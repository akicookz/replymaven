# Message Delivery / Read Receipts (dashboard-side)

**Date:** 2026-07-01
**Status:** Design — pending implementation plan

## Problem

When an agent (or the bot) sends a message to a visitor, the dashboard gives no
signal about what happened to it. The agent cannot tell whether the message
reached the visitor's widget, whether the visitor actually saw it, or whether it
fell back to email because the visitor was offline. The only persisted
delivery-ish signal today is `messages.emailedAt`, and it isn't even rendered.

**Goal:** give agents confidence that a message they sent was actually
**delivered** and **seen**, presented in the customer-support convention
(muted text labels, a prominent "Emailed" fallback badge) rather than raw
WhatsApp tick glyphs.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where status shows | **Dashboard only** | Matches the ask; agents see status on the messages they send. No visitor-side receipts. |
| "Read" signal | **Widget panel open + tab focused** | Reuses existing `markConversationSeen`/visibility-focus logic; WhatsApp/Intercom "open the chat = read" semantics. No per-message IntersectionObserver. |
| Which messages get receipts | **Agent + bot** (`role in ('agent','bot')`) | Consistent ticks across all outbound messages. Visitor/system messages never get status. |
| Transport / persistence | **Approach A** — widget acks over WebSocket, persisted in the Durable Object; heartbeat POST carries the same for polling fallback | Reuses the DO's existing `drizzle(env.DB)` + `ChatService` access and presence machinery; low latency; minimal new HTTP surface. |
| Presentation | **Support-tool style** — `Sent → Delivered → Seen` as muted text, `Seen` emphasized, `Emailed` as a composing badge; exact times on hover | Maps honestly onto what a web widget can observe; the email fallback is first-class. The middle "Delivered" state is kept (the user wants delivery confidence), unlike Intercom which drops it. |

## Out of scope

