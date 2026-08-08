# Generic MCP Write Approval Implementation Plan

> **Required skill:** Execute with `superpowers:test-driven-development`; use `superpowers:verification-before-completion` before calling the phase complete.

**Goal:** Let any configured native MCP write tool pause for a compact dashboard-sidechat approval and execute exactly once after `Always allow` or `Allow once`.

**Architecture:** Extend the phase 2 dynamic native-tool wrapper. Read tools still execute directly. A write without an exact persistent grant stores AES-GCM-encrypted native arguments in a project-scoped pending-call row, persists a safe `approval` sidechat message, and ends the current model turn. The authenticated decision route atomically claims and executes that pending call through `McpConnectionService`, then starts a normal sidechat continuation with the raw result only in memory. No Think Action, durable pause, provider-specific action, or second sidechat runtime is added.

**Dependency:** Phases 1 and 2 are complete.

**Design source:** `docs/superpowers/specs/2026-08-07-private-sidechat-mcp-actions-design.md`

## Non-negotiable invariants

- Every native tool marked `write` uses one generic approval path.
- The browser receives only a safe descriptor and opaque execution ID—never native arguments, schema, credentials, or result.
- Exact native arguments are encrypted at rest with the existing `ENCRYPTION_KEY` and decrypted only during the authoritative execution.
- Approval is accepted only from an authenticated dashboard route after project/conversation/role authorization.
- The server ignores browser-supplied connection IDs, tool names, arguments, amounts, targets, and descriptors.
- `Allow once` scopes to one exact execution. `Always allow` scopes to project + connection + native tool + input-schema fingerprint.
- The same execution ID can cross `prepared -> executing` once. Duplicate clicks/calls are idempotent.
- Ambiguous provider outcomes are `unknown` and never retried automatically.
- Approval UI is the same received Maven bubble with two compact actions—no card, alert, badge, `Not now`, or reject button.
- Raw inputs/results never enter either message channel, browser frames, Telegram, logs, traces, or audit rows.

---

## Task 1: Define safe approval contracts

**Files:**

- Create: `shared/mcp-approvals.ts`
- Create: `shared/mcp-approvals.test.ts`
- Modify: `shared/ws-events.ts`

### Step 1: Write failing contract tests

Define a safe descriptor:

```ts
interface McpApprovalDescriptor {
  executionId: string;
  title: string;
  description: string;
  criticalRanges: Array<{ start: number; end: number }>;
  expiresAt: number;
}
```

It must not contain connection ID, native tool name, arguments, schema, raw result, provider object, credential, or model reasoning.

Use validated ranges (or another bounded structured emphasis representation) so the UI can bold important description text without accepting arbitrary HTML.

Define statuses: `pending | executing | succeeded | failed | unknown | expired | invalidated`.

### Step 2: Add safe WebSocket update shape

`sidechat:approval_updated` contains conversation/message/execution IDs and safe status/summary only. It is always dashboard-agent-only through the phase 1 broadcast helper.

### Step 3: Verify

```bash
bun test shared/mcp-approvals.test.ts worker/realtime/broadcast.test.ts
```

### Step 4: Commit

```bash
git add shared/mcp-approvals.ts shared/mcp-approvals.test.ts shared/ws-events.ts worker/realtime/broadcast.test.ts
git commit -m "feat: define generic MCP approval contract"
```

---

## Task 2: Persist encrypted pending calls and exact policies

**Files:**

- Modify: `worker/db/schema.ts`
- Create: generated migration under `worker/db/drizzle/`
- Create: `worker/db/mcp-approval-schema.test.ts`

### Step 1: Write failing schema tests

Add:

### `mcp_pending_calls`

- ID;
- project, conversation, connection IDs with cascades;
- native tool name and input-schema fingerprint;
- encrypted arguments;
- argument hash and execution/idempotency hash;
- safe descriptor JSON and descriptor hash;
- state;
- expires/claimed/settled timestamps;
- actor/approval mode after decision;
- created/updated timestamps.

### `mcp_tool_policies`

