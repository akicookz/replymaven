# Private Sidechat Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's one-shot inline Compose feature with an authenticated, durable, private Cloudflare Think sidechat built from the inbox's existing thread, bubble, and composer primitives across desktop, focus mode, tablet, and mobile.

**Architecture:** Add one `MavenSidechatAgent extends Think` Durable Object per project conversation. Think owns the private transcript and resumable stream; D1 stores only a small status projection. The React inbox connects with `useAgent` + `useAgentChat` using a two-minute project-scoped token, while `ChatThread`, `MessageBubble`, and `Composer` are generalized once and reused by ReadingPane, FocusView, and SidechatPane. The stable visitor transcript, widget, Telegram path, and public reply/send flow remain unchanged.

**Tech Stack:** Bun, React 19, Tailwind CSS v4, TanStack Query, Hono, D1/Drizzle, Cloudflare Durable Objects, `agents@0.20.0`, `@cloudflare/think@0.14.0`, `@cloudflare/ai-chat@0.10.0`, AI SDK v6.

**Spec:** `docs/superpowers/specs/2026-08-07-private-sidechat-mcp-actions-design.md` — read it before starting.

## Global Constraints

- Use Bun only. Never use npm/yarn.
- Read every file before modifying it. Preserve unrelated/uncommitted work.
- Function declarations for all named functions and components; arrows only for inline callbacks.
- Do not change widget SSE, visitor APIs, Telegram ownership, or D1 public transcript semantics.
- No private sidechat content may enter `messages`, public SSE, Telegram, or widget APIs.
- No sparkle icon. Exact entry copy is `Start sidechat` / `Open sidechat` plus the existing `⇧⇥` keycap.
- No row separators, `border-t`, `border-b`, `<hr>`, or nested card stacks.
- Reuse and extend `ChatThread`, `MessageBubble`, and `Composer`; do not create sidechat-specific copies of their thread, bubble, Markdown, auto-grow, focus, or send-control implementations.
- Preserve `glass-reading`, `glass-bar`, `glass-button`, `bg-bubble-*`, `text-ink-*`, `rounded-bubble`, and the existing typography.
- Think remains behind `worker/agents/sidechat-runtime.ts`; React remains behind `src/lib/use-sidechat.ts`. Do not scatter experimental SDK calls through inbox components.
- `sendReasoning = false`, `includeMcpTools = false`, `workspaceBash = false`, and a strict `activeTools` allowlist are non-negotiable.
- Do not enable Workers traces for the new agent in this phase.
- Migrations are Drizzle-generated: edit schema, run `bun run db:generate`, inspect SQL, then `bun run db:migrate:dev`.
- Test cycle per task: targeted `bun test <file>`, then `bun run build`, then `bun run lint` with no new failures.
- Commit after every task. Stage only files named by that task; use `git add -p` for any file that already had unrelated edits. Never push or deploy.

---

### Task 1: Record the baseline and upgrade the Cloudflare agent packages

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `wrangler.jsonc`
- Modify: `worker/types.ts`
- Modify: `worker/index.ts`

**Interfaces:**
- Produces SDK versions that support Think durable submissions/actions and MCP v2.
- Produces the `MAVEN_SIDECHAT` Durable Object binding; it is not reachable until later tasks register routes/authentication.

- [ ] **Step 1: Capture the current baseline without changing files**

Run separately:

```bash
bun test
bun run build
bun run lint
```

Record any pre-existing failures in the implementation log. Do not fix unrelated failures in this feature branch.

- [ ] **Step 2: Upgrade only the required compatible packages**

```bash
bun add --exact agents@0.20.0 @cloudflare/think@0.14.0 @cloudflare/ai-chat@0.10.0
```

Keep `ai` on major v6 and `zod` on v4. Inspect `bun.lock` to confirm a single `agents` version and compatible peer ranges.

- [ ] **Step 3: Update Worker compatibility deliberately**

In `wrangler.jsonc`:

- change `compatibility_date` to `2026-08-07`;
- keep only `nodejs_compat` in `compatibility_flags`;
- add the `MAVEN_SIDECHAT -> MavenSidechatAgent` binding;
- append, never edit, migration tag `v2-maven-sidechat-agent` with `MavenSidechatAgent` in `new_sqlite_classes`;
- add `/api/agents/*` to `assets.run_worker_first`;
- do not add `observability.traces.enabled`.

Add typed namespaces to `AppEnv` in `worker/types.ts`.