- Visitor-side receipts (whether the *agent* has read the visitor's messages).
- Per-message scroll-into-view ("IntersectionObserver") read precision.
- Status ticks in the conversation **list** preview — thread view only for v1.
- Email bounce / delivery-failure surfacing beyond the existing flow (the
  `Emailed` badge reflects `emailedAt`; bounce handling is a separate concern).

## State model

For each outbound message the dashboard derives one primary state plus an
optional email badge:

```
primary:  Sent  →  Delivered  →  Seen      (monotonic; later supersedes earlier)
badge:    Emailed                          (independent; shown when emailedAt set)
```

- **Sent** — message persisted server-side (`createdAt`), no delivery ack yet.
- **Delivered** — the visitor's widget received it (`deliveredAt`). On the web
  this means "widget was loaded, connected, and received it" — if the visitor
  has left the page it stays at *Sent* until they return and the widget
  reconnects (`resume`/poll), which fires the delivered ack. This limitation is
  expected and is exactly why the `Emailed` badge matters.
- **Seen** — the visitor had the widget open + focused at/after delivery
  (`readAt`). Setting `readAt` also backfills `deliveredAt` if null.
- **Emailed** — `emailedAt` is set (agent chose "send as email", or the
  inbound-mail / offline path emailed it). Composes with the primary state,
  e.g. "Sent · Emailed", "Seen · Emailed".

Precedence for the primary label: `readAt ? Seen : deliveredAt ? Delivered : Sent`.

## Data model

New Drizzle migration adding two nullable timestamp columns to `messages`
(`worker/db/schema.ts`, mirroring the existing `emailedAt`):

```ts
deliveredAt: integer("delivered_at", { mode: "timestamp" }),
readAt:      integer("read_at",      { mode: "timestamp" }),
```

- Only ever set for outbound rows (`role in ('agent','bot')`).
- Pre-existing messages stay null → render as plain "Sent". No backfill.
- Migration generated via `bun run db:generate` (never hand-written SQL).

## ChatService methods

Two idempotent "up-to" methods mirroring `markMessageAsEmailed`
(`worker/services/chat-service.ts`). They take a cutoff timestamp (the
`createdAt` of the newest message the widget acked) and mark all earlier
outbound messages that lack the timestamp. They **return the affected message
IDs** so the caller can broadcast a precise status event (and skip the
broadcast entirely when nothing changed — keeps re-acks silent).

```ts
// set deliveredAt = now where role in (agent,bot)
//   AND deliveredAt IS NULL AND createdAt <= cutoff. returns affected ids.
async markMessagesDelivered(conversationId: string, cutoff: Date): Promise<string[]>

// set readAt = now (and deliveredAt = now where still null) for the same
//   predicate on readAt. returns affected ids (newly-read).
async markMessagesRead(conversationId: string, cutoff: Date): Promise<string[]>
```

Notes:
- "Read implies delivered": `markMessagesRead` also sets `deliveredAt` where
  null, so a fast reader shows *Seen* without losing a delivered moment.
- Idempotent: re-acking the same id affects 0 rows → no broadcast.

## Wire contract (`shared/ws-events.ts`)

Add one server event (fanned only to agent sockets) and two client events
(sent by the visitor widget):

```ts
// ServerEvent (added)
| { type: "message:status"; conversationId: string;
    status: "delivered" | "read"; messageIds: string[]; at: number }

// ClientEvent (added)
| { type: "delivered"; upToMessageId: string }
| { type: "read";      upToMessageId: string }
```

`MessagePayload` is **not** extended — a freshly broadcast `message:new` is
always "Sent"; status arrives via subsequent `message:status` events.

## Backend flow

### WebSocket path (primary) — `worker/durable-objects/conversation-do.ts`

Extend `webSocketMessage` to handle `delivered` / `read` frames (alongside the
existing `ping`/`resume`/`presence`):

1. Guard: only act on `kind === "visitor"` sockets (from the attachment).
2. Resolve the cutoff: `chatService.getMessageById(upToMessageId)` → `createdAt`
   (verify it belongs to this conversation).
3. `markMessagesDelivered` / `markMessagesRead` → affected ids.
4. If non-empty, fan a `message:status` event out to the DO's `kind:agent`
   sockets (iterate `this.state.getWebSockets()`, filter by attachment kind —
   the same loop shape as `handleBroadcast`, no exclude needed since the sender
   is a visitor socket).

### Polling fallback — widget heartbeat route

The widget already sends presence via `POST /api/widget/:slug/conversations/:id/heartbeat`.
Extend that route's body to optionally carry `deliveredUpTo` / `readUpTo`
message ids. The worker handler resolves the cutoff, calls the same ChatService
methods, and broadcasts the `message:status` event via the existing `dispatch`
helper in `worker/realtime/broadcast.ts` (new `broadcastMessageStatus(env, ctx,
conversationId, status, messageIds)`). This keeps the WS and poll paths sharing
one persistence + broadcast implementation.

## Widget changes (`widget/index.ts`)

The visitor widget gains two acks. Both report the **newest outbound (agent/bot)
message id** the widget currently holds (read-up-to / monotonic):

- **Delivered ack** — fire whenever the widget receives outbound message(s):
  on WS `message:new` for an agent/bot message, and after a poll/`resume` fetch
  that returns outbound messages. Debounced (coalesce bursts).
  - WS connected: send `{ type: "delivered", upToMessageId }`.
  - Polling mode: include `deliveredUpTo` on the next heartbeat POST.
- **Read ack** — fire when the chat panel is open **and** the tab is focused.
  Reuse the existing `markConversationSeen()` trigger points + visibility/focus
  listeners. Send `{ type: "read", upToMessageId }` (WS) or `readUpTo`
  (heartbeat). Read ack also implies delivered, so it can subsume the delivered
  ack when both are due.

Only outbound messages are acked; the visitor's own messages need no ack. No
change to the visitor-facing "Sending… / Sent / Failed" optimistic indicator on
the *visitor's own* outgoing messages — that is separate and stays as-is.

## Dashboard changes

### Types — `src/lib/inbox/types.ts`
Add `deliveredAt?: string | null` and `readAt?: string | null` to the `Message`
type (next to the existing `emailedAt`).

### Detail endpoint — `worker/index.ts` (`GET /api/projects/:id/conversations/:convId`)
Include `deliveredAt` / `readAt` in the messages select so status renders on
initial load (the select already returns `emailedAt`).

### Realtime — `src/lib/use-conversation-ws.ts`
Handle the new `message:status` event: patch the `["conversation-detail", id]`
React Query cache, setting `deliveredAt`/`readAt` on the listed `messageIds`.

### Optimistic insert — `src/pages/Conversations.tsx` (`sendReply`)
The optimistic agent message gets `deliveredAt: null, readAt: null` (alongside
the existing `emailedAt: null`); the ws dedup/replace path is unchanged.

### UI — `src/components/inbox/MessageBubble.tsx`
On outbound (agent/bot) messages only, render a small muted status row beneath
the bubble next to the timestamp. **No divider lines** — separate with spacing
and muted color only (per project style rule).

- Copy: `Sent` · `Delivered` · `Seen`. `Seen` rendered with slightly stronger
  weight/color than `Sent`/`Delivered`.
- Email badge: append `· Emailed` (small envelope icon + label) when
  `emailedAt` is set, composing with the primary label.
- Hover tooltip with exact local times, e.g.
  "Delivered 2:31 PM · Seen 2:33 PM · Emailed 2:30 PM".
- Derivation: `readAt ? 'Seen' : deliveredAt ? 'Delivered' : 'Sent'`.

## Edge cases

- **Idempotent re-acks:** up-to marking affects 0 rows on repeat → no broadcast,
  no flicker.
- **Read before dashboard renders Delivered:** precedence collapses to *Seen*;
  the `read` event marks those ids read directly.
- **Bot messages:** streamed via SSE to the requesting widget (already in hand →
  delivered/seen acked normally) and broadcast to other sockets; "up-to newest
  outbound id" covers both arrival paths.
- **Offline visitor:** message stays *Sent*; if emailed, shows "Sent · Emailed";
  on return, widget reconnect → `resume` fetch → delivered/seen acks fire.
- **Visitor never gets status events:** the DO only fans `message:status` to
  `kind:agent` sockets, so receipts never leak to the widget.
- **Closed conversation:** acks still persist timestamps; no special handling.

## Testing

- **ChatService (unit, TDD):** up-to semantics, outbound-only predicate,
  idempotency (0 rows on repeat), read-implies-delivered, returned-id accuracy.
- **DO / worker fallback:** a `delivered`/`read` frame (and a heartbeat with
  `deliveredUpTo`/`readUpTo`) persists timestamps and broadcasts a
  `message:status` with the correct ids to agent sockets only.
- **Dashboard:** `MessageBubble` renders the correct label per
  (deliveredAt, readAt, emailedAt) combination, including the composing
  `Emailed` badge and tooltip; `use-conversation-ws` patches the cache on
  `message:status`.
- **Widget:** vanilla TS — covered by manual/integration verification (open
  widget → agent sends → dashboard shows Delivered then Seen; close tab → send →
  Sent only; send-as-email offline → Sent · Emailed).

## Rollout notes

- Additive, nullable columns + additive wire events → backward compatible. Old
  widgets that never ack simply leave messages at *Sent*; new dashboards tolerate
  missing `deliveredAt`/`readAt`.
- Deploy order: migrate DB → deploy worker (DO + routes + detail select) →
  deploy dashboard → build/upload widget (`widget:deploy`). Each step is safe on
  its own because every field/event is optional.