- project and connection IDs;
- native tool name;
- input-schema fingerprint;
- mode `every_time | always`;
- enabled;
- actor and timestamps;
- exact unique scope.

Use the phase 2 `mcp_action_runs` table for safe audit output.

Tests must prove:

- ciphertext is never equal to plaintext;
- exact scope uniqueness;
- project/conversation/connection cascade cleanup;
- no raw result column;
- status enum correctness; and
- expired/policy indexes support approval lookup.

### Step 2: Implement and generate migration

Use the existing AES-GCM encryption service. Hash canonical JSON with a deterministic key-order serializer before encryption; never log plaintext during canonicalization failures.

```bash
bun run db:generate
bun run db:migrate:dev
bun test worker/db/mcp-approval-schema.test.ts
```

### Step 3: Commit

```bash
git add worker/db/schema.ts worker/db/drizzle worker/db/mcp-approval-schema.test.ts
git commit -m "feat: persist encrypted MCP write approvals"
```

---

## Task 3: Implement the generic pending-call state machine

**Files:**

- Create: `worker/services/mcp-approval-service.ts`
- Create: `worker/services/mcp-approval-service.test.ts`
- Modify: `worker/services/mcp-connection-service.ts`

### Step 1: Write failing state-machine tests

Cover:

- prepare validates current enabled write setting and schema fingerprint;
- arguments encrypt before insert and round-trip only in service scope;
- safe descriptor length/range validation;
- `Allow once` binds one authoritative descriptor/argument hash;
- `Always allow` creates exact current policy and approves current execution;
- duplicate identical decision is idempotent;
- conflicting/stale/expired decision returns conflict and does not execute;
- reconnect, auth-account change, tool disable, access change, and schema drift invalidate policy/pending calls;
- only one atomic transition from `prepared` to `executing`;
- success/failure/unknown settlement is terminal;
- ambiguous timeout/disconnect is `unknown`; and
- plaintext arguments/results never appear in thrown errors or safe run records.

### Step 2: Implement authoritative lookup

The decision input is only `executionId`, `messageId`, and requested mode. The service reloads and validates:

- authenticated project/conversation;
- pending call and approval message relationship;
- current connection and native tool setting;
- current catalog/schema fingerprint;
- expiry and state;
- descriptor hash; and
- actor permission.

Ignore all client copies of tool/connection/arguments/descriptor values.

### Step 3: Implement exact-once execution

Atomically claim `prepared -> executing`, decrypt arguments, and call exact `(connectionId, nativeToolName, arguments)` once through `McpConnectionService`.

If the MCP server exposes a standard idempotency capability, use the stable execution ID only through that generic capability. Never invent provider-specific idempotency parameters.

Settle:

- normal result: `succeeded`;
- explicit MCP error before effect: `failed`;
- timeout/disconnect after request dispatch: `unknown`.

Never automatically retry `unknown`.

### Step 4: Verify

```bash
bun test worker/services/mcp-approval-service.test.ts worker/services/mcp-connection-service.test.ts
```

### Step 5: Commit

```bash
git add worker/services/mcp-approval-service.ts worker/services/mcp-approval-service.test.ts worker/services/mcp-connection-service.ts
git commit -m "feat: execute approved MCP writes exactly once"
```

---

## Task 4: Intercept every configured native write tool

**Files:**

- Modify: `worker/chat-runtime/sidechat/build-mcp-tools.ts`
- Modify: `worker/chat-runtime/sidechat/build-mcp-tools.test.ts`
- Modify: `worker/chat-runtime/sidechat/run-sidechat-turn.ts`
- Modify: `worker/services/chat-service.ts`

### Step 1: Write failing generic wrapper tests

Assert:

- read tool executes immediately;
- write + exact active always policy executes immediately;
- write without policy calls `prepare`, persists one `bot/sidechat/approval` message, sets conversation `sidechatStatus = waiting_approval`, and stops the current turn;
- no provider/native switch statement exists;
- approval message metadata contains only the safe descriptor;
- closing the browser does not alter pending state;
- duplicate model preparation with identical run/tool/args resolves to the same pending execution; and
- raw arguments never reach message rows or WebSocket events.

