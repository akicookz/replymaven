# Safe MCP Read Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Maven privately retrieve narrowly normalized customer facts from project-connected PostHog, Stripe, Slack, Attio, Linear, or custom MCP servers without exposing raw provider records to the model, browser, logs, D1, public transcript, or visitor.

**Architecture:** Add one `MavenIntegrationAgent extends Agent` Durable Object per outbound MCP connection. It owns the Cloudflare MCP client, OAuth/token state, catalog, and raw provider execution scope. D1 stores only connection metadata, reviewed mappings, policies, and bounded audit summaries. MavenSidechatAgent receives five canonical read actions over typed Durable Object RPC; it never receives arbitrary MCP tools or raw MCP results.

**Tech Stack:** Bun, Hono, D1/Drizzle, Cloudflare Durable Objects, Cloudflare Agents MCP client, React 19, TanStack Query, Tailwind CSS v4, Zod v4.

**Prerequisite:** Complete `docs/superpowers/plans/2026-08-07-private-sidechat-foundation.md` first.

**Spec:** `docs/superpowers/specs/2026-08-07-private-sidechat-mcp-actions-design.md` — read sections 5–10 before starting.

## Global Constraints

- Use Bun only. Never use npm/yarn.
- Read every target file before modifying it and preserve unrelated/uncommitted work.
- Function declarations for named functions/components; arrows only for inline callbacks.
- Outbound provider connections are project-scoped and distinct from Settings > MCP, which exposes ReplyMaven to external clients.
- Resolve customers by trusted canonical `externalId` first, normalized canonical customer email second. Never search using visitor-authored text, conversation snapshot email, widget metadata, or model-supplied identifiers.
- Direct MCP tools must never enter `MavenSidechatAgent.getTools()`, `activeTools`, a model prompt, or browser data.
- Raw MCP input/output exists only inside the integration agent execution call and must be reduced before RPC returns.
- Never log, trace, persist, stream, or render provider payloads, credentials, headers, access tokens, complete customer records, or tool arguments.
- Every enabled canonical action must bind to an exact connection, tool name, profile version, mapping version, input-schema fingerprint, and reducer version.
- Catalog drift moves a mapping to `needs_review`; it never guesses or silently remaps.
- Read actions require project enablement but never an approval prompt.
- Use normalized error codes and safe summaries. Do not put raw provider exception strings into D1 or the UI.
- Use existing semantic tokens and row/card rhythm. No sparkle icons, nested card stacks, row separators, or generic integration-logo tiles.
- Migrations are Drizzle-generated and inspected before application.
- Test cycle per task: targeted tests, `bun run build`, `bun run lint`; commit only named files, using `git add -p` for files that already had unrelated edits; never push/deploy.

---

### Task 1: Add the outbound integration Durable Object binding

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `worker/types.ts`
- Modify: `worker/index.ts`
- Create: `worker/agents/maven-integration-agent.ts`
- Modify: `worker-configuration.d.ts`

**Interfaces:**

```typescript
export interface IntegrationAgentRpc {
  refreshCatalog(): Promise<SafeCatalogSummary>;
  validateMapping(input: ValidateMappingInput): Promise<ValidatedMapping>;
  executeCanonicalRead(input: CanonicalReadRequest): Promise<CanonicalReadResult>;
  disconnect(): Promise<void>;
}
```

- [ ] **Step 1: Write a binding/export smoke test**

Assert that the Worker exports `MavenIntegrationAgent`, its binding is typed, and no route can connect without dashboard authentication.

- [ ] **Step 2: Add the binding and append-only migration**

In `wrangler.jsonc`:

- add `MAVEN_INTEGRATION -> MavenIntegrationAgent`;
- append `v3-maven-integration-agent` with `MavenIntegrationAgent` in `new_sqlite_classes`;
- do not edit or reuse the sidechat migration tag;
- keep agent routes in `assets.run_worker_first`;
- do not enable traces.

- [ ] **Step 3: Add a sealed class shell**

The shell rejects browser WebSocket connections and exposes no direct MCP methods yet. It exists only so type generation/build succeeds.

