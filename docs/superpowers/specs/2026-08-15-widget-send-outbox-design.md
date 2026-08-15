# Widget Send Outbox Design

**Date:** 2026-08-15

**Status:** Draft for review

## Objective

Make visitor message delivery in the embed widget lossless. Today a message
can render as sent while it never reached the server, with no retry and no
honest failure state. The fix is an outbox: every outgoing message is a
tracked object with a delivery lifecycle, confirmed by server echo, resent
automatically after reconnects, and surfaced as "not delivered" only when
retries are exhausted.

All changes live in the widget bundle (`widget/index.ts`,
`widget/agent-chat-bridge.tsx`). No worker changes.

## Loss windows this closes

Observed on production 2026-08-15 (the "hi"/"gi" conversation created nine
seconds after a deploy reset, messages rendered locally, absent server-side):

1. **Deploy reset.** A push to main resets every Durable Object and drops
   every socket. A send racing the reconnect can pass `waitForOpenSocket`
   and write to a socket whose server side is gone.
2. **Open timeout.** `waitForOpenSocket` rejects after 10 seconds. The catch
   shows "Failed to send" once, but the message is never retried, and the
   status silently resets on the next send.
3. **Resume-probe race.** A submit that lands in the same socket batch as the
   stream-resume probe gets its turn buffered server-side awaiting a replay
   ACK that never comes (documented in `agent-chat-bridge.tsx`). The socket
   write succeeds, so the client shows "Sent" while the server discards the
   turn. The current gate prevents this only for the initial CONNECTING
   state, not for mid-session reconnects.

Root defect across all three: "Sent" is inferred from the local socket write
(`agentChatClient.send` resolving) or from a reply starting to stream
(`markPendingVisitorMessageSent`), never from the server acknowledging the
message.

## What already exists and is kept

- Client-generated message ids: `optimisticMessageId = crypto.randomUUID()`
  is already passed as `id` through `agentChatClient.send` and into the
  `UIMessage`. Ids are the idempotency key; nothing new needed here.
- Optimistic rendering: `addMessageToUI(..., optimistic)` plus
  `pendingVisitorMessageIds` already swap the local bubble for the server
  copy when the echo arrives (`widget/index.ts:5043`).
- The per-message status element ("Sending..." / "Sent" / "Failed").
- Image uploads happen over HTTP before the socket send and already have
  their own retry; the outbox stores the resolved `uploadedImageUrl`, so a
  resend never re-uploads.

## Design

### Outbox states

Each entry: `{ id, content, imageUrls, pageContext, state, attempts,
enqueuedAt }` with states:

- `queued` — created on submit, rendered immediately as "Sending...".
- `inflight` — handed to `sendMessage`; stays inflight until confirmed or
  the attempt fails.
- `delivered` — the id appeared in server-synced messages. Terminal. The
  status element flips to "Sent"; rendering is owned by the normal message
  sync from here on.
- `undeliverable` — retries exhausted. Terminal until the visitor taps
  retry, which re-enqueues the same entry (same id).

The outbox is a bounded FIFO (cap 20). At cap, submit fails fast with the
existing "Failed to send" status rather than growing without bound.

### Confirmation contract

(Amended twice. The draft's echo-only rule was wrong because
`useAgentChat.messages` contains the sender's optimistic copy and human-mode
conversations never produce a reply. The second draft's
"resolution = delivered, 20s timeout = retry" rule was then broken by the
adversarial review on two counts: `sendMessage` resolves only after the
*entire turn* completes, so any turn longer than the timeout triggered a
blind resend and a duplicate turn; and the transport also resolves
`sendMessage` when the socket *closes*, marking lost messages delivered.)

An attempt has three outcomes:

1. **delivered** — `sendMessage` resolved while the socket is still OPEN.
   Only then is the final frame provably from the server. Covers replies,
   silenced turns (human mode's 204), and gate outcomes alike, regardless of
   turn duration.
2. **ambiguous** — `sendMessage` resolved at/after a socket close. The write
   may or may not have landed. The entry stays inflight and is adjudicated
   by the post-recovery reconcile: id present → delivered (this also heals
   entries that already went undeliverable); id absent → requeued with a
   bumped attempt epoch and a fresh age clock, then resent. If no recovery
   arrives within 60 seconds, the entry goes undeliverable — never a blind
   resend.
3. **rejected** — the attempt provably failed before the socket write
   (open-wait timeout, close-before-open, superseded, not connected).
   Requeue with a bumped epoch; resend on the next trigger is safe.

There is no short attempt timeout. A 120-second safety timeout covers an
attempt that never settles (zombie socket); it marks the entry undeliverable
without resending, since the write may have happened. Manual retry after
that is the one path that can still duplicate a turn; it is user-initiated,
visible, and requires a >120s turn plus a tap.

`markPendingVisitorMessageSent` (reply-stream heuristic) is deleted.

### Flush algorithm

The outbox lives in the bridge (it already owns the socket, `useAgentChat`
messages, and `isRecovering`). Flush runs:

- immediately on enqueue;
- on every socket `open` event, **after** recovery completes
  (`isRecovering` false) and the resulting message sync has been reconciled;
- on manual tap-to-retry.

Flush is FIFO and sequential: entry N+1 is not attempted until entry N is
`delivered`. An `undeliverable` entry steps aside rather than blocking the
queue; ordering holds among entries that are still being attempted. Per
attempt: `waitForOpenSocket` → `sendMessage` with the entry's id and stored
body, raced against a 20-second attempt timeout. An attempt failure leaves
the entry `queued` and waits for the next flush trigger — connection-usable
activity updates and the post-recovery reconcile — because a send can only
succeed when the socket is open.

A requeued entry's superseded attempt can still be parked on the socket-open
wait; the attempt re-checks an `isCurrent` guard immediately before the
socket write so only the current attempt ever sends (the reconnected
PartySocket is the same object, so the stale wait does resolve).

An entry becomes `undeliverable` after 3 failed attempts or 30 seconds in
the outbox, whichever comes first; an attempt already in flight when the
clock fires may still conclude as delivered, because the server did receive
it. Attempts and the clock reset on manual retry.

### Why reconcile-before-resend is mandatory

Resending an id the server already has would re-run the turn: the server
persists the incoming message by id upsert (no duplicate row), but a
chat-request always runs a turn against the last user message. The
reconcile step guarantees a resend happens only when the server provably
never received the message, making delivery exactly-once at the turn level.

The post-recovery ordering also keeps a resend behind the stream-resume
probe on a fresh socket, which is the same ordering the existing
`waitForOpenSocket` comment requires for first connects.

### UI states

- `queued`/`inflight`: existing "Sending..." label.
- `delivered`: existing "Sent" label with the current fade-out.
- `undeliverable`: the status element becomes "Not delivered · Retry", where
  Retry is a tap target that re-enqueues. The bubble stays in place.
- The fake bot bubble on failure ("Sorry, I couldn't connect...") is
  removed. It is a hardcoded bot utterance in the transcript for what is a
  transport problem; the per-message status line is the honest surface. The
  bubble also polluted transcripts that later synced fine.
- The composer no longer blocks on delivery. Today `sendMessage` is awaited
  before the input re-enables; with the outbox, submit enqueues and returns,
  and the input unlocks immediately. Server-side turn queueing
  (`messageConcurrency: "queue"`) already serializes rapid messages.

### Bridge interface changes

`WidgetAgentChatClient.send` becomes enqueue (resolves on enqueue, not
delivery). The bridge exposes outbox transitions to `widget/index.ts`
through the existing listener pattern (a new `onOutbox(entries)` alongside
`onMessages`/`onActivity`) so the DOM layer can update status elements by
message id. The lazy-client wrapper (`lazy-agent-chat-client.ts`) forwards
the new listener; its generation guard already handles identity resets.

### Identity and conversation resets

`identitySessions` reset (visitor identify/logout) and conversation switch
already tear down the bridge via `disconnect()`. `disconnect()` drops the
outbox; queued messages for a dead identity session must not be delivered
under a new one. This matches the existing behavior of
`pendingVisitorMessageIds.clear()` on reset.

## Non-goals

- Persisting the outbox across page reloads. A reload creates a new widget
  session; undelivered messages are lost as they are today. Revisit only if
  reload-during-send shows up in practice.
- Multi-tab coordination. Each tab has an independent outbox; ids are
  unique per tab, so the worst case is two turns from two tabs, which is
  current behavior.
- Dashboard/sidechat send paths. The sidechat has its own retry planning
  (`planFailedSidechatRetry`); out of scope here.

## Testing

Unit tests in `widget/agent-chat-bridge.test.tsx` with a fake socket and
scripted message syncs:

- send while OPEN → delivered on echo, exactly one `sendMessage` call;
- send while CONNECTING → held, flushed after open + recovery, delivered;
- socket drops after send, echo never arrives → resent once after
  reconnect + reconciliation, delivered, no duplicate send for an id the
  sync contains;
- echo arrives during recovery → no resend;
- three failed attempts → `undeliverable`; manual retry re-enqueues and
  delivers;
- FIFO: second message never sent before first confirms;
- identity reset mid-queue → outbox dropped, no send under new session;
- cap: 21st enqueue rejects.

Manual verification on `test-widget.html` against dev: kill the socket from
devtools mid-send and confirm resend-on-reconnect and the not-delivered
state.

## Rollout

Widget deploys are manual and independent of the worker
(`bun run widget:deploy` → R2, `Cache-Control: max-age=600`). Old bundles
keep working unchanged against the current worker; no protocol change is
involved. Ship, then verify on production with a forced socket drop before
announcing.

## Version skew

The embed and runtime bundles deploy together but cache independently for
600 seconds, so either pairing can occur for up to ~10 minutes after a
deploy:

- **New embed + old runtime**: the lazy client feature-detects `onOutbox`
  and `retry`. Against an old runtime it falls back to the old semantics and
  synthesizes outbox transitions from the `send()` promise (resolve →
  delivered, reject → undeliverable) so the status line keeps working
  instead of the chat crashing on a missing method.
- **Old embed + new runtime**: the old embed awaits `send()`, which now
  resolves on enqueue, so its "Sent" label appears early during the skew
  window. Transitional and harmless.

## Adversarial review round (2026-08-16)

A four-dimension review workflow with adversarial verification (20 agents)
confirmed 12 findings against the first implementation; all are fixed and
regression-tested:

- Both delivery-contract breaks above (duplicate turns from the 20s timeout;
  close-resolution marking lost messages delivered) — fixed by the
  delivered/ambiguous/rejected contract.
- `attemptEpoch` was not bumped on the failure requeue, so a superseded
  parked attempt's `isCurrent` guard could pass again — every requeue now
  bumps.
- Reconcile skipped `undeliverable` entries present in the server snapshot
  — now heals them to delivered.
- A reconcile requeue lost the entry's age clock — re-armed with a fresh
  budget.
- The transport-unavailable submit path lost the typed draft and mislabeled
  the previous message's status — the catch only touches the failed
  message's own element and restores the draft when nothing rendered.
- The "Image failed to upload" notice was overwritten by the outbox's
  "Sending..." — it is now a separate persistent note element.
- `handleAgentOutbox` re-processed every entry on every publish, churning
  Retry buttons and hiding the typing indicator for unrelated turns — the
  DOM layer now diffs against the last rendered state per id.
- New-embed/old-runtime skew threw `delegate.onOutbox is not a function` —
  the feature-detected fallback above.

## Review findings incorporated

Self-review against the first draft changed the following:

1. **Reply-stream confirmation removed rather than kept as a fallback.**
   Draft kept `markPendingVisitorMessageSent` alongside echo confirmation.
   That reintroduces the false-"Sent" bug for the buffered-turn race (a
   reply can stream for a turn whose message the server later discards is
   not possible — but a *previous* turn's late chunks can arrive after a new
   send, mislabeling it). One confirmation source, the echo, is strictly
   safer and simpler.
2. **Timer-based retry loop removed.** Draft retried on an exponential
   timer. A send can only succeed on an open socket, and PartySocket already
   owns reconnection with infinite retries, so the `open` event is the only
   meaningful retry trigger; timers just add races with recovery. The
   30-second undeliverable clock is the only timer left.
3. **Composer unblock called out explicitly.** Decoupling submit from
   delivery changes `isSending` handling in `widget/index.ts`; the draft
   left it implicit and it would have deadlocked the input on a queued entry.
4. **Image URLs stored post-upload.** Draft stored the `File`, which would
   re-upload on retry and can fail after identity reset; storing the
   resolved URL makes retries pure socket operations.
5. **Outbox placed in the bridge, not `index.ts`.** The DOM layer lacks
   access to server message state and `isRecovering`; putting the queue
   where confirmation data lives avoids a second cross-layer protocol.

## Open questions

1. Should `undeliverable` also offer "copy text" so a visitor can recover a
   long message if retry keeps failing? Cheap, but adds UI surface.
2. Cap value (20) and attempt budget (3 / 30s) are judgment calls; tune
   after observing production behavior.
3. Whether to emit a content-free analytics event on `undeliverable` so
   silent loss is measurable. Leaning yes via the existing widget event
   hook if one exists; otherwise defer.
