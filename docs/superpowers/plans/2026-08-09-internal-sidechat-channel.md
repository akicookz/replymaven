# Internal Sidechat Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private human–Maven sidechat to each existing project conversation, using the existing message table, `ConversationDO`, dashboard WebSocket, `ChatThread`, `MessageBubble`, `Composer`, and unified Maven loop, while making public/sidechat leakage impossible at service boundaries.

**Architecture:** `messages.channel` separates public and sidechat rows inside the same conversation. Public and private service methods are explicit and mutually scoped. The authenticated sidechat route persists the human message, claims a short run lease on the conversation, and runs the same `runMavenTurn` used by the widget. Agent-only `sidechat:*` events travel through the current `ConversationDO`. The new pane is layout only; all chat rendering/composition reuses current primitives.

**Tech Stack:** React 19, TanStack Query, Hono, Drizzle/D1, Cloudflare `ConversationDO`, Partysocket, Tailwind v4, Bun tests.

## Global Constraints

- Complete `2026-08-09-unified-maven-tool-loop.md` first.
- Do not create a sidechat-specific Agent, Durable Object, WebSocket, message table, bubble, thread, composer, or model loop.
- Every public message read/write/replay/receipt path must explicitly filter `channel = "public"`; defaults alone are insufficient.
- Sidechat events are dashboard-agent-only. Visitor sockets must never receive them.
- Sidechat activity must not change public ownership, public status, delivery/read receipts, Telegram behavior, visitor last activity, canned-response generation, or public conversation previews.
- Accepted work may continue after the pane closes. One sidechat run may execute per conversation at a time.
- The public composer clears only after its text is accepted and persisted as a sidechat message. Attachments remain staged.
- `Add to reply` fills but never sends the public composer.
- Reuse the exact current typography, bubble, glass, spacing, and motion language; no sparkle icon, card stack, alert, divider, or permanent rail.
- Use function declarations for named functions/components and Bun for all commands.
- Commit steps are checkpoints; do not deploy.

## File Map

| File | Change |
|---|---|
| `worker/db/schema.ts` | Add message channel/kind/metadata and compact conversation sidechat state |
| `worker/db/drizzle/0063_internal_sidechat_channel.sql` | Public-compatible migration |
| `worker/db/sidechat-channel.test.ts` | **Create** migration/schema isolation tests |
| `worker/services/chat-service.ts` | Explicit public predicates; dedicated sidechat reads/writes/run lease |
| `worker/services/chat-service.test.ts` | Public isolation and sidechat lease tests |
| `worker/chat-runtime/types.ts` | Channel-aware role conversion and sidechat prompt context |
| `worker/chat-runtime/types.test.ts` | Public/sidechat role mapping tests |
| `worker/chat-runtime/tools/internal/present-reply-draft.ts` | **Create** structured sidechat draft tool |
| `worker/chat-runtime/tools/internal/present-reply-draft.test.ts` | **Create** channel and draft-bound tests |
| `worker/chat-runtime/orchestration/run-maven-turn.ts` | Register draft tool for sidechat and expose captured artifact |
| `worker/chat-runtime/orchestration/run-sidechat-turn.ts` | **Create** consume shared stream, persist private response, update status |
| `worker/chat-runtime/orchestration/run-sidechat-turn.test.ts` | **Create** lifecycle/recovery/privacy tests |
| `worker/chat-runtime/prompt/build-support-system-prompt.ts` | Add exact private sidechat disclosure contract |
| `worker/chat-runtime/prompt/build-support-system-prompt.test.ts` | Prompt isolation tests |
| `worker/validation.ts` | Add sidechat message/retry schemas |
| `worker/validation.test.ts` | Sidechat validation tests |
| `worker/routes/sidechat-handlers.ts` | **Create** testable authenticated route handlers |
| `worker/routes/sidechat-handlers.test.ts` | **Create** authorization/acceptance tests |
| `worker/index.ts` | Mount sidechat routes; remove compose-draft route/imports |
| `shared/ws-events.ts` | Add agent-only sidechat event contracts and cursors |
| `worker/realtime/broadcast.ts` | Add safe agent-only sidechat broadcasts |
| `worker/realtime/broadcast.test.ts` | Audience and safe payload tests |
| `worker/durable-objects/conversation-do.ts` | Replay/filter both channels on existing sockets |
| `src/lib/use-conversation-ws.ts` | Update private query cache and streaming state |
| `src/lib/inbox/types.ts` | Add sidechat message/status types |
| `src/lib/inbox/sidechat.ts` | **Create** pane/layout/state pure helpers |
| `src/lib/inbox/sidechat.test.ts` | **Create** layout/status/draft transition tests |
| `src/components/inbox/MessageBubble.tsx` | Add public/sidechat perspective and inline bubble actions |
| `src/components/inbox/ChatThread.tsx` | Pass perspective/actions; remain the only thread renderer |
| `src/components/inbox/Composer.tsx` | Support public and sidechat modes; replace Compose action |
| `src/components/inbox/ConversationRow.tsx` | Show one quiet sidechat status dot without changing public preview |
| `src/components/inbox/FocusView.tsx` | Delete duplicate `FocusBubble`; reuse `ChatThread` |
| `src/components/inbox/SidechatPane.tsx` | **Create** layout shell using shared chat primitives |
| `src/components/inbox/ReadingPane.tsx` | Pass sidechat entry props to public composer |
| `src/pages/Conversations.tsx` | Sidechat queries/mutations/layout; delete inline compose mutation |
| `worker/chat-runtime/llm/compose-agent-draft.ts` | **Delete after sidechat draft path passes** |

