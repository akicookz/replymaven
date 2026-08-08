# Generic MCP Write Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Maven to use any native MCP tool labeled `write` from sidechat, pausing before the external call until an authenticated human chooses `Allow once` or `Always allow`, then execute the exact sealed call at most once and continue through the same Maven loop.

**Architecture:** AI SDK v6 native tool approval (`needsApproval` and `tool-approval-request`) stops the shared `ToolLoopAgent` before execution. ReplyMaven seals the exact tool input and approval identifiers in D1 and renders a safe normal sidechat bubble. Approval atomically claims the pending call, optionally creates an exact project policy, reconstructs the AI SDK approval continuation, and runs the same tool registry/agent so the native MCP result reaches Maven transiently and Maven finishes the private response.

**Tech Stack:** AI SDK v6 tool approvals, Cloudflare Workers, Hono, Drizzle/D1, Web Crypto AES-GCM/SHA-256, existing `ConversationDO`, React 19, Bun tests.

## Global Constraints

- Complete unified loop, sidechat, and generic MCP connection plans first.
- Approval applies only to native MCP tools labeled `write`; do not add provider-specific action code.
- Do not add a second agent, planner, Workflow, Durable Object, action schema, reducer, or provider mapping.
- Do not alter native MCP input schemas to ask the model for approval copy or policy choices.
- The write tool must not contact the MCP server before approval unless an exact active Always policy exists.
- Only authenticated dashboard routes can approve. Visitor/widget, public messages, email, Telegram, model output, WebSocket frames, and forged tool arguments cannot approve.
- `Allow once` approves one exact pending call. `Always allow` is project-wide only for the exact connection version, native tool name, and schema fingerprint.
- Owner/admin can always or once; a project member can once but cannot create an Always policy.
- Pending arguments are encrypted. Raw arguments/results never reach message metadata, browser payloads, logs, traces, or run audit rows.
- Pending calls expire after 15 minutes. Claimed/unknown calls are never automatically retried.
- The approval UI is the existing Maven bubble, not a card/alert/panel. Actions are exactly `Always allow | Allow once`; no reject or `Not now`.
- Use function declarations for named functions/components and Bun for commands.
- Commit steps are checkpoints; do not deploy.

## File Map

| File | Change |
|---|---|
| `worker/db/schema.ts` | Add pending MCP call and Always-policy tables; extend safe runs |
| `worker/db/drizzle/0065_generic_mcp_write_approvals.sql` | Approval persistence migration |
| `worker/db/mcp-write-approval-schema.test.ts` | **Create** schema/no-raw-data assertions |
| `worker/services/mcp-approval-service.ts` | **Create** seal/claim/policy/settle service |
| `worker/services/mcp-approval-service.test.ts` | **Create** exact scope, expiry, race, invalidation tests |
| `worker/mcp-client/approval-descriptor.ts` | **Create** deterministic safe human copy |
| `worker/mcp-client/approval-descriptor.test.ts` | **Create** redaction/bounds/copy tests |
| `worker/mcp-client/tool-adapter.ts` | Add native AI SDK `needsApproval` for writes |
| `worker/mcp-client/tool-adapter.test.ts` | Always-policy and no-preapproval-call tests |
| `worker/chat-runtime/types.ts` | Add approval pause/continuation artifacts |
| `worker/chat-runtime/orchestration/run-maven-turn.ts` | Capture approval requests and accept approved continuation |
| `worker/chat-runtime/orchestration/run-maven-turn.test.ts` | AI SDK approval stop/resume tests |
| `worker/chat-runtime/orchestration/run-sidechat-turn.ts` | Persist approval bubble and waiting state |
| `worker/chat-runtime/orchestration/run-sidechat-turn.test.ts` | No-final-text-before-approval tests |
| `worker/chat-runtime/orchestration/run-approved-sidechat-turn.ts` | **Create** exact continuation and settlement |
| `worker/chat-runtime/orchestration/run-approved-sidechat-turn.test.ts` | **Create** once/always/idempotency/unknown tests |
| `worker/routes/mcp-approval-handlers.ts` | **Create** authenticated dashboard approval handler |
| `worker/routes/mcp-approval-handlers.test.ts` | **Create** actor/channel/stale descriptor tests |
| `worker/validation.ts` | Approval body schema |
| `worker/validation.test.ts` | Approval input tests |
| `worker/index.ts` | Mount approval route |
| `shared/ws-events.ts` | Safe approval message/status metadata only |
| `worker/realtime/broadcast.test.ts` | Assert no sealed args leak |
| `src/lib/inbox/types.ts` | Typed safe approval metadata |
| `src/lib/inbox/sidechat.ts` | Approval state transitions and button permissions |
| `src/lib/inbox/sidechat.test.ts` | Approval UI/state tests |
| `src/components/inbox/MessageBubble.tsx` | Render compact actions in the normal bubble |
| `src/pages/Conversations.tsx` | Approval mutation and optimistic disable/refetch |
| `src/pages/McpProjectConnections.tsx` | Write policy display/reset beside native tool setting |

