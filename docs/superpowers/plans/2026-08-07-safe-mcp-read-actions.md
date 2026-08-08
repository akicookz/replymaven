# MCP Connection Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each project one generic MCP client with simple PostHog, Stripe, Slack, Attio, Linear, and Custom connection presets, then let owners configure the connected server's native tools directly for Maven sidechat.

**Architecture:** One `MavenIntegrationAgent extends Agent` Durable Object owns each connection's generic MCP client, credentials, OAuth state, and discovered catalog. Presets are inert metadata that only prefill the standard connection form. Native MCP tools are discovered generically, disabled by default, and configured by exact tool name/input-schema fingerprint; there are no provider profiles, canonical actions, reducers, templates, or provider-specific runtime branches.

**Tech Stack:** Bun, Hono, D1/Drizzle, Cloudflare Durable Objects, Cloudflare Agents MCP client, AI SDK v6, React 19, TanStack Query, Tailwind CSS v4, Zod v4.

**Prerequisite:** Complete `docs/superpowers/plans/2026-08-07-private-sidechat-foundation.md` first.

**Spec:** `docs/superpowers/specs/2026-08-07-private-sidechat-mcp-actions-design.md` — read sections 5–10 before starting.

## Global Constraints

- Use Bun only. Never use npm/yarn.
- Read every target file before modifying it. Preserve unrelated/uncommitted work and use `git add -p` when a named file already contains unrelated edits.
- Function declarations for named functions/components; arrows only for inline callbacks.
- One generic MCP transport/catalog/execution path serves every preset and custom connection.
- Presets contain only ID, label, existing icon path, default URL, auth-mode/setup copy, and official docs URL.
- No preset may create tools, action templates, canonical action IDs, provider prompts, mappings, reducers, profile versions, provider schemas, identity rules, or code branches.
- Every discovered native tool starts disabled.
- Owner/admin configures the native tool directly as enabled, `read | write`, optional project instruction, and write approval mode.
- MCP annotations may suggest read/write classification but never enable or authorize a tool automatically.
- Customer lookup instructions prefer canonical `externalId`, then normalized canonical customer email. Never treat visitor-authored text, widget metadata, `visitorName`, or conversation snapshot email as trusted identity.
- MCP tool inputs/results may reach the private LLM context. They must never render in browser frames, visible messages, public D1 `messages`, Telegram, widget APIs, D1 integration tables, logs, or traces.
- Credentials, OAuth tokens, and authorization headers never reach the model or D1.
- Reuse the existing `Actions & Tools` page shell/components. Add only `Connections`; do not add `Agent actions`.
- No sparkle treatment, marketplace card grid, nested card stack, alert banner, or row separators.
- Migrations are Drizzle-generated, inspected, and applied locally only.
- Test each task with targeted tests, `bun run build`, and `bun run lint`; commit only named files; never push/deploy.

---

### Task 1: Add the generic integration-agent binding and RPC shell

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `worker/types.ts`
- Modify: `worker/index.ts`
- Create: `worker/agents/maven-integration-agent.ts`
- Create: `worker/agents/maven-integration-agent.test.ts`
- Modify: `worker-configuration.d.ts`

**Interfaces:**

```typescript
export interface IntegrationAgentRpc {
  connect(input: McpConnectInput): Promise<McpConnectionState>;
  getCatalog(): Promise<McpToolCatalog>;
  refreshCatalog(): Promise<McpToolCatalog>;
  callTool(input: NativeMcpToolCall): Promise<NativeMcpToolResult>;
  disconnect(): Promise<void>;
}
```

- [ ] **Step 1: Write a failing export/binding test**

Assert the Worker exports `MavenIntegrationAgent`, `AppEnv` contains `MAVEN_INTEGRATION`, and the class exposes no browser WebSocket chat route.

```bash
bun test worker/agents/maven-integration-agent.test.ts
```

Expected: fail because the class/binding do not exist.

- [ ] **Step 2: Add the Durable Object binding**

Append `MAVEN_INTEGRATION -> MavenIntegrationAgent` and migration tag `v3-maven-integration-agent` with `new_sqlite_classes: ["MavenIntegrationAgent"]`. Do not edit earlier migration tags or enable traces.

- [ ] **Step 3: Add a sealed shell and regenerate types**

The shell rejects direct WebSocket/client access. Only authenticated Hono handlers and `MavenSidechatAgent` may call its RPC methods.

