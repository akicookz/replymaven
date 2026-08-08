# Generic MCP Write Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pause every enabled native MCP tool configured as a write, show one compact approval inside the existing Maven message bubble, and execute the exact tool call only after an authorized dashboard human chooses `Always allow` or `Allow once`.

**Architecture:** Phase 2 already discovers native MCP tools and stores exact tool settings. Phase 3 wraps any enabled write tool in the same dynamic Think `kind: "durable-pause"` action. Think Durable Object state owns pending native arguments and approval state; D1 stores only the tool setting and bounded safe run metadata. There are no provider-specific actions, preparation services, reducers, validators, policies, or execution branches.

**Tech Stack:** Bun, Hono, D1/Drizzle, Cloudflare Think Actions, Cloudflare Durable Objects/RPC, React 19, existing inbox chat primitives, Tailwind CSS v4, Zod v4.

**Prerequisites:** Complete and verify:

- `docs/superpowers/plans/2026-08-07-private-sidechat-foundation.md`
- `docs/superpowers/plans/2026-08-07-safe-mcp-read-actions.md`

**Spec:** `docs/superpowers/specs/2026-08-07-private-sidechat-mcp-actions-design.md` — read sections 2.4, 3, 7, 8, and 10–12 before starting.

## Global Constraints

- Use Bun only. Never use npm/yarn.
- Read every target file before modifying it. Preserve unrelated work and use `git add -p` for files with pre-existing unrelated edits.
- Function declarations for named functions/components; arrows only for inline callbacks.
- Apply one generic approval path to every native MCP tool whose saved setting is `enabled=true` and `access="write"`.
- Do not create provider-specific action IDs, schemas, files, validators, descriptors, expiry rules, reducers, retries, or runtime branches.
- Tool availability and input schema come from the connected MCP server's current catalog.
- Exact native arguments remain inside private Think/agent state and never reach browser frames, D1, logs, traces, public messages, Telegram, or widget APIs.
- The browser receives only a human-readable approval descriptor, tool/connection labels, expiry, permissions, and descriptor hash.
- Writes default to `Ask every time`.
- `Always allow` is exact to project, connection, native tool name, and current input-schema fingerprint.
- Reconnect, schema change, classification change, or disable invalidates `Always allow`.
- Never automatically retry a native MCP write after dispatch. An uncertain transport outcome is `outcome_unknown`.
- Approval is dashboard-sidechat-only. Widget, public chat, Telegram, API keys, and external MCP clients cannot approve.
- Reuse `ChatThread`, `MessageBubbleShell`, and the shared bubble action slot. Do not create an approval card or a new bubble primitive.
- Visible buttons are exactly `Always allow` then `Allow once`; no `Not now`, rejection action, badge, alert, or verification block.
- Approval controls are 28px visibly high with 12.5–13px labels and minimum 40px hit targets.
- Put needed details in description text and bold only the critical segment.
- Test each task with targeted tests, `bun run build`, and `bun run lint`; commit only named files; never push/deploy.

---

### Task 1: Define generic pending-call and approval contracts

**Files:**
- Modify: `shared/mcp-types.ts`
- Modify: `shared/sidechat-types.ts`
- Create: `worker/agents/mcp-write/contracts.test.ts`

**Contracts:**

```typescript
export interface PendingMcpWrite {
  executionId: string;
  connectionId: string;
  toolName: string;
  inputSchemaFingerprint: string;
  argumentHash: string;
  descriptor: SafeMcpApprovalDescriptor;
  expiresAt: string;
}

export interface SafeMcpApprovalDescriptor {
  executionId: string;
  connectionLabel: string;
  toolLabel: string;
  description: string;
  criticalDetail: string | null;
  descriptorHash: string;
  expiresAt: string;
  canApproveOnce: boolean;
  canAlwaysAllow: boolean;
}

export type McpWriteStatus =
  | "pending_approval"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"
  | "expired"
  | "outcome_unknown";
```

- [ ] **Step 1: Write failing contract tests**

