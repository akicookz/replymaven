# Write Action Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Maven prepare and execute narrowly scoped Stripe, Slack, Attio, and Linear writes only after an authorized dashboard human chooses `Always allow` or `Allow once`, while keeping raw arguments private and preserving at-most-once external effects.

**Architecture:** Write intent is prepared server-side into encrypted `action_preparations`. A Think Action receives only the preparation ID, bounded safe description, and descriptor hash, then pauses with `kind: "durable-pause"`. The dashboard renders that pending action as a normal Maven message bubble. Approval is re-authorized server-side; the integration agent revalidates identity, mapping, policy, expiry, and provider preconditions before invoking one exact MCP tool. D1 holds only sealed arguments and safe audit metadata.

**Tech Stack:** Bun, Hono, D1/Drizzle, Cloudflare Think Actions, Cloudflare Durable Objects/RPC, Web Crypto AES-GCM/HMAC, React 19, Tailwind CSS v4, Zod v4.

**Prerequisites:** Complete, verify, and retain the privacy boundaries from:

- `docs/superpowers/plans/2026-08-07-private-sidechat-foundation.md`
- `docs/superpowers/plans/2026-08-07-safe-mcp-read-actions.md`

**Spec:** `docs/superpowers/specs/2026-08-07-private-sidechat-mcp-actions-design.md` — read sections 2.4, 6.3, 7, 8, and 10–12 before starting.

## Global Constraints

- Use Bun only. Never use npm/yarn.
- Read every target file before modifying it and preserve unrelated/uncommitted work.
- Function declarations for named functions/components; arrows only for inline callbacks.
- PostHog remains read-only in v1.
- Initial write IDs are exactly:
  - `customer.stripe.refund_payment`
  - `customer.stripe.cancel_subscription_at_period_end`
  - `customer.slack.post_internal_message`
  - `customer.attio.add_note`
  - `customer.linear.create_issue`
- Writes are dashboard-only. There is no widget, public chat, API-key, Telegram, webhook, or MCP-external-client approval route.
- Write actions default to `every_time`; no grant is inferred from a successful previous execution.
- `Always allow` is scoped to exact project, connection, canonical action, action-schema version, and mapping version. Reconnect/remap/version changes invalidate it.
- `Allow once` binds to exact Think execution ID and authoritative descriptor hash.
- The model never sees provider credentials, raw provider arguments, raw provider results, idempotency material, or encrypted preparation payloads.
- The browser never receives plaintext provider arguments. It receives an action description specifically designed for human approval.
- Think action input contains only `preparationId`, bounded safe summary/critical detail, and `descriptorHash`.
- Execution reloads trusted identity and provider state. It must not trust stale identity or model text from preparation time.
- Never automatically retry an external write after a transport timeout/unknown outcome. Mark it `outcome_unknown` and require reconciliation.
- Approval bubbles use exactly the same Maven bubble width, font, line height, padding, and radius. No card, alert, verified badge, sparkles, or `Not now`.
- Visible actions are exactly `Always allow` then `Allow once`; compact buttons use the existing `glass-button` language at 28px visible height and retain at least a 40px hit target.
- Put critical details in the description text and bold only those details.
- No row separators in settings/activity UI.
- Test cycle per task: targeted tests, `bun run build`, `bun run lint`; commit only named files, using `git add -p` for files that already had unrelated edits; never push/deploy.

---

### Task 1: Extend shared contracts for prepared writes and approval states

**Files:**
- Modify: `shared/action-types.ts`
- Modify: `shared/sidechat-types.ts`
- Create: `worker/agents/write-actions/contracts.test.ts`

**Contracts:**

```typescript
export type CanonicalWriteActionId =
  | "customer.stripe.refund_payment"
  | "customer.stripe.cancel_subscription_at_period_end"
  | "customer.slack.post_internal_message"
  | "customer.attio.add_note"
  | "customer.linear.create_issue";

export interface SafeApprovalDescriptor {
  executionId: string;
  preparationId: string;
  canonicalActionId: CanonicalWriteActionId;
  providerLabel: string;
  actionLabel: string;
  description: string;
  criticalDetail: string | null;
  expiresAt: string;
  canApproveOnce: boolean;
  canAlwaysAllow: boolean;
  descriptorHash: string;
}
```