```bash
bun run cf-typegen
bun test worker/agents/maven-integration-agent.test.ts
bun run build
bun run lint
```

- [ ] **Step 4: Commit**

```bash
git add wrangler.jsonc worker/types.ts worker/index.ts worker/agents/maven-integration-agent.ts worker/agents/maven-integration-agent.test.ts worker-configuration.d.ts
git commit -m "chore: add generic MCP connection agent"
```

---

### Task 2: Define the inert preset catalog and generic MCP contracts

**Files:**
- Create: `shared/mcp-types.ts`
- Create: `shared/mcp-presets.ts`
- Create: `shared/mcp-presets.test.ts`

**Contracts:**

```typescript
export type McpPresetId =
  | "posthog"
  | "stripe"
  | "slack"
  | "attio"
  | "linear";

export interface McpConnectionPreset {
  id: McpPresetId;
  label: string;
  iconPath: string;
  defaultUrl: string;
  authMode: "oauth_discovery" | "oauth_client_credentials";
  setupCopy: string;
  docsUrl: string;
}

export interface McpToolCatalogEntry {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  inputSchemaFingerprint: string;
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}
```

- [ ] **Step 1: Write failing preset tests**

Assert exact records:

| Preset | URL | Auth |
|---|---|---|
| PostHog | `https://mcp.posthog.com/mcp` | OAuth discovery |
| Stripe | `https://mcp.stripe.com` | OAuth discovery |
| Slack | `https://mcp.slack.com/mcp` | OAuth client credentials |
| Attio | `https://mcp.attio.com/mcp` | OAuth discovery |
| Linear | `https://mcp.linear.app/mcp` | OAuth discovery |

Also assert existing icon paths under `/integrations/*.svg`, official docs URLs, unique IDs, HTTPS URLs, and that preset objects have no keys matching `action`, `tool`, `profile`, `reducer`, `mapping`, `prompt`, or `schema`.

- [ ] **Step 2: Implement the immutable catalog**

Export `MCP_CONNECTION_PRESETS` as a readonly array and `getMcpPreset(id)`. Custom is a UI choice, not a stored preset record; it leaves URL/auth fields editable.

- [ ] **Step 3: Define generic connection/catalog/call contracts**

Include connection state, safe catalog, tool settings, OAuth start/callback state, native tool call, raw private result, and normalized transport error. Do not add provider unions beyond optional `presetId`.

- [ ] **Step 4: Verify no provider behavior entered the catalog**

```bash
bun test shared/mcp-presets.test.ts
rg -n "canonical|reducer|billing_summary|refund_payment|post_internal|add_note|create_issue" shared/mcp-presets.ts shared/mcp-types.ts
bun run build
```

Expected: tests pass and the search returns zero hits.

- [ ] **Step 5: Commit**

```bash
git add shared/mcp-types.ts shared/mcp-presets.ts shared/mcp-presets.test.ts
git commit -m "feat: define simple MCP connection presets"
```

---

### Task 3: Persist connection metadata, native tool settings, and safe run metadata

**Files:**
- Modify: `worker/db/schema.ts`
- Create: generated `worker/db/drizzle/006X_*.sql`
- Modify: generated `worker/db/drizzle/meta/*`
- Create: `worker/services/mcp-connection-service.ts`
- Create: `worker/services/mcp-connection-service.test.ts`
- Create: `worker/services/mcp-tool-service.ts`
- Create: `worker/services/mcp-tool-service.test.ts`

**Tables:**

```text
integration_connections
  projectId, presetId?, displayName, serverUrl, agentName, sdkServerId,
  state, catalogFingerprint, lastErrorCode?, connectedAt?, timestamps

integration_tool_settings
  projectId, connectionId, toolName, inputSchemaFingerprint, enabled,
  access(read|write), approvalMode(every_time|always), projectInstruction?,
  configuredBy, timestamps

mcp_tool_runs
  projectId, conversationId, connectionId, toolName, status,
  approvalMode?, approvalActorId?, durationMs?, argumentHash?, errorCode?, timestamps
```

No table contains OAuth state/token, authorization header, full catalog/schema, tool arguments, or tool result.

- [ ] **Step 1: Write failing service tests**

Cover project scoping, optional preset ID, arbitrary custom connection, unique stable agent/server IDs, all discovered tools disabled until configured, exact tool/schema setting uniqueness, instruction length cap, catalog drift disablement, safe run metadata, and absence of secret/raw columns.