---

### Task 1: Add the channel-safe message schema

**Files:**
- Modify: `worker/db/schema.ts`
- Create: `worker/db/sidechat-channel.test.ts`
- Generate: `worker/db/drizzle/0063_internal_sidechat_channel.sql`

**Schema:**

```typescript
channel: text("channel", { enum: ["public", "sidechat"] })
  .notNull()
  .default("public"),
kind: text("kind", { enum: ["text", "reply_draft", "approval"] })
  .notNull()
  .default("text"),
metadata: text("message_metadata"),
```

Add to `conversations`:

```typescript
sidechatStatus: text("sidechat_status", {
  enum: ["idle", "working", "waiting_approval", "ready", "failed"],
}).notNull().default("idle"),
sidechatRunId: text("sidechat_run_id"),
sidechatLeaseExpiresAt: integer("sidechat_lease_expires_at", { mode: "timestamp" }),
sidechatUpdatedAt: integer("sidechat_updated_at", { mode: "timestamp" }),
```

- [ ] **Step 1: Write the failing schema/migration test**

Assert exact columns, enums/defaults, `(conversation_id, channel, created_at)` index, public defaults for legacy inserts, and absence of any `sidechat_threads` table.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/db/sidechat-channel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify the schema and generate the named migration**

Run: `bun run db:generate --name internal_sidechat_channel`.

Inspect `0063_internal_sidechat_channel.sql`: existing message rows must become `public/text`; no data copy or second transcript table is allowed.

- [ ] **Step 4: Run the migration test**

Run: `bun test worker/db/sidechat-channel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the checkpoint**

```bash
git add worker/db/schema.ts worker/db/drizzle worker/db/sidechat-channel.test.ts
git commit -m "feat: add internal message channel"
```

### Task 2: Make every transcript operation channel-explicit

**Files:**
- Modify: `worker/services/chat-service.ts`
- Modify: `worker/services/chat-service.test.ts`

**Interfaces:**

```typescript
async getPublicMessages(conversationId: string): Promise<MessageRow[]>;
async getRecentPublicMessages(conversationId: string, limit?: number): Promise<Page>;
async getPublicMessagesBefore(conversationId: string, before: Date, limit?: number): Promise<Page>;
async getPublicMessagesSince(conversationId: string, since: number): Promise<MessageRow[]>;

async getRecentSidechatMessages(conversationId: string, limit?: number): Promise<Page>;
async getSidechatMessagesBefore(conversationId: string, before: Date, limit?: number): Promise<Page>;
async getSidechatMessagesSince(conversationId: string, since: number): Promise<MessageRow[]>;

