# Internal Sidechat Channel Implementation Plan

> **Required skill:** Execute this plan with `superpowers:test-driven-development`, then use `superpowers:verification-before-completion` before claiming the phase is complete.

**Goal:** Replace one-shot inline Compose with a private human↔Maven channel on the existing conversation infrastructure and existing inbox chat components.

**Architecture:** Add `channel` and structured `kind` to the existing `messages` table, put the sidechat status projection on the existing `conversations` row, extend `ChatService`, the current AI SDK runtime, `ConversationDO`, and the authenticated dashboard WebSocket, and reuse `ChatThread`, `MessageBubble`, and `Composer`. Do not add a second chat runtime, agent class, Durable Object, token, transcript store, or client hook.

**Tech stack:** Bun, React 19, TanStack Query, Hono, D1/Drizzle, the existing `ConversationDO`, AI SDK v6, Tailwind CSS v4, and the current inbox primitives. No dependency additions are required in this phase.

**Design source:** `docs/superpowers/specs/2026-08-07-private-sidechat-mcp-actions-design.md`

## Non-negotiable invariants

- Public and sidechat messages share a conversation ID but never share a query result by default.
- Every current public path explicitly filters `messages.channel = "public"` before sidechat can be enabled.
- Sidechat activity does not change public status, ownership, handoff, delivery/read state, `lastActivityAt`, or list ordering.
- Sidechat events are dashboard-agent-only and have distinct event names; never send them as `message:new`.
- Only finalized, safe model text and bounded structured UI metadata are stored. Reasoning and future MCP payloads are not.
- `Add to reply` fills the existing public composer and never sends.
- The pane uses the actual current `ChatThread`, `MessageBubble`, and `Composer` implementations.
- Do not add `@cloudflare/think`, `@cloudflare/ai-chat`, a sidechat DO binding, or a `sidechat_threads` table.

---

## Task 1: Add channels to the existing conversation schema

**Files:**

- Modify: `worker/db/schema.ts`
- Create: generated Drizzle migration under `worker/db/drizzle/`
- Modify: `worker/db/customer-schema.test.ts` or create `worker/db/sidechat-schema.test.ts`

### Step 1: Write failing schema tests

Assert:

- `messages.channel` is `public | sidechat`, non-null, default `public`;
- `messages.kind` is `text | reply_draft | approval`, non-null, default `text`;
- `messages.metadata` is nullable text;
- `conversations.sidechatStatus` is nullable or defaults to `idle` and accepts only the five designed states;
- `sidechatUnread`, `sidechatLastActivityAt`, `sidechatRunId`, and `sidechatLeaseExpiresAt` exist;
- the message index supports `(conversationId, channel, createdAt)`; and
- no `sidechat_threads` table exists.

Run:

```bash
bun test worker/db/sidechat-schema.test.ts
```

Expected: FAIL before schema changes.

### Step 2: Implement the smallest schema change

Use Drizzle enum text columns and existing timestamp conventions. Keep current role values unchanged: sidechat human messages use `agent`; Maven messages use `bot`.

Do not overload `sources`; structured sidechat UI data belongs in `metadata`.

### Step 3: Generate and inspect the migration

```bash
bun run db:generate
```

Confirm it only adds the new columns/indexes and preserves every existing message/conversation row. Existing rows must resolve to `public/text` without a backfill script.

### Step 4: Run focused tests

```bash
bun test worker/db/sidechat-schema.test.ts
bun run db:migrate:dev
```

### Step 5: Commit

```bash
git add worker/db/schema.ts worker/db/drizzle worker/db/sidechat-schema.test.ts
git commit -m "feat: add internal conversation message channel"
```

---

## Task 2: Make public message isolation explicit before adding sidechat reads

**Files:**

- Modify: `worker/services/chat-service.ts`
- Modify: `worker/services/chat-service.test.ts`
- Inspect and update callers in: `worker/index.ts`, `worker/durable-objects/conversation-do.ts`, `worker/services/telegram-service.ts`, `worker/services/email-service.ts`, `worker/chat-runtime/`

### Step 1: Add adversarial failing fixtures

For one conversation, insert interleaved rows:

```text
public visitor -> sidechat agent -> public bot -> sidechat bot -> public agent
```

Assert every existing public method returns only public rows:

- `getMessages`;
- `getRecentMessages`;
- `getMessagesBefore`;
- `getMessagesSince`;
- `getLastMessagesByConversationIds`;
- visitor-message counts / first-turn checks;
- context helpers used by widget AI, Telegram, and email; and
- message lookup used for visitor replay/read receipts.