---

### Task 1: Persist sealed pending calls and exact policies

**Files:**
- Modify: `worker/db/schema.ts`
- Create: `worker/db/mcp-write-approval-schema.test.ts`
- Generate: `worker/db/drizzle/0065_generic_mcp_write_approvals.sql`

**Tables:**

```typescript
projectMcpPendingCalls: {
  id, projectId, connectionId, toolId, conversationId, sidechatRunId,
  toolName, modelName, connectionVersion, schemaFingerprint,
  aiApprovalId, aiToolCallId, encryptedArguments, descriptorHash,
  title, descriptionMarkdown,
  status: "pending" | "claimed" | "succeeded" | "failed" | "unknown" | "expired" | "invalidated",
  requestedByMessageId, approvedByUserId,
  approvalMode: "once" | "always" | null,
  expiresAt, claimedAt, settledAt, createdAt
}

projectMcpPolicies: {
  id, projectId, connectionId, toolId, toolName,
  connectionVersion, schemaFingerprint,
  mode: "always", enabled, createdByUserId,
  createdAt, updatedAt
}
```

Extend `projectMcpRuns` with nullable `pendingCallId`, `approvalMode`, `approvedByUserId`, and `schemaFingerprint`.

- [ ] **Step 1: Write the failing schema/migration tests**

Assert foreign keys/cascades, unique active policy scope, pending-status/expiry indexes, required exact call identity, encrypted argument column, and absence of plaintext `arguments`, `input`, `output`, or `result` columns.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/db/mcp-write-approval-schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add tables/columns and generate the migration**

Run: `bun run db:generate --name generic_mcp_write_approvals`.

Policies are unique across `(project_id, connection_id, tool_name, connection_version, schema_fingerprint)`. Pending calls retain their immutable tool/connection identity even if catalog rows later change.

- [ ] **Step 4: Run schema tests**

Run: `bun test worker/db/mcp-write-approval-schema.test.ts worker/db/project-mcp-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the checkpoint**

```bash
git add worker/db/schema.ts worker/db/drizzle worker/db/mcp-write-approval-schema.test.ts
git commit -m "feat: add MCP approval persistence"
```

### Task 2: Build the sealed approval ledger

**Files:**
- Create: `worker/services/mcp-approval-service.ts`
- Create: `worker/services/mcp-approval-service.test.ts`

**Interfaces:**

```typescript
export interface SealMcpCallInput {
  projectId: string;
  connectionId: string;
  toolId: string;
  conversationId: string;
  sidechatRunId: string;
  toolName: string;
  modelName: string;
  connectionVersion: number;
  schemaFingerprint: string;
  aiApprovalId: string;
  aiToolCallId: string;
  arguments: unknown;
  descriptor: ApprovalDescriptor;
  expiresAt: Date;
}

export interface ClaimedMcpCall {
  row: ProjectMcpPendingCallRow;
  arguments: unknown;
}

seal(input: SealMcpCallInput, encryptionKey: string): Promise<ProjectMcpPendingCallRow>;
claim(input: { pendingCallId: string; projectId: string; conversationId: string; actorUserId: string; mode: "once" | "always"; now: Date }, encryptionKey: string): Promise<ClaimedMcpCall | null>;
hasActiveAlwaysPolicy(input: AuthoritativeMcpWriteIdentity): Promise<boolean>;
createAlwaysPolicy(input: CreateMcpAlwaysPolicy): Promise<void>;
settle(pendingCallId: string, status: "succeeded" | "failed" | "unknown"): Promise<void>;
invalidateForConnection(connectionId: string): Promise<void>;
```

- [ ] **Step 1: Write failing ledger tests**

Cover encrypted round-trip, no plaintext in D1, canonical stable descriptor hash, one claimant in a race, duplicate claim null, expired claim marks expired, cross-project/conversation/actor rejection, tool/fingerprint/version mismatch invalidation, owner/admin Always, member Always denial, member once success, policy exact-match success, reconnect/schema/access/disable invalidation, and no auto-retry of claimed/unknown rows.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/services/mcp-approval-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement sealing and hashing**

Serialize with recursively sorted JSON, hash the immutable descriptor and call identity with SHA-256, encrypt exact arguments with existing AES-GCM helpers, and store only the ciphertext. Reject non-JSON values, payloads over 64 KiB, and descriptor content over its bounds.

- [ ] **Step 4: Implement atomic claim and policy checks**

Use one conditional D1 update from `pending` to `claimed` requiring matching project/conversation, unexpired `expiresAt`, and null `claimedAt`. Read/decrypt only after the update returns a row. Recheck current connection/tool/version/fingerprint/enabled/write state before returning the claim.

- [ ] **Step 5: Run tests**

Run: `bun test worker/services/mcp-approval-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/services/mcp-approval-service.ts worker/services/mcp-approval-service.test.ts
git commit -m "feat: seal and claim MCP write approvals"
```

### Task 3: Generate bounded human copy without changing native tools

**Files:**
- Create: `worker/mcp-client/approval-descriptor.ts`
- Create: `worker/mcp-client/approval-descriptor.test.ts`

**Interface:**

```typescript
export interface ApprovalDescriptor {
  title: string;
  descriptionMarkdown: string;
}