- [ ] **Step 1: Write failing validation/serialization tests**

Reject descriptors containing email, external ID, provider object IDs not intended for display, credentials, raw arguments, arbitrary HTML/Markdown, or unbounded text. Preserve only a restricted boldable critical-detail field.

- [ ] **Step 2: Define state transitions**

Preparation: `prepared | pending_approval | approved | executing | succeeded | failed | rejected | expired | outcome_unknown`.

Think execution: pending approval must map sidechat projection to `waiting_approval`; success/failure returns it to `ready`, `idle`, or `failed` according to whether a draft follows.

- [ ] **Step 3: Define safe client data parts**

`data-sidechat-approval` contains only the descriptor and status. It must never expose Think internal state blobs, action input, encrypted payload, or provider result.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/write-actions/contracts.test.ts
bun run build
git add shared/action-types.ts shared/sidechat-types.ts worker/agents/write-actions/contracts.test.ts
git commit -m "feat: define write approval contracts"
```

---

### Task 2: Add encrypted action preparations and extended audit metadata

**Files:**
- Modify: `worker/db/schema.ts`
- Create: generated `worker/db/drizzle/006X_*.sql`
- Modify: generated `worker/db/drizzle/meta/*`
- Create: `worker/services/action-preparation-service.ts`
- Create: `worker/services/action-preparation-service.test.ts`
- Modify: `worker/services/action-run-service.ts`
- Modify: `worker/services/action-run-service.test.ts`
- Modify: `worker/services/action-policy-service.ts`
- Modify: `worker/services/action-policy-service.test.ts`

**`action_preparations` fields:**

- project/conversation/connection/canonical action IDs;
- action-schema/mapping/reducer versions;
- encrypted provider arguments and IV/key version;
- descriptor hash and idempotency hash;
- status, expiry, settlement timestamp, timestamps.

No plaintext argument, email, external ID, provider raw response, or credential column.

- [ ] **Step 1: Write failing schema/service tests**

Cover tenant scoping, AES-GCM round trip, tamper rejection, key-context separation, no plaintext sentinel in stored row, unique idempotency hash, legal/illegal transitions, expiry, settle-once behavior, and concurrency races.

- [ ] **Step 2: Implement authenticated encryption**

Derive a versioned AES-GCM key from `ENCRYPTION_KEY` with context `replymaven-action-preparation-v1`. Bind ciphertext AAD to project, connection, action ID, preparation ID, schema version, and mapping version.

- [ ] **Step 3: Extend action run/policy services**

Add approval mode/actor/time, Think execution ID, preparation ID, duration, safe summary, normalized provider result reference hash, and `outcome_unknown`. Store no tool arguments/output.

- [ ] **Step 4: Generate/apply/inspect migration**

```bash
bun run db:generate
bun run db:migrate:dev
```

The migration may create `action_preparations` and add only required safe metadata columns/indexes. It must not rebuild unrelated tables.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/services/action-preparation-service.test.ts worker/services/action-run-service.test.ts worker/services/action-policy-service.test.ts
bun run build
git add worker/db/schema.ts worker/services/action-preparation-service.ts worker/services/action-preparation-service.test.ts worker/services/action-run-service.ts worker/services/action-run-service.test.ts worker/services/action-policy-service.ts worker/services/action-policy-service.test.ts
git add -p worker/db/drizzle
git diff --cached --name-only
git commit -m "feat: seal write action preparations"
```

The staged list must include only the new action-preparation migration, its snapshot/journal updates, and the named schema/service/test files.

---

### Task 3: Build preparation, descriptor, and idempotency primitives

**Files:**
- Create: `worker/agents/write-actions/prepare-write.ts`
- Create: `worker/agents/write-actions/prepare-write.test.ts`
- Create: `worker/agents/write-actions/descriptor.ts`
- Create: `worker/agents/write-actions/descriptor.test.ts`
- Create: `worker/agents/write-actions/idempotency.ts`
- Create: `worker/agents/write-actions/idempotency.test.ts`

- [ ] **Step 1: Write failing deterministic-hash tests**

Equivalent canonical arguments produce the same descriptor/idempotency hashes; changed amount, payment target, cancellation timing, channel, note, or issue title produces a different hash. Object-key order must not matter.

- [ ] **Step 2: Implement preparation flow**

For every write:

1. authenticate sidechat project/conversation;
2. resolve trusted canonical customer identity;
3. load enabled ready mapping/policy;
4. call a provider-specific preflight read if required;
5. build exact provider arguments in trusted Worker code;
6. construct safe human descriptor;
7. encrypt arguments;
8. persist preparation and idempotency hash;
9. return only safe Think action input.

- [ ] **Step 3: Implement descriptor rendering data**

Descriptions must read to the human agent, not the visitor. Example:

```text
Refund the latest eligible Stripe payment. The refund is **$49.00 USD for the Aug 4 payment**.
```

Do not repeat customer email/external ID or provider payload. `criticalDetail` is plain text and the UI applies bold; do not accept HTML.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/write-actions/prepare-write.test.ts worker/agents/write-actions/descriptor.test.ts worker/agents/write-actions/idempotency.test.ts
bun run build
git add worker/agents/write-actions/prepare-write.ts worker/agents/write-actions/prepare-write.test.ts worker/agents/write-actions/descriptor.ts worker/agents/write-actions/descriptor.test.ts worker/agents/write-actions/idempotency.ts worker/agents/write-actions/idempotency.test.ts
git commit -m "feat: prepare deterministic write intents"
```

---

### Task 4: Implement Think durable-pause write actions

**Files:**
- Create: `worker/agents/write-actions/think-actions.ts`
- Create: `worker/agents/write-actions/think-actions.test.ts`
- Modify: `worker/agents/maven-sidechat-agent.ts`
- Modify: `worker/agents/sidechat-runtime.ts`
- Modify: `worker/agents/sidechat-runtime.test.ts`

- [ ] **Step 1: Write failing action-definition tests**

Assert every write action uses:

```typescript
action({
  kind: "durable-pause",
  approval: true,
  idempotencyKey: /* preparation-derived */,
  // safe input only
})
```

Assert no action input schema includes raw provider arguments, identity, connection selection, arbitrary tool name, or passthrough object.

- [ ] **Step 2: Implement exact action factories**

Each canonical write has a narrow model-facing intent schema and calls `prepareWrite`. The durable action pauses before execution. Its execution callback loads the sealed preparation server-side; it never uses model data as provider arguments.

- [ ] **Step 3: Derive approval requirements authoritatively**

Use Think `authorizeTurn`/`authorizeAction` and D1 policy lookup:

- `every_time` or no exact policy -> pause;
- exact valid `always` policy -> authorize without browser prompt;
- disabled, version mismatch, stale mapping, role mismatch, expired preparation -> reject;
- do not accept model/browser claims that an action is pre-approved.

- [ ] **Step 4: Project safe pending approvals**

Map Think `pendingApprovals` into safe data parts. Set D1 projection `waiting_approval`, broadcast only status/unread, and leave execution pending when the pane disconnects.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/agents/write-actions/think-actions.test.ts worker/agents/sidechat-runtime.test.ts
bun run build
bun run lint
git add worker/agents/write-actions/think-actions.ts worker/agents/write-actions/think-actions.test.ts worker/agents/maven-sidechat-agent.ts worker/agents/sidechat-runtime.ts worker/agents/sidechat-runtime.test.ts
git commit -m "feat: pause sidechat writes for approval"
```

