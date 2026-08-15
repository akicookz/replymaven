export type SendOutboxState =
  | "queued"
  | "inflight"
  | "delivered"
  | "undeliverable";

export interface SendOutboxEntrySnapshot {
  id: string;
  state: SendOutboxState;
  attempts: number;
}

export type SendAttemptOutcome = "delivered" | "ambiguous";

interface SendOutboxEntry<TInput> {
  id: string;
  input: TInput;
  state: SendOutboxState;
  attempts: number;
  enqueuedAt: number;
  attemptEpoch: number;
  // Set once an attempt reaches "ambiguous": the write may have happened, so
  // this entry must never be resent without a reconcile proving absence.
  maybeSent: boolean;
  ageTimer: unknown;
  adjudicationTimer: unknown;
}

interface SendOutboxOptions<TInput> {
  // Contract:
  // - resolve "delivered": the server's final frame arrived on a live socket.
  // - resolve "ambiguous": the attempt may have written the message but the
  //   outcome is unknown (socket closed around resolution). The entry stays
  //   inflight until a reconcile adjudicates it.
  // - reject: the attempt provably failed BEFORE the socket write; resending
  //   is safe.
  // isCurrent must be re-checked immediately before the socket write: a
  // reconcile can requeue this entry while the attempt is parked, and the
  // requeued copy must be the only one that actually sends.
  attempt(
    input: TInput,
    isCurrent: () => boolean,
  ): Promise<SendAttemptOutcome>;
  onChange(entries: SendOutboxEntrySnapshot[]): void;
  // Safety net for an attempt that never settles (zombie socket, hung turn).
  // On expiry the entry becomes undeliverable; it is never blindly resent.
  attemptTimeoutMs?: number;
  maxAttempts?: number;
  maxAgeMs?: number;
  // How long an ambiguous entry waits for a reconcile before going
  // undeliverable.
  adjudicationTimeoutMs?: number;
  capacity?: number;
  now?(): number;
  setTimer?(handler: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export interface SendOutbox<TInput> {
  enqueue(id: string, input: TInput): boolean;
  retry(id: string): void;
  // Post-recovery adjudication against the server-authoritative message ids:
  // present means delivered (including undeliverable entries, which heal); an
  // interrupted or ambiguous inflight entry that is absent goes back to
  // queued for a resend.
  reconcile(serverIds: ReadonlySet<string>): void;
  // Connection-usable trigger; starts a flush if anything is queued.
  poke(): void;
  clear(): void;
  snapshot(): SendOutboxEntrySnapshot[];
}

export function createSendOutbox<TInput>(
  options: SendOutboxOptions<TInput>,
): SendOutbox<TInput> {
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 120_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  const adjudicationTimeoutMs = options.adjudicationTimeoutMs ?? 60_000;
  const capacity = options.capacity ?? 20;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ??
    ((handler: () => void, ms: number) => setTimeout(handler, ms));
  const clearTimer = options.clearTimer ??
    ((handle: unknown) => clearTimeout(handle as number));

  let entries: Array<SendOutboxEntry<TInput>> = [];
  let flushing = false;

  function snapshot(): SendOutboxEntrySnapshot[] {
    return entries.map((entry) => ({
      id: entry.id,
      state: entry.state,
      attempts: entry.attempts,
    }));
  }

  function clearEntryTimers(entry: SendOutboxEntry<TInput>): void {
    clearTimer(entry.ageTimer);
    clearTimer(entry.adjudicationTimer);
    entry.ageTimer = null;
    entry.adjudicationTimer = null;
  }

  function publishAndPrune(): void {
    options.onChange(snapshot());
    for (const entry of entries) {
      if (entry.state === "delivered") clearEntryTimers(entry);
    }
    entries = entries.filter((entry) => entry.state !== "delivered");
  }

  function deliver(entry: SendOutboxEntry<TInput>): void {
    entry.state = "delivered";
    entry.attemptEpoch += 1;
  }

  function fail(entry: SendOutboxEntry<TInput>): void {
    entry.state = "undeliverable";
    entry.attemptEpoch += 1;
    clearEntryTimers(entry);
  }

  function requeue(entry: SendOutboxEntry<TInput>): void {
    entry.state = "queued";
    // Always invalidate the superseded attempt so a parked isCurrent guard
    // can never pass again for it.
    entry.attemptEpoch += 1;
  }

  function armAgeTimer(entry: SendOutboxEntry<TInput>): void {
    clearTimer(entry.ageTimer);
    entry.ageTimer = setTimer(() => {
      // Only a queued entry expires outright: it provably never left the
      // client. Inflight entries are settled by their attempt, the
      // adjudication timer, or the safety timeout.
      if (entry.state !== "queued") return;
      fail(entry);
      publishAndPrune();
    }, maxAgeMs);
  }

  function enqueue(id: string, input: TInput): boolean {
    const pending = entries.filter((entry) =>
      entry.state === "queued" || entry.state === "inflight"
    );
    if (pending.length >= capacity) return false;
    const entry: SendOutboxEntry<TInput> = {
      id,
      input,
      state: "queued",
      attempts: 0,
      enqueuedAt: now(),
      attemptEpoch: 0,
      maybeSent: false,
      ageTimer: null,
      adjudicationTimer: null,
    };
    entries.push(entry);
    armAgeTimer(entry);
    publishAndPrune();
    poke();
    return true;
  }

  function retry(id: string): void {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry || entry.state !== "undeliverable") return;
    requeue(entry);
    entry.attempts = 0;
    entry.enqueuedAt = now();
    armAgeTimer(entry);
    publishAndPrune();
    poke();
  }

  function reconcile(serverIds: ReadonlySet<string>): void {
    let changed = false;
    for (const entry of entries) {
      if (entry.state === "delivered") continue;
      if (serverIds.has(entry.id)) {
        // Present server-side settles every non-terminal state, and heals an
        // undeliverable entry whose write actually landed.
        deliver(entry);
        changed = true;
        continue;
      }
      if (entry.state === "inflight") {
        // Adjudicated absent: the write never landed, so a resend is safe.
        clearTimer(entry.adjudicationTimer);
        entry.adjudicationTimer = null;
        entry.maybeSent = false;
        requeue(entry);
        armAgeTimer(entry);
        entry.enqueuedAt = now();
        changed = true;
      }
    }
    if (changed) publishAndPrune();
    poke();
  }

  function attemptWithTimeout(
    entry: SendOutboxEntry<TInput>,
    epoch: number,
  ): Promise<SendAttemptOutcome | "timeout"> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimer(() => {
        if (settled) return;
        settled = true;
        resolve("timeout");
      }, attemptTimeoutMs);
      const isCurrent = () =>
        entry.attemptEpoch === epoch && entry.state === "inflight";
      options.attempt(entry.input, isCurrent).then((outcome) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        resolve(outcome);
      }, (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async function flush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      for (;;) {
        const entry = entries.find((candidate) => candidate.state === "queued");
        if (!entry) return;
        entry.state = "inflight";
        entry.attempts += 1;
        const epoch = entry.attemptEpoch;
        publishAndPrune();
        try {
          const outcome = await attemptWithTimeout(entry, epoch);
          if (entry.attemptEpoch !== epoch) continue;
          if (outcome === "delivered") {
            deliver(entry);
            publishAndPrune();
            continue;
          }
          // "ambiguous" and "timeout" both mean the write may have happened;
          // never resend without a reconcile. Ambiguous waits for the
          // recovery that follows the socket close; timeout gives up.
          entry.maybeSent = true;
          if (outcome === "timeout") {
            fail(entry);
            publishAndPrune();
            return;
          }
          clearTimer(entry.adjudicationTimer);
          entry.adjudicationTimer = setTimer(() => {
            if (entry.state !== "inflight" || entry.attemptEpoch !== epoch) {
              return;
            }
            fail(entry);
            publishAndPrune();
          }, adjudicationTimeoutMs);
          // Leave the entry inflight for reconcile; later entries must not
          // overtake it, so stop flushing.
          return;
        } catch {
          if (entry.attemptEpoch !== epoch) continue;
          const overAge = now() - entry.enqueuedAt >= maxAgeMs;
          if (overAge || entry.attempts >= maxAttempts) {
            fail(entry);
          } else {
            requeue(entry);
          }
          publishAndPrune();
          // A failed head waits for the next trigger instead of spinning;
          // nothing behind it can succeed on the same dead connection.
          return;
        }
      }
    } finally {
      flushing = false;
    }
  }

  function poke(): void {
    void flush();
  }

  function clear(): void {
    for (const entry of entries) {
      clearEntryTimers(entry);
      entry.attemptEpoch += 1;
    }
    entries = [];
    options.onChange([]);
  }

  return { enqueue, retry, reconcile, poke, clear, snapshot };
}