export function buildApprovalDescriptor(input: {
  connectionLabel: string;
  toolTitle: string;
  toolDescription: string;
  arguments: unknown;
}): ApprovalDescriptor;
```

- [ ] **Step 1: Write failing copy and redaction tests**

Cover a short native tool title, long title, secret-like keys (`token`, `secret`, `password`, `authorization`, `cookie`, `key`), IDs, nested objects, large text, control characters, markdown injection, arrays, and empty arguments. Assert title <= 120 characters, description <= 500, no raw secrets, no JSON dump, no provider-specific wording, and exactly one bold critical phrase.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/mcp-client/approval-descriptor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement deterministic copy**

Use native MCP `annotations.title` when available, otherwise the stored tool name converted to words. Format:

```text
Run {tool title}?
This **changes data in {connection label}** using the details Maven prepared. The action may not be reversible.
```

If up to three non-secret top-level primitive arguments are safe and useful, append a bounded humanized sentence after the warning. Redact ID-like strings to last four characters. Do not ask a model to generate approval copy and do not modify the native tool schema.

- [ ] **Step 4: Run tests**

Run: `bun test worker/mcp-client/approval-descriptor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the checkpoint**

```bash
git add worker/mcp-client/approval-descriptor.ts worker/mcp-client/approval-descriptor.test.ts
git commit -m "feat: format safe MCP approval copy"
```

### Task 4: Use AI SDK native approval in the generic write adapter

**Files:**
- Modify: `worker/chat-runtime/types.ts`
- Modify: `worker/chat-runtime/tools/build-maven-tool-registry.ts`
- Modify: `worker/chat-runtime/tools/build-maven-tool-registry.test.ts`
- Modify: `worker/mcp-client/tool-adapter.ts`
- Modify: `worker/mcp-client/tool-adapter.test.ts`

**Interface extension:**

```typescript
export interface MavenToolDefinition {
  // existing fields
  needsApproval?: boolean | ((input: unknown) => Promise<boolean>);
}
```

- [ ] **Step 1: Write failing registry/adapter tests**

Assert read tools never request approval, writes request approval before `execute`, active exact Always policy returns false from `needsApproval`, changed policy identity requests again, public still excludes MCP, and an approval request causes zero MCP fetches and zero safe-run rows.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/chat-runtime/tools/build-maven-tool-registry.test.ts worker/mcp-client/tool-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Pass `needsApproval` through the shared registry**

The registry still prefilters and the executor still reauthorizes. For MCP writes:

```typescript
needsApproval: async () => {
  const authoritative = await loadAuthoritativeWriteIdentity();
  if (!authoritative.ok) return true;
  return !(await approvalService.hasActiveAlwaysPolicy(authoritative.value));
},
```

The tool's `execute` is unchanged: after an approved continuation or active Always policy, it rechecks authority and calls the exact native tool.

- [ ] **Step 4: Include writes in sidechat registry only**

Change MCP loading from enabled reads to all enabled native tools. `access` comes from the authoritative project setting. No heuristic based on HTTP method, provider, or tool name is allowed.

- [ ] **Step 5: Run tests**

Run: `bun test worker/chat-runtime/tools/build-maven-tool-registry.test.ts worker/mcp-client/tool-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/chat-runtime worker/mcp-client/tool-adapter.ts worker/mcp-client/tool-adapter.test.ts
git commit -m "feat: pause native MCP writes for approval"
```

### Task 5: Capture approval requests as normal sidechat messages