- [ ] **Step 4: Add temporary exported class shells so typegen/build can resolve bindings**

Create a minimal class shell inside its final Task-6 file, or temporarily export the typed class from `worker/index.ts`. Do not route it yet. The final file must be:

- `worker/agents/maven-sidechat-agent.ts`

- [ ] **Step 5: Regenerate Worker types and verify the compatibility-date jump**

```bash
bun run cf-typegen
bun test
bun run build
bun run lint
```

Expected: no new test/build/lint failure relative to Step 1. If a compatibility-date behavior changes, isolate and fix it before continuing.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock wrangler.jsonc worker/types.ts worker/index.ts worker-configuration.d.ts worker/agents/maven-sidechat-agent.ts
git commit -m "chore: add Cloudflare agent runtime dependencies"
```

---

### Task 2: Define shared sidechat contracts and the pure inbox state machine

**Files:**
- Create: `shared/sidechat-types.ts`
- Create: `src/lib/inbox/sidechat-state.ts`
- Create: `src/lib/inbox/sidechat-state.test.ts`
- Modify: `src/lib/inbox/types.ts`

**Interfaces:**

```typescript
export type SidechatStatus =
  | "idle"
  | "working"
  | "waiting_approval"
  | "ready"
  | "failed";

export interface SidechatProjection {
  conversationId: string;
  status: SidechatStatus;
  unread: boolean;
  lastPreview: string | null;
  lastActivityAt: string | null;
}

export interface SidechatReplyDraft {
  type: "reply_draft";
  text: string;
}
```

`Conversation` gains an optional `sidechat: SidechatProjection | null` field.

- [ ] **Step 1: Write failing state-machine tests**

Test pure functions for:

- empty public draft -> `Help me respond to Sarah.`;
- non-empty public draft preserves original whitespace in the private message but tests emptiness with `.trim()`;
- public draft clears only on `accepted`;
- existing sidechat opens without creating a duplicate starter message;
- status-to-dot token mapping;
- archived thread is read-only;
- pane visibility at mobile, compact desktop, and `2xl` desktop breakpoints.

Run:

```bash
bun test src/lib/inbox/sidechat-state.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 2: Implement the smallest pure state helpers**

Use explicit return types and no React dependency:

```typescript
export function buildStarterMessage(
  draft: string,
  customerFirstName: string,
): string;

export function getSidechatEntryLabel(
  projection: SidechatProjection | null,
): "Start sidechat" | "Open sidechat";
```

- [ ] **Step 3: Add the shared wire types**

Include typed server frames/data parts for:

- `data-sidechat-activity`;
- `data-sidechat-reply-draft`;
- phase-3 `data-sidechat-approval` (declare now; render later);
- `sidechat:status` realtime event payload.

Do not use `unknown` beyond parsing boundaries and never use `any`.

- [ ] **Step 4: Run tests and typecheck**

```bash
bun test src/lib/inbox/sidechat-state.test.ts
bun run build
```

Expected: state tests pass; frontend and worker agree on shared types.

- [ ] **Step 5: Commit**

```bash
git add shared/sidechat-types.ts src/lib/inbox/sidechat-state.ts src/lib/inbox/sidechat-state.test.ts src/lib/inbox/types.ts
git commit -m "feat: define private sidechat contracts"
```

---

### Task 3: Add the D1 sidechat status projection

**Files:**
- Modify: `worker/db/schema.ts`
- Create: `worker/services/sidechat-service.ts`
- Create: `worker/services/sidechat-service.test.ts`
- Create: generated `worker/db/drizzle/006X_*.sql`
- Modify: generated `worker/db/drizzle/meta/*`

**Schema:**

