# Message Delivery / Read Receipts (dashboard-side) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show agents whether a message they sent was delivered to the visitor's widget, seen, and/or emailed — WhatsApp-style receipts in the dashboard thread, presented in the support-tool convention (muted `Sent → Delivered → Seen` text + an `Emailed` badge).

**Architecture:** The visitor widget acks `delivered` (on receiving an outbound message) and `read` (when the chat panel is open + tab focused) over its existing WebSocket; the Durable Object persists `deliveredAt`/`readAt` to the `messages` table and fans a `message:status` event out to the agent sockets it owns. Polling-mode visitors carry the same acks on the existing heartbeat POST, which the worker route persists + broadcasts via the existing `dispatch` helper. The dashboard patches its React Query cache on `message:status` and renders the status under each outbound bubble.

**Tech Stack:** Bun, Cloudflare Workers, Hono, Drizzle ORM + D1, Durable Objects (WebSocket hibernation), React 19, TanStack Query, Tailwind v4, lucide-react. Widget is a single vanilla-TS file.

## Global Constraints

- **Bun only** — never npm/yarn. Run scripts with `bun run <script>` / `bunx <bin>` / `bun test`.
- **Cloudflare Workers compatible** — no Node-only APIs in `worker/`, `widget/`, or `shared/`.
- **No raw SQL migrations** — generate via `bun run db:generate` (Drizzle). Never hand-write a `.sql` file in `worker/db/drizzle/`.
- **Read before write** — open every file start-to-relevant-section before editing it.
- **No commits without explicit user authorization** (project rule overrides the skill default). The `Commit` step in each task is a checkpoint — only run it once the user has said to commit. If not authorized, leave the changes staged/unstaged and move on.
- **No co-authored commits.**
- **Testing reality:** this repo has **no D1 / route / DOM test harness** — `bun test` runs **pure functions only** (e.g. `worker/mcp-oauth.test.ts`). Only **Task 6** is automatable TDD (a pure helper). DB methods, routes, the DO, and widget glue are verified by `bunx tsc -b` (typecheck), `bun run lint`, and the manual `bun run dev` browser flow in **Task 10** — this matches `AGENTS.md`'s prescribed verification flow. Do **not** invent a vitest/miniflare setup.
- **Per-task gate** (unless a task says otherwise): `bun run lint` passes with no new errors **and** `bunx tsc -b` completes with no errors.
- **No divider lines** in UI (project memory): separate with spacing / muted color, never `border-t`/`border-b`.
- **Outbound = `role in ('agent','bot')`.** Visitor/system messages never get receipts.

---

### Task 1: Schema columns + migration

Add the two nullable timestamp columns to `messages` and keep the hand-built row literals in `ChatService` in sync, then generate + apply the migration.

**Files:**
- Modify: `worker/db/schema.ts:451` (the `emailedAt` line in the `messages` table)
- Modify: `worker/services/chat-service.ts:613-617` (`addSystemMessage` return literal) and `:644-646` (`addMessage` return literal)
- Generated: `worker/db/drizzle/0054_*.sql` (created by `db:generate` — do not author by hand)

**Interfaces:**
- Produces: `messages.deliveredAt` / `messages.readAt` columns (Drizzle `Date | null`), now part of `MessageRow` (`typeof messages.$inferSelect`). Every later task that reads/writes a message row relies on these existing.

- [ ] **Step 1: Add the columns to the schema**

In `worker/db/schema.ts`, change the `emailedAt` line (line 451) from:

```ts
    emailedAt: integer("emailed_at", { mode: "timestamp" }),
  },
```

to:

```ts
    emailedAt: integer("emailed_at", { mode: "timestamp" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp" }),
    readAt: integer("read_at", { mode: "timestamp" }),
  },
```

- [ ] **Step 2: Keep `addMessage`'s returned row literal in sync**

`addMessage` builds its `MessageRow` by hand (no re-select), so the new columns must be added or TypeScript will reject the return. In `worker/services/chat-service.ts`, change the end of the `addMessage` return (lines 644-646) from:

```ts
      createdAt: now,
      emailedAt: null,
    };
```

to:

```ts
      createdAt: now,
      emailedAt: null,
      deliveredAt: null,
      readAt: null,
    };
```

- [ ] **Step 3: Keep `addSystemMessage`'s returned row literal in sync**

In the same file, change the `addSystemMessage` return (lines 613-617) from:

```ts
    return {
      id, conversationId, role: "system", content, sources,
      imageUrl: null, senderName: null, senderAvatar: null, userId: null,
      createdAt: now, emailedAt: null,
    };
```

to:

```ts
    return {
      id, conversationId, role: "system", content, sources,
      imageUrl: null, senderName: null, senderAvatar: null, userId: null,
      createdAt: now, emailedAt: null, deliveredAt: null, readAt: null,
    };
```

- [ ] **Step 4: Generate the migration**

Run: `bun run db:generate`
Expected: a new file `worker/db/drizzle/0054_<random>.sql` is created containing two `ALTER TABLE \`messages\` ADD \`delivered_at\` integer;` / `ADD \`read_at\` integer;` statements (exact name varies). Confirm it only touches `messages` (no unintended diffs).