**Files:**
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.ts`
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.test.ts`
- Modify: `worker/chat-runtime/orchestration/run-sidechat-turn.ts`
- Modify: `worker/chat-runtime/orchestration/run-sidechat-turn.test.ts`
- Modify: `shared/ws-events.ts`
- Modify: `worker/realtime/broadcast.test.ts`

**Artifacts:**

```typescript
export type MavenArtifact =
  | { type: "reply_draft"; draft: string }
  | {
      type: "approval_request";
      aiApprovalId: string;
      aiToolCallId: string;
      modelName: string;
      input: unknown;
    }
  | null;
```

- [ ] **Step 1: Write failing stop/persistence tests**

Assert `tool-approval-request` stops the agent before execute, becomes an in-process artifact, is never streamed raw, seals one pending row, persists one `kind="approval"` Maven bubble whose content is the title plus description and whose metadata contains only `{ pendingCallId, descriptorHash, status: "pending" }`, sets `waiting_approval`, and emits no final Maven text/draft before approval.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/chat-runtime/orchestration/run-sidechat-turn.test.ts worker/realtime/broadcast.test.ts`
Expected: FAIL.

- [ ] **Step 3: Capture the AI SDK event**

The stream consumer recognizes `tool-approval-request`, resolves its model tool to the authoritative MCP row, builds the descriptor, and returns the artifact to `runSidechatTurn`. Public stream mapping drops this event entirely; it can never arise for public tools in v1.

- [ ] **Step 4: Seal and render the approval bubble**

`runSidechatTurn` calls `approvalService.seal` before broadcasting. Persist `content = descriptor.title + "\n\n" + descriptor.descriptionMarkdown`; persist/broadcast only the safe control metadata. Use the existing Maven received-bubble surface; metadata controls only inline actions and must not duplicate the visible copy.

- [ ] **Step 5: Run tests**

Run: `bun test worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/chat-runtime/orchestration/run-sidechat-turn.test.ts worker/realtime/broadcast.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/chat-runtime shared/ws-events.ts worker/realtime
git commit -m "feat: persist MCP approval requests in sidechat"
```

### Task 6: Resume the same Maven loop after approval

**Files:**
- Create: `worker/chat-runtime/orchestration/run-approved-sidechat-turn.ts`
- Create: `worker/chat-runtime/orchestration/run-approved-sidechat-turn.test.ts`
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.ts`
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.test.ts`

**Continuation:**

```typescript
export interface ApprovedMcpContinuation {
  aiApprovalId: string;
  aiToolCallId: string;
  modelName: string;
  input: unknown;
}
```

- [ ] **Step 1: Write failing continuation tests**

Cover synthetic AI SDK assistant tool-call/approval-request plus tool approval-response, exact sealed input use, authoritative recheck, one native MCP call, raw result available to the model, final normal text or reply draft, no raw browser/persistence payload, success settlement, provider validation failure, timeout/ambiguous result => unknown, crash-after-claim never retry, and duplicate approval no-op.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/chat-runtime/orchestration/run-approved-sidechat-turn.test.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add approved continuation support to `runMavenTurn`**

Rebuild normal sidechat history/context from D1, then append the AI SDK-native approval parts using the stored IDs and decrypted exact input. Do not convert the result into a new human message or call a separate compose model. The same `ToolLoopAgent` executes the approved tool and continues.

- [ ] **Step 4: Implement approved run orchestration**

`runApprovedSidechatTurn` accepts an already claimed row, marks the approval bubble metadata `executing`, calls the shared loop, persists its final private result, settles pending/run status, and updates the bubble to `completed`, `failed`, or `unknown`. A provider timeout/transport disconnect after request dispatch is `unknown` and cannot be retried automatically.

- [ ] **Step 5: Run focused tests**

Run: `bun test worker/chat-runtime/orchestration/run-approved-sidechat-turn.test.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/mcp-client/tool-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/chat-runtime/orchestration
git commit -m "feat: continue Maven after MCP approval"
```

### Task 7: Add the authenticated approval endpoint

**Files:**
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`
- Create: `worker/routes/mcp-approval-handlers.ts`
- Create: `worker/routes/mcp-approval-handlers.test.ts`
- Modify: `worker/index.ts`

**Route:**

```text
POST /api/projects/:id/conversations/:convId/sidechat/approvals/:pendingCallId
Body: { mode: "once" | "always", descriptorHash: string }
```

- [ ] **Step 1: Write failing route tests**