```typescript
export const sidechatThreads = sqliteTable(
  "sidechat_threads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    agentName: text("agent_name").notNull(),
    status: text("status", { enum: ["idle", "working", "waiting_approval", "ready", "failed"] }).notNull(),
    unread: integer("unread", { mode: "boolean" }).notNull().default(false),
    lastPreview: text("last_preview"),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`).$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    uniqueIndex("idx_sidechat_threads_conversation").on(table.projectId, table.conversationId),
    index("idx_sidechat_threads_project_status").on(table.projectId, table.status),
  ],
);
```

`lastPreview` is capped at 160 characters and accepts only a server-produced private assistant summary; never store tool outputs or approval arguments.

- [ ] **Step 1: Write failing service tests**

Cover create/upsert, status transition, unread rules, mark read, project scoping, 160-char preview cap, and cascade-friendly delete behavior.

```bash
bun test worker/services/sidechat-service.test.ts
```

Expected: fail because table/service do not exist.

- [ ] **Step 2: Add schema and service**

Required methods:

```typescript
getByConversation(projectId: string, conversationId: string): Promise<SidechatThreadRow | null>
upsertStatus(input: UpdateSidechatStatusInput): Promise<SidechatThreadRow>
markRead(projectId: string, conversationId: string): Promise<void>
deleteProjection(projectId: string, conversationId: string): Promise<void>
```

- [ ] **Step 3: Generate and apply migration**

```bash
bun run db:generate
bun run db:migrate:dev
```

Inspect SQL: it must only create `sidechat_threads` and its indexes. No existing table may be recreated/dropped.

- [ ] **Step 4: Run tests**

```bash
bun test worker/services/sidechat-service.test.ts
bun run build
```

- [ ] **Step 5: Commit**

Stage the exact generated migration/snapshot files plus schema/service/tests.

```bash
git commit -m "feat: persist sidechat status projections"
```

---

### Task 4: Add short-lived sidechat connection tokens

**Files:**
- Create: `worker/security/sidechat-connection-token.ts`
- Create: `worker/security/sidechat-connection-token.test.ts`
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`

**Token contract:**

```typescript
export interface SidechatConnectionClaims {
  v: 1;
  aud: "replymaven-sidechat";
  sub: string;
  effectiveUserId: string;
  projectId: string;
  conversationId: string;
  agentName: string;
  role: "owner" | "admin" | "member";
  canApproveOnce: boolean;
  canManagePolicy: boolean;
  iat: number;
  exp: number;
}
```

Sign with HMAC-SHA256 using a key derived from `ENCRYPTION_KEY` with the fixed context label `replymaven-sidechat-token-v1`; do not add a browser-visible secret.

- [ ] **Step 1: Write failing token tests**

Cover round-trip, signature tampering, wrong audience, wrong agent name, expiry, future `iat`, version mismatch, and the exact two-minute maximum lifetime.

```bash
bun test worker/security/sidechat-connection-token.test.ts
```

- [ ] **Step 2: Implement base64url/HMAC helpers with Web Crypto**

Match the style of `worker/security/customer-identity-token.ts`; do not duplicate unsafe parsers. Error returns must be stable codes, not raw crypto exceptions.

- [ ] **Step 3: Add request validation**

Add a schema only for optional client timezone/locale metadata. Project, conversation, user, role, and agent name always come from the authenticated server context.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/security/sidechat-connection-token.test.ts worker/validation.test.ts
bun run build
git add worker/security/sidechat-connection-token.ts worker/security/sidechat-connection-token.test.ts worker/validation.ts worker/validation.test.ts
git commit -m "feat: secure sidechat WebSocket connections"
```

---

### Task 5: Build the private sidechat context boundary and prompt

**Files:**
- Create: `worker/agents/sidechat-context.ts`
- Create: `worker/agents/sidechat-context.test.ts`
- Create: `worker/agents/sidechat-prompt.ts`
- Create: `worker/agents/sidechat-prompt.test.ts`
- Modify: `worker/services/customer-service.ts` only if a project-scoped read helper is missing

**Interfaces:**

```typescript
export interface SidechatContext {
  project: { id: string; companyName: string | null; companyContext: string | null };
  conversation: { id: string; status: string; archived: boolean };
  customer: { id: string; firstName: string; externalId: string | null; email: string | null } | null;
  transcript: Array<{ role: "visitor" | "bot" | "agent"; content: string; createdAt: string }>;
}
```

System rows, tool executions, Telegram metadata, encrypted settings, API keys, public-bot hidden instructions, and raw customer custom fields are excluded. Canonical external ID/email may reach the private model context for generic MCP tool calls but never a public draft unless the human explicitly wrote it there.

- [ ] **Step 1: Write failing context tests**

Cover project scoping, 40-message transcript cap, exclusion of system messages, archived state, linked canonical customer, external-ID preference, normalized canonical-email fallback, and no fallback to conversation snapshot email.

- [ ] **Step 2: Implement the D1 loader**

Load current context on every turn so new visitor messages are visible without copying them into the private transcript.

- [ ] **Step 3: Write failing prompt tests**

Assert exact policy clauses:

- private collaborator speaking to the dashboard human;
- context may inform but must not be dumped;
- never address the visitor unless producing a `reply_draft` attachment;
- never auto-send;
- use external ID before email when a future native MCP tool can accept both;
- never repeat external IDs, email, internal links, raw records, or hidden metadata in visible sidechat prose or a reply draft;
- if facts are unavailable, ask the human or draft without inventing;
- `presentReplyDraft` exactly once when a sendable reply is ready.

- [ ] **Step 4: Implement the prompt builder**

Use explicit XML-like context sections and escape content. Keep the policy outside customer-controlled transcript text.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/agents/sidechat-context.test.ts worker/agents/sidechat-prompt.test.ts
bun run build
git add worker/agents/sidechat-context.ts worker/agents/sidechat-context.test.ts worker/agents/sidechat-prompt.ts worker/agents/sidechat-prompt.test.ts worker/services/customer-service.ts
git commit -m "feat: build private sidechat context"
```