- [ ] **Step 5: Apply the migration locally**

Run: `bun run db:migrate:dev`
Expected: migration `0054_*` applies with no error.

- [ ] **Step 6: Typecheck**

Run: `bunx tsc -b`
Expected: completes with no errors (the row literals now satisfy `MessageRow`).

- [ ] **Step 7: Commit** *(only if authorized — see Global Constraints)*

```bash
git add worker/db/schema.ts worker/services/chat-service.ts worker/db/drizzle
git commit -m "feat(inbox): add deliveredAt/readAt columns to messages"
```

---

### Task 2: Wire-contract events

Add the `message:status` server event and the `delivered`/`read` client events to the shared WS contract.

**Files:**
- Modify: `shared/ws-events.ts` (the `ServerEvent` and `ClientEvent` unions)

**Interfaces:**
- Produces:
  - `ServerEvent` gains `{ type: "message:status"; conversationId: string; status: "delivered" | "read"; messageIds: string[]; at: number }`
  - `ClientEvent` gains `{ type: "delivered"; upToMessageId: string }` and `{ type: "read"; upToMessageId: string }`
- Consumed by: Task 4 (DO + broadcast), Task 5 (heartbeat route), Task 7 (dashboard ws handler), Task 9 (widget).

- [ ] **Step 1: Add the server event**

In `shared/ws-events.ts`, the `ServerEvent` union currently ends:

```ts
  | {
      type: "conversation:closed";
      conversationId: string;
      reason: string | null;
    }
  | { type: "pong"; t: number };
```

Change it to insert the new event before `pong`:

```ts
  | {
      type: "conversation:closed";
      conversationId: string;
      reason: string | null;
    }
  | {
      type: "message:status";
      conversationId: string;
      status: "delivered" | "read";
      messageIds: string[];
      at: number;
    }
  | { type: "pong"; t: number };
```

- [ ] **Step 2: Add the client events**

The `ClientEvent` union currently is:

```ts
export type ClientEvent =
  | { type: "ping"; t: number }
  | { type: "resume"; lastMessageId: string | null };
```

Change it to:

```ts
export type ClientEvent =
  | { type: "ping"; t: number }
  | { type: "resume"; lastMessageId: string | null }
  | { type: "delivered"; upToMessageId: string }
  | { type: "read"; upToMessageId: string };
```

- [ ] **Step 3: Typecheck + lint**