---

### Task 5: Add authoritative dashboard approval endpoints

**Files:**
- Create: `worker/routes/action-approval-handlers.ts`
- Create: `worker/routes/action-approval-handlers.test.ts`
- Modify: `worker/index.ts`
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`

**Endpoint:**

```text
POST /api/projects/:id/conversations/:convId/sidechat/approvals/:executionId
```

Request:

```typescript
{ decision: "allow_once" | "always_allow"; descriptorHash: string }
```

- [ ] **Step 1: Write failing authorization/race tests**

Cover unauthenticated, cross-project/conversation, expired token, non-pending execution, stale descriptor hash, already decided, double click, concurrent humans, member once permission, member persistent denial, owner/admin persistent permission, disabled policy, mapping/schema change, and archived conversation.

- [ ] **Step 2: Implement server-authoritative lookup**

The endpoint loads authenticated effective project role, Think `pendingApprovals`, D1 preparation, mapping, connection, policy, and descriptor. It ignores any browser-supplied action/connection/customer detail.

- [ ] **Step 3: Implement `Allow once`**

Atomically record actor/mode against the exact execution/preparation/hash, then call Think `approveExecution`. A duplicate identical decision is idempotent; a conflicting decision returns 409.

- [ ] **Step 4: Implement `Always allow`**

Owner/admin only. In one D1 transaction, upsert the exact-scoped `always` policy and record the current decision; then approve the current execution. If Think approval fails before execution starts, keep the policy but report safe retry state. If mapping changes concurrently, fail closed.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/routes/action-approval-handlers.test.ts worker/validation.test.ts
bun run build
git add worker/routes/action-approval-handlers.ts worker/routes/action-approval-handlers.test.ts worker/index.ts worker/validation.ts worker/validation.test.ts
git commit -m "feat: authorize sidechat write approvals"
```