- [ ] **Step 4: Generate types and verify**

```bash
bun run cf-typegen
bun test worker/agents/maven-integration-agent.test.ts
bun run build
bun run lint
```

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc worker/types.ts worker/index.ts worker/agents/maven-integration-agent.ts worker/agents/maven-integration-agent.test.ts worker-configuration.d.ts
git commit -m "chore: add outbound integration agent binding"
```

---

### Task 2: Define canonical actions and safe wire contracts

**Files:**
- Create: `shared/integration-types.ts`
- Create: `shared/action-types.ts`
- Create: `worker/agents/provider-profiles/types.ts`
- Create: `worker/agents/provider-profiles/contracts.test.ts`

**Canonical read IDs:**

```typescript
export type CanonicalReadActionId =
  | "customer.posthog.events"
  | "customer.stripe.billing_summary"
  | "customer.slack.search"
  | "customer.attio.record"
  | "customer.linear.issues";
```

**Safe result contract:**

```typescript
export interface CanonicalReadResult<TFact extends SafeFact> {
  ok: boolean;
  actionId: CanonicalReadActionId;
  connectionId: string;
  mappingVersion: number;
  retrievedAt: string;
  fact: TFact | null;
  errorCode: CanonicalReadErrorCode | null;
}
```

- [ ] **Step 1: Write failing serialization/data-boundary tests**

Reject objects containing keys matching credential/raw-field deny lists such as `token`, `secret`, `authorization`, `metadata`, `address`, `payment_method`, `raw`, `payload`, and provider object blobs. Verify safe facts remain bounded by count and string length.

- [ ] **Step 2: Define exact provider result types**

- PostHog: bounded events with event name, timestamp, and allowlisted primitive properties only.
- Stripe: subscription state, plan/price label, start/current-period dates, cancellation state/date, and bounded recent payment changes summarized as upgrade/downgrade/purchase/payment/refund.
- Slack: bounded internal message matches with channel display name, author display name, timestamp, excerpt, and permalink only when policy permits.
- Attio: allowlisted customer/company attributes and bounded recent notes/activity summaries.
- Linear: bounded issue identifier/title/status/priority/team/updated date/url.

No type may contain an escape hatch such as `Record<string, unknown>` after the reducer boundary.

- [ ] **Step 3: Define safe catalog and mapping contracts**

Catalog summaries include only server ID, tool names, tool descriptions, input-schema fingerprints, and review compatibility. Do not serialize full provider output schemas/descriptions to the browser if unnecessary.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/provider-profiles/contracts.test.ts
bun run build
git add shared/integration-types.ts shared/action-types.ts worker/agents/provider-profiles/types.ts worker/agents/provider-profiles/contracts.test.ts
git commit -m "feat: define canonical integration contracts"
```

---

### Task 3: Add connection, mapping, policy, and read-run metadata

**Files:**
- Modify: `worker/db/schema.ts`
- Create: generated `worker/db/drizzle/006X_*.sql`
- Modify: generated `worker/db/drizzle/meta/*`
- Create: `worker/services/integration-service.ts`
- Create: `worker/services/integration-service.test.ts`
- Create: `worker/services/action-policy-service.ts`
- Create: `worker/services/action-policy-service.test.ts`
- Create: `worker/services/action-run-service.ts`
- Create: `worker/services/action-run-service.test.ts`

**Tables:**

- `integration_connections`: project, display name, provider kind, normalized HTTPS server URL, deterministic agent instance name, stable SDK server ID, state, catalog fingerprint, last safe error code, connected timestamp, timestamps. No tokens/headers.
- `integration_action_mappings`: connection, canonical action ID, selected MCP tool name, profile/mapping/reducer versions, input-schema fingerprint, `read | write`, enabled, `unmapped | ready | needs_review | unsupported`, timestamps.
- `action_policies`: project, connection, canonical action ID, action schema version, mapping version, `every_time | always`, enabled, actor, timestamps. Reads use only `enabled`; write modes are implemented in phase 3.
- `action_runs`: project, conversation, connection, canonical action ID, optional preparation ID, status, duration, safe summary, normalized error code, result reference hash, timestamps. No raw input/output.