- [ ] **Step 2: Implement schema/services**

Require `(projectId, connectionId)` for every lookup/mutation. `approvalMode` is accepted only when `access="write"`; read tools always store `every_time` internally but do not prompt.

- [ ] **Step 3: Generate, inspect, and apply migration**

```bash
bun run db:generate
bun run db:migrate:dev
```

The SQL may only create the three named tables/indexes. It must not rebuild or drop existing tables.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/services/mcp-connection-service.test.ts worker/services/mcp-tool-service.test.ts
bun run build
git add worker/db/schema.ts worker/services/mcp-connection-service.ts worker/services/mcp-connection-service.test.ts worker/services/mcp-tool-service.ts worker/services/mcp-tool-service.test.ts
git add -p worker/db/drizzle
git diff --cached --name-only
git commit -m "feat: persist generic MCP tool settings"
```

The staged list must contain only the new migration/meta files and named schema/service/test files.

---

### Task 4: Build one generic MCP client runtime

**Files:**
- Create: `worker/agents/mcp-runtime.ts`
- Create: `worker/agents/mcp-runtime.test.ts`
- Replace shell: `worker/agents/maven-integration-agent.ts`
- Modify: `worker/agents/maven-integration-agent.test.ts`

**Runtime boundary:**

```typescript
export interface McpRuntime {
  connect(input: McpConnectInput): Promise<McpConnectionState>;
  getCatalog(): Promise<McpToolCatalog>;
  callTool(input: NativeMcpToolCall): Promise<NativeMcpToolResult>;
  disconnect(): Promise<void>;
}
```

- [ ] **Step 1: Write failing fake-transport tests**

Cover Streamable HTTP, stable server ID, OAuth-discovery pending/connected, confidential OAuth fields, bearer auth for Custom, no-auth Custom, catalog listing, exact native tool call, timeout, reconnect, disconnect, normalized errors, and credential non-export.

- [ ] **Step 2: Implement generic connection lifecycle**

Use the Cloudflare Agents MCP client behind `McpRuntime`. Preset ID is never switched on after UI form hydration; runtime consumes only the generic resolved URL/auth input.

- [ ] **Step 3: Implement generic catalog serialization**

Return native name, description, JSON input schema, annotations, and deterministic input-schema fingerprint. Store catalog bodies in integration-agent SQLite only. D1 receives the aggregate catalog fingerprint and configured tool settings.

- [ ] **Step 4: Implement exact native execution**

Validate current fingerprint, validate arguments against the current native input schema, call exactly `(sdkServerId, toolName)`, and return the raw MCP result only over private typed RPC to sidechat. Do not parse or transform it by provider.

- [ ] **Step 5: Prove presets do not affect runtime behavior**

Run the same fake catalog/tool execution once with each preset ID and once as Custom. The transport calls/results must be byte-equivalent after resolved URL/auth input.

```bash
bun test worker/agents/mcp-runtime.test.ts worker/agents/maven-integration-agent.test.ts
bun run build
bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add worker/agents/mcp-runtime.ts worker/agents/mcp-runtime.test.ts worker/agents/maven-integration-agent.ts worker/agents/maven-integration-agent.test.ts
git commit -m "feat: connect arbitrary MCP servers generically"
```

---

### Task 5: Secure remote URLs, OAuth, and credential submission

**Files:**
- Create: `worker/security/mcp-server-url.ts`
- Create: `worker/security/mcp-server-url.test.ts`
- Create: `worker/security/mcp-oauth-state.ts`
- Create: `worker/security/mcp-oauth-state.test.ts`
- Modify: `worker/agents/mcp-runtime.ts`
- Modify: `worker/agents/mcp-runtime.test.ts`

- [ ] **Step 1: Write failing URL/OAuth tests**

Cover HTTPS-only, production loopback/private/link-local denial, development loopback exception, URL userinfo/fragment rejection, redirect revalidation, callback host/state/PKCE mismatch, expired state, cross-project connection ID, secret redaction, and callback replay.

- [ ] **Step 2: Implement generic URL validation**

Apply the same validation to presets and Custom. A preset URL is editable only after selecting Custom; backend still validates all URLs rather than trusting preset ID.

- [ ] **Step 3: Implement generic auth flows**

- `oauth_discovery`: use MCP OAuth metadata/dynamic registration supported by the Agents client.
- `oauth_client_credentials`: accept client ID/secret through the authenticated route and forward directly to the integration agent; never store/return them in D1.
- `bearer`: accept a header value through the authenticated Custom flow and store only inside the integration agent.
- `none`: permit only when explicitly selected for Custom.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/security/mcp-server-url.test.ts worker/security/mcp-oauth-state.test.ts worker/agents/mcp-runtime.test.ts
bun run build
git add worker/security/mcp-server-url.ts worker/security/mcp-server-url.test.ts worker/security/mcp-oauth-state.ts worker/security/mcp-oauth-state.test.ts worker/agents/mcp-runtime.ts worker/agents/mcp-runtime.test.ts
git commit -m "feat: secure generic MCP authentication"
```