---

### Task 6: Render the exact approval bubble in sidechat

**Files:**
- Create: `src/components/inbox/SidechatApproval.tsx`
- Create: `src/components/inbox/SidechatApproval.test.ts`
- Modify: `src/components/inbox/SidechatMessage.tsx`
- Modify: `src/components/inbox/SidechatPane.tsx`
- Modify: `src/lib/use-sidechat.ts`
- Modify: `src/lib/use-sidechat.test.ts`

- [ ] **Step 1: Write failing visual/copy/accessibility tests**

Assert:

- bubble uses the same `max-w-[88%] px-3.5 py-2.5 text-[14.5px] leading-[1.5] rounded-bl-[6px]` Maven message geometry;
- exact action order/copy is `Always allow`, `Allow once`;
- no strings/imports for `Not now`, `verified`, `badge`, `alert`, `card`, or `Sparkles`;
- critical detail alone is semibold/bold;
- both buttons have accessible names, pending state, and no accidental form submit;
- status changes are announced politely without moving focus.

- [ ] **Step 2: Implement approval as a normal message body**

The description is normal message text. The critical detail is inserted as a code-owned `<strong>` segment, never `dangerouslySetInnerHTML`. Actions sit in the bubble's normal content flow with a small `gap-1.5` and wrap cleanly.

- [ ] **Step 3: Match existing compact buttons**

- 28px visual height, 12.5–13px label, 10–12px horizontal padding, 8px radius, and the existing glass shadow;
- `Always allow` secondary glass treatment;
- `Allow once` current primary blue treatment;
- transparent 40px minimum hit target around each visible button;
- pending decision disables both and preserves width—no spinner-induced shift.

- [ ] **Step 4: Handle project roles without changing the two-button layout**

For a member who can approve once but cannot persist policy, keep `Always allow` visible but disabled. Include **Only a project owner or admin can save this permission** in the normal description. Never add a third control or permission alert.

- [ ] **Step 5: Implement decision states**

Pending, saving policy, approved once, always allowed, expired, rejected, running, succeeded, failed, and outcome unknown render in-place inside the same bubble. Settled controls become quiet text; they do not turn into status cards.

- [ ] **Step 6: Verify and commit**

```bash
bun test src/components/inbox/SidechatApproval.test.ts src/lib/use-sidechat.test.ts
bun run build
bun run lint
git add src/components/inbox/SidechatApproval.tsx src/components/inbox/SidechatApproval.test.ts src/components/inbox/SidechatMessage.tsx src/components/inbox/SidechatPane.tsx src/lib/use-sidechat.ts src/lib/use-sidechat.test.ts
git commit -m "feat: add native sidechat approval bubble"
```

---

### Task 7: Enforce exact persistent-policy invalidation

**Files:**
- Modify: `worker/services/action-policy-service.ts`
- Modify: `worker/services/action-policy-service.test.ts`
- Modify: `worker/services/integration-service.ts`
- Modify: `worker/services/integration-service.test.ts`
- Modify: `worker/routes/integration-handlers.ts`
- Modify: `worker/routes/integration-handlers.test.ts`