async addSidechatHumanMessage(input: SidechatHumanMessageInput): Promise<MessageRow | null>;
async addSidechatMavenMessage(input: SidechatMavenMessageInput): Promise<MessageRow | null>;
async getMessageByIdForChannel(id: string, channel: MavenChannel): Promise<MessageRow | null>;
```

- [ ] **Step 1: Add failing isolation tests around all existing public methods**

Seed adjacent public and sidechat rows and assert public detail, pagination, replay, last-message preview, delivery/read marking, emailed message lookup, summary/canned-response inputs, and visitor-message counts never include or mutate sidechat rows.

- [ ] **Step 2: Run and confirm leakage is currently possible**

Run: `bun test worker/services/chat-service.test.ts`
Expected: new channel tests FAIL.

- [ ] **Step 3: Rename ambiguous public methods and add predicates**

Every public query uses both conversation ID and `eq(messages.channel, "public")`. Update all production call sites. Sidechat methods use `eq(messages.channel, "sidechat")` and reject `visitor`/`system` roles.

Sidechat inserts must not update `lastActivityAt`, public status, ownership/chatState, delivery fields, email fields, or Telegram state. They update only `sidechatUpdatedAt`.

- [ ] **Step 4: Add atomic sidechat run coordination**

```typescript
async claimSidechatRun(input: {
  projectId: string;
  conversationId: string;
  runId: string;
  now: Date;
  leaseExpiresAt: Date;
}): Promise<boolean>;

async settleSidechatRun(input: {
  projectId: string;
  conversationId: string;
  runId: string;
  status: "idle" | "ready" | "failed" | "waiting_approval";
}): Promise<boolean>;
```

Claim only when archived is null and no unexpired lease exists. Settlement matches the current run ID. A read of an expired `working` lease normalizes it to `failed` before returning state.

- [ ] **Step 5: Run service tests**

Run: `bun test worker/services/chat-service.test.ts worker/services/conversation-retention-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Audit every direct `messages` query**

Run: `rg -n "from\(messages\)|update\(messages\)|delete\(messages\)" worker`.

Inspect every match. Public/widget/email/Telegram/canned-response/retention paths require an explicit public predicate or a documented all-channel deletion case. Add a test for every corrected leak.

- [ ] **Step 7: Commit the checkpoint**

```bash
git add worker/services worker/index.ts worker/chat-runtime
git commit -m "refactor: enforce message channels in chat service"
```

### Task 3: Carry sidechat over the existing ConversationDO

**Files:**
- Modify: `shared/ws-events.ts`
- Modify: `worker/realtime/broadcast.ts`
- Modify: `worker/realtime/broadcast.test.ts`
- Modify: `worker/durable-objects/conversation-do.ts`
- Modify: `src/lib/use-conversation-ws.ts`

**Wire contracts:**

```typescript
export interface SidechatMessagePayload {
  id: string;
  role: "agent" | "bot";
  content: string;
  kind: "text" | "reply_draft" | "approval";
  metadata: SafeSidechatMessageMetadata | null;
  senderName: string | null;
  createdAt: number;
}

type SidechatServerEvent =
  | { type: "sidechat:message"; conversationId: string; message: SidechatMessagePayload }
  | { type: "sidechat:delta"; conversationId: string; runId: string; delta: string }
  | { type: "sidechat:activity"; conversationId: string; runId: string; label: string; phase: "start" | "finish" }
  | { type: "sidechat:status"; conversationId: string; status: SidechatStatus; runId: string | null };
```

- [ ] **Step 1: Write failing realtime tests**

Assert sidechat events always dispatch with `audience: "agents"`, safe payload conversion rejects unknown metadata keys, visitor sockets never receive or replay sidechat, and agent reconnect supports separate `lastPublicMessageId` and `lastSidechatMessageId` cursors.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/realtime/broadcast.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend the shared event union and broadcasters**

Add dedicated `broadcastSidechatMessage`, `broadcastSidechatDelta`, `broadcastSidechatActivity`, and `broadcastSidechatStatus` functions. Each calls existing dispatch with `{ audience: "agents" }`. Never overload `message:new` for private rows.

- [ ] **Step 4: Extend replay in the existing DO**

On an agent `resume`, replay public rows through `message:new` and private rows through `sidechat:message` using their separate cursors. A visitor resume executes only the public query. No new DO binding or route is added.

- [ ] **Step 5: Update dashboard cache handling**

Keep sidechat messages in `['sidechat', projectId, conversationId]`, status in conversation detail/list caches, and ephemeral delta/activity in a small in-memory store keyed by `runId`. Never append private rows to `conversation-detail.messages`.