Reject descriptors with unknown fields, HTML, control characters, excessive text, OAuth/token/header keys, full native arguments, or raw MCP result. Verify only the critical-detail field can receive bold treatment in the UI model.

- [ ] **Step 2: Add safe sidechat data parts**

`data-sidechat-approval` contains only the descriptor/status. It cannot contain native arguments, catalog schema, Think internal state, or provider output.

- [ ] **Step 3: Add deterministic hashing helpers**

Canonicalize JSON object-key order and hash exact `(projectId, conversationId, connectionId, toolName, inputSchemaFingerprint, arguments)` for the argument hash. Hash the safe descriptor separately. Equivalent inputs must hash identically; any native argument change must alter the argument hash.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/mcp-write/contracts.test.ts
bun run build
git add shared/mcp-types.ts shared/sidechat-types.ts worker/agents/mcp-write/contracts.test.ts
git commit -m "feat: define generic MCP write approvals"
```

---

### Task 2: Generate bounded human approval descriptions generically

**Files:**
- Create: `worker/agents/mcp-write/approval-descriptor.ts`
- Create: `worker/agents/mcp-write/approval-descriptor.test.ts`
- Modify: `worker/agents/sidechat-prompt.ts`
- Modify: `worker/agents/sidechat-prompt.test.ts`

**Model-facing wrapper input:**

```typescript
{
  arguments: NativeToolArguments;
  approvalDescription: string;
  criticalDetail?: string;
}
```

`arguments` is validated by the current native MCP input schema. The two descriptor fields describe the same intended call to the dashboard human; they are not forwarded to the MCP server.

- [ ] **Step 1: Write failing descriptor tests**

Cover short/long text, unsupported Markdown/HTML, critical segment absent/present, argument/description hash binding, stale description after argument mutation, secret-looking fields, and maximum 600-character description plus 240-character critical detail.

- [ ] **Step 2: Implement generic descriptor construction**

Use connection display name, native tool name, model-authored description, critical detail, expiry, and server-computed hashes. Do not parse tool names or arguments for provider semantics. Do not build provider-specific copy.

- [ ] **Step 3: Add exact prompt rules**

Maven must:

- address the dashboard human, never the visitor;
- describe the concrete effect and important values it intends to submit;
- put only the most consequential sentence/value in `criticalDetail`;
- never include credentials, customer external ID/email, raw records, or hidden MCP metadata;
- never claim an effect occurred before the tool succeeds;
- ask a private follow-up instead of preparing a write when native arguments are ambiguous.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/mcp-write/approval-descriptor.test.ts worker/agents/sidechat-prompt.test.ts
bun run build
git add worker/agents/mcp-write/approval-descriptor.ts worker/agents/mcp-write/approval-descriptor.test.ts worker/agents/sidechat-prompt.ts worker/agents/sidechat-prompt.test.ts
git commit -m "feat: describe pending MCP writes safely"
```

---

### Task 3: Wrap every configured native write tool in one Think durable action

**Files:**
- Create: `worker/agents/mcp-write/dynamic-write-action.ts`
- Create: `worker/agents/mcp-write/dynamic-write-action.test.ts`
- Modify: `worker/agents/sidechat-mcp-tools.ts`
- Modify: `worker/agents/sidechat-mcp-tools.test.ts`
- Modify: `worker/agents/maven-sidechat-agent.ts`
- Modify: `worker/agents/sidechat-runtime.ts`

- [ ] **Step 1: Write failing dynamic-wrapper tests**

Cover enabled read executes without approval, disabled write omitted, enabled write wrapped, exact native JSON Schema nested under `arguments`, descriptor fields appended generically, current fingerprint required, stable execution/idempotency key, and zero provider-name switches/imports.

- [ ] **Step 2: Implement the generic factory**

For every current setting with `enabled=true` and `access="write"`, create:

```typescript
action({
  kind: "durable-pause",
  approval: true,
  inputSchema: buildWriteWrapperSchema(nativeInputSchema),
  idempotencyKey: buildExecutionKey,
  execute: executeApprovedNativeTool,
})
```

The wrapper stores exact arguments in private Think state, generates the safe descriptor, and pauses before integration-agent RPC.