- [ ] **Step 1: Write failing service tests**

Cover tenant scoping, unique connection name/agent name, exact mapping uniqueness, mapping-version increment, schema drift to `needs_review`, enabled reads, bounded safe summaries, and absence of credential columns.

- [ ] **Step 2: Implement schemas/services**

Use project-scoped methods only. A caller must never load a connection or policy by opaque ID without project ID.

- [ ] **Step 3: Generate/apply/inspect migration**

```bash
bun run db:generate
bun run db:migrate:dev
```

The migration may create only these four tables/indexes. It must not recreate, drop, or rewrite existing tables.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/services/integration-service.test.ts worker/services/action-policy-service.test.ts worker/services/action-run-service.test.ts
bun run build
git add worker/db/schema.ts worker/services/integration-service.ts worker/services/integration-service.test.ts worker/services/action-policy-service.ts worker/services/action-policy-service.test.ts worker/services/action-run-service.ts worker/services/action-run-service.test.ts
git add -p worker/db/drizzle
git diff --cached --name-only
git commit -m "feat: persist safe integration metadata"
```

The staged list must include only the newly generated migration, its snapshot/journal updates, and the named schema/service/test files.

---

### Task 4: Build deterministic catalog fingerprinting and profile review

**Files:**
- Create: `worker/agents/provider-profiles/catalog.ts`
- Create: `worker/agents/provider-profiles/catalog.test.ts`
- Create: `worker/agents/provider-profiles/registry.ts`
- Create: `worker/agents/provider-profiles/registry.test.ts`
- Create: `worker/agents/provider-profiles/schema-fingerprint.ts`
- Create: `worker/agents/provider-profiles/schema-fingerprint.test.ts`

- [ ] **Step 1: Write failing canonicalization tests**

Equivalent JSON Schemas with reordered keys must hash identically. Changed required fields, types, enums, or nested structures must produce a different hash. Descriptions/defaults may be ignored only if the profile validator does not rely on them.

- [ ] **Step 2: Implement the registry**

Each profile declares:

```typescript
export interface ProviderProfile<TInput, TRaw, TFact extends SafeFact> {
  provider: ProviderKind;
  canonicalActionId: CanonicalActionId;
  profileVersion: number;
  reducerVersion: number;
  matchCatalog(catalog: SafeMcpCatalog): MappingCandidate[];
  validateInputSchema(schema: JsonSchema): ProfileValidationResult;
  buildProviderInput(identity: TrustedCustomerIdentity, query: CanonicalQuery): TInput;
  reduce(raw: TRaw): TFact;
}
```

The registry maps canonical IDs to code-owned profiles; it does not accept model-generated reducers or transforms.

- [ ] **Step 3: Implement review rules**

- one exact compatible candidate may be suggested but still requires a human `Save mapping` action;
- zero or multiple candidates remain `unmapped`;
- any catalog/schema fingerprint change after save becomes `needs_review` and disables execution;
- custom servers can be connected and mapped only when they satisfy an existing canonical profile.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/provider-profiles/catalog.test.ts worker/agents/provider-profiles/registry.test.ts worker/agents/provider-profiles/schema-fingerprint.test.ts
bun run build
git add worker/agents/provider-profiles/catalog.ts worker/agents/provider-profiles/catalog.test.ts worker/agents/provider-profiles/registry.ts worker/agents/provider-profiles/registry.test.ts worker/agents/provider-profiles/schema-fingerprint.ts worker/agents/provider-profiles/schema-fingerprint.test.ts
git commit -m "feat: review MCP catalogs deterministically"
```

---

### Task 5: Implement the generic MCP client inside the integration agent