- [ ] **Step 1: Write failing invalidation tests**

Cover disconnect/reconnect, new connection ID, tool remap, input-schema fingerprint change, mapping-version increment, canonical action-schema bump, action disable/re-enable, and reducer-only version bump.

- [ ] **Step 2: Implement exact grant lookup**

Lookup key is `(projectId, connectionId, canonicalActionId, actionSchemaVersion, mappingVersion)`. A reducer version change may require mapping review but never widens policy scope. No wildcard/provider-wide/project-wide-all-writes grant exists.

- [ ] **Step 3: Invalidate on mapping lifecycle**

Mark old policies disabled in the same transaction that increments mapping version or disconnects the connection. Preserve safe audit history; never silently migrate grants.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/services/action-policy-service.test.ts worker/services/integration-service.test.ts worker/routes/integration-handlers.test.ts
bun run build
git add worker/services/action-policy-service.ts worker/services/action-policy-service.test.ts worker/services/integration-service.ts worker/services/integration-service.test.ts worker/routes/integration-handlers.ts worker/routes/integration-handlers.test.ts
git commit -m "feat: scope persistent action permissions"
```

---

### Task 8: Execute sealed writes through the integration agent

**Files:**
- Create: `worker/agents/write-actions/execute-write.ts`
- Create: `worker/agents/write-actions/execute-write.test.ts`
- Modify: `worker/agents/maven-integration-agent.ts`
- Modify: `worker/agents/integration-runtime.ts`
- Modify: `worker/agents/integration-runtime.test.ts`

- [ ] **Step 1: Write failing execution-state tests**

Cover valid approval, expired/rejected preparation, stale identity, connection degraded, mapping drift, provider precondition drift, duplicate execution, simultaneous calls, timeout-before-send, timeout-after-send, definite provider rejection, malformed safe result, and normalized audit metadata.

- [ ] **Step 2: Implement execution preconditions**

Before the call:

1. atomically claim the preparation from `approved` to `executing`;
2. re-resolve trusted identity;
3. reload exact connection/mapping/policy/execution approval;
4. decrypt with AAD and validate typed provider args;
5. refresh any action-specific precondition;
6. bind provider idempotency key where supported;
7. call only the reviewed MCP tool once.

- [ ] **Step 3: Handle outcomes conservatively**

- definite success -> reduce safe result, hash reference, `succeeded`;
- definite provider validation/rejection -> `failed` with normalized code;
- no bytes sent/known pre-dispatch failure -> safe manual retry may create a new execution for the same preparation only when proven;
- timeout/disconnect after dispatch or indeterminate provider result -> `outcome_unknown`, no retry;
- raw response never crosses the integration agent boundary.

- [ ] **Step 4: Settle and erase**

After definite settlement, overwrite/delete ciphertext according to retention policy and keep only safe action-run metadata. On outcome unknown, retain ciphertext only for the short reconciliation window, inaccessible to UI/model.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/agents/write-actions/execute-write.test.ts worker/agents/integration-runtime.test.ts
bun run build
bun run lint
git add worker/agents/write-actions/execute-write.ts worker/agents/write-actions/execute-write.test.ts worker/agents/maven-integration-agent.ts worker/agents/integration-runtime.ts worker/agents/integration-runtime.test.ts
git commit -m "feat: execute approved writes at most once"
```

---

### Task 9: Implement Stripe refund and cancel-at-period-end actions

**Files:**
- Modify: `worker/agents/provider-profiles/stripe.ts`
- Modify: `worker/agents/provider-profiles/stripe.test.ts`
- Create: `worker/agents/write-actions/stripe.ts`
- Create: `worker/agents/write-actions/stripe.test.ts`

- [ ] **Step 1: Write refund preparation/execution tests**

Cover explicit eligible payment selection from safe recent-payment facts, amount/currency, full vs partial refund if v1 supports only full refund, already refunded, disputed, too old/ineligible, idempotency support, preflight drift, and outcome unknown.

- [ ] **Step 2: Implement v1 refund conservatively**