- [ ] **Step 3: Apply persistent policy authoritatively**

Use `authorizeTurn`/`authorizeAction` plus the current `integration_tool_settings` row:

- exact `always` setting and fingerprint -> authorize without prompt;
- `every_time` -> pause;
- disabled, changed schema, changed classification, disconnected server, or missing setting -> reject;
- ignore model/browser claims about approval.

- [ ] **Step 4: Project safe pending state**

Convert Think `pendingApprovals` into `data-sidechat-approval`, set `sidechat_threads.status="waiting_approval"`, and broadcast only status/unread. Closing the panel or losing the WebSocket leaves the durable pause intact.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/agents/mcp-write/dynamic-write-action.test.ts worker/agents/sidechat-mcp-tools.test.ts
bun run build
bun run lint
git add worker/agents/mcp-write/dynamic-write-action.ts worker/agents/mcp-write/dynamic-write-action.test.ts worker/agents/sidechat-mcp-tools.ts worker/agents/sidechat-mcp-tools.test.ts worker/agents/maven-sidechat-agent.ts worker/agents/sidechat-runtime.ts
git commit -m "feat: pause native MCP writes generically"
```

---

### Task 4: Add the authoritative dashboard approval endpoint

**Files:**
- Create: `worker/routes/mcp-approval-handlers.ts`
- Create: `worker/routes/mcp-approval-handlers.test.ts`
- Modify: `worker/index.ts`
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`

**Endpoint:**

```text
POST /api/projects/:id/conversations/:convId/sidechat/approvals/:executionId
```

```typescript
{ decision: "allow_once" | "always_allow"; descriptorHash: string }
```

- [ ] **Step 1: Write failing authorization/race tests**

Cover unauthenticated, wrong project/conversation, no approval role, member allow-once, member always denial, owner/admin always, stale descriptor hash, non-pending execution, expired request, disabled tool, schema drift, disconnect, duplicate click, concurrent humans, and archived conversation.

- [ ] **Step 2: Implement authoritative lookup**

Load authenticated effective role, Think pending execution, current connection/tool setting, current catalog fingerprint, and safe descriptor. Ignore browser-supplied connection/tool/argument values.

- [ ] **Step 3: Implement `Allow once`**

Bind the decision to exact execution/descriptor/argument hashes, record safe actor/mode metadata, then call Think `approveExecution`. An identical duplicate is idempotent; a conflicting decision returns 409.

- [ ] **Step 4: Implement `Always allow`**