---

### Task 6: Implement the Think agent behind a narrow runtime adapter

**Files:**
- Create: `worker/agents/sidechat-runtime.ts`
- Create: `worker/agents/sidechat-runtime.test.ts`
- Replace shell: `worker/agents/maven-sidechat-agent.ts`
- Modify: `worker/index.ts`
- Modify: `worker/types.ts`

**Runtime adapter:**

```typescript
export interface SidechatTurnRuntime {
  submitStarter(text: string, idempotencyKey: string): Promise<{ accepted: boolean; submissionId: string }>;
  markRead(): Promise<void>;
  destroyThread(): Promise<void>;
}
```

The adapter is the only application code that calls Think `runTurn`, `submitMessages`, Session, or reply-attachment APIs.

- [ ] **Step 1: Write failing adapter/config tests**

Assert deterministic agent name parsing, idempotency keys, active tool allowlist, `sendReasoning=false`, `includeMcpTools=false`, `workspaceBash=false`, message concurrency `queue`, and no client tools.

- [ ] **Step 2: Implement `presentReplyDraft`**

Use a server action that validates:

```typescript
z.object({ text: z.string().trim().min(1).max(4_000) })
```

Attach `{ type: "reply_draft", text }`, return only `{ presented: true }`, and render it as `data-sidechat-reply-draft`. Do not persist it to D1.

- [ ] **Step 3: Implement `MavenSidechatAgent`**

Required behavior:

- verify token in `onConnect`; close with code 4001 on failure;
- build model with existing `createLanguageModel` and environment keys;
- load fresh `SidechatContext` in `beforeTurn`;
- return only `presentReplyDraft` in the phase-1 active tool list;
- set D1 projection to `working` before a turn;
- set `ready` when a reply draft exists, `idle` after normal private answer, `failed` on terminal error;
- keep recovery enabled and configure a 120-second stall watchdog;
- never log message bodies or tool/action parts.

- [ ] **Step 4: Export and route the agent**

In `worker/index.ts`, run `routeAgentRequest` for `/api/agents/*` before protected Hono dashboard routes and before the SPA fallback. Reject every agent class except `maven-sidechat-agent` in this phase. Agent `onConnect` remains the authority even if routing is reached.

- [ ] **Step 5: Verify local WebSocket behavior**

Start `bun run dev`. With a deliberately invalid token, connect to the agent route and expect close 4001. Do not continue until an unauthenticated socket cannot read existing messages.

- [ ] **Step 6: Verify and commit**

```bash
bun test worker/agents/sidechat-runtime.test.ts worker/agents/sidechat-context.test.ts worker/agents/sidechat-prompt.test.ts
bun run build
bun run lint
git add worker/agents/sidechat-runtime.ts worker/agents/sidechat-runtime.test.ts worker/agents/maven-sidechat-agent.ts worker/index.ts worker/types.ts
git commit -m "feat: add durable private sidechat agent"
```

---

### Task 7: Add authenticated dashboard endpoints and realtime projection events

**Files:**
- Create: `worker/routes/sidechat-handlers.ts`
- Create: `worker/routes/sidechat-handlers.test.ts`
- Modify: `worker/index.ts`
- Modify: `shared/ws-events.ts`
- Modify: `worker/realtime/broadcast.ts`
- Modify: `worker/realtime/broadcast.test.ts`
- Modify: `worker/durable-objects/conversation-do.ts`
- Modify: `worker/services/chat-service.ts`
- Modify: `worker/services/chat-service.test.ts`

**Endpoints:**

- `POST /api/projects/:id/conversations/:convId/sidechat/token`
- `POST /api/projects/:id/conversations/:convId/sidechat/read`