Run: `bunx tsc -b && bun run lint`
Expected: both pass (adding union members doesn't break existing exhaustive switches — they all use `if/else if` chains, not exhaustive `never` checks).

- [ ] **Step 4: Commit** *(only if authorized)*

```bash
git add shared/ws-events.ts
git commit -m "feat(inbox): add message:status + delivered/read ws events"
```

---

### Task 3: ChatService marking methods

Add idempotent "up-to" methods that mark outbound messages delivered/read and return the affected ids.

**Files:**
- Modify: `worker/services/chat-service.ts` (add methods after `markMessageAsEmailed`, line 682)

**Interfaces:**
- Consumes: `messages.deliveredAt` / `messages.readAt` (Task 1); operators `and, eq, inArray, isNull, lte` (already imported at `chat-service.ts:2`).
- Produces (called by Task 4 DO + Task 5 route):
  - `markDeliveredUpTo(conversationId: string, upToMessageId: string): Promise<string[]>` — returns ids newly set to delivered (empty if none / unknown message / cross-conversation).
  - `markReadUpTo(conversationId: string, upToMessageId: string): Promise<string[]>` — returns ids newly set to read (also backfills `deliveredAt`).

- [ ] **Step 1: Add the four methods**

In `worker/services/chat-service.ts`, immediately after the `markMessageAsEmailed` method (which ends at line 682 with `}`), insert:

```ts
  // Mark all outbound (agent/bot) messages in the conversation up to and
  // including `cutoff` that aren't already delivered. Returns the ids that
  // were newly marked (empty when there's nothing to do — keeps re-acks silent).
  async markMessagesDelivered(
    conversationId: string,
    cutoff: Date,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          inArray(messages.role, ["agent", "bot"]),
          isNull(messages.deliveredAt),
          lte(messages.createdAt, cutoff),
        ),
      );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    await this.db
      .update(messages)
      .set({ deliveredAt: new Date() })
      .where(inArray(messages.id, ids));
    return ids;
  }

  // Mark outbound messages up to `cutoff` as read. Read implies delivered, so
  // any of those still missing `deliveredAt` get it backfilled. Returns the
  // ids that were newly marked read.
  async markMessagesRead(
    conversationId: string,
    cutoff: Date,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          inArray(messages.role, ["agent", "bot"]),
          isNull(messages.readAt),
          lte(messages.createdAt, cutoff),
        ),
      );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    const now = new Date();
    await this.db
      .update(messages)
      .set({ readAt: now })
      .where(inArray(messages.id, ids));
    await this.db
      .update(messages)
      .set({ deliveredAt: now })
      .where(and(inArray(messages.id, ids), isNull(messages.deliveredAt)));
    return ids;
  }

  // Resolve a widget-supplied "newest message id" to its createdAt (guarding
  // that it belongs to this conversation) and mark delivered up to it.
  async markDeliveredUpTo(
    conversationId: string,
    upToMessageId: string,
  ): Promise<string[]> {
    const m = await this.getMessageById(upToMessageId);
    if (!m || m.conversationId !== conversationId) return [];
    return this.markMessagesDelivered(conversationId, m.createdAt);
  }

  async markReadUpTo(
    conversationId: string,
    upToMessageId: string,
  ): Promise<string[]> {
    const m = await this.getMessageById(upToMessageId);
    if (!m || m.conversationId !== conversationId) return [];
    return this.markMessagesRead(conversationId, m.createdAt);
  }
```

- [ ] **Step 2: Typecheck + lint**

Run: `bunx tsc -b && bun run lint`
Expected: both pass. (`and, eq, inArray, isNull, lte` are already imported per `chat-service.ts:2`; no new import needed.)

- [ ] **Step 3: Commit** *(only if authorized)*

```bash
git add worker/services/chat-service.ts
git commit -m "feat(inbox): ChatService markDelivered/markRead up-to methods"
```

---

### Task 4: Broadcast helper + Durable Object frame handling

Add a `broadcastMessageStatus` helper (for the poll-fallback route) and teach the DO to handle `delivered`/`read` frames directly, fanning `message:status` out to agent sockets.

**Files:**
- Modify: `worker/realtime/broadcast.ts` (add `broadcastMessageStatus`)
- Modify: `worker/durable-objects/conversation-do.ts` (extend `webSocketMessage`, add `broadcastToAgents`)

**Interfaces:**
- Consumes: `message:status` event type (Task 2); `ChatService.markDeliveredUpTo`/`markReadUpTo` (Task 3).
- Produces: `broadcastMessageStatus(env, ctx, conversationId, status: "delivered" | "read", messageIds: string[])` (used by Task 5).

- [ ] **Step 1: Add `broadcastMessageStatus` to `broadcast.ts`**

At the end of `worker/realtime/broadcast.ts` (after `broadcastClosed`, line 154), append:

```ts

export function broadcastMessageStatus(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  status: "delivered" | "read",
  messageIds: string[],
): void {
  if (messageIds.length === 0) return;
  dispatch(env, ctx, conversationId, {
    type: "message:status",
    conversationId,
    status,
    messageIds,
    at: Date.now(),
  });
}
```

- [ ] **Step 2: Extend the DO's parsed-frame type**

In `worker/durable-objects/conversation-do.ts`, the `webSocketMessage` handler narrows `parsed` at lines 132-136:

```ts
    const msg = parsed as {
      type?: string;
      lastMessageId?: string | null;
      state?: string;
    };
```

Change it to add `upToMessageId`:

```ts
    const msg = parsed as {
      type?: string;
      lastMessageId?: string | null;
      state?: string;
      upToMessageId?: string;
    };
```

- [ ] **Step 3: Handle `delivered`/`read` frames in the DO**

In the same `webSocketMessage` method, the presence block currently ends at line 161-162:

```ts
      return;
    }
  }
```

Insert the new handler block between the presence block's closing `}` and the method's closing `}`. Replace:

```ts
      return;
    }
  }

  webSocketClose(): void {
```

with:

```ts
      return;
    }

    if (
      (msg.type === "delivered" || msg.type === "read") &&
      typeof msg.upToMessageId === "string"
    ) {
      const att = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (att?.kind !== "visitor") return;

      const db = drizzle(this.env.DB);
      const chatService = new ChatService(db);
      const ids =
        msg.type === "delivered"
          ? await chatService.markDeliveredUpTo(att.conversationId, msg.upToMessageId)
          : await chatService.markReadUpTo(att.conversationId, msg.upToMessageId);
      if (ids.length === 0) return;

      this.broadcastToAgents({
        type: "message:status",
        conversationId: att.conversationId,
        status: msg.type,
        messageIds: ids,
        at: Date.now(),
      });
      return;
    }
  }

  webSocketClose(): void {
```

- [ ] **Step 4: Add the `broadcastToAgents` helper to the DO**

In `conversation-do.ts`, add this private method just before the existing `private safeSend(...)` method (line 260):

```ts
  private broadcastToAgents(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (att?.kind !== "agent") continue;
      try {
        ws.send(payload);
      } catch {
        // Socket might be in a weird state — Cloudflare will clean it up.
      }
    }
  }

```

(`ServerEvent` and `ChatService` and `drizzle` are already imported at the top of `conversation-do.ts` — lines 1-4.)

- [ ] **Step 5: Typecheck + lint**

Run: `bunx tsc -b && bun run lint`
Expected: both pass. (`status: msg.type` typechecks because the `if` narrows `msg.type` to `"delivered" | "read"`.)

- [ ] **Step 6: Commit** *(only if authorized)*

```bash
git add worker/realtime/broadcast.ts worker/durable-objects/conversation-do.ts
git commit -m "feat(inbox): DO handles delivered/read frames, broadcasts message:status"
```

---

### Task 5: Heartbeat route (polling fallback) + broadcast import

Extend the widget heartbeat route to accept optional `deliveredUpTo`/`readUpTo`, persist via ChatService, and broadcast `message:status`.

**Files:**
- Modify: `worker/index.ts` import block (add `broadcastMessageStatus`)
- Modify: `worker/index.ts:770-803` (the heartbeat handler)

**Interfaces:**
- Consumes: `ChatService.markDeliveredUpTo`/`markReadUpTo` (Task 3); `broadcastMessageStatus` (Task 4).

- [ ] **Step 1: Import `broadcastMessageStatus`**

In `worker/index.ts`, the broadcast helpers are imported around lines 75-76. Add `broadcastMessageStatus` next to `broadcastStatusChange`. Change:

```ts
  broadcastMessageNew,
  broadcastStatusChange,
```

to:

```ts
  broadcastMessageNew,
  broadcastStatusChange,
  broadcastMessageStatus,
```

- [ ] **Step 2: Parse the new body fields in the heartbeat handler**

In the heartbeat handler (lines 770-803), the body-parse block currently is:

```ts
    let presence: "active" | "background" = "active";
    try {
      const body = await c.req.json();
      if (body.presence === "background") presence = "background";
    } catch {
      // No body or invalid JSON — default to active
    }
```

Change it to also capture the ack fields:

```ts
    let presence: "active" | "background" = "active";
    let deliveredUpTo: string | undefined;
    let readUpTo: string | undefined;
    try {
      const body = await c.req.json();
      if (body.presence === "background") presence = "background";
      if (typeof body.deliveredUpTo === "string") deliveredUpTo = body.deliveredUpTo;
      if (typeof body.readUpTo === "string") readUpTo = body.readUpTo;
    } catch {
      // No body or invalid JSON — default to active
    }
```

- [ ] **Step 3: Persist + broadcast the acks before returning**

The handler currently ends:

```ts
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    return c.json({ ok: true, status: conversation.status });
  })
```

Change it to mark + broadcast between the null check and the response:

```ts
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    if (deliveredUpTo) {
      const ids = await chatService.markDeliveredUpTo(conversationId, deliveredUpTo);
      broadcastMessageStatus(c.env, c.executionCtx, conversationId, "delivered", ids);
    }
    if (readUpTo) {
      const ids = await chatService.markReadUpTo(conversationId, readUpTo);
      broadcastMessageStatus(c.env, c.executionCtx, conversationId, "read", ids);
    }

    return c.json({ ok: true, status: conversation.status });
  })
```

(`chatService` and `conversationId` are already in scope in this handler; `broadcastMessageStatus` no-ops on an empty id array, so the calls are safe even when nothing was newly marked.)

- [ ] **Step 4: Typecheck + lint**

Run: `bunx tsc -b && bun run lint`
Expected: both pass.

- [ ] **Step 5: Commit** *(only if authorized)*

```bash
git add worker/index.ts
git commit -m "feat(inbox): heartbeat route persists+broadcasts delivered/read acks"
```

---

### Task 6: Pure status-derivation helper (TDD)

The one automatable unit. A pure function that maps a message's `(role, deliveredAt, readAt, emailedAt)` to the displayed status. Drives the UI in Task 8.

**Files:**
- Create: `src/lib/inbox/message-status.ts`
- Test: `src/lib/inbox/message-status.test.ts`

**Interfaces:**
- Produces (consumed by Task 8):
  - type `DeliveryStatus = "sent" | "delivered" | "seen"`
  - `interface MessageStatusInput { role: "visitor" | "bot" | "agent" | "system"; deliveredAt?: string | null; readAt?: string | null; emailedAt?: string | null }`
  - `interface MessageStatusView { status: DeliveryStatus; label: "Sent" | "Delivered" | "Seen"; emailed: boolean }`
  - `deriveMessageStatus(m: MessageStatusInput): MessageStatusView | null` — `null` for non-outbound (visitor/system) messages.

- [ ] **Step 1: Write the failing test**

Create `src/lib/inbox/message-status.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { deriveMessageStatus } from "./message-status";

const base = { role: "agent" as const };

describe("deriveMessageStatus", () => {
  test("agent message with no timestamps is Sent", () => {
    expect(deriveMessageStatus(base)).toEqual({
      status: "sent",
      label: "Sent",
      emailed: false,
    });
  });

  test("deliveredAt set (no readAt) is Delivered", () => {
    expect(deriveMessageStatus({ ...base, deliveredAt: "2026-07-01T00:00:00Z" })).toEqual({
      status: "delivered",
      label: "Delivered",
      emailed: false,
    });
  });

  test("readAt takes precedence over deliveredAt → Seen", () => {
    expect(
      deriveMessageStatus({
        ...base,
        deliveredAt: "2026-07-01T00:00:00Z",
        readAt: "2026-07-01T00:01:00Z",
      }),
    ).toEqual({ status: "seen", label: "Seen", emailed: false });
  });

  test("readAt without deliveredAt still → Seen", () => {
    expect(deriveMessageStatus({ ...base, readAt: "2026-07-01T00:01:00Z" })).toEqual({
      status: "seen",
      label: "Seen",
      emailed: false,
    });
  });

  test("emailed flag reflects emailedAt", () => {
    expect(deriveMessageStatus({ ...base, emailedAt: "2026-07-01T00:00:00Z" })).toEqual({
      status: "sent",
      label: "Sent",
      emailed: true,
    });
  });

  test("bot messages get receipts like agent", () => {
    expect(deriveMessageStatus({ role: "bot", readAt: "2026-07-01T00:00:00Z" })?.label).toBe(
      "Seen",
    );
  });

  test("visitor messages get no receipt", () => {
    expect(deriveMessageStatus({ role: "visitor", readAt: "x" })).toBeNull();
  });

  test("system messages get no receipt", () => {
    expect(deriveMessageStatus({ role: "system" })).toBeNull();
  });

  test("null timestamps behave like absent", () => {
    expect(
      deriveMessageStatus({ role: "agent", deliveredAt: null, readAt: null, emailedAt: null }),
    ).toEqual({ status: "sent", label: "Sent", emailed: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/inbox/message-status.test.ts`
Expected: FAIL — `Cannot find module './message-status'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/inbox/message-status.ts`:

```ts
export type DeliveryStatus = "sent" | "delivered" | "seen";

export interface MessageStatusInput {
  role: "visitor" | "bot" | "agent" | "system";
  deliveredAt?: string | null;
  readAt?: string | null;
  emailedAt?: string | null;
}

export interface MessageStatusView {
  status: DeliveryStatus;
  label: "Sent" | "Delivered" | "Seen";
  emailed: boolean;
}

const LABELS: Record<DeliveryStatus, MessageStatusView["label"]> = {
  sent: "Sent",
  delivered: "Delivered",
  seen: "Seen",
};

// Receipts only apply to outbound (agent/bot) messages. Returns null for
// inbound visitor messages and centred system rows.
export function deriveMessageStatus(
  m: MessageStatusInput,
): MessageStatusView | null {
  if (m.role !== "agent" && m.role !== "bot") return null;
  const status: DeliveryStatus = m.readAt
    ? "seen"
    : m.deliveredAt
      ? "delivered"
      : "sent";
  return { status, label: LABELS[status], emailed: Boolean(m.emailedAt) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/inbox/message-status.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Lint**

Run: `bun run lint`
Expected: passes.

- [ ] **Step 6: Commit** *(only if authorized)*

```bash
git add src/lib/inbox/message-status.ts src/lib/inbox/message-status.test.ts
git commit -m "feat(inbox): pure deriveMessageStatus helper + tests"
```

---

### Task 7: Dashboard types + ws cache patch + optimistic insert

Plumb `deliveredAt`/`readAt` through the dashboard types, patch the React Query cache on `message:status`, and seed the optimistic agent message with null receipt fields.

**Files:**
- Modify: `src/lib/inbox/types.ts:38-51` (`Message` interface)
- Modify: `src/lib/use-conversation-ws.ts:20-24` (`ConversationDetailMessage`) and the `handleMessage` if-chain
- Modify: `src/pages/Conversations.tsx:540-548` (optimistic insert literal)

**Interfaces:**
- Consumes: `message:status` event (Task 2). The detail endpoint already returns `deliveredAt`/`readAt` for free (the route does `select()`-all + `{ ...msg }` spread, and D1 timestamp columns serialize to ISO strings via `c.json`) — **no worker change needed for initial load.**
- Produces: `Message.deliveredAt` / `Message.readAt` on the dashboard `Message` type (consumed by Task 8).

- [ ] **Step 1: Add fields to the `Message` type**

In `src/lib/inbox/types.ts`, the `Message` interface ends:

```ts
  createdAt: string;
  emailedAt?: string | null;
}
```

Change to:

```ts
  createdAt: string;
  emailedAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
}
```

- [ ] **Step 2: Add fields to `ConversationDetailMessage`**

In `src/lib/use-conversation-ws.ts`, the interface (lines 20-24) is:

```ts
interface ConversationDetailMessage extends MessagePayload {
  toolExecutions?: unknown[];
  emailedAt?: string | null;
  userId?: string | null;
}
```

Change to:

```ts
interface ConversationDetailMessage extends MessagePayload {
  toolExecutions?: unknown[];
  emailedAt?: string | null;
  userId?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
}
```

- [ ] **Step 3: Handle `message:status` in the ws if-chain**

In `src/lib/use-conversation-ws.ts`, the `handleMessage` if-chain ends with the `conversation:closed` branch. After that branch's closing `}` (just before `handleMessage`'s own closing `}` at line ~182), add a new `else if`:

```ts
      } else if (parsed.type === "message:status") {
        const idSet = new Set(parsed.messageIds);
        const iso = new Date(parsed.at).toISOString();
        const markRead = parsed.status === "read";
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              messages: old.messages.map((m) => {
                if (!idSet.has(m.id)) return m;
                if (markRead) {
                  return {
                    ...m,
                    readAt: iso,
                    deliveredAt: m.deliveredAt ?? iso,
                  } as ConversationDetailMessage;
                }
                return {
                  ...m,
                  deliveredAt: m.deliveredAt ?? iso,
                } as ConversationDetailMessage;
              }),
            };
          },
        );
      }