**Files:**
- Create: `worker/agents/integration-runtime.ts`
- Create: `worker/agents/integration-runtime.test.ts`
- Replace shell: `worker/agents/maven-integration-agent.ts`
- Create: `worker/agents/maven-integration-agent.test.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Write failing runtime tests with a fake MCP transport**

Cover stable server ID, Streamable HTTP URL validation, OAuth pending/connected states, bearer header submission without D1 persistence, reconnect, catalog refresh, disconnect, execution timeout, normalized errors, and catalog drift.

- [ ] **Step 2: Implement the MCP client lifecycle**

- register by stable SDK server ID derived from connection ID, never display name;
- accept only `https:` except loopback in development;
- reject userinfo, fragments, unexpected redirect hosts, and private-network targets unless project security policy explicitly supports them later;
- let the Agents SDK store OAuth/client state in the integration Durable Object;
- forward OAuth callback before the SPA fallback;
- never return OAuth tokens to React or D1.

- [ ] **Step 3: Build deterministic selected-tool execution**

The integration agent may use the SDK catalog/AI-tool adapter only to locate and invoke the exact reviewed `serverId + toolName`. It must not pass `mcp.getAITools()` to any model. Validate the current input schema fingerprint before every call.

- [ ] **Step 4: Enforce the reducer boundary**

Execution order is fixed:

```text
typed canonical request
→ trusted identity injected inside Worker
→ reviewed provider input builder
→ exact MCP tool call
→ code-owned reducer
→ safe-fact validator
→ typed RPC result
```

Put the raw response in a local variable only. No callback, event, exception, state update, trace, or logger receives it.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/agents/integration-runtime.test.ts worker/agents/maven-integration-agent.test.ts
bun run build
bun run lint
git add worker/agents/integration-runtime.ts worker/agents/integration-runtime.test.ts worker/agents/maven-integration-agent.ts worker/agents/maven-integration-agent.test.ts worker/index.ts
git commit -m "feat: add isolated MCP client runtime"
```

---

### Task 6: Add authenticated project connection and mapping APIs

**Files:**
- Create: `worker/routes/integration-handlers.ts`
- Create: `worker/routes/integration-handlers.test.ts`
- Modify: `worker/index.ts`
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`

**Endpoints:**

- `GET /api/projects/:id/integrations`
- `POST /api/projects/:id/integrations`
- `GET /api/projects/:id/integrations/:connectionId`
- `POST /api/projects/:id/integrations/:connectionId/connect`
- `GET /api/projects/:id/integrations/:connectionId/oauth/callback`
- `POST /api/projects/:id/integrations/:connectionId/refresh`
- `PUT /api/projects/:id/integrations/:connectionId/mappings/:actionId`
- `PATCH /api/projects/:id/integrations/:connectionId/actions/:actionId`
- `DELETE /api/projects/:id/integrations/:connectionId`

- [ ] **Step 1: Write failing auth/validation tests**

Cover unauthenticated 401, wrong project 404, role checks, invalid schemes/URLs, open redirects, cross-project IDs, state/PKCE mismatch, mismatched catalog fingerprint, mapping write races, and responses containing no credentials/raw schemas.

- [ ] **Step 2: Implement connection creation**

Create D1 metadata first in `connecting`, then initialize the exact integration agent. If initialization fails, leave a normalized `degraded` state that can be retried; never persist submitted authorization headers.

- [ ] **Step 3: Implement reviewed mapping changes**

Require the browser to submit the displayed current catalog fingerprint. Revalidate it in the integration agent, save the exact mapping, increment mapping version, and disable old grants.

- [ ] **Step 4: Implement disconnect safely**

Mark D1 `disconnecting`, remove the MCP server/credentials inside the integration agent, destroy its durable state, then mark/delete metadata. Record a retryable cleanup task if agent destruction fails.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/routes/integration-handlers.test.ts worker/validation.test.ts
bun run build
git add worker/routes/integration-handlers.ts worker/routes/integration-handlers.test.ts worker/index.ts worker/validation.ts worker/validation.test.ts
git commit -m "feat: manage project MCP connections"
```

---

### Task 7: Resolve only trusted customer identity

