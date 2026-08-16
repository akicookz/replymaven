import { describe, expect, test } from "bun:test";
import {
  createSendOutbox,
  type SendOutboxEntrySnapshot,
} from "./send-outbox";

interface Harness {
  outbox: ReturnType<typeof createSendOutbox<string>>;
  attempts: Array<{
    input: string;
    isCurrent(): boolean;
    delivered(): void;
    ambiguous(): void;
    reject(): void;
  }>;
  published: SendOutboxEntrySnapshot[][];
  advance(ms: number): void;
}

function harness(overrides: {
  maxAttempts?: number;
  maxAgeMs?: number;
  capacity?: number;
  attemptTimeoutMs?: number;
  adjudicationTimeoutMs?: number;
} = {}): Harness {
  const attempts: Harness["attempts"] = [];
  const published: SendOutboxEntrySnapshot[][] = [];
  let clock = 0;
  let timerId = 0;
  const timers = new Map<number, { handler(): void; at: number }>();
  const outbox = createSendOutbox<string>({
    attempt(input, isCurrent) {
      return new Promise((resolve, reject) => {
        attempts.push({
          input,
          isCurrent,
          delivered: () => resolve("delivered"),
          ambiguous: () => resolve("ambiguous"),
          reject: () => reject(new Error("attempt failed")),
        });
      });
    },
    onChange(entries) {
      published.push(entries);
    },
    now: () => clock,
    setTimer(handler, ms) {
      timerId += 1;
      timers.set(timerId, { handler, at: clock + ms });
      return timerId;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
    ...overrides,
  });
  return {
    outbox,
    attempts,
    published,
    advance(ms: number) {
      clock += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at > clock) continue;
        timers.delete(id);
        timer.handler();
      }
    },
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function lastState(h: Harness, id: string): string | undefined {
  for (let index = h.published.length - 1; index >= 0; index -= 1) {
    const entry = h.published[index]!.find((candidate) => candidate.id === id);
    if (entry) return entry.state;
  }
  return undefined;
}

describe("widget send outbox", () => {
  test("delivers on a live-socket resolution and prunes the entry", async () => {
    const h = harness();
    expect(h.outbox.enqueue("m1", "hello")).toBe(true);
    await settle();
    expect(h.attempts).toHaveLength(1);
    expect(lastState(h, "m1")).toBe("inflight");
    h.attempts[0]!.delivered();
    await settle();
    expect(lastState(h, "m1")).toBe("delivered");
    expect(h.outbox.snapshot()).toHaveLength(0);
  });

  test("confirmInflight settles the head entry at turn start", async () => {
    const h = harness();
    h.outbox.enqueue("m1", "hello");
    await settle();
    expect(lastState(h, "m1")).toBe("inflight");

    // Server streaming proves receipt long before the final frame resolves
    // the attempt.
    h.outbox.confirmInflight();
    expect(lastState(h, "m1")).toBe("delivered");
    expect(h.outbox.snapshot()).toHaveLength(0);

    // The superseded attempt's late resolution must not double-fire, and the
    // next message flushes normally afterwards.
    h.attempts[0]!.delivered();
    await settle();
    h.outbox.enqueue("m2", "next");
    await settle();
    expect(h.attempts).toHaveLength(2);
    expect(lastState(h, "m2")).toBe("inflight");
    h.outbox.confirmInflight();
    expect(lastState(h, "m2")).toBe("delivered");
  });

  test("confirmInflight without an inflight entry is a no-op", async () => {
    const h = harness();
    h.outbox.confirmInflight();
    expect(h.outbox.snapshot()).toHaveLength(0);
    h.outbox.enqueue("m1", "hello");
    await settle();
    h.attempts[0]!.delivered();
    await settle();
    h.outbox.confirmInflight();
    expect(lastState(h, "m1")).toBe("delivered");
  });

  test("a rejected attempt requeues, invalidates the stale guard, and resends on the next trigger", async () => {
    const h = harness();
    h.outbox.enqueue("m1", "hello");
    await settle();
    const first = h.attempts[0]!;
    first.reject();
    await settle();
    expect(lastState(h, "m1")).toBe("queued");
    // The superseded attempt must never pass the pre-write guard again.
    expect(first.isCurrent()).toBe(false);
    expect(h.attempts).toHaveLength(1);
    h.outbox.poke();
    await settle();
    expect(first.isCurrent()).toBe(false);
    h.attempts[1]!.delivered();
    await settle();
    expect(lastState(h, "m1")).toBe("delivered");
  });

  test("flushes strictly one at a time in order", async () => {
    const h = harness();
    h.outbox.enqueue("m1", "first");
    h.outbox.enqueue("m2", "second");
    await settle();
    expect(h.attempts.map((attempt) => attempt.input)).toEqual(["first"]);
    h.attempts[0]!.delivered();
    await settle();
    expect(h.attempts.map((attempt) => attempt.input)).toEqual([
      "first",
      "second",
    ]);
  });

  test("becomes undeliverable after max rejected attempts and recovers via retry", async () => {
    const h = harness({ maxAttempts: 2 });
    h.outbox.enqueue("m1", "hello");
    await settle();
    h.attempts[0]!.reject();
    await settle();
    h.outbox.poke();
    await settle();
    h.attempts[1]!.reject();
    await settle();
    expect(lastState(h, "m1")).toBe("undeliverable");
    h.outbox.poke();
    await settle();
    expect(h.attempts).toHaveLength(2);

    h.outbox.retry("m1");
    await settle();
    expect(h.attempts).toHaveLength(3);
    h.attempts[2]!.delivered();
    await settle();
    expect(lastState(h, "m1")).toBe("delivered");
  });

  test("an undeliverable head does not block later messages", async () => {
    const h = harness({ maxAttempts: 1 });
    h.outbox.enqueue("m1", "first");
    await settle();
    h.attempts[0]!.reject();
    await settle();
    expect(lastState(h, "m1")).toBe("undeliverable");
    h.outbox.enqueue("m2", "second");
    await settle();
    expect(h.attempts.map((attempt) => attempt.input)).toEqual([
      "first",
      "second",
    ]);
  });

  test("expires a queued entry after the age limit", async () => {
    const h = harness();
    h.outbox.enqueue("m1", "hello");
    await settle();
    h.attempts[0]!.reject();
    await settle();
    h.advance(30_000);
    expect(lastState(h, "m1")).toBe("undeliverable");
  });

  test("ambiguous outcome waits inflight; reconcile-present delivers", async () => {
    const h = harness();
    h.outbox.enqueue("m1", "hello");
    await settle();
    h.attempts[0]!.ambiguous();
    await settle();
    expect(lastState(h, "m1")).toBe("inflight");
    // No blind resend on pokes while awaiting adjudication.
    h.outbox.poke();
    await settle();
    expect(h.attempts).toHaveLength(1);
    h.outbox.reconcile(new Set(["m1"]));
    await settle();
    expect(lastState(h, "m1")).toBe("delivered");
  });

  test("ambiguous outcome resends only after reconcile proves absence", async () => {
    const h = harness();
    h.outbox.enqueue("m1", "hello");
    await settle();
    const first = h.attempts[0]!;
    first.ambiguous();
    await settle();
    h.outbox.reconcile(new Set());
    await settle();
    expect(first.isCurrent()).toBe(false);
    expect(h.attempts).toHaveLength(2);
    h.attempts[1]!.delivered();
    await settle();
    expect(lastState(h, "m1")).toBe("delivered");
  });

  test("an unadjudicated ambiguous entry goes undeliverable, never blindly resent", async () => {
    const h = harness();
    h.outbox.enqueue("m1", "hello");
    await settle();
    h.attempts[0]!.ambiguous();
    await settle();
    h.advance(60_000);
    expect(lastState(h, "m1")).toBe("undeliverable");
    h.outbox.poke();
    await settle();
    expect(h.attempts).toHaveLength(1);
  });

  test("an attempt that never settles times out to undeliverable without a resend", async () => {
    const h = harness();
    h.outbox.enqueue("m1", "hello");
    await settle();
    h.advance(120_000);
    await settle();
    expect(lastState(h, "m1")).toBe("undeliverable");
    h.outbox.poke();
    await settle();
    expect(h.attempts).toHaveLength(1);
  });

  test("reconcile heals an undeliverable entry the server actually has", async () => {
    const h = harness();
    h.outbox.enqueue("m1", "hello");
    await settle();
    h.attempts[0]!.ambiguous();
    await settle();
    h.advance(60_000);
    expect(lastState(h, "m1")).toBe("undeliverable");
    h.outbox.reconcile(new Set(["m1"]));
    await settle();
    expect(lastState(h, "m1")).toBe("delivered");
    expect(h.outbox.snapshot()).toHaveLength(0);
  });

  test("a reconcile requeue re-arms the age clock", async () => {
    const h = harness();
    h.outbox.enqueue("m1", "hello");
    await settle();
    h.attempts[0]!.ambiguous();
    await settle();
    h.advance(20_000);
    h.outbox.reconcile(new Set());
    await settle();
    // The resend attempt rejects; the entry sits queued and must still be
    // able to expire on its refreshed clock.
    h.attempts[1]!.reject();
    await settle();
    expect(lastState(h, "m1")).toBe("queued");
    h.advance(30_000);
    expect(lastState(h, "m1")).toBe("undeliverable");
  });

  test("rejects beyond capacity and clears completely", async () => {
    const h = harness({ capacity: 2 });
    expect(h.outbox.enqueue("m1", "a")).toBe(true);
    expect(h.outbox.enqueue("m2", "b")).toBe(true);
    expect(h.outbox.enqueue("m3", "c")).toBe(false);
    h.outbox.clear();
    expect(h.outbox.snapshot()).toHaveLength(0);
    expect(h.published.at(-1)).toEqual([]);
    h.attempts[0]?.delivered();
    await settle();
    expect(h.outbox.snapshot()).toHaveLength(0);
  });
});