- [ ] **Step 6: Run tests and build**

Run: `bun test worker/realtime/broadcast.test.ts worker/services/chat-service.test.ts && bun run build`
Expected: PASS.

- [ ] **Step 7: Commit the checkpoint**

```bash
git add shared/ws-events.ts worker/realtime worker/durable-objects/conversation-do.ts src/lib/use-conversation-ws.ts
git commit -m "feat: route sidechat on conversation realtime"
```

### Task 4: Add structured reply drafts to the shared loop

**Files:**
- Create: `worker/chat-runtime/tools/internal/present-reply-draft.ts`
- Create: `worker/chat-runtime/tools/internal/present-reply-draft.test.ts`
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.ts`
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.test.ts`
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.ts`
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.test.ts`
- Modify: `worker/chat-runtime/types.ts`
- Modify: `worker/chat-runtime/types.test.ts`

**Interfaces:**

```typescript
export type MavenArtifact =
  | { type: "reply_draft"; draft: string }
  | null;

export interface MavenTurnResult {
  fullStream: AsyncIterable<MavenStreamPart>;
  artifact: MavenArtifact;
  collectedSources: SourceReference[];
  toolActivity: SafeToolActivity[];
}
```

- [ ] **Step 1: Write failing draft and role-mapping tests**

Assert the tool is sidechat-only, draft is 1–5,000 characters, public registry excludes it, only its latest successful call becomes the artifact, and channel role conversion is:

```typescript
public:   visitor -> user; bot/agent -> assistant
sidechat: agent -> user; bot -> assistant
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/chat-runtime/tools/internal/present-reply-draft.test.ts worker/chat-runtime/types.test.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tool and artifact capture**

The tool accepts `{ draft: string }`, records the bounded string in the turn-local accumulator, and returns `{ accepted: true }`. It writes nothing by itself. `runSidechatTurn` owns persistence.

- [ ] **Step 4: Add the exact sidechat disclosure prompt**

```text
This is a private conversation with the human support agent. Use private customer
context to reason, but never dump raw records, identifiers, internal links,
metadata, credentials, tool arguments, or complete tool results. Mention only
the minimum customer-safe fact needed in a proposed visitor reply. When a reply
is ready, call present_reply_draft with exactly the text the visitor should see.
Do not send it and do not claim the human approved it.
```

Public prompts must not contain the sidechat disclosure block or expose `present_reply_draft`.

- [ ] **Step 5: Run focused tests**

Run: `bun test worker/chat-runtime/tools/internal/present-reply-draft.test.ts worker/chat-runtime/types.test.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/chat-runtime/prompt/build-support-system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/chat-runtime
git commit -m "feat: add structured sidechat reply drafts"
```

### Task 5: Add authenticated sidechat routes and background execution

**Files:**
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`
- Create: `worker/routes/sidechat-handlers.ts`
- Create: `worker/routes/sidechat-handlers.test.ts`
- Create: `worker/chat-runtime/orchestration/run-sidechat-turn.ts`
- Create: `worker/chat-runtime/orchestration/run-sidechat-turn.test.ts`
- Modify: `worker/index.ts`

**Routes:**

```text
GET  /api/projects/:id/conversations/:convId/sidechat?before=<iso>&limit=<n>
POST /api/projects/:id/conversations/:convId/sidechat/messages
POST /api/projects/:id/conversations/:convId/sidechat/retry
```

POST body: `{ content?: string }`; when present it must trim to 1–5,000 characters. An omitted value asks the server to create the trusted default. Retry body: `{ messageId: string }` referring to the last sidechat human message.

- [ ] **Step 1: Write failing handler tests**

Cover owner/admin/member-with-project-access, unrelated user 404, archived read-only behavior, busy 409 without message insert, persisted acceptance before 202, empty default message built server-side from trusted customer/conversation name, lease expiry retry, and no public ownership/status mutations.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/routes/sidechat-handlers.test.ts worker/chat-runtime/orchestration/run-sidechat-turn.test.ts worker/validation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement testable handlers and mount them**

Use the same effective-owner/project authorization as conversation detail. On POST:

1. resolve operational conversation;
2. claim a 60-second run lease;
3. persist the sidechat human message;
4. broadcast it and working status;
5. start `runSidechatTurn` with `c.executionCtx.waitUntil`;
6. return `{ message, runId }` with status 202.

If persistence fails, release the lease and return an error. Never clear client draft on an error response.

- [ ] **Step 4: Implement `runSidechatTurn` with the shared loop**

Load up to 25 public messages as a read-only prompt transcript and up to 40 private messages as model history. Resolve the linked canonical customer. Call `runMavenTurn` with `channel: "sidechat"`. Broadcast safe delta/activity events, persist one final Maven message, and settle status:

- `ready` for a reply-draft artifact;
- `idle` for ordinary Maven text/question;
- `failed` for abort/model failure/no final output.

Persist reply draft as `content = artifact.draft`, `kind = "reply_draft"`, and safe metadata `{ "draft": artifact.draft }`.

- [ ] **Step 5: Run focused tests**

Run: `bun test worker/routes/sidechat-handlers.test.ts worker/chat-runtime/orchestration/run-sidechat-turn.test.ts worker/services/chat-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/routes/sidechat-handlers.ts worker/routes/sidechat-handlers.test.ts worker/chat-runtime/orchestration/run-sidechat-turn.ts worker/chat-runtime/orchestration/run-sidechat-turn.test.ts worker/index.ts worker/validation.ts worker/validation.test.ts
git commit -m "feat: add authenticated sidechat turns"
```

### Task 6: Reuse chat primitives for both perspectives

**Files:**
- Modify: `src/lib/inbox/types.ts`
- Create: `src/lib/inbox/sidechat.ts`
- Create: `src/lib/inbox/sidechat.test.ts`
- Modify: `src/components/inbox/MessageBubble.tsx`
- Modify: `src/components/inbox/ChatThread.tsx`
- Modify: `src/components/inbox/Composer.tsx`
- Modify: `src/components/inbox/FocusView.tsx`

**Component contracts:**

```typescript
type ChatPerspective = "public" | "sidechat";

interface ChatThreadProps {
  perspective?: ChatPerspective;
  onAddToReply?: (draft: string) => void;
  onApprovalAction?: (messageId: string, mode: "always" | "once") => void;
  // existing props remain
}

type ComposerMode =
  | { kind: "public"; onStartSidechat: () => void; sidechatExists: boolean; sidechatStatus: SidechatStatus }
  | { kind: "sidechat"; onSendPrivate: () => void; working: boolean };
```

- [ ] **Step 1: Write failing pure UI-state tests**

Cover received/sent alignment by perspective, action visibility by `kind`, public draft clearing only after accepted response, Add-to-reply exact replacement/focus intent, pane breakpoint mode, and archived read-only state.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/lib/inbox/sidechat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Generalize `MessageBubble` and `ChatThread`**

Derive received alignment with:

```typescript
const isReceived = perspective === "sidechat"
  ? message.role === "bot"
  : message.role === "visitor";
```

Render `Add to reply` and later approval actions inside the same bubble surface, after description text. They are not nested cards. Keep the exact 14.5px body size and existing bubble widths/radii.

In sidechat, label Maven as `Maven` and the authenticated human as `You`; do not reuse the public `Agent` sender label.

- [ ] **Step 4: Generalize `Composer`**

Public mode keeps attachments, Resolve, and Send, but replaces `Compose ⇧⇥` with `Start sidechat ⇧⇥` or `Open sidechat ⇧⇥`; no icon. Shift+Tab works even when the public draft is empty. Sidechat mode uses the same glass shell, textarea, and 32px send button, but hides attachments/Resolve and shows placeholder `Ask Maven…`.

Show one 7px status dot beside `Open sidechat` and on `ConversationRow` only for `working`, `waiting_approval`, `ready`, or `failed`. Reuse `bg-dot-blue`, `bg-dot-orange`, `bg-dot-green`, and `bg-destructive`; only `working` may pulse, and reduced motion disables the pulse. Use an accessible title/label, not a visible badge or alert. Sidechat activity must not replace or contaminate the public last-message preview.

- [ ] **Step 5: Delete `FocusBubble`**

Make `FocusView` render `ChatThread` so future bubble changes have one implementation. Preserve the focus card's existing scroll/header/composer layout.

- [ ] **Step 6: Run tests and build**