If the user has not explicitly selected a payment and exactly one eligible recent payment cannot be proven, Maven must ask the human. Do not infer from “latest” when ambiguity exists. Critical detail shows amount, currency, and human date/label—not raw payment ID.

- [ ] **Step 3: Write cancellation tests**

Cover active/trialing subscription, already scheduled, multiple subscriptions, immediate cancellation request rejected as unsupported v1, renewal/cancellation date, and provider state change after approval.

- [ ] **Step 4: Implement period-end cancellation only**

Descriptor explicitly says service remains active through **the exact period-end date**. The MCP write must set period-end cancellation and never immediate deletion/cancel unless a future separately named action is added.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/agents/write-actions/stripe.test.ts worker/agents/provider-profiles/stripe.test.ts
bun run build
git add worker/agents/provider-profiles/stripe.ts worker/agents/provider-profiles/stripe.test.ts worker/agents/write-actions/stripe.ts worker/agents/write-actions/stripe.test.ts
git commit -m "feat: add approved Stripe writes"
```

---

### Task 10: Implement Slack internal-message action

**Files:**
- Modify: `worker/agents/provider-profiles/slack.ts`
- Modify: `worker/agents/provider-profiles/slack.test.ts`
- Create: `worker/agents/write-actions/slack.ts`
- Create: `worker/agents/write-actions/slack.test.ts`

- [ ] **Step 1: Write action tests**

Cover project allowlisted channel, channel missing/renamed, message length, mention normalization, no hidden mass mentions, safe customer reference, exact preview, duplicate idempotency, and ambiguous outcome.

- [ ] **Step 2: Implement safe preparation**

Maven supplies message intent/content within a strict length. Trusted code resolves the configured destination. Descriptor includes **channel display name and exact message preview**. It does not include customer email/external ID unless the project-authored template explicitly permits a safe label.

- [ ] **Step 3: Implement execution**

Revalidate channel allowlist and mapping immediately before posting. Reject `@channel`, `@here`, `@everyone`, and broad user-group mentions in v1 unless a future distinct action/policy supports them.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/write-actions/slack.test.ts worker/agents/provider-profiles/slack.test.ts
bun run build
git add worker/agents/provider-profiles/slack.ts worker/agents/provider-profiles/slack.test.ts worker/agents/write-actions/slack.ts worker/agents/write-actions/slack.test.ts
git commit -m "feat: add approved Slack messages"
```

---

### Task 11: Implement Attio note action

**Files:**
- Modify: `worker/agents/provider-profiles/attio.ts`
- Modify: `worker/agents/provider-profiles/attio.test.ts`
- Create: `worker/agents/write-actions/attio.ts`
- Create: `worker/agents/write-actions/attio.test.ts`

- [ ] **Step 1: Write action tests**

Cover exact unique record, no/duplicate record, note length, formatting normalization, record changed/deleted after approval, idempotency, and outcome unknown.

- [ ] **Step 2: Implement safe preparation/execution**

Descriptor contains the record display name/type and **exact bounded note preview**. Exact provider record ID remains sealed. Re-resolve identity and confirm the same unique record before writing.

- [ ] **Step 3: Verify and commit**

```bash
bun test worker/agents/write-actions/attio.test.ts worker/agents/provider-profiles/attio.test.ts
bun run build
git add worker/agents/provider-profiles/attio.ts worker/agents/provider-profiles/attio.test.ts worker/agents/write-actions/attio.ts worker/agents/write-actions/attio.test.ts
git commit -m "feat: add approved Attio notes"
```

---

### Task 12: Implement Linear issue action

**Files:**
- Modify: `worker/agents/provider-profiles/linear.ts`
- Modify: `worker/agents/provider-profiles/linear.test.ts`
- Create: `worker/agents/write-actions/linear.ts`
- Create: `worker/agents/write-actions/linear.test.ts`

- [ ] **Step 1: Write action tests**

Cover allowlisted team/project, title/description lengths, priority/state allowlists, label mapping, customer-safe context, removed team, schema drift, idempotency, and outcome unknown.

- [ ] **Step 2: Implement safe preparation/execution**

Descriptor includes **team, issue title, and priority** plus a bounded description preview. Team/project/label IDs stay sealed. Revalidate team/action mapping before creation.