Owner/admin only. Atomically set the exact current `integration_tool_settings.approvalMode="always"`, record the current decision, then approve. A concurrent schema/connection/classification change fails closed.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/routes/mcp-approval-handlers.test.ts worker/validation.test.ts
bun run build
git add worker/routes/mcp-approval-handlers.ts worker/routes/mcp-approval-handlers.test.ts worker/index.ts worker/validation.ts worker/validation.test.ts
git commit -m "feat: approve pending MCP writes"
```

---

### Task 5: Render approval content inside the existing Maven bubble

**Files:**
- Create: `src/components/inbox/SidechatApprovalBody.tsx`
- Create: `src/components/inbox/SidechatApprovalBody.test.ts`
- Modify: `src/components/inbox/SidechatPane.tsx`
- Modify: `src/components/inbox/MessageBubble.tsx`
- Modify: `src/lib/use-sidechat.ts`
- Modify: `src/lib/use-sidechat.test.ts`

- [ ] **Step 1: Write failing reuse/copy/accessibility tests**

Assert:

- `SidechatApprovalBody` is rendered through `MessageBubbleShell`'s body/action slot;
- it defines no background, max-width, padding, bubble radius, sender header, Markdown renderer, or outer bubble container;
- exact button order/copy is `Always allow`, `Allow once`;
- no `Not now`, reject, verified, badge, alert, card, or sparkle string/import;
- critical detail alone uses `<strong>`;
- pending state disables both without changing width;
- status updates use polite live announcements and retain focus.

- [ ] **Step 2: Implement the content-only approval renderer**

Render description as normal text and `criticalDetail` as a code-owned `<strong>` segment; never use raw HTML. Put both controls in the existing bubble action slot with `gap-1.5` and wrapping.

- [ ] **Step 3: Match current compact controls**

- 28px visible height;
- 12.5–13px label;
- 10–12px horizontal padding;
- eight-pixel radius;
- existing glass shadow/focus treatment;
- transparent minimum 40px hit target;
- secondary `Always allow`, primary `Allow once`.

- [ ] **Step 4: Handle role and settled states without extra UI**

For a member without persistent-policy permission, keep `Always allow` visible/disabled and include **Only a project owner or admin can save this permission** in description text. Pending, saving, approved, running, succeeded, failed, expired, and outcome unknown stay inside the same bubble body; settled buttons become quiet status text.

- [ ] **Step 5: Verify and commit**

```bash
bun test src/components/inbox/SidechatApprovalBody.test.ts src/lib/use-sidechat.test.ts src/components/inbox/chat-primitives.test.ts
bun run build
bun run lint
git add src/components/inbox/SidechatApprovalBody.tsx src/components/inbox/SidechatApprovalBody.test.ts src/components/inbox/SidechatPane.tsx src/components/inbox/MessageBubble.tsx src/lib/use-sidechat.ts src/lib/use-sidechat.test.ts
git commit -m "feat: show native write approval in chat bubble"
```

---

### Task 6: Execute an approved native tool exactly once from ReplyMaven

**Files:**
- Create: `worker/agents/mcp-write/execute-write.ts`
- Create: `worker/agents/mcp-write/execute-write.test.ts`
- Modify: `worker/agents/maven-integration-agent.ts`
- Modify: `worker/agents/mcp-runtime.ts`
- Modify: `worker/agents/mcp-runtime.test.ts`
- Modify: `worker/services/mcp-tool-service.ts`
- Modify: `worker/services/mcp-tool-service.test.ts`

- [ ] **Step 1: Write failing execution-state tests**

Cover valid approval, expired execution, disabled tool, changed schema/classification, disconnected server, duplicate execution, simultaneous calls, validation failure before dispatch, timeout before dispatch, timeout after dispatch, definite MCP error, malformed response, and safe run metadata.

- [ ] **Step 2: Implement pre-dispatch checks**

Atomically claim the execution, reload the current connection/tool setting/catalog, compare exact fingerprint/argument/descriptor hashes, revalidate arguments against native schema, and confirm authorization. Do not inspect provider/tool semantics.

- [ ] **Step 3: Dispatch once**

Call exact `(connectionId, nativeToolName, nativeArguments)` once through `MavenIntegrationAgent.callTool`. If the server advertises `idempotentHint`, include the stable execution key only through a generic protocol field supported by that server; never invent provider-specific idempotency arguments.

- [ ] **Step 4: Settle conservatively**

- definite success -> `succeeded` and raw result returned only to private model context;
- definite pre-dispatch/native error -> `failed` with safe code;
- disconnect/timeout after possible dispatch -> `outcome_unknown` with no retry;
- duplicate completed execution -> return stored safe status without another call.

Record only safe run metadata in D1. Do not store input/result.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/agents/mcp-write/execute-write.test.ts worker/agents/mcp-runtime.test.ts worker/services/mcp-tool-service.test.ts
bun run build
bun run lint
git add worker/agents/mcp-write/execute-write.ts worker/agents/mcp-write/execute-write.test.ts worker/agents/maven-integration-agent.ts worker/agents/mcp-runtime.ts worker/agents/mcp-runtime.test.ts worker/services/mcp-tool-service.ts worker/services/mcp-tool-service.test.ts
git commit -m "feat: execute approved MCP writes once"
```

---

### Task 7: Invalidate persistent permission on any tool-scope change

**Files:**
- Modify: `worker/services/mcp-tool-service.ts`
- Modify: `worker/services/mcp-tool-service.test.ts`
- Modify: `worker/routes/mcp-connection-handlers.ts`
- Modify: `worker/routes/mcp-connection-handlers.test.ts`

- [ ] **Step 1: Write failing invalidation tests**