Cover unauthenticated 401, unrelated/cross-project 404, visitor/public endpoint absence, project member once success, member Always 403, owner/admin both modes, stale descriptor 409 with authoritative payload refetch, expired 410, duplicate idempotent 200 without execution, claim before 202, Always policy creation scoped exactly, and no secrets in response.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/routes/mcp-approval-handlers.test.ts worker/validation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Load the authoritative pending descriptor and compare `descriptorHash` using a timing-safe byte comparison before enabling execution. Validate role. For Always, create the exact policy in the same request flow, then atomically claim. Start `runApprovedSidechatTurn` with `c.executionCtx.waitUntil` and return `{ accepted: true, pendingCallId }` with 202.

- [ ] **Step 4: Mount only under authenticated dashboard middleware**

Do not add any equivalent widget, email, Telegram, MCP-server, or WebSocket client event. Approval is HTTP session-authenticated and CSRF-protected by the existing same-origin session behavior.

- [ ] **Step 5: Run tests**

Run: `bun test worker/routes/mcp-approval-handlers.test.ts worker/services/mcp-approval-service.test.ts worker/validation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/routes/mcp-approval-handlers.ts worker/routes/mcp-approval-handlers.test.ts worker/index.ts worker/validation.ts worker/validation.test.ts
git commit -m "feat: approve MCP writes from dashboard"
```

### Task 8: Render exact compact approval actions in the shared bubble

**Files:**
- Modify: `src/lib/inbox/types.ts`
- Modify: `src/lib/inbox/sidechat.ts`
- Modify: `src/lib/inbox/sidechat.test.ts`
- Modify: `src/components/inbox/MessageBubble.tsx`
- Modify: `src/pages/Conversations.tsx`
- Modify: `src/pages/McpProjectConnections.tsx`

- [ ] **Step 1: Write failing UI-state tests**

Cover pending/executing/completed/failed/unknown/expired state, exact button order, role-based Always visibility/disable, double-click suppression, stale 409 refetch, sidechat-close deferral, and no reject state/action.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/lib/inbox/sidechat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Render approval metadata inside `MessageBubble`**

Use the normal received bubble body:

```tsx
<div dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
<div className="mt-2 flex items-center gap-1.5">
  <button>Always allow</button>
  <button>Allow once</button>
</div>
```

The visible buttons are 28px high, 12.5–13px text, 8px radius, with a 40px hit target via surrounding padding/pseudo-element. `Always allow` is secondary; `Allow once` is primary. There is no nested surface, alert color block, badge, icon, `Not now`, or repeated detail.

- [ ] **Step 4: Wire the mutation**

Disable both actions after click, submit mode plus current descriptor hash, leave the pane open, and rely on sidechat realtime for executing/result state. Closing the pane does nothing to the pending server row.

- [ ] **Step 5: Surface/reset Always policy beside the native tool**

In Connections, show compact approval policy copy for write tools (`Ask every time` or `Always allowed`) and an owner/admin-only reset action. This is a row control, not a separate Agent Actions page.

- [ ] **Step 6: Run test/build and visually inspect**

Run: `bun test src/lib/inbox/sidechat.test.ts && bun run build`, then inspect normal, long description, member, executing, completed, failed, unknown, expired, keyboard focus, 200% zoom, 390px, and reduced-motion states.

- [ ] **Step 7: Commit the checkpoint**

```bash
git add src
git commit -m "feat: add compact MCP approval bubbles"
```

### Task 9: Adversarial and end-to-end verification

**Files:**
- Verify: all files in this plan's File Map
- Modify only if a verification failure is caused by this implementation

- [ ] Attempt approval from widget route, visitor WebSocket, forged sidechat message text, Telegram, email ingress, and MCP-server endpoint; every path must fail or have no route.
- [ ] Race two `Allow once` requests; prove one claim and one MCP call.
- [ ] Approve from a stale tab after tool disable, schema refresh, connection reconnect, account change, and expiry; prove no external call.
- [ ] Force provider timeout after request dispatch; verify `unknown`, no retry button, no automatic retry, and human-facing verification guidance.
- [ ] Inspect D1, dashboard HTTP/WS, Worker logs, and traces; exact args and raw results must appear nowhere except transient in-process model/tool execution.
- [ ] Verify active Always policy skips the approval bubble only for the exact version/fingerprint and still performs executor reauthorization.
- [ ] Verify the final draft still requires `Add to reply` and public Send.
- [ ] Run `bun test worker/services/mcp-approval-service.test.ts worker/mcp-client worker/chat-runtime worker/routes/mcp-approval-handlers.test.ts worker/realtime src/lib/inbox/sidechat.test.ts`.
- [ ] Run `bun run build` and `bun run lint`; fix only new failures.
- [ ] Commit verification fixes, if any:

```bash
git add worker src shared
git commit -m "test: verify MCP write approvals"
```