- [ ] **Step 3: Verify and commit**

```bash
bun test worker/agents/write-actions/linear.test.ts worker/agents/provider-profiles/linear.test.ts
bun run build
git add worker/agents/provider-profiles/linear.ts worker/agents/provider-profiles/linear.test.ts worker/agents/write-actions/linear.ts worker/agents/write-actions/linear.test.ts
git commit -m "feat: add approved Linear issues"
```

---

### Task 13: Add approval expiry, rejection, and recovery

**Files:**
- Create: `worker/agents/write-actions/approval-expiry.ts`
- Create: `worker/agents/write-actions/approval-expiry.test.ts`
- Modify: `worker/agents/maven-sidechat-agent.ts`
- Modify: `worker/services/action-preparation-service.ts`
- Modify: `worker/services/action-preparation-service.test.ts`

- [ ] **Step 1: Write failing clock/recovery tests**

Cover 15-minute expiry for Stripe refund/cancellation, 24-hour expiry for Slack/Attio/Linear, pane closed, agent restart, repeated alarm, approval racing expiry, and expired execution never running.

- [ ] **Step 2: Schedule durable expiry**

Use Think/agent durable scheduling tied to execution ID. On expiry, atomically mark preparation expired, call `rejectExecution` with normalized `expired`, update safe approval data, and clear `waiting_approval` projection.

- [ ] **Step 3: Handle explicit rejection internally**

There is no visible `Not now` button. If a future system/admin operation rejects, it must use the same authoritative endpoint/service and render a settled quiet state. Closing the pane merely defers.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/write-actions/approval-expiry.test.ts worker/services/action-preparation-service.test.ts
bun run build
git add worker/agents/write-actions/approval-expiry.ts worker/agents/write-actions/approval-expiry.test.ts worker/agents/maven-sidechat-agent.ts worker/services/action-preparation-service.ts worker/services/action-preparation-service.test.ts
git commit -m "feat: expire pending write approvals safely"
```

---

### Task 14: Finish Agent actions policy and activity UI

**Files:**
- Modify: `src/components/actions/AgentActionsPanel.tsx`
- Modify: `src/components/actions/ActionMappingRow.tsx`
- Create: `src/components/actions/AgentActionPolicyRow.tsx`
- Create: `src/components/actions/ActionActivity.tsx`
- Create: `src/components/actions/write-policy-ui.test.ts`
- Create: `worker/routes/action-activity-handlers.ts`
- Create: `worker/routes/action-activity-handlers.test.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Write failing API/UI tests**

Project owners/admins can choose `Ask every time` or `Always allow` for an exact mapped write. Members can view but not change persistent policy. Activity responses contain safe metadata only. No raw arguments/output or customer identifiers.

- [ ] **Step 2: Implement policy rows**

Use the existing settings list rhythm: one row, concise description, native compact select/switch/button styles, no nested policy card. If a mapping change invalidates a grant, put **Permission reset because the mapped tool changed** in the description text.

- [ ] **Step 3: Implement safe activity**

Show action label, provider/connection, status, human actor, approval mode, safe summary, duration, and timestamp. `outcome_unknown` uses bold critical detail and a compact reconciliation action only if supported. No generic alert banner.

- [ ] **Step 4: Add pagination/filtering**

Server paginates by project and safe timestamp cursor. UI filters by action/status/connection without downloading all history.

- [ ] **Step 5: Verify and commit**

```bash
bun test src/components/actions/write-policy-ui.test.ts worker/routes/action-activity-handlers.test.ts
bun run build
bun run lint
git add src/components/actions/AgentActionsPanel.tsx src/components/actions/ActionMappingRow.tsx src/components/actions/AgentActionPolicyRow.tsx src/components/actions/ActionActivity.tsx src/components/actions/write-policy-ui.test.ts worker/routes/action-activity-handlers.ts worker/routes/action-activity-handlers.test.ts worker/index.ts
git commit -m "feat: manage write policies and activity"
```

---

### Task 15: Enforce preparation retention and privacy-safe observability