Cover reconnect/new account, server URL change, native tool disappearance, input-schema fingerprint change, read/write reclassification, disable/re-enable, connection deletion, and description-only catalog change.

- [ ] **Step 2: Implement exact policy scope**

Persistent authorization key is `(projectId, connectionId, toolName, inputSchemaFingerprint)`. There is no provider-wide, connection-wide, wildcard-tool, or all-writes grant.

- [ ] **Step 3: Reset grants transactionally**

Set approval mode back to `every_time` in the same transaction that changes schema fingerprint, classification, enabled state, or connection identity. Description-only changes do not alter the fingerprint but still refresh displayed copy.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/services/mcp-tool-service.test.ts worker/routes/mcp-connection-handlers.test.ts
bun run build
git add worker/services/mcp-tool-service.ts worker/services/mcp-tool-service.test.ts worker/routes/mcp-connection-handlers.ts worker/routes/mcp-connection-handlers.test.ts
git commit -m "feat: scope MCP write permission exactly"
```

---

### Task 8: Add generic approval expiry and restart recovery

**Files:**
- Create: `worker/agents/mcp-write/approval-expiry.ts`
- Create: `worker/agents/mcp-write/approval-expiry.test.ts`
- Modify: `worker/agents/maven-sidechat-agent.ts`
- Modify: `worker/agents/sidechat-runtime.ts`

- [ ] **Step 1: Write failing clock/recovery tests**

Cover default 24-hour expiry, project-configured duration, pane closed, WebSocket reconnect, agent restart, repeated alarm, approval racing expiry, and expired execution never dispatching.

- [ ] **Step 2: Schedule durable expiry**

Schedule by execution ID in sidechat agent state. At deadline, atomically mark expired, call Think `rejectExecution` with safe `expired`, update the visible approval part, and clear `waiting_approval` projection.

- [ ] **Step 3: Preserve the no-rejection-button UX**

There is no visible `Not now`. Closing the pane defers. System cleanup may reject through the same internal service but renders only a settled quiet state.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/mcp-write/approval-expiry.test.ts worker/agents/mcp-write/dynamic-write-action.test.ts
bun run build
git add worker/agents/mcp-write/approval-expiry.ts worker/agents/mcp-write/approval-expiry.test.ts worker/agents/maven-sidechat-agent.ts worker/agents/sidechat-runtime.ts
git commit -m "feat: expire pending MCP approvals"
```

---

### Task 9: Add safe write activity to each connection detail

**Files:**
- Create: `worker/routes/mcp-tool-run-handlers.ts`
- Create: `worker/routes/mcp-tool-run-handlers.test.ts`
- Modify: `worker/index.ts`
- Create: `src/components/connections/ToolActivity.tsx`
- Create: `src/components/connections/ToolActivity.test.ts`
- Modify: `src/components/connections/ConnectionsPanel.tsx`

- [ ] **Step 1: Write failing API/UI tests**

API returns project-scoped paginated safe metadata only: connection/tool label, status, approval mode/actor display, duration, timestamp, and safe error code. It excludes native arguments/results, customer identity, hashes not needed by UI, OAuth state, and catalog schemas.

- [ ] **Step 2: Implement paginated route**

Add `GET /api/projects/:id/mcp-connections/:connectionId/activity` with timestamp/ID cursor and status filter. Reuse existing effective-owner/team authorization.

- [ ] **Step 3: Render activity in Connections**

Use the existing settings list rhythm under the selected connection. No new Agent actions tab or activity card stack. Show native tool name, status, human actor, approval mode, duration, and timestamp. `outcome_unknown` puts **Check the provider before trying again** in description text.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/routes/mcp-tool-run-handlers.test.ts src/components/connections/ToolActivity.test.ts
bun run build
bun run lint
git add worker/routes/mcp-tool-run-handlers.ts worker/routes/mcp-tool-run-handlers.test.ts worker/index.ts src/components/connections/ToolActivity.tsx src/components/connections/ToolActivity.test.ts src/components/connections/ConnectionsPanel.tsx
git commit -m "feat: show safe MCP tool activity"
```

---

### Task 10: Enforce private pending-state retention and observability

**Files:**
- Create: `worker/services/mcp-write-retention-service.ts`
- Create: `worker/services/mcp-write-retention-service.test.ts`
- Modify: `worker/services/sidechat-retention-service.ts`
- Modify: `worker/services/mcp-retention-service.ts`
- Modify: `worker/services/project-service.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Write failing cleanup/privacy tests**