### Step 2: Generate the descriptor safely

The model may propose a short title, description, and critical spans, but server validation owns bounds and removes unsupported markup. If the model does not provide a valid descriptor, synthesize a generic safe description from the native tool display name without copying arguments.

Do not build provider-specific copy templates.

### Step 3: Stop and resume as two normal turns

Do not pause an SDK/LLM invocation durably.

Preparation ends the current turn after persisting the approval bubble. After approval execution, start a new sidechat continuation with:

- the successful/failed result in transient model context;
- the prior sidechat/public histories;
- a system instruction to report the outcome concisely and prepare a visitor draft only when appropriate.

Only the new final Maven message is persisted.

### Step 4: Verify

```bash
bun test worker/chat-runtime/sidechat/build-mcp-tools.test.ts worker/chat-runtime/sidechat
```

### Step 5: Commit

```bash
git add worker/chat-runtime/sidechat worker/services/chat-service.ts
git commit -m "feat: pause native MCP writes for approval"
```

---

## Task 5: Add authenticated approval decision routes

**Files:**

- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`
- Modify: `worker/index.ts`
- Create: `worker/routes/mcp-approval-handlers.ts`
- Create: `worker/routes/mcp-approval-handlers.test.ts`

### Step 1: Write failing authorization tests

Cover:

- unauthenticated `401`;
- wrong project/conversation/message/execution `404`;
- visitor/widget/Telegram/public route cannot decide;
- authorized member can `Allow once` only when current team permissions allow writes;
- only owner/admin can create `Always allow`;
- stale descriptor/schema/policy returns `409`;
- browser-supplied extra tool/argument fields are rejected;
- duplicate identical decisions return current state without another call; and
- connection unavailable/unknown result is reported safely.

### Step 2: Add one compact route

```text
POST /api/projects/:id/conversations/:convId/sidechat/approvals/:executionId
body: { messageId, mode: "once" | "always" }
```

Sequence:

1. authorize user/project/conversation;
2. load authoritative pending call and message;
3. validate team permission and current tool state;
4. atomically record decision/claim;
5. broadcast safe `executing` update;
6. execute with a bounded wait under `executionCtx.waitUntil` / existing conversation coordinator;
7. persist safe audit/status;
8. broadcast safe final update; and
9. run the normal sidechat continuation.

### Step 3: Add policy management to existing tool settings API

Owners/admins can inspect/revoke `always` on the native tool row. Changing access, reconnecting, disabling, or accepting catalog drift must invalidate the old policy server-side in the same mutation.

### Step 4: Verify

```bash
bun test worker/routes/mcp-approval-handlers.test.ts worker/validation.test.ts
```

### Step 5: Commit

```bash
git add worker/validation.ts worker/validation.test.ts worker/index.ts worker/routes/mcp-approval-handlers.ts worker/routes/mcp-approval-handlers.test.ts
git commit -m "feat: approve MCP writes from dashboard sidechat"
```

---

## Task 6: Render approval actions inside the existing Maven bubble

**Files:**

- Modify: `src/components/inbox/MessageBubble.tsx`
- Modify: `src/components/inbox/SidechatMessageActions.tsx`
- Modify: `src/components/inbox/SidechatPane.tsx`
- Modify: `src/lib/inbox/types.ts`
- Modify: `src/lib/inbox/sidechat-cache.ts`
- Create: `src/lib/inbox/approval-presentation.test.ts`

### Step 1: Write presentation/state tests

Assert:

- approval uses sidechat Maven `received` placement;
- normal bubble shell owns max width, padding, font, line height, radius, surface, and sender header;
- only description critical ranges are bold;
- action order is `Always allow`, then `Allow once`;
- `Always allow` is secondary and `Allow once` primary;
- visible button height is 28px with a 40px hit target;
- no `Not now`, reject, badge, alert, nested card, or duplicated details;
- pending/executing/succeeded/failed/unknown/expired updates are idempotent; and
- buttons disable before POST and re-enable only on safe retryable failure.

### Step 2: Use the existing bubble action slot

Render title, description, and buttons inside the same content surface already created by `MessageBubble`. Do not wrap them in another panel.

Closing the pane is the deferral behavior. It does not mutate pending state.

### Step 3: Match current control language

Use current semantic tokens, compact button radius/type, focus rings, hover/pressed states, and disabled treatment. No sparkle icon, warning icon, provider badge, gradient, glow, or separator.

### Step 4: Verify

```bash
bun test src/lib/inbox/approval-presentation.test.ts
bun run lint
bun run build
```

### Step 5: Commit

```bash
git add src/components/inbox src/lib/inbox
git commit -m "feat: render compact sidechat write approvals"
```

---

## Task 7: Expiry, invalidation, cleanup, and safe audit

**Files:**

- Modify: `worker/services/mcp-approval-service.ts`
- Modify: `worker/services/mcp-approval-service.test.ts`
- Modify: `worker/services/conversation-retention-service.ts`
- Modify: `worker/services/conversation-retention-service.test.ts`
- Modify: MCP disconnect/project deletion paths

### Step 1: Implement lazy and scheduled expiry safely

Every read/decision checks expiry atomically. Add a bounded scheduled cleanup path using the project's existing scheduled Worker mechanism if available; do not add Workflows for one-step writes.

Expiry marks `expired`, clears ciphertext after the audit window, updates the safe approval message/status, and never executes.

### Step 2: Invalidate on configuration change

In one server-side mutation, invalidate relevant pending calls/policies when:

- connection auth account changes;
- server URL changes;
- native schema fingerprint changes;
- tool is disabled;
- access changes; or
- connection/project is removed.

### Step 3: Retention

Conversation/project deletion relies on D1 cascades for messages, pending calls, policies, and safe runs. Ensure in-flight execution checks current conversation/project state before dispatching the provider request.

### Step 4: Verify

```bash
bun test worker/services/mcp-approval-service.test.ts worker/services/conversation-retention-service.test.ts
```

### Step 5: Commit

```bash
git add worker/services
git commit -m "feat: expire and clean up MCP approvals"
```

---

## Task 8: Security, idempotency, visual, and regression acceptance

**Files:**

- Create: `docs/superpowers/verification/2026-08-08-generic-mcp-write-approval.md`
- Add focused regression tests where failures belong

### Step 1: Full automated verification

```bash
bun test
bun run lint
bun run build
```

### Step 2: Sentinel leakage suite

Plant unique sentinels in OAuth credentials, native arguments, native results, and model tool context. Prove they do not appear in:

- public or sidechat message content/metadata;
- any visitor/dashboard WebSocket payload;
- public APIs;
- Telegram/email;
- safe action runs/errors;
- application logs/traces; or
- reply drafts.

The model may receive arguments/results in memory and must produce only the required conclusion. The human must still choose `Add to reply` and Send.

### Step 3: Race/idempotency suite

Exercise double-clicks, two tabs, stale UI, expired call, revoked policy, reconnect, schema drift, timeout before dispatch, timeout after dispatch, browser close, Worker retry, and conversation/project deletion during approval.

No case may dispatch the same execution twice.

### Step 4: Visual QA

At 1440×1000, 1100×900, 768×900, and 390×844 compare approval directly with adjacent Maven bubbles. Confirm identical shell/typography/spacing and compact controls. Test long critical description, executing, success, failure, unknown, expired, keyboard focus, 200% zoom, dark mode, and reduced motion.

### Step 5: Architecture grep

```bash
rg -n "durable-pause|Think|MavenSidechatAgent|MavenIntegrationAgent|refund_payment|cancel_subscription|post_internal_message|attio\.add|linear\.create" src worker shared package.json wrangler.jsonc
```

Expected: no matches introduced by these phases.

### Step 6: Commit verification fixes

Stage only files changed by this phase, then:

```bash
git commit -m "fix: complete generic MCP write approval acceptance"
```

Do not deploy or run approval tests against production accounts without separate user authorization.