**Files:**
- Create: `worker/services/trusted-customer-identity-service.ts`
- Create: `worker/services/trusted-customer-identity-service.test.ts`
- Modify: `worker/services/customer-service.ts` only if a project-scoped helper is missing

**Contract:**

```typescript
export interface TrustedCustomerIdentity {
  customerId: string;
  externalId: string | null;
  normalizedEmail: string | null;
  source: "external_id" | "email";
}
```

- [ ] **Step 1: Write failing identity tests**

Cover external ID preferred when both exist, email fallback only from canonical `customers.email`, absent identity, cross-project conflict, duplicate conflict, and refusal to consume conversation `visitorEmail`, visitor messages, metadata, custom fields, or model arguments.

- [ ] **Step 2: Implement resolution from conversation linkage**

Start with authenticated `(projectId, conversationId)`, read its canonical `customerId`, then load the same-project customer. Do not search arbitrary customer rows using a model-provided identifier.

- [ ] **Step 3: Return minimal provider identity**

Profiles may request external ID and/or normalized email, but the LLM-facing action schema contains neither. Identity is injected only after action selection inside trusted Worker code.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/services/trusted-customer-identity-service.test.ts
bun run build
git add worker/services/trusted-customer-identity-service.ts worker/services/trusted-customer-identity-service.test.ts worker/services/customer-service.ts
git commit -m "feat: enforce trusted customer lookup"
```

---

### Task 8: Implement the PostHog events profile

**Files:**
- Create: `worker/agents/provider-profiles/posthog.ts`
- Create: `worker/agents/provider-profiles/posthog.test.ts`
- Create: `worker/agents/provider-profiles/fixtures/posthog-catalog.json`

**Canonical input visible to Maven:**

```typescript
{ query?: string; dateFrom: string; dateTo: string; limit?: number }
```

Identity is injected server-side. Clamp date range to 90 days and limit to 50.

- [ ] **Step 1: Write fixture-based failing tests**

Test external ID-first query construction, email fallback, date/limit clamps, event filtering, primitive-property allowlist, string truncation, chronological ordering, and rejection of persons/session/provider metadata.

- [ ] **Step 2: Implement mapping validator/input builder/reducer**

Return only event name, timestamp, and configured allowlisted primitive properties. Do not return distinct ID, person object, IP, geo, device fingerprint, feature flags, session recordings, or raw properties.

- [ ] **Step 3: Verify and commit**

```bash
bun test worker/agents/provider-profiles/posthog.test.ts
bun run build
git add worker/agents/provider-profiles/posthog.ts worker/agents/provider-profiles/posthog.test.ts worker/agents/provider-profiles/fixtures/posthog-catalog.json
git commit -m "feat: normalize PostHog customer events"
```

---

### Task 9: Implement the Stripe billing-summary profile

**Files:**
- Create: `worker/agents/provider-profiles/stripe.ts`
- Create: `worker/agents/provider-profiles/stripe.test.ts`
- Create: `worker/agents/provider-profiles/fixtures/stripe-catalog.json`

- [ ] **Step 1: Write fixture-based failing tests**

Cover exact external metadata/reference lookup when available, normalized email fallback, zero/one/multiple Stripe-customer matches, active/trialing/past-due/canceled subscriptions, renewal date, scheduled cancellation date, recently canceled date, payment summaries, upgrade/downgrade classification, currencies, and bounded history.

- [ ] **Step 2: Implement strict ambiguity behavior**

Multiple provider customers must return `identity_ambiguous`; never merge or choose the newest/first result. Missing data returns `not_found`, not an invented inactive subscription.

- [ ] **Step 3: Implement the safe reducer**

Return no complete Stripe customer, subscription, invoice, charge, payment method, billing address, tax, balance transaction, receipt details, metadata object, or raw IDs except a bounded human-safe invoice/reference label when explicitly allowed.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/provider-profiles/stripe.test.ts
bun run build
git add worker/agents/provider-profiles/stripe.ts worker/agents/provider-profiles/stripe.test.ts worker/agents/provider-profiles/fixtures/stripe-catalog.json
git commit -m "feat: normalize Stripe billing context"
```