The conversation preview must be `public agent`, never the later sidechat message.

### Step 2: Add a named public-channel condition

Create a small reusable query condition such as `publicMessageCondition()` and apply it to all public queries. Do not rely on the default value: reads must remain safe after sidechat rows exist.

For correlated preview subqueries, include `m2.channel = 'public'` inside the subquery as well as the outer query.

### Step 3: Add dedicated sidechat methods

Add strict methods such as:

```ts
getSidechatMessages(conversationId, limit, before?)
addSidechatHumanMessage(...)
addSidechatMavenMessage(...)
updateSidechatMessageMetadata(...)
claimSidechatRun(...)
settleSidechatRun(...)
```

Requirements:

- verify project/conversation scope on writes;
- never update public `lastActivityAt` or status;
- atomically set only sidechat projection fields;
- reject new work on archived conversations while retaining reads; and
- accept only bounded, validated metadata for `reply_draft`/`approval`.

### Step 4: Cover mutations and receipts

Ensure public delete, delivery/read status, email markers, and bot/agent insert helpers cannot target sidechat messages accidentally. Sidechat mutations get their own project-scoped methods.

### Step 5: Run regression tests

```bash
bun test worker/services/chat-service.test.ts worker/services/telegram-service.test.ts worker/services/email-service.test.ts
```

### Step 6: Commit

```bash
git add worker/services/chat-service.ts worker/services/chat-service.test.ts worker/index.ts worker/durable-objects/conversation-do.ts worker/services worker/chat-runtime
git commit -m "refactor: isolate public and sidechat messages"
```

---

## Task 3: Extend the existing WebSocket contract with agent-only sidechat events

**Files:**

- Modify: `shared/ws-events.ts`
- Modify: `worker/realtime/broadcast.ts`
- Modify: `worker/realtime/broadcast.test.ts`
- Modify: `worker/durable-objects/conversation-do.ts`
- Modify: `src/lib/use-conversation-ws.ts`
- Create: `src/lib/inbox/sidechat-cache.ts`
- Create: `src/lib/inbox/sidechat-cache.test.ts`

### Step 1: Write failing contract and audience tests

Add typed payloads for:

- `sidechat:message`;
- `sidechat:delta`;
- `sidechat:status`;
- `sidechat:approval_updated`.

Assert every `broadcastSidechat*` helper hardcodes `audience: "agents"` and cannot accept a caller override.

Plant a private sentinel and prove a visitor socket never receives it during broadcast or replay.

### Step 2: Keep public replay public

`ConversationDO.replayMissed` must call the public-only ChatService method. Dashboard reconnect should refetch `sidechat-messages`; do not merge sidechat replay into the visitor resume cursor.

### Step 3: Update the existing dashboard hook

Extend `useConversationWs` rather than adding a second WebSocket/hook:

- append/dedupe finalized sidechat messages in `['sidechat-messages', conversationId]`;
- hold the current ephemeral delta separately;
- patch status on the existing conversation detail/list queries;
- refetch sidechat on socket reconnect; and
- ignore sidechat events unless the selected connection is an authenticated dashboard agent socket.

### Step 4: Verify

```bash
bun test worker/realtime/broadcast.test.ts src/lib/inbox/sidechat-cache.test.ts
```

### Step 5: Commit

```bash
git add shared/ws-events.ts worker/realtime src/lib/use-conversation-ws.ts src/lib/inbox
git commit -m "feat: stream sidechat on existing conversation realtime"
```

---

## Task 4: Run Maven turns through the existing AI SDK runtime

**Files:**

- Create: `worker/chat-runtime/sidechat/build-sidechat-context.ts`
- Create: `worker/chat-runtime/sidechat/build-sidechat-prompt.ts`
- Create: `worker/chat-runtime/sidechat/run-sidechat-turn.ts`
- Create: matching `*.test.ts` files
- Modify: `worker/durable-objects/conversation-do.ts`
- Modify: `worker/types.ts` only if an existing binding type requires it; do not add a binding

### Step 1: Write failing prompt/context tests

Cover:

- bounded public and sidechat histories are loaded separately;
- public system-event rows are excluded;
- the linked canonical customer is used;
- external ID is presented as preferred and canonical email as fallback;
- visitor-supplied identity snapshots are not promoted;
- archived state is read-only;
- the prompt says customer/tool data is working context, prohibits raw dumps/internal identifiers/links, and requires minimum visitor-appropriate facts in drafts; and
- model reasoning is never emitted or persisted.