Token response:

```typescript
{ token: string; agentName: string; expiresAt: string }
```

- [ ] **Step 1: Write failing route tests**

Cover unauthenticated 401, wrong project 404, inaccessible team project 404, archived conversation token read-only claims, valid token claims, and no customer data in response.

- [ ] **Step 2: Implement route handlers using existing effective-owner/team checks**

Do not reimplement auth inside the handler. Reuse the same project/conversation access path as the detail route and derive permission claims from `activeRole`.

- [ ] **Step 3: Write failing list-projection tests**

Conversation list/detail results should include `sidechat: null` or the exact projection; private transcript and agent name must not be serialized to the browser list.

- [ ] **Step 4: Join/project sidechat status in ChatService**

Use a left join or batched project query; do not introduce N+1 agent/D1 reads.

- [ ] **Step 5: Add realtime `sidechat:status`**

Broadcast only conversation ID, status, unread, and lastActivityAt. Update dashboard clients; never forward the event to visitor sockets.

- [ ] **Step 6: Verify and commit**

```bash
bun test worker/routes/sidechat-handlers.test.ts worker/services/chat-service.test.ts worker/realtime/broadcast.test.ts
bun run build
git add worker/routes/sidechat-handlers.ts worker/routes/sidechat-handlers.test.ts worker/index.ts shared/ws-events.ts worker/realtime/broadcast.ts worker/realtime/broadcast.test.ts worker/durable-objects/conversation-do.ts worker/services/chat-service.ts worker/services/chat-service.test.ts
git commit -m "feat: expose authenticated sidechat status"
```

---

### Task 8: Build the React sidechat client hook

**Files:**
- Create: `src/lib/use-sidechat.ts`
- Create: `src/lib/use-sidechat.test.ts`
- Modify: `src/lib/use-conversation-ws.ts`

**Hook contract:**

```typescript
export interface UseSidechatResult {
  messages: SidechatUiMessage[];
  status: "connecting" | "idle" | "submitted" | "streaming" | "error";
  submitStarter(text: string): Promise<boolean>;
  sendPrivateMessage(text: string): void;
  markRead(): void;
  retry(): void;
}
```

- [ ] **Step 1: Write failing parser/transfer tests**

Extract pure helpers and test reply-draft data parts, activity parts, unsupported parts ignored, connection-token refresh, and starter idempotency key stability.

- [ ] **Step 2: Implement `useAgent` + `useAgentChat` wrapper**

- Fetch a token lazily only when pane opens.
- Pass it through async `query` to `useAgent`.
- Use `resume: true` and `cancelOnClientAbort: false`.
- Never pass browser tools or automatic approval handlers.
- Do not expose raw `UIMessage` shapes to inbox components; normalize them first.

- [ ] **Step 3: Handle realtime status**

Extend `use-conversation-ws.ts` for `sidechat:status` and update the relevant TanStack Query caches without invalidating the entire inbox.

- [ ] **Step 4: Verify and commit**

```bash
bun test src/lib/use-sidechat.test.ts src/lib/inbox/sidechat-state.test.ts
bun run build
git add src/lib/use-sidechat.ts src/lib/use-sidechat.test.ts src/lib/use-conversation-ws.ts
git commit -m "feat: connect inbox to private sidechat"
```

---

### Task 9: Generalize the existing chat primitives and compose sidechat from them

**Files:**
- Modify: `src/components/inbox/ChatThread.tsx`
- Modify: `src/components/inbox/MessageBubble.tsx`
- Modify: `src/components/inbox/Composer.tsx`
- Modify: `src/components/inbox/FocusView.tsx`
- Create: `src/components/inbox/SidechatPane.tsx`
- Create: `src/components/inbox/chat-primitives.test.ts`
- Create: `src/components/inbox/sidechat-a11y.test.ts`

**Interfaces:**

```typescript
export interface ThreadItem {
  id: string;
  direction: "received" | "sent";
  senderLabel: string;
  senderTone: "visitor" | "maven" | "human";
  content: string;
  createdAt: string;
  bodyKind: "markdown" | "activity" | "reply_draft" | "approval";
}

export interface ComposerMode {
  kind: "public_reply" | "private_sidechat";
  placeholder: string;
  submitOnEnter: boolean;
  showAttachments: boolean;
  showResolve: boolean;
}
```

- [ ] **Step 1: Write failing reuse/static-contract tests**

Assert:

- `SidechatPane.tsx` imports and renders `ChatThread`, `MessageBubble` through the thread renderer, and `Composer`;
- there is no `SidechatMessage`, `SidechatComposer`, alternate bubble shell, alternate Markdown renderer, or copied textarea auto-grow hook;
- `FocusView.tsx` no longer defines `FocusBubble` or calls `renderMarkdown` directly;
- public mode retains attachments, Resolve, Cmd/Ctrl+Enter, and existing placeholder behavior;
- private mode uses `Message privately…`, Enter to submit, Shift+Enter for a newline, no attachment/Resolve controls;
- no string/import matches `Sparkles`, `sparkle`, `Not now`, or `verified`.

Run:

```bash
bun test src/components/inbox/chat-primitives.test.ts src/components/inbox/sidechat-a11y.test.ts
```

Expected: fail because the existing primitives do not yet expose the required modes/slots.

- [ ] **Step 2: Extract a reusable bubble shell inside `MessageBubble.tsx`**

Keep `MessageBubble` as the public adapter, but export one named `MessageBubbleShell` used by both public messages and sidechat. It owns:

- sender/timestamp header;
- sent/received alignment and colors;
- `max-w-9/10 sm:max-w-3/4 px-3.5 py-2.5 text-[14.5px] leading-normal`;
- `rounded-bubble` and six-pixel tail corner;
- the existing `prose-chat`/`renderMarkdown` path;
- an optional `actions` slot inside the bubble body.

Activity, reply-draft, and approval content may supply body/actions; none may recreate the outer bubble markup.

- [ ] **Step 3: Generalize `ChatThread` without changing public output**

Add a typed adapter from current `Message`/`Conversation` to `ThreadItem`, plus an optional private item collection/body renderer. Preserve the current skeleton, date dividers, five-minute sender grouping, search hooks, message IDs, and spacing. Snapshot/class-contract tests must prove ReadingPane output is unchanged for representative visitor/bot/agent/system sequences.

- [ ] **Step 4: Add private mode to `Composer`**

Move the existing layout-effect auto-grow, focus restoration, container, textarea, and 32px circular send control into the shared mode path. Public mode retains uploads, drag/drop, Resolve, sidechat entry, and Cmd/Ctrl+Enter. Private mode reuses the same structure while hiding public-only controls and submitting on Enter.

- [ ] **Step 5: Remove FocusView's duplicate bubble implementation**

Delete `FocusBubble`, `renderMarkdown`, and local image/body rendering from `FocusView.tsx`. Render the conversation with the generalized `ChatThread` so focus mode, ReadingPane, and sidechat share one thread/bubble implementation.

- [ ] **Step 6: Compose `SidechatPane` from the shared primitives**

`SidechatPane` owns only pane orchestration and sidechat-specific body content:

- width `w-full md:w-[min(380px,42vw)] 2xl:w-[400px]`;
- `glass-reading flex shrink-0 flex-col h-full overflow-hidden`;
- 14px semibold title and 11.5–12px muted subline;
- close/back control;
- conversion of normalized sidechat messages to `ThreadItem`;
- compact activity with `role="status"`;
- reply-draft body with one `Add to reply` action in the shared bubble action slot;
- shared Composer in `private_sidechat` mode;
- near-bottom scroll pinning and per-conversation scroll restoration;
- 200ms opacity/translate transition with reduced-motion override.

It must not define bubble surfaces, Markdown, textarea growth, or a second send button.

- [ ] **Step 7: Run tests/build and commit**

```bash
bun test src/components/inbox/chat-primitives.test.ts src/components/inbox/sidechat-a11y.test.ts
bun run build
bun run lint
git add src/components/inbox/ChatThread.tsx src/components/inbox/MessageBubble.tsx src/components/inbox/Composer.tsx src/components/inbox/FocusView.tsx src/components/inbox/SidechatPane.tsx src/components/inbox/chat-primitives.test.ts src/components/inbox/sidechat-a11y.test.ts
git commit -m "refactor: reuse inbox chat primitives for sidechat"
```

---

### Task 10: Replace inline Compose in the split inbox and focus view

**Files:**
- Modify: `src/pages/Conversations.tsx`
- Modify: `src/components/inbox/Composer.tsx`
- Modify: `src/components/inbox/ReadingPane.tsx`
- Modify: `src/components/inbox/FocusView.tsx`
- Modify: `src/components/inbox/MessageList.tsx`
- Modify: `src/components/inbox/ConversationRow.tsx`
- Modify: `src/lib/inbox/types.ts`