---

### Task 10: Implement the Slack search profile

**Files:**
- Create: `worker/agents/provider-profiles/slack.ts`
- Create: `worker/agents/provider-profiles/slack.test.ts`
- Create: `worker/agents/provider-profiles/fixtures/slack-catalog.json`

- [ ] **Step 1: Write fixture-based failing tests**

Cover external-ID token search where supported, email-derived internal lookup fallback, project-configured channel allowlist, date range, limit, thread/message dedupe, excerpt truncation, bot/system message exclusion, and no private-channel leakage outside the allowlist.

- [ ] **Step 2: Implement query and reducer**

Return channel display name, human author display name, timestamp, bounded excerpt, and allowed permalink. Do not return user profile objects, email, channel membership, reactions, files, message metadata, or full threads.

- [ ] **Step 3: Verify and commit**

```bash
bun test worker/agents/provider-profiles/slack.test.ts
bun run build
git add worker/agents/provider-profiles/slack.ts worker/agents/provider-profiles/slack.test.ts worker/agents/provider-profiles/fixtures/slack-catalog.json
git commit -m "feat: normalize Slack customer context"
```

---

### Task 11: Implement the Attio record profile

**Files:**
- Create: `worker/agents/provider-profiles/attio.ts`
- Create: `worker/agents/provider-profiles/attio.test.ts`
- Create: `worker/agents/provider-profiles/fixtures/attio-catalog.json`

- [ ] **Step 1: Write fixture-based failing tests**

Cover external-ID attribute lookup, email fallback, duplicate ambiguity, project-configured attribute allowlist, primitive normalization, note/activity limits, and exclusion of full record objects/internal IDs.

- [ ] **Step 2: Implement mapping/input/reducer**

Return only configured display attributes and short recent note/activity summaries. Unknown rich attribute types are dropped, not stringified.

- [ ] **Step 3: Verify and commit**

```bash
bun test worker/agents/provider-profiles/attio.test.ts
bun run build
git add worker/agents/provider-profiles/attio.ts worker/agents/provider-profiles/attio.test.ts worker/agents/provider-profiles/fixtures/attio-catalog.json
git commit -m "feat: normalize Attio customer records"
```

---

### Task 12: Implement the Linear issues profile

**Files:**
- Create: `worker/agents/provider-profiles/linear.ts`
- Create: `worker/agents/provider-profiles/linear.test.ts`
- Create: `worker/agents/provider-profiles/fixtures/linear-catalog.json`

- [ ] **Step 1: Write fixture-based failing tests**

Cover exact customer labels/relations or external-ID references where configured, normalized-email fallback where the selected tool supports it, team allowlist, state/date filtering, dedupe, issue limit, URL validation, and exclusion of comments/descriptions unless separately allowlisted later.

- [ ] **Step 2: Implement mapping/input/reducer**

Return identifier, title, state, priority, team name, updated date, and allowed URL only. Never return complete issue, creator/assignee profiles, attachments, private comments, or workspace metadata.

- [ ] **Step 3: Verify and commit**

```bash
bun test worker/agents/provider-profiles/linear.test.ts
bun run build
git add worker/agents/provider-profiles/linear.ts worker/agents/provider-profiles/linear.test.ts worker/agents/provider-profiles/fixtures/linear-catalog.json
git commit -m "feat: normalize Linear customer issues"
```

---

### Task 13: Bridge canonical reads into private sidechat

**Files:**
- Create: `worker/agents/sidechat-read-actions.ts`
- Create: `worker/agents/sidechat-read-actions.test.ts`
- Modify: `worker/agents/maven-sidechat-agent.ts`
- Modify: `worker/agents/sidechat-prompt.ts`
- Modify: `worker/agents/sidechat-prompt.test.ts`
- Modify: `worker/agents/sidechat-runtime.ts`

- [ ] **Step 1: Write failing tool-surface tests**

Assert `getTools()` exposes only enabled canonical read names plus `presentReplyDraft`; input schemas contain query/date/filter intent only; schemas do not contain email, external ID, connection ID, MCP server ID, tool name, provider arguments, or raw passthrough fields.