Run: `bun test src/lib/inbox/sidechat.test.ts && bun run build`
Expected: PASS.

- [ ] **Step 7: Commit the checkpoint**

```bash
git add src/lib/inbox src/components/inbox
git commit -m "refactor: share chat primitives with sidechat"
```

### Task 7: Integrate the responsive pane and remove inline Compose

**Files:**
- Create: `src/components/inbox/SidechatPane.tsx`
- Modify: `src/components/inbox/ReadingPane.tsx`
- Modify: `src/pages/Conversations.tsx`
- Modify: `worker/index.ts`
- Delete: `worker/chat-runtime/llm/compose-agent-draft.ts`

- [ ] **Step 1: Add failing orchestrator-state tests**

Extend `src/lib/inbox/sidechat.test.ts` for open/close, conversation switch, prior run continuation, existing-thread copy, empty default, optimistic private message reconciliation, streaming replacement, and `Add to reply` focus command.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/lib/inbox/sidechat.test.ts`
Expected: FAIL on missing transitions.

- [ ] **Step 3: Build `SidechatPane` from shared pieces**

It contains only:

- compact header with `Sidechat`, private subline, and close/back button;
- one scroll region rendering `ChatThread perspective="sidechat"`;
- safe activity/stream continuation inside the thread flow;
- shared `Composer` in sidechat mode.

No visitor preview, toggle rail, permanent pane, duplicate transcript, card shell, or divider.

- [ ] **Step 4: Replace the compose mutation in `Conversations.tsx`**

Delete `composeDraft`, `handleCompose`, `composing`, and `/compose-draft` calls. Add sidechat query/mutation state. When starting from public text, submit the trimmed draft and clear it only in `onSuccess`. If empty, omit content and let the server build the trusted default. Leave pending images untouched.

- [ ] **Step 5: Implement exact responsive layout**

- `>=1536px`: list remains, pane 400px;
- `768–1535px`: list hides, pane `min(380px, 42vw)`;
- `<768px`: sidechat replaces reading pane with compact Back;
- focus mode: conversation plus sidechat;
- closed: current layout is byte-for-byte behaviorally unchanged.

Use targeted width/opacity/transform transitions of 180–220ms with reduced-motion fallback. Never use `transition-all`.

- [ ] **Step 6: Remove the old server compose endpoint**

Delete the route, `composeDraftSchema`, imports, and `compose-agent-draft.ts`. Run `rg -n "compose-draft|composeAgentDraft|onCompose|composing" worker src` and expect no production matches.

- [ ] **Step 7: Run tests and build**

Run: `bun test src/lib/inbox/sidechat.test.ts worker/routes/sidechat-handlers.test.ts worker/chat-runtime && bun run build`
Expected: PASS.

- [ ] **Step 8: Commit the checkpoint**

```bash
git add src worker
git commit -m "feat: replace inline compose with private sidechat"
```

### Task 8: Visual, accessibility, privacy, and recovery verification

**Files:**
- Verify: all files in this plan's File Map
- Modify only if a verification failure is caused by this implementation

- [ ] Start `bun run dev`; do not deploy.
- [ ] Capture sidechat closed, empty, history, working, tool activity, reply draft, failure/retry, conversation switch, focus, and archived states at 1440x1000, 1100x900, 768x900, and 390x844.
- [ ] Confirm all bubbles and both composers use the existing tokens and exact current type scale; buttons remain compact with at least 40px hit targets.
- [ ] Confirm Shift+Tab opens sidechat from an empty or populated public composer and never sends.
- [ ] Confirm `Add to reply` inserts exact text, focuses the public textarea end, leaves sidechat open, and never sends.
- [ ] Confirm closing/reopening during a run recovers through status/durable final message; partial text is not finalized.
- [ ] Connect a visitor widget and dashboard simultaneously; prove no `sidechat:*` frame reaches the visitor socket and no private row appears in widget history/polling.
- [ ] Check keyboard-only use, visible focus, 200% zoom, reduced motion, long customer names, long draft text, and narrow panes.
- [ ] Run `bun test worker src shared`, `bun run build`, and `bun run lint`; fix only new failures.
- [ ] Commit verification fixes, if any:

```bash
git add src worker shared
git commit -m "test: verify private sidechat channel"
```