**Prop replacement:**

```typescript
// Remove
onCompose: () => void;
composing: boolean;

// Add
onStartSidechat: () => void;
sidechatOpen: boolean;
sidechatProjection: SidechatProjection | null;
```

- [ ] **Step 1: Remove the compose mutation and add conversation-scoped pane state**

Delete `composeDraft` and `handleCompose` from `Conversations.tsx`. Add:

- `sidechatOpen` boolean;
- selected-conversation sidechat hook;
- transfer-in-flight state;
- `handleStartSidechat` that opens first, submits, then clears public draft only after acceptance;
- `handleAddToReply` that sets draft and focuses the public textarea.

Keep sidechat open when selecting another conversation; bind the hook to the newly selected ID.

- [ ] **Step 2: Replace the Composer action exactly**

In `Composer.tsx`:

- change key handler from `onCompose` to `onStartSidechat`;
- allow Shift+Tab when draft is empty;
- visible copy `Start sidechat` or `Open sidechat`;
- preserve `⇧⇥` keycap;
- no icon;
- no `Composing…`/shimmer state;
- disable only while the starter transfer is being accepted;
- keep Resolve, attachments, and public Send unchanged.

- [ ] **Step 3: Add the sidechat as a real third pane**

Split view rules:

- closed: existing list + reading pane exactly unchanged;
- open under `2xl`: hide MessageList, show ReadingPane + 380px sidechat;
- open at `2xl`: keep MessageList + ReadingPane + 400px sidechat;
- open mobile: hide list and reading pane, show sidechat full width;
- close mobile: restore reading pane.

- [ ] **Step 4: Integrate focus view**

Render FocusView and SidechatPane as siblings. The focus conversation card keeps its max width and centers in remaining space. Reuse the `ChatThread` and `Composer` primitive instances introduced in Task 9; do not restore `FocusBubble`, duplicate sidechat state, or create a second agent connection.

- [ ] **Step 5: Add quiet status dots**

ConversationRow gets a 6px dot using existing dot tokens:

- working -> `bg-dot-blue` with subtle pulse;
- waiting approval -> `bg-dot-orange`;
- ready -> `bg-dot-green`;
- failed -> `bg-dot-gray`.

No text badge, count chip, or sparkle icon. Selected-row contrast must remain legible.

- [ ] **Step 6: Verify keyboard/focus behavior**

Manual checks:

- Shift+Tab never moves focus and works with empty/non-empty draft;
- normal Tab and Shift+Tab outside the public textarea are unchanged;
- failed starter submission preserves public draft;
- Add to reply focuses textarea at end;
- Cmd/Ctrl+Enter still sends publicly;
- closing sidechat leaves work running.

- [ ] **Step 7: Build and commit**

```bash
bun test src/lib/inbox/sidechat-state.test.ts src/lib/use-sidechat.test.ts
bun run build
bun run lint
git add src/pages/Conversations.tsx src/components/inbox/Composer.tsx src/components/inbox/ReadingPane.tsx src/components/inbox/FocusView.tsx src/components/inbox/MessageList.tsx src/components/inbox/ConversationRow.tsx src/lib/inbox/types.ts
git commit -m "feat: replace inline compose with sidechat"
```

---

### Task 11: Remove the obsolete compose endpoint and prompt implementation