- [ ] **Step 2: Implement typed canonical read actions**

For each call:

1. derive project/conversation from authenticated sidechat claims;
2. load trusted identity;
3. load the enabled ready mapping;
4. call the exact integration agent by typed RPC;
5. validate the safe result again at the sidechat boundary;
6. record bounded action-run metadata;
7. emit a compact private activity part such as `Stripe · Checking billing`;
8. return the safe fact to Think.

- [ ] **Step 3: Restrict active tools per turn**

Use `beforeTurn().activeTools` to expose only actions enabled for this project and ready for this customer. Keep `includeMcpTools=false`, `workspaceBash=false`, and `sendReasoning=false`.

- [ ] **Step 4: Extend prompt privacy tests**

Tell Maven to answer the human agent with conclusions, use facts to draft the visitor reply, and never enumerate hidden provider data or repeat identifiers. The prompt is a defense-in-depth rule, not the raw-data boundary.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/agents/sidechat-read-actions.test.ts worker/agents/sidechat-prompt.test.ts
bun run build
bun run lint
git add worker/agents/sidechat-read-actions.ts worker/agents/sidechat-read-actions.test.ts worker/agents/maven-sidechat-agent.ts worker/agents/sidechat-prompt.ts worker/agents/sidechat-prompt.test.ts worker/agents/sidechat-runtime.ts
git commit -m "feat: give sidechat safe customer reads"
```

---

### Task 14: Add project Connections and Agent actions UI

**Files:**
- Modify: `src/pages/QuickActions.tsx`
- Create: `src/components/actions/ConnectionsPanel.tsx`
- Create: `src/components/actions/ConnectionRow.tsx`
- Create: `src/components/actions/ConnectionDialog.tsx`
- Create: `src/components/actions/AgentActionsPanel.tsx`
- Create: `src/components/actions/ActionMappingRow.tsx`
- Create: `src/components/actions/integration-ui.test.ts`
- Modify: `src/pages/McpConnections.tsx`

- [ ] **Step 1: Write failing tab/copy/accessibility tests**

Exact top-level tabs:

```text
Actions | Tools | Connections | Agent actions
```

Verify semantic tab roles, keyboard navigation, compact button labels, no sparkle icon, no raw tool schema/output, no credential echo, and Settings > MCP copy explicitly says it is for external clients connecting to ReplyMaven.

- [ ] **Step 2: Build Connections as a native settings list**

Match current `QuickActions.tsx` shell, heading sizes, content width, `rounded-[20px]` outer surfaces, 13–14px row text, 11.5–12px descriptions, glass buttons, and spacing. Each connection row shows provider mark/name, display name, `Connected | Connecting | Needs review | Degraded`, last checked, and a compact overflow menu. No oversized marketplace cards.

- [ ] **Step 3: Build the connection flow**

The dialog collects provider/custom server, name, HTTPS URL, then hands OAuth or optional authorization-header submission directly to the agent endpoint. Secrets are never read back. Show progress as inline copy, not an alert card.

- [ ] **Step 4: Build Agent actions**

Group by connection/provider. Each canonical action row shows:

- human label and concise description;
- Read/Write label;
- enabled switch;
- mapping status/tool name;
- `Review mapping` only when needed;
- write approval policy control rendered disabled until phase 3.

Critical review detail is bold inside description text. Do not add a separate alert or badge block.

- [ ] **Step 5: Handle all UI states**

Loading skeletons, empty, OAuth pending, connected, degraded, mapping review, no compatible tools, reconnecting, and disconnect confirmation must preserve the same page geometry. Errors remain local to the affected row/dialog.

- [ ] **Step 6: Verify and commit**

```bash
bun test src/components/actions/integration-ui.test.ts
bun run build
bun run lint
git add src/pages/QuickActions.tsx src/components/actions/ConnectionsPanel.tsx src/components/actions/ConnectionRow.tsx src/components/actions/ConnectionDialog.tsx src/components/actions/AgentActionsPanel.tsx src/components/actions/ActionMappingRow.tsx src/components/actions/integration-ui.test.ts src/pages/McpConnections.tsx
git commit -m "feat: configure MCP actions in project settings"
```

---

### Task 15: Enforce lifecycle, SSRF, retention, and privacy invariants

**Files:**
- Create: `worker/security/mcp-server-url.ts`
- Create: `worker/security/mcp-server-url.test.ts`
- Create: `worker/services/integration-retention-service.ts`
- Create: `worker/services/integration-retention-service.test.ts`
- Modify: `worker/services/project-service.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Write failing security/lifecycle tests**