```

(Insert this between the end of the `conversation:closed` branch and the closing brace of `handleMessage`. It does **not** invalidate the conversation list — status isn't shown there.)

- [ ] **Step 4: Seed optimistic insert with null receipts**

In `src/pages/Conversations.tsx`, the optimistic message literal (lines 540-548) is:

```ts
          const optimistic: Message = {
            id: `optimistic-${Date.now()}`,
            role: "agent",
            content,
            imageUrl: imageUrl ?? null,
            createdAt: new Date().toISOString(),
            senderName: null,
            emailedAt: null,
          };
```

Change to:

```ts
          const optimistic: Message = {
            id: `optimistic-${Date.now()}`,
            role: "agent",
            content,
            imageUrl: imageUrl ?? null,
            createdAt: new Date().toISOString(),
            senderName: null,
            emailedAt: null,
            deliveredAt: null,
            readAt: null,
          };
```

- [ ] **Step 5: Typecheck + lint**

Run: `bunx tsc -b && bun run lint`
Expected: both pass.

- [ ] **Step 6: Commit** *(only if authorized)*

```bash
git add src/lib/inbox/types.ts src/lib/use-conversation-ws.ts src/pages/Conversations.tsx
git commit -m "feat(inbox): plumb deliveredAt/readAt through dashboard + message:status cache patch"
```

---

### Task 8: Render the status under outbound bubbles

Show `Sent / Delivered / Seen` (+ `Emailed` badge) under each bot/agent message, muted, with exact times on hover.

**Files:**
- Modify: `src/components/inbox/MessageBubble.tsx`

**Interfaces:**
- Consumes: `deriveMessageStatus` (Task 6); `Message.deliveredAt`/`readAt`/`emailedAt` (Tasks 1+7); `Mail` icon from `lucide-react`.

- [ ] **Step 1: Add imports**

In `src/components/inbox/MessageBubble.tsx`, line 1 currently:

```tsx
import { Trash2 } from "lucide-react";
```

Change to:

```tsx
import { Mail, Trash2 } from "lucide-react";
import { deriveMessageStatus } from "@/lib/inbox/message-status";
```

(Keep the existing `import type { Conversation, Message } ...` and `import { cn, renderMarkdown } ...` lines as-is.)

- [ ] **Step 2: Compute status + tooltip before the sent-bubble return**

In `MessageBubble.tsx`, find the comment line `  // Sent bubble (bot or agent)` (just before the final `return`). Immediately **above** that comment, insert:

```tsx
  const status = deriveMessageStatus(message);
  const statusTooltip = [
    message.deliveredAt ? `Delivered ${formatTime(message.deliveredAt)}` : null,
    message.readAt ? `Seen ${formatTime(message.readAt)}` : null,
    message.emailedAt ? `Emailed ${formatTime(message.emailedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

```

- [ ] **Step 3: Render the status row inside the sent bubble**

In the sent-bubble `return`, the structure is:

```tsx
      <div className="relative group max-w-[74%]">
        <div className={cn("px-[14px] py-[10px] ...
        ...
        {isAgent && (
          <button ... >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
```

Insert the status row between the closing `</div>` of `relative group` and the outer container's closing `</div>`:

```tsx
      </div>
      {status && (
        <div
          className="mt-1 text-[11px] text-ink-8 flex items-center gap-1"
          title={statusTooltip || undefined}
        >
          <span
            className={
              status.status === "seen"
                ? "text-brand-label-human font-medium"
                : undefined
            }
          >
            {status.label}
          </span>
          {status.emailed && (
            <>
              <span aria-hidden="true">·</span>
              <Mail size={11} />
              <span>Emailed</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

(`status` is `null` for visitor/system rows — the early `isReceived` return already handles visitor; for any non-outbound row reaching here, `status` is falsy and nothing renders. No divider lines — only `mt-1` spacing and muted `text-ink-8`, per the project rule.)

- [ ] **Step 4: Typecheck + lint**

Run: `bunx tsc -b && bun run lint`
Expected: both pass.

- [ ] **Step 5: Visual check (deferred to Task 10)**

The rendered output is verified end-to-end in Task 10. No standalone component test (no DOM harness in this repo).

- [ ] **Step 6: Commit** *(only if authorized)*

```bash
git add src/components/inbox/MessageBubble.tsx
git commit -m "feat(inbox): render Sent/Delivered/Seen + Emailed under outbound bubbles"
```

---

### Task 9: Widget delivered/read acks

Make the widget report `delivered` (on receiving an outbound message) and `read` (when the panel is open + tab focused), over WS when healthy, else via an on-demand heartbeat POST.

**Files:**
- Modify: `widget/index.ts` — add ack helpers near `sendPresenceOverWs` (line 3236); wire into the WS `message:new` handler (5459-5480), the poll `hasNewMessages` block (5706), `markConversationSeen` (5810), the `visibilitychange` handler (3220-3227), `openChatWidget` (6248-6251), and the SSE completion (4646-4648).

**Interfaces:**
- Consumes: the `delivered`/`read` client events (Task 2 — handled by the DO in Task 4 and the heartbeat route in Task 5). Reuses widget state `newestResponseId`, `isOpen`, `isTabActive`, `wsHealthy`, `wsSocket`, `conversationId`, `baseUrl`, `projectSlug`.

- [ ] **Step 1: Add the ack helpers**

In `widget/index.ts`, the `sendPresenceOverWs` function ends at line 3236 with `}`. Immediately after it, insert:

```ts

  function sendAckOverWs(type: "delivered" | "read", messageId: string): void {
    if (!wsHealthy || !wsSocket) return;
    try {
      wsSocket.send(JSON.stringify({ type, upToMessageId: messageId }));
    } catch {
      // ignore
    }
  }

  async function sendAckViaHeartbeat(fields: {
    deliveredUpTo?: string;
    readUpTo?: string;
  }): Promise<void> {
    if (!conversationId) return;
    try {
      await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/${conversationId}/heartbeat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presence: document.hidden ? "background" : "active",
            ...fields,
          }),
        },
      );
    } catch {
      // best-effort
    }
  }

  // Tell the server the newest outbound (bot/agent) message reached this widget
  // so the dashboard can show a "Delivered" receipt.
  function reportDelivered(): void {
    if (!conversationId || !newestResponseId) return;
    if (wsHealthy && wsSocket) {
      sendAckOverWs("delivered", newestResponseId);
    } else {
      void sendAckViaHeartbeat({ deliveredUpTo: newestResponseId });
    }
  }

  // Tell the server the visitor has actually seen the newest outbound message —
  // only when the panel is open AND the tab is focused.
  function reportRead(): void {
    if (!conversationId || !newestResponseId) return;
    if (!isOpen || !isTabActive) return;
    if (wsHealthy && wsSocket) {
      sendAckOverWs("read", newestResponseId);
    } else {
      void sendAckViaHeartbeat({ readUpTo: newestResponseId });
    }
  }
```

- [ ] **Step 2: Fire `reportDelivered` when a WS message arrives**

In the WS `message:new` branch (lines 5459-5480), the `if (rendered) {` block starts:

```ts
      if (parsed.type === "message:new" && parsed.message) {
        const rendered = renderIncomingMessage(parsed.message);
        if (rendered) {
          lastNewMessageAt = Date.now();
          if (isOpen) {
```

Change to insert `reportDelivered();` right after `lastNewMessageAt = Date.now();`:

```ts
      if (parsed.type === "message:new" && parsed.message) {
        const rendered = renderIncomingMessage(parsed.message);
        if (rendered) {
          lastNewMessageAt = Date.now();
          reportDelivered();
          if (isOpen) {
```

(When `isOpen`, the existing `markConversationSeen()` call a few lines down fires `reportRead()` — added in Step 4.)

- [ ] **Step 3: Fire `reportDelivered` on a poll tick with new messages**

In `pollMessages`, the `hasNewMessages` block (line 5706) is:

```ts
      if (hasNewMessages) {
        lastNewMessageAt = Date.now();
        if (isOpen) {
```

Change to:

```ts
      if (hasNewMessages) {
        lastNewMessageAt = Date.now();
        reportDelivered();
        if (isOpen) {
```

- [ ] **Step 4: Fire `reportRead` from `markConversationSeen`**

`markConversationSeen` (lines 5810-5813) is:

```ts
  function markConversationSeen() {
    if (newestResponseId) setStoredSeenResponseId(newestResponseId);
    clearUnreadBadge();
  }
```

Change to:

```ts
  function markConversationSeen() {
    if (newestResponseId) setStoredSeenResponseId(newestResponseId);
    clearUnreadBadge();
    reportRead();
  }
```

(`reportRead` self-guards on `isOpen && isTabActive`, so this is safe at every existing `markConversationSeen` call site.)

- [ ] **Step 5: Re-fire `reportRead` when the tab refocuses**

The `visibilitychange` handler (lines 3220-3227) is:

```ts
  document.addEventListener("visibilitychange", () => {
    isTabActive = !document.hidden;
    if (isTabActive && titleOverridden) {
      document.title = originalDocTitle;
      titleOverridden = false;
    }
    sendPresenceOverWs(document.hidden ? "background" : "active");
  });
```

Change to add a `reportRead()` call when the tab becomes active:

```ts
  document.addEventListener("visibilitychange", () => {
    isTabActive = !document.hidden;
    if (isTabActive && titleOverridden) {
      document.title = originalDocTitle;
      titleOverridden = false;
    }
    sendPresenceOverWs(document.hidden ? "background" : "active");
    if (isTabActive) reportRead();
  });
```

- [ ] **Step 6: Fire `reportDelivered` when the panel opens**

In `openChatWidget` (lines 6248-6251):

```ts
    isOpen = true;
    chatWindow.classList.add("open");
    trigger.classList.add("active");
    markConversationSeen();
```

Change to add `reportDelivered();` before `markConversationSeen();`:

```ts
    isOpen = true;
    chatWindow.classList.add("open");
    trigger.classList.add("active");
    reportDelivered();
    markConversationSeen();
```

- [ ] **Step 7: Cover bot replies that arrive via SSE**

A bot reply streamed back over SSE doesn't pass through `renderIncomingMessage`/`pollMessages`, so `newestResponseId` must be updated on stream completion. The completion handler (lines 4646-4648) is:

```ts
                  if (data.messageId) {
                    renderedMessageIds.add(data.messageId);
                    lastSeenMessageId = data.messageId;
```

Change to set `newestResponseId` and fire the acks (the visitor just typed, so the panel is open + focused → this also marks the bot reply Seen):

```ts
                  if (data.messageId) {
                    renderedMessageIds.add(data.messageId);
                    lastSeenMessageId = data.messageId;
                    newestResponseId = data.messageId;
                    reportDelivered();
                    reportRead();
```

(Do not change the lines after `lastSeenMessageId = data.messageId;` other than inserting these three — keep the existing closing brace and following code intact.)

- [ ] **Step 8: Typecheck + lint**

Run: `bunx tsc -b && bun run lint`
Expected: both pass.

- [ ] **Step 9: Build the widget bundle**

Run: `bun run widget:build`
Expected: builds `dist-widget/widget-embed.js` and copies it to `public/widget-embed.js` with no error.

- [ ] **Step 10: Commit** *(only if authorized)*

```bash
git add widget/index.ts public/widget-embed.js
git commit -m "feat(widget): report delivered/read acks for outbound messages"
```

---

### Task 10: End-to-end verification (`bun run dev` + browser)

No automated integration harness exists, so validate the whole chain manually. This is the acceptance gate.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `bun run dev`
Expected: Vite serves the SPA and the worker; note the local URL.

- [ ] **Step 2: Open dashboard + widget side by side**

In one tab open the dashboard inbox for a project; in another open the project's widget test page (or the embedded widget). Pick/create a conversation visible in both.

- [ ] **Step 3: Delivered (panel closed)**

With the **widget panel closed but loaded**, send an agent reply from the dashboard.
Expected: the dashboard bubble shows **Sent**, then flips to **Delivered** within ~1s (the widget acks delivery on receipt even while closed). It does **not** show Seen.

- [ ] **Step 4: Seen (panel open + focused)**

Open the widget panel (tab focused).
Expected: the dashboard bubble flips to **Seen** (emphasized). Hover shows the tooltip "Delivered … · Seen …".

- [ ] **Step 5: Seen on refocus**

Send another agent reply while the widget tab is **backgrounded** (switch to a different tab) but the panel is open.
Expected: dashboard shows **Delivered** (not Seen). Switch back to the widget tab → it flips to **Seen** (the `visibilitychange` read ack).

- [ ] **Step 6: Bot reply receipts**

From the widget, send a visitor message that triggers a bot answer.
Expected: in the dashboard the bot message shows **Seen** (visitor was open + focused while chatting).

- [ ] **Step 7: Emailed badge**

With the visitor **offline** (close the widget tab), send an agent reply with the "send as email" option.
Expected: dashboard bubble shows **Sent · ✉ Emailed**. Re-open the widget → it advances to **Delivered**/**Seen** while keeping the **Emailed** badge.

- [ ] **Step 8: Polling fallback**

Temporarily block WebSockets (e.g. devtools → block the `…/ws` request) so the widget falls back to polling, then repeat Steps 3-4.
Expected: Delivered/Seen still update (via the heartbeat-carried acks), just with polling latency.

- [ ] **Step 9: Regression sweep**

Confirm unrelated inbox behavior is intact: optimistic agent send still reconciles, message deletion still works, conversation status transitions still broadcast, visitor's own "Sending…/Sent" indicator is unchanged.

- [ ] **Step 10: Final full build**

Run: `bun run build`
Expected: `tsc -b && vite build` completes with no errors.

- [ ] **Step 11: Commit** *(only if authorized — typically nothing to commit here unless Steps surfaced fixes)*

---

## Self-Review

**Spec coverage:**
- Dashboard-only scope → Tasks 7-8 (no widget-side receipt UI). ✓
- Read = panel open + focused → Task 9 Steps 4-5 (`isOpen && isTabActive`, `markConversationSeen` + `visibilitychange`). ✓
- Agent + bot receipts → `deriveMessageStatus` accepts both (Task 6); SSE bot path covered (Task 9 Step 7). ✓
- Approach A (WS acks, DO persists; heartbeat fallback) → Tasks 4 (DO) + 5 (heartbeat). ✓
- `deliveredAt`/`readAt` columns mirroring `emailedAt` → Task 1. ✓
- ChatService up-to methods, idempotent, read-implies-delivered, return affected ids → Task 3. ✓
- Wire contract (`message:status` + `delivered`/`read`) → Task 2. ✓
- Detail endpoint returns new fields → covered for free (Task 7 Step note: `select()`-all + spread). ✓
- Support-tool presentation: `Sent → Delivered → Seen` text, Seen emphasized, `Emailed` composing badge, hover times, no dividers → Task 8. ✓
- Initial render + live patch → Task 7 (cache) + detail endpoint. ✓
- Out of scope (visitor-side receipts, per-message IntersectionObserver, list-preview ticks) → not implemented. ✓

**Placeholder scan:** no TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**Type consistency:** `deriveMessageStatus`/`MessageStatusView`/`DeliveryStatus` consistent between Tasks 6 and 8; `markDeliveredUpTo`/`markReadUpTo` names consistent between Tasks 3, 4, 5; `broadcastMessageStatus` signature consistent between Tasks 4 and 5; `message:status` event shape (`status`/`messageIds`/`at`) consistent across Tasks 2, 4, 5, 7; client `{ type, upToMessageId }` consistent between Task 9 (widget send) and Tasks 2/4 (contract/DO). ✓