Cover expired/completed pending-call removal, conversation deletion, connection deletion, project deletion, active pending approval rejection, safe-run retention, partial cleanup retry, and unique sentinels in arguments/results/credentials/model text.

- [ ] **Step 2: Implement cleanup ordering**

Reject pending Think executions, clear private pending arguments/schedules, destroy sidechat or integration state as scoped, then delete safe D1 metadata. Record durable cleanup before asynchronous destructive operations.

- [ ] **Step 3: Enforce observability allowlist**

Logs/errors may contain event name, project/conversation/connection IDs, native tool name, status/error code, duration, approval mode/actor ID, and hashes. Tests must prove no credential, identity, argument, result, catalog schema, visible message, or descriptor body is emitted. Traces remain disabled.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/services/mcp-write-retention-service.test.ts
bun test
bun run build
bun run lint
git diff --check
git add worker/services/mcp-write-retention-service.ts worker/services/mcp-write-retention-service.test.ts worker/services/sidechat-retention-service.ts worker/services/mcp-retention-service.ts worker/services/project-service.ts worker/index.ts
git commit -m "feat: enforce MCP write privacy lifecycle"
```

---

### Task 11: Run generic approval and visual acceptance

**Files:**
- Modify only phase-3 files when a measured defect is found
- Create: `docs/superpowers/verification/2026-08-08-generic-mcp-write-approval.md`

- [ ] **Step 1: Exercise one generic matrix across unrelated native tools**

Use a disposable MCP server exposing differently shaped write tools: simple primitives, nested objects, arrays, optional values, and a long description. For every tool test owner/admin once/always, member once/always-disabled, schema drift, reconnect, expiry, pane close/reopen, restart, definite failure, and unknown outcome. No test code may branch by provider.

- [ ] **Step 2: Prove no duplicate external dispatch**

Count test-server invocations under duplicate approval, repeated execution callback, disconnect, timeout, and replay. Each approved execution dispatches zero or one external call. After a possible dispatch timeout, status is `outcome_unknown` and count never increases automatically.

- [ ] **Step 3: Prove private-data boundaries**

Plant sentinels in native arguments/results and prove they do not appear in browser frames, visible sidechat messages, reply drafts, D1, logs, public transcript, widget, or Telegram. Verify the private model can still use a successful result to prepare a concise non-dumping response.

- [ ] **Step 4: Capture the approval visual matrix**

At `1440x1000`, `1100x900`, `768x900`, and `390x844`, capture short/long descriptions, wrapped critical detail, idle/hover/focus/pressed/disabled/loading buttons, member role, expired/running/succeeded/failed/unknown states, light/dark mode, reduced motion, and 200% zoom.

Compare the approval against adjacent Maven messages. Bubble shell, max width, padding, text, line height, sender header, radius, and spacing must be identical because they are the same `MessageBubbleShell` instance.

- [ ] **Step 5: Verify removed provider scope**

```bash
rg -n "customer\.stripe|customer\.posthog|customer\.slack|customer\.attio|customer\.linear|refund_payment|cancel_subscription|post_internal_message|add_note|create_issue|provider-profiles|canonicalAction" worker src shared
bun test
bun run build
bun run lint
git diff --check
```

Expected: the provider-specific search returns zero new feature hits; test/build/lint match baseline; no whitespace errors.

- [ ] **Step 6: Commit verification evidence**

Stage the verification document and only exact files changed to fix measured defects, inspect `git diff --cached --name-only`, then commit:

```bash
git commit -m "fix: verify generic MCP write approvals"
```

Do not deploy, run remote migrations, connect production servers, push, or enable production write tools without explicit user approval.