**Files:**
- Modify: `worker/index.ts`
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`
- Delete: `worker/chat-runtime/llm/compose-agent-draft.ts`
- Modify/delete tests that exclusively cover compose-draft

- [ ] **Step 1: Prove there are no callers**

```bash
rg -n "compose-draft|composeDraftSchema|composeAgentDraft|handleCompose|onCompose|composing" src worker shared
```

Expected before deletion: only the route/validation/LLM implementation and their tests remain. If another caller exists, stop and update this plan.

- [ ] **Step 2: Delete the route and dead code**

Remove `/compose-draft`, its rate-limit key, validation schema, imports, and obsolete tests. Do not remove the planner's internal `compose` action; that is part of the public bot runtime and is unrelated.

- [ ] **Step 3: Prove the correct compose code remains**

```bash
rg -n "compose-draft|composeAgentDraft|onCompose|Composing…" src worker shared
```

Expected: zero hits. Then run:

```bash
bun test
bun run build
bun run lint
```

- [ ] **Step 4: Commit**

```bash
git add worker/index.ts worker/validation.ts worker/validation.test.ts worker/chat-runtime/llm/compose-agent-draft.ts
git commit -m "refactor: remove one-shot reply compose"
```

---

### Task 12: Add cleanup, feature gating, and privacy-safe failure handling

**Files:**
- Create: `worker/services/sidechat-retention-service.ts`
- Create: `worker/services/sidechat-retention-service.test.ts`
- Modify: `worker/services/conversation-retention-service.ts`
- Modify: `worker/services/conversation-retention-service.test.ts`
- Modify: manual conversation/project delete handlers in `worker/index.ts`
- Modify: `worker/services/chat-service.ts`
- Modify: `src/lib/inbox/types.ts`
- Modify: `src/pages/Conversations.tsx`
- Modify: `worker/types.ts`
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Write failing lifecycle tests**

Cover manual conversation deletion, retention deletion, project deletion, idempotent missing-agent cleanup, and retry recording when agent destroy fails.

- [ ] **Step 2: Implement `destroyThread()`**

Clear Think Session/messages, approval state, schedules, and workspace rows, then delete the D1 projection. It must be safe to call more than once.

- [ ] **Step 3: Integrate cleanup before destructive D1 operations**

Use `executionCtx.waitUntil` only after a durable cleanup task has been recorded. Do not let a transient DO failure orphan private data silently.

- [ ] **Step 4: Add a server-side rollout flag**

Add `PRIVATE_SIDECHAT_ENABLED` to `AppEnv`/`wrangler.jsonc`, false in production configuration until visual acceptance. When false:

- token endpoint returns 404;
- agent route refuses new sidechat connections;
- authenticated conversation list/detail responses expose `sidechatEnabled: false` and the frontend omits the entry action and pane;
- existing public reply/send remains fully usable.

- [ ] **Step 5: Verify no sensitive logging**

Search all new files for `console`, request/response body logs, UIMessage logging, token logging, and tool-part logging. Only event IDs/status/error codes may be logged.

- [ ] **Step 6: Verify and commit**

```bash
bun test worker/services/sidechat-retention-service.test.ts worker/services/conversation-retention-service.test.ts
bun run build
bun run lint
git add worker/services/sidechat-retention-service.ts worker/services/sidechat-retention-service.test.ts worker/services/conversation-retention-service.ts worker/services/conversation-retention-service.test.ts worker/index.ts worker/services/chat-service.ts src/lib/inbox/types.ts src/pages/Conversations.tsx worker/types.ts wrangler.jsonc
git commit -m "feat: enforce sidechat lifecycle boundaries"
```

---

### Task 13: Pixel, responsive, motion, and accessibility acceptance

**Files:**
- Modify only files from Tasks 8–10 when a measured defect is found
- Create: `docs/superpowers/verification/2026-08-07-private-sidechat-foundation.md`

- [ ] **Step 1: Start the real application**

```bash
bun run dev
```

Use a real local conversation and a local agent instance. Do not validate against a standalone mock HTML file.

- [ ] **Step 2: Capture the required viewport matrix**

Capture all phase-1 states—closed, empty, history, working/streaming, ready draft, failed, conversation switch, focus mode, and archived read-only—at:

```text
1440x1000
1100x900
768x900
390x844
```

Use `bun ~/.preview-tools/shot.mjs <url> <out.png> [selector] [width] [height]`. Store temporary captures outside the repo unless the user asks to retain them.

- [ ] **Step 3: Compare against existing inbox measurements**

Record in the verification doc:

- public composer/pane unchanged when sidechat closed;
- header, bubble, and button font sizes;
- 380/400px pane widths;
- no list at compact desktop while open;
- no overlay/mobile sliver;
- no sparkle icon/card/alert/badge/Not now;
- no clipped long text at 200% zoom.

- [ ] **Step 4: Keyboard and screen-reader pass**

Test tab order, Escape/close behavior, focus restoration, aria-live activity, reduced motion, and color contrast. Visible compact controls must retain at least a 40px hit area.

- [ ] **Step 5: Final automated verification**

```bash
bun test
bun run build
bun run lint
git diff --check
```

Expected: no new failures relative to Task 1 baseline and no whitespace errors.

- [ ] **Step 6: Commit verification-only fixes and record**

```bash
git add docs/superpowers/verification/2026-08-07-private-sidechat-foundation.md <exact-fixed-files>
git commit -m "fix: polish sidechat across inbox layouts"
```

Do not deploy. Ask the user before any production migration, flag change, push, or deployment.