### Step 2: Build on current model adapters

Use existing:

- `createLanguageModel`;
- `runWithModelFallback`;
- AI SDK v6 streaming primitives;
- current project model configuration; and
- existing knowledge retrieval helpers where useful.

Do not import Think, Chat SDK, or Agents chat hooks.

### Step 3: Add a bounded sidechat turn runner

The runner:

1. validates the run ID/lease against the conversation row;
2. builds public/private context;
3. broadcasts safe text deltas agent-only;
4. persists one final `bot/sidechat` message;
5. validates optional `reply_draft` metadata with Zod;
6. updates only sidechat projection columns; and
7. marks failures without finalizing partial text.

The turn ignores browser disconnects. Apply explicit model/tool deadlines and a maximum turn count.

### Step 4: Trigger it through the existing `ConversationDO`

Add an internal-secret-protected `/internal/sidechat/turn` handler. The authenticated Hono route calls the existing conversation stub with `executionCtx.waitUntil(...)`. This keeps one conversation coordinator and lets work continue when the pane closes.

Use the D1 run lease to prevent duplicate/interleaved turns and recover a stale execution as `failed`.

### Step 5: Verify failure/retry behavior

Test success, model fallback, browser disconnect, duplicate internal trigger, stale lease, invalid structured draft, archived conversation, and no partial-message persistence.

```bash
bun test worker/chat-runtime/sidechat worker/durable-objects
```

### Step 6: Commit

```bash
git add worker/chat-runtime/sidechat worker/durable-objects/conversation-do.ts
git commit -m "feat: run Maven sidechat on existing chat runtime"
```

---

## Task 5: Add authenticated sidechat routes

**Files:**

- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`
- Modify: `worker/index.ts`
- Create: `worker/routes/sidechat-handlers.test.ts`

### Step 1: Write failing route tests

Cover:

- unauthenticated `401`;
- wrong project/conversation `404`;
- effective owner/team authorization parity with conversation detail;
- GET pagination returns sidechat only;
- POST rejects archived, empty/oversized, malformed, or already-working turns;
- successful POST persists the human message and returns `202` plus run ID;
- public draft handoff data is never sent by the server;
- retry is permitted only for the authoritative failed/stale run; and
- widget/public routes cannot address sidechat.

### Step 2: Add validation schemas

Add bounded schemas for human text, pagination, and retry. Do not accept `customerId`, identity values, model options, message role, channel, or tool data from the browser.

### Step 3: Add routes next to current conversation routes

Implement:

```text
GET  /api/projects/:id/conversations/:convId/sidechat/messages
POST /api/projects/:id/conversations/:convId/sidechat/messages
POST /api/projects/:id/conversations/:convId/sidechat/retry
```

The POST sequence is: authorize → validate → atomically insert human message and claim lease → agent-only broadcast → queue existing DO turn → return `202`.

### Step 4: Run tests

```bash
bun test worker/routes/sidechat-handlers.test.ts worker/validation.test.ts
```

### Step 5: Commit

```bash
git add worker/validation.ts worker/validation.test.ts worker/index.ts worker/routes/sidechat-handlers.test.ts
git commit -m "feat: add authenticated internal sidechat routes"
```

---

## Task 6: Generalize the existing chat primitives once

**Files:**

- Modify: `src/lib/inbox/types.ts`
- Modify: `src/components/inbox/ChatThread.tsx`
- Modify: `src/components/inbox/MessageBubble.tsx`
- Modify: `src/components/inbox/Composer.tsx`
- Modify: `src/components/inbox/FocusView.tsx`
- Modify: `src/components/inbox/ReadingPane.tsx`
- Create: `src/lib/inbox/thread-presentation.ts`
- Create: `src/lib/inbox/thread-presentation.test.ts`

### Step 1: Write presentation tests before JSX changes

Test sender placement/labels for both perspectives:

| Channel | Role | Placement |
|---|---|---|
| public | visitor | received |
| public | bot/agent | sent |
| sidechat | bot | received |
| sidechat | agent | sent |

Also cover grouped headers, delivery status only on public messages, `reply_draft` action availability, approval action slots, and archived/read-only state.

### Step 2: Add narrow mode props

Generalize existing components with explicit props such as `mode="public" | "sidechat"`, action slots, placeholder, submit behavior, attachment visibility, and read-only state.

Keep the actual bubble shell, padding, radius, typography, grouping, scroll behavior, auto-grow, and send button in one implementation. Do not create `SidechatBubble`, `SidechatThread`, or another visual shell.

### Step 3: Remove FocusView duplication

Delete its local bubble rendering and compose `ChatThread` + the shared composer surface. Confirm public focus mode is unchanged before adding sidechat.

### Step 4: Verify

```bash
bun test src/lib/inbox/thread-presentation.test.ts
bun run lint
bun run build
```

### Step 5: Commit

```bash
git add src/lib/inbox src/components/inbox
git commit -m "refactor: reuse inbox chat primitives for sidechat"
```

---

## Task 7: Add the sidechat pane and replace inline Compose

**Files:**

- Create: `src/components/inbox/SidechatPane.tsx`
- Create: `src/components/inbox/SidechatMessageActions.tsx`
- Modify: `src/pages/Conversations.tsx`
- Modify: `src/components/inbox/Composer.tsx`
- Modify: `src/components/inbox/ConversationRow.tsx`
- Modify: relevant inbox layout/styles in `src/index.css` only if existing tokens cannot express the state

### Step 1: Add state/data flow, then visuals

Use TanStack Query key `['sidechat-messages', conversationId]`. Keep pane-open state in `Conversations.tsx` and reuse `useConversationWs` for updates.

Opening behavior:

- submit existing public text privately and clear only after `202`;
- otherwise submit the default help message;
- never move pending images;
- if history exists, just open it;
- Shift+Tab works from the public composer and uses the same handler as the button.

### Step 2: Build the pane with shared primitives

Use:

- title `Sidechat`;
- subline `Private · Maven has {firstName}'s context`;
- existing thread/bubbles/composer;
- no sparkle icon;
- no permanent rail, preview panel, card stack, alert, or separators.