Cover HTTPS enforcement, localhost development exception, DNS/IP private ranges, redirect revalidation, project deletion, connection deletion, token revocation, OAuth state removal, stale run retention, destroy retry, and log redaction.

- [ ] **Step 2: Add URL and redirect validation**

Reject loopback/link-local/private ranges in production, nonstandard credentials in URL, DNS rebinding on redirects where runtime information permits, and callbacks not bound to the exact project/connection/OAuth state.

- [ ] **Step 3: Add retention/deletion**

Project/connection deletion destroys integration agent SQLite before final metadata deletion or records a durable retry. Read action-run metadata follows the project audit-retention setting. Catalog fingerprints may remain; catalog bodies may not.

- [ ] **Step 4: Audit observability**

Search new code and error reporting for request bodies, OAuth query values, headers, UI messages, raw tool inputs/outputs, and provider exceptions. Logs may contain event name, project/connection IDs, canonical action ID, normalized status/error code, duration, and hashed reference only.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/security/mcp-server-url.test.ts worker/services/integration-retention-service.test.ts
bun test
bun run build
bun run lint
git diff --check
git add worker/security/mcp-server-url.ts worker/security/mcp-server-url.test.ts worker/services/integration-retention-service.ts worker/services/integration-retention-service.test.ts worker/services/project-service.ts worker/index.ts
git commit -m "feat: secure integration lifecycle"
```

---

### Task 16: Run provider, visual, and privacy acceptance

**Files:**
- Modify only phase-2 files when a measured defect is found
- Create: `docs/superpowers/verification/2026-08-07-safe-mcp-read-actions.md`

- [ ] **Step 1: Run fixture contract suites**

Exercise all five profiles against representative current catalog fixtures plus deliberate catalog drift, malformed result, oversized result, ambiguity, timeout, and unavailable-server cases.

- [ ] **Step 2: Run local MCP end-to-end fixtures**

Use a disposable local test MCP server with synthetic records. Prove raw sentinel strings placed outside each reducer allowlist do not appear in:

- Maven input/output messages;
- browser WebSocket frames;
- D1 rows;
- Worker logs/test captures;
- sidechat activity/reply draft;
- public conversation messages.

- [ ] **Step 3: Capture the project settings matrix**

At `1440x1000`, `1100x900`, `768x900`, and `390x844`, capture Connections/Agent actions loading, empty, connected, needs-review, degraded, and long-description states. Compare typography, radii, shadows, row heights, button heights, icon weights, focus rings, dark mode, and 200% zoom against the existing Actions/Tools page.

- [ ] **Step 4: Exercise sidechat read states**

Verify compact activity, successful normalized fact use, missing trusted identity, ambiguous provider identity, unavailable provider, mapping-needs-review, panel-close continuity, and `Add to reply`. No raw fact dump or provider JSON may render.

- [ ] **Step 5: Record evidence and run final checks**

```bash
bun test
bun run build
bun run lint
git diff --check
```

Record exact commands/results, viewport captures, privacy sentinel results, and known pre-existing failures in the verification document.

- [ ] **Step 6: Commit verification-only fixes and record**

```bash
git add docs/superpowers/verification/2026-08-07-safe-mcp-read-actions.md <exact-fixed-files>
git commit -m "fix: harden and polish MCP read actions"
```

Do not deploy, run remote migrations, enable production connections, push, or expose credentials without explicit user approval.