---

### Task 6: Add authenticated connection and native-tool configuration APIs

**Files:**
- Create: `worker/routes/mcp-connection-handlers.ts`
- Create: `worker/routes/mcp-connection-handlers.test.ts`
- Modify: `worker/index.ts`
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`

**Endpoints:**

```text
GET    /api/projects/:id/mcp-connections
POST   /api/projects/:id/mcp-connections
GET    /api/projects/:id/mcp-connections/:connectionId
POST   /api/projects/:id/mcp-connections/:connectionId/connect
GET    /api/projects/:id/mcp-connections/:connectionId/oauth/callback
POST   /api/projects/:id/mcp-connections/:connectionId/refresh
PUT    /api/projects/:id/mcp-connections/:connectionId/tools/:toolName
DELETE /api/projects/:id/mcp-connections/:connectionId
```

- [ ] **Step 1: Write failing auth/validation tests**

Cover unauthenticated 401, wrong project 404, member write denial, valid owner/admin access, preset URL tampering, Custom URL/auth validation, cross-project IDs, secret non-echo, OAuth replay, missing current catalog fingerprint, unknown tool, schema drift, and invalid access/approval combinations.

- [ ] **Step 2: Implement connection routes**

The POST accepts `presetId | null`, display name, resolved URL, and auth mode. Preset selection is validated against `shared/mcp-presets.ts`, but the resulting connection row/runtime remains generic.

- [ ] **Step 3: Implement native tool settings**

The PUT body is exactly:

```typescript
{
  enabled: boolean;
  access: "read" | "write";
  approvalMode: "every_time" | "always";
  projectInstruction: string | null;
  inputSchemaFingerprint: string;
}
```

Re-read the current catalog inside the integration agent before saving. Any mismatch returns 409 and leaves the tool disabled.

- [ ] **Step 4: Implement disconnect ordering**

Mark `disconnecting`, remove SDK server/credentials and destroy integration-agent state, then delete connection/tool settings. Persist a cleanup retry before returning if destruction fails.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/routes/mcp-connection-handlers.test.ts worker/validation.test.ts
bun run build
bun run lint
git add worker/routes/mcp-connection-handlers.ts worker/routes/mcp-connection-handlers.test.ts worker/index.ts worker/validation.ts worker/validation.test.ts
git commit -m "feat: configure native MCP tools"
```

---

### Task 7: Add canonical customer context to the private model only

**Files:**
- Modify: `worker/agents/sidechat-context.ts`
- Modify: `worker/agents/sidechat-context.test.ts`
- Modify: `worker/agents/sidechat-prompt.ts`
- Modify: `worker/agents/sidechat-prompt.test.ts`

- [ ] **Step 1: Write failing customer-context tests**

Cover linked project customer, external ID present, normalized canonical email fallback, missing identity, project isolation, and refusal to use conversation `visitorEmail`, `visitorName`, widget metadata, customer custom fields, or visitor message text as identity.

- [ ] **Step 2: Expose minimal trusted identity to Maven**

The private context contains customer display name, external ID, and normalized email. There is no provider mapper. The native MCP tool schema determines which argument Maven uses.

- [ ] **Step 3: Add exact prompt tests**

Assert instructions:

- prefer external ID; use email only when external ID is absent or unsupported by the native tool;
- MCP data is private working context, not copy;
- answer the dashboard human concisely;
- never dump tool results, records, identifiers, emails, internal links, or hidden metadata;
- never put them in `presentReplyDraft` unless the human explicitly asks to include a specific safe fact;
- never invent results when a tool fails.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/agents/sidechat-context.test.ts worker/agents/sidechat-prompt.test.ts
bun run build
git add worker/agents/sidechat-context.ts worker/agents/sidechat-context.test.ts worker/agents/sidechat-prompt.ts worker/agents/sidechat-prompt.test.ts
git commit -m "feat: provide private customer lookup context"
```

---

### Task 8: Expose enabled native MCP tools to Think generically

**Files:**
- Create: `worker/agents/sidechat-mcp-tools.ts`
- Create: `worker/agents/sidechat-mcp-tools.test.ts`
- Modify: `worker/agents/maven-sidechat-agent.ts`
- Modify: `worker/agents/sidechat-runtime.ts`
- Modify: `worker/agents/sidechat-runtime.test.ts`

- [ ] **Step 1: Write failing dynamic-tool tests**

Cover disabled tool omitted, enabled read included, write omitted from phase 2 execution until phase 3 wrapper exists, exact native name/description/schema, project instruction appended after the server description, fingerprint recheck, multiple connections with namespaced stable tool IDs, and no provider branching.

- [ ] **Step 2: Implement generic AI SDK tool construction**

For each enabled current catalog entry, build one dynamic AI SDK tool from its native JSON Schema. Use a stable model-facing key derived from connection ID/tool name while preserving exact native name in execution metadata. The executor calls `MavenIntegrationAgent.callTool` by typed RPC.

- [ ] **Step 3: Keep raw results private while allowing model access**

Return native MCP results to the model execution context unchanged. The sidechat client projection must replace tool input/output UI parts with a bounded activity part containing connection label, tool display name, state, and safe error code only.

Plant unique argument/result sentinels and assert they do not appear in serialized WebSocket/UI frames, visible sidechat messages, D1, public `messages`, or captured logs.

- [ ] **Step 4: Restrict active tools per turn**

`beforeTurn().activeTools` includes only `presentReplyDraft` plus enabled tools whose current fingerprints still match settings. Keep `workspaceBash=false` and `sendReasoning=false`.

- [ ] **Step 5: Verify and commit**

```bash
bun test worker/agents/sidechat-mcp-tools.test.ts worker/agents/sidechat-runtime.test.ts
bun run build
bun run lint
git add worker/agents/sidechat-mcp-tools.ts worker/agents/sidechat-mcp-tools.test.ts worker/agents/maven-sidechat-agent.ts worker/agents/sidechat-runtime.ts worker/agents/sidechat-runtime.test.ts
git commit -m "feat: expose configured MCP tools to sidechat"
```

---

### Task 9: Add the Connections tab using existing settings primitives

**Files:**
- Modify: `src/pages/QuickActions.tsx`
- Create: `src/components/connections/ConnectionsPanel.tsx`
- Create: `src/components/connections/ConnectionPicker.tsx`
- Create: `src/components/connections/ConnectionRow.tsx`
- Create: `src/components/connections/ConnectionDialog.tsx`
- Create: `src/components/connections/NativeToolRow.tsx`
- Create: `src/components/connections/connections-ui.test.ts`
- Modify: `src/pages/McpConnections.tsx`

- [ ] **Step 1: Write failing navigation/copy tests**

Exact project tabs:

```text
Actions | Tools | Connections
```

Assert no `Agent actions` tab, provider action list, marketplace grid, sparkle icon, raw schema/result, or credential echo. Settings > MCP copy must state it is for external clients connecting to ReplyMaven.

- [ ] **Step 2: Add compact preset selection**

Use the existing page shell, segment control, shadcn Dialog, Button, Input, Label, Select, and Switch. Presets render as compact selectable rows using `/integrations/{provider}.svg`, provider name, and short connection copy. Selecting one fills URL/auth fields. `Custom` leaves them editable. Do not add large provider cards or provider-specific form components.

- [ ] **Step 3: Add the generic connection dialog**

Fields:

- display name;
- MCP URL;
- auth mode;
- Slack/generic confidential OAuth client ID and secret when selected;
- bearer token when selected for Custom.

Sensitive inputs are write-only and clear after submission. OAuth progress appears as local description text, not an alert card.

- [ ] **Step 4: Add connection rows and native tool settings**

Each connection row shows preset icon/name, display name, status, last checked, and compact overflow actions. Expanded/detail content lists discovered native tools directly. Each `NativeToolRow` has:

- native tool name and server description;
- enabled switch;
- Read/Write select;
- write approval select (`Ask every time` / `Always allow`);
- optional project instruction;
- schema-changed description with only the critical sentence bold.

Do not rename native tools into ReplyMaven actions.

- [ ] **Step 5: Cover UI states**

Loading, no connections, preset selected, custom form, OAuth pending, connected, degraded, empty catalog, tool disabled, tool configured, schema changed, reconnecting, and disconnect confirmation preserve the same page geometry. Errors remain local to the row/dialog.

- [ ] **Step 6: Verify and commit**

```bash
bun test src/components/connections/connections-ui.test.ts
bun run build
bun run lint
git add src/pages/QuickActions.tsx src/components/connections/ConnectionsPanel.tsx src/components/connections/ConnectionPicker.tsx src/components/connections/ConnectionRow.tsx src/components/connections/ConnectionDialog.tsx src/components/connections/NativeToolRow.tsx src/components/connections/connections-ui.test.ts src/pages/McpConnections.tsx
git commit -m "feat: configure MCP connections from presets"
```

---

### Task 10: Enforce integration lifecycle and privacy-safe observability

**Files:**
- Create: `worker/services/mcp-retention-service.ts`
- Create: `worker/services/mcp-retention-service.test.ts`
- Modify: `worker/services/project-service.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Cover connection/project deletion, credential removal, OAuth-state removal, agent destruction, retry after partial cleanup, stale safe-run retention, catalog-body exclusion from D1, and idempotent missing-agent cleanup.