`Add to reply` copies the exact structured draft to public composer state, focuses its textarea at the end, and leaves the pane open.

### Step 3: Implement responsive layout exactly

- ≥1536px: 400px pane, list remains.
- 768–1535px: 380px pane capped at 42vw, list hidden.
- <768px: sidechat replaces reading pane with compact back control.
- Focus mode: conversation + sidechat, with current centered conversation width preserved in remaining space.

Use targeted 180–220ms width/opacity/transform transitions and respect reduced motion. Never use `transition-all`.

### Step 4: Remove inline Compose end to end

After the feature path is wired:

- remove compose-draft mutation/state/UI;
- remove `/compose-draft` route and validation only when no caller remains;
- change button copy to `Start sidechat` / `Open sidechat`;
- keep the public reply composer and Send path unchanged.

### Step 5: Commit

```bash
git add src worker/index.ts worker/validation.ts
git commit -m "feat: replace inline compose with private sidechat"
```

---

## Task 8: Leakage, accessibility, responsive, and regression acceptance

**Files:**

- Create: `docs/superpowers/verification/2026-08-08-internal-sidechat.md`
- Add focused tests where the failure belongs

### Step 1: Run automated verification

```bash
bun test
bun run lint
bun run build
```

### Step 2: Run a sentinel leakage test

Place a unique sidechat sentinel in D1 and exercise:

- widget history/polling;
- widget WebSocket reconnect/replay;
- public dashboard history/pagination;
- conversation-list preview;
- Telegram context;
- email context;
- public AI prompt construction; and
- public delivery/read receipts.

The sentinel must appear only in authenticated sidechat GET/events.

### Step 3: Visual QA

Run `bun run dev`, then capture at 1440×1000, 1100×900, 768×900, and 390×844:

1. sidechat closed;
2. first open;
3. existing history;
4. streaming turn;
5. ready draft;
6. failed/retry;
7. conversation switch while prior work continues;
8. focus mode;
9. archived/read-only;
10. keyboard focus, 200% zoom, and reduced motion.

Compare bubble shell, font, padding, radius, composer, and button treatment against the public thread. Record screenshots and deviations in the verification document.

### Step 4: Final architecture grep

```bash
rg -n "MavenSidechatAgent|sidechat_threads|@cloudflare/think|@cloudflare/ai-chat|useAgentChat|SidechatBubble" src worker shared package.json wrangler.jsonc
```

Expected: no matches.

### Step 5: Commit verification fixes

Stage only files changed by this phase, then:

```bash
git commit -m "fix: complete internal sidechat acceptance"
```

Do not deploy. Deployment is a separate user-approved action.