**Files:**
- Create: `worker/services/action-retention-service.ts`
- Create: `worker/services/action-retention-service.test.ts`
- Modify: `worker/services/sidechat-retention-service.ts`
- Modify: `worker/services/integration-retention-service.ts`
- Modify: `worker/services/project-service.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Write failing retention/deletion tests**

Cover settled ciphertext deletion, expired preparation deletion, short outcome-unknown reconciliation window, audit-metadata retention, conversation/project deletion, integration disconnect, active pending approvals, and retry after partial cleanup.

- [ ] **Step 2: Implement cleanup order**

Reject pending Think executions, erase preparation ciphertext, clear schedules, destroy integration state when appropriate, then delete D1 metadata. Record durable cleanup work before asynchronous destructive steps.

- [ ] **Step 3: Add observability allowlist tests**

Capture logger/error-reporter calls and prove only event name, IDs, canonical action ID, normalized state/error, duration, approval mode, actor ID, and hashes appear. Plant unique sentinels in identity, arguments, OAuth data, provider payload, and model text; assert none appear.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/services/action-retention-service.test.ts
bun test
bun run build
bun run lint
git diff --check
git add worker/services/action-retention-service.ts worker/services/action-retention-service.test.ts worker/services/sidechat-retention-service.ts worker/services/integration-retention-service.ts worker/services/project-service.ts worker/index.ts
git commit -m "feat: enforce write action retention"
```

---

### Task 16: Run write safety, visual, and end-to-end acceptance

**Files:**
- Modify only phase-3 files when a measured defect is found
- Create: `docs/superpowers/verification/2026-08-07-write-action-approvals.md`

- [ ] **Step 1: Exercise the full approval matrix**

For every write action, test:

- owner/admin `Allow once`;
- owner/admin `Always allow`, then a second matching execution without prompt;
- member once allowed and persistent action disabled;
- stale descriptor, expired approval, policy invalidation, connection reconnect, mapping drift;
- pane close/reopen and agent restart while pending;
- definite failure and outcome unknown;
- duplicate clicks and concurrent approvers.

- [ ] **Step 2: Prove at-most-once behavior with a synthetic MCP server**

Count external calls under network timeout/disconnect/replay scenarios. An approved preparation must produce zero or one provider-side mutation, never two. For an indeterminate response, Maven says the outcome must be checked; it does not retry.

- [ ] **Step 3: Run privacy sentinel tests end to end**

Place unique sentinels in encrypted args and raw provider responses. Prove they do not appear in browser frames, Think transcript, Maven output, D1 plaintext, logs, activity, public reply draft, public transcript, widget, or Telegram.

- [ ] **Step 4: Capture the approval visual matrix**

At `1440x1000`, `1100x900`, `768x900`, and `390x844`, capture:

- short and long description;
- wrapped critical detail;
- both buttons idle/hover/focus/pressed/disabled/loading;
- member permission state;
- expired, running, succeeded, failed, outcome unknown;
- light/dark mode and 200% zoom.

Compare the bubble numerically with `SidechatMessage`: font, line height, max width, padding, corner radii, surface, shadow, and vertical rhythm must match. Compare buttons with existing composer/actions controls for height, label size, icon weight, focus ring, hit target, and optical alignment.

- [ ] **Step 5: Verify product boundaries**

Confirm:

- no approval UI/route exists in visitor widget or Telegram;
- no write executes from public conversation text alone;
- Add to reply remains manual and public send remains separate;
- there is no inline Compose, sparkle icon, card, alert, badge, or `Not now`;
- sidechat keeps working while closed and reopens on the correct conversation;
- PostHog exposes no write action.

- [ ] **Step 6: Run final checks and record evidence**

```bash
bun test
bun run build
bun run lint
git diff --check
```

Record exact results, synthetic MCP call counts, privacy sentinel matrix, screenshots, keyboard/screen-reader checks, reduced-motion behavior, and pre-existing failures.

- [ ] **Step 7: Commit verification-only fixes and record**

```bash
git add docs/superpowers/verification/2026-08-07-write-action-approvals.md <exact-fixed-files>
git commit -m "fix: verify and polish write approvals"
```

Do not deploy, run remote migrations, enable production writes, push, or change a production action policy without explicit user approval.