- [ ] **Step 2: Implement cleanup ordering**

Record durable cleanup, mark connection disconnecting, remove MCP registration/credentials and agent SQLite, delete tool settings, then delete connection metadata. Project deletion repeats this per connection before D1 cascade.

- [ ] **Step 3: Add log/trace allowlist tests**

Only event name, project/connection/conversation IDs, native tool name, status, safe error code, duration, approval mode/actor ID, and hashes may be logged. Plant sentinels in OAuth fields, customer identity, tool arguments, and raw results; assert zero captured occurrences. Keep Workers traces disabled.

- [ ] **Step 4: Verify and commit**

```bash
bun test worker/services/mcp-retention-service.test.ts
bun test
bun run build
bun run lint
git diff --check
git add worker/services/mcp-retention-service.ts worker/services/mcp-retention-service.test.ts worker/services/project-service.ts worker/index.ts
git commit -m "feat: enforce MCP connection lifecycle"
```

---

### Task 11: Run generic MCP and visual acceptance

**Files:**
- Modify only phase-2 files when a measured defect is found
- Create: `docs/superpowers/verification/2026-08-08-mcp-connection-presets.md`

- [ ] **Step 1: Exercise every preset through one generic fixture**

Use a disposable Streamable HTTP MCP test server with read and write tools. Resolve each preset form, then override only the test URL in development. Prove every preset takes the identical connection/catalog/call code path and that Custom uses the same path.

- [ ] **Step 2: Verify actual provider connection setup**

Against non-production/sandbox accounts where available, verify endpoint discovery/OAuth only for PostHog, Stripe, Slack, Attio, and Linear. Do not add provider code if a provider changes its auth flow; update inert preset metadata/setup copy or use Custom.

- [ ] **Step 3: Run disclosure sentinel tests**

Put unique sentinels into MCP arguments/results. Prove the model can consume the result to answer a bounded private question while sentinels do not appear in browser frames, visible sidechat prose, reply draft, D1, logs, public transcript, widget, or Telegram.

- [ ] **Step 4: Capture the Connections UI matrix**

At `1440x1000`, `1100x900`, `768x900`, and `390x844`, capture loading, empty, picker, OAuth, connected, degraded, native tools, schema-changed, and long-description states in light/dark mode and 200% zoom. Compare page width, typography, radii, shadows, row height, controls, focus rings, icon size, and spacing against existing Actions/Tools.

- [ ] **Step 5: Final verification**

```bash
bun test
bun run build
bun run lint
git diff --check
rg -n "billing_summary|refund_payment|post_internal_message|attio\.record|linear\.issues|provider-profiles|canonicalAction" worker src shared
```

Expected: test/build/lint match baseline, no whitespace errors, and the provider-specific search returns zero new feature hits.

- [ ] **Step 6: Commit verification-only fixes and evidence**

Stage the verification document and only exact files changed to fix measured defects, inspect `git diff --cached --name-only`, then commit:

```bash
git commit -m "fix: verify generic MCP connection presets"
```

Do not deploy, run remote migrations, connect production accounts, push, or enable production tools without explicit user approval.
