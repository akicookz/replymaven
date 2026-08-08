# Generic MCP Connections and Presets Implementation Plan

> **Required skill:** Execute with `superpowers:test-driven-development`; use `superpowers:verification-before-completion` before calling the phase complete.

**Goal:** Let a project connect Streamable HTTP MCP servers from simple PostHog, Stripe, Slack, Attio, Linear, or Custom presets, review native tools, and expose enabled read tools to Maven sidechat through one generic path.

**Architecture:** Use the repository's existing `@modelcontextprotocol/sdk` from a Worker `McpConnectionService`. Persist project-scoped connection/catalog/tool settings and AES-GCM-encrypted auth/OAuth material in D1. Presets only prefill the connection form. Native tools are discovered and executed generically; there are no provider actions, profiles, reducers, mappings, or provider-specific branches.

**Dependency:** Phase 1 internal sidechat channel is complete. Do not add a new Durable Object or chat runtime.

**Design source:** `docs/superpowers/specs/2026-08-07-private-sidechat-mcp-actions-design.md`

## Non-negotiable invariants

- One generic transport/catalog/call implementation serves all presets and Custom.
- A preset contains only display/setup metadata and never changes runtime behavior.
- Every discovered native tool is disabled until an owner/admin reviews it.
- Tool settings bind to exact connection ID, native tool name, and input-schema fingerprint.
- Catalog/schema drift disables the tool until reviewed.
- Trusted identity comes from the linked canonical customer: external ID first, normalized email fallback.
- Native tool inputs/results may reach the private LLM turn but never browser events, message rows, public transcripts, Telegram, logs, traces, or safe activity records.
- Phase 2 executes only tools configured as `read`. Configured `write` tools remain unavailable until phase 3.
- Do not add `MavenIntegrationAgent`, provider enums that affect execution, canonical actions, schema mappings, or reducers.

---

## Task 1: Define inert preset and generic MCP contracts

**Files:**

- Create: `shared/mcp-presets.ts`
- Create: `shared/mcp-presets.test.ts`
- Create: `shared/mcp-types.ts`

### Step 1: Write failing preset tests

Define expected presets:

| ID | Label | URL |
|---|---|---|
| `posthog` | PostHog | `https://mcp.posthog.com/mcp` |
| `stripe` | Stripe | `https://mcp.stripe.com` |
| `slack` | Slack | `https://mcp.slack.com/mcp` |
| `attio` | Attio | `https://mcp.attio.com/mcp` |
| `linear` | Linear | `https://mcp.linear.app/mcp` |

Assert HTTPS URLs, unique IDs, valid existing icon/docs paths, and absence of keys matching `action`, `tool`, `profile`, `reducer`, `mapping`, `prompt`, `identity`, `schema`, or `parameter`.

Custom is a picker choice, not a stored preset object.

### Step 2: Define transport-neutral types

Types cover:

- safe connection summary;
- auth mode (`oauth | bearer | headers | none`);
- safe catalog entry (native name, description, input schema, annotations, fingerprint);
- per-tool setting (`enabled`, `read | write`, optional bounded instructions, approval mode);
- generic call request/result used only inside Worker scope; and
- normalized transport errors without payloads.

Do not add provider unions beyond nullable `presetId`.

### Step 3: Verify

```bash
bun test shared/mcp-presets.test.ts
rg -n "billing_summary|refund_payment|post_internal|add_note|create_issue|canonical|reducer" shared/mcp-*.ts
```

Expected grep: no matches.

### Step 4: Commit

```bash
git add shared/mcp-presets.ts shared/mcp-presets.test.ts shared/mcp-types.ts
git commit -m "feat: define inert MCP connection presets"
```

---

## Task 2: Add project-scoped MCP connection and tool-setting storage

**Files:**

- Modify: `worker/db/schema.ts`
- Create: generated migration under `worker/db/drizzle/`
- Create: `worker/db/mcp-connection-schema.test.ts`

### Step 1: Write failing schema tests

Add tables:

### `mcp_connections`

- project ID;
- nullable preset ID;
- display name;
- server URL;
- auth mode;
- encrypted auth material;
- encrypted OAuth client/tokens/state as needed by the SDK provider;
- connection state;
- catalog fingerprint and encrypted/safe cached catalog strategy;
- last checked/connected timestamp;
- bounded safe error code;
- timestamps.

### `mcp_tool_settings`

- connection/project IDs;
- native tool name;
- input-schema fingerprint;
- enabled;
- access `read | write`;
- bounded optional instructions;
- write approval mode;
- reviewed by/at;
- timestamps;
- unique exact setting scope.

### `mcp_action_runs`

- safe audit only: project, conversation, connection, native tool name, access, status, approval actor/mode, duration, schema fingerprint, safe summary/error code, timestamps.

Tests must prove:

- project cascade cleanup;
- arbitrary Custom HTTPS server support;
- exact setting uniqueness;
- disabled-by-default behavior;
- instruction length bounds at validation/service layer; and
- no plaintext credential, raw arguments, or raw result column.

### Step 2: Implement and generate migration

Reuse `worker/services/encryption-service.ts` for AES-GCM. Never return encrypted blobs from API serializers.

```bash
bun run db:generate
bun run db:migrate:dev
bun test worker/db/mcp-connection-schema.test.ts
```

### Step 3: Commit

```bash
git add worker/db/schema.ts worker/db/drizzle worker/db/mcp-connection-schema.test.ts
git commit -m "feat: persist generic MCP connection settings"
```

---

## Task 3: Implement one Worker MCP client service

**Files:**

- Create: `worker/services/mcp-connection-service.ts`
- Create: `worker/services/mcp-connection-service.test.ts`
- Create: `worker/mcp-client/create-mcp-client.ts`
- Create: `worker/mcp-client/oauth-provider.ts`
- Create: `worker/mcp-client/schema-fingerprint.ts`
- Create: matching tests under `worker/mcp-client/`
- Reuse: `worker/services/encryption-service.ts`

### Step 1: Build a fake Streamable HTTP MCP server fixture

The fixture exposes:

- one read tool;
- one write tool;
- JSON Schema inputs;
- annotations;
- controllable OAuth/bearer behavior;
- schema drift;
- large/sensitive results; and
- timeout/ambiguous transport failures.

Use it for every preset and Custom; do not mock separate provider behavior.

### Step 2: Write failing service tests

Cover:

- SSRF-safe HTTPS URL validation and redirect revalidation;
- connect/initialize/listTools/callTool/close with `@modelcontextprotocol/sdk`;
- OAuth state/PKCE/replay/expiry and encrypted token refresh;
- bearer/header decryption only inside call scope;
- catalog fingerprint stability;
- catalog drift disabling affected settings;
- connection/project scoping;
- deadline and response-size limits;
- transport errors reduced to safe codes; and
- raw arguments/results absent from logs and returned API DTOs.

### Step 3: Implement the generic client lifecycle

For discovery or a sidechat turn:

1. load and authorize the project connection;
2. decrypt auth material in memory;
3. construct `Client` + `StreamableHTTPClientTransport`;
4. connect and perform the bounded operation;
5. close in `finally`;
6. clear references to decrypted data; and
7. persist only safe connection/catalog/run metadata.

Reuse one connected client for multiple tool calls within a single sidechat turn. Do not introduce a long-lived global client or isolate-global customer state.

### Step 4: Prove presets are runtime-inert

Resolve each preset form to the fake server in test mode and run the same discovery/call. After URL/auth resolution, captured SDK operations must be equivalent for every preset and Custom.

### Step 5: Verify

```bash
bun test worker/services/mcp-connection-service.test.ts worker/mcp-client
bun run lint
bun run build
```

### Step 6: Commit

```bash
git add worker/services/mcp-connection-service.ts worker/services/mcp-connection-service.test.ts worker/mcp-client
git commit -m "feat: consume MCP servers through one Worker service"
```

---

## Task 4: Add authenticated connection, OAuth, catalog, and tool-setting APIs

**Files:**

- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`
- Modify: `worker/index.ts`
- Create: `worker/routes/mcp-connection-handlers.ts`
- Create: `worker/routes/mcp-connection-handlers.test.ts`

### Step 1: Write failing route tests

Cover:

- unauthenticated `401`;
- cross-project `404`;
- owner/admin mutation and member read behavior according to existing project access helpers;
- safe list/detail serialization with no secrets;
- preset ID validation without trusting its URL;
- Custom HTTPS URL validation;
- OAuth start/callback state and replay rejection;
- connect/reconnect/disconnect;
- catalog refresh;
- tool setting update bound to current fingerprint;
- write tool cannot become executable before phase 3; and
- stale settings return `needs_review`.

### Step 2: Add routes before SPA fallback

Suggested routes:

```text
GET    /api/projects/:id/mcp-connections
POST   /api/projects/:id/mcp-connections
GET    /api/projects/:id/mcp-connections/:connectionId
PATCH  /api/projects/:id/mcp-connections/:connectionId
DELETE /api/projects/:id/mcp-connections/:connectionId
POST   /api/projects/:id/mcp-connections/:connectionId/connect
POST   /api/projects/:id/mcp-connections/:connectionId/refresh
PATCH  /api/projects/:id/mcp-connections/:connectionId/tools/:toolName
GET    /api/mcp-client/oauth/:connectionId/callback
```

OAuth callback state must bind project, connection, initiating user, redirect origin, expiry, and nonce. Never accept a project/connection reassignment from callback query data.

### Step 3: Serialize safe DTOs explicitly

Return preset/display metadata, connection state, catalog fingerprint, safe native schemas/annotations, tool settings, and safe errors. Do not spread database rows into JSON.

### Step 4: Verify

```bash
bun test worker/routes/mcp-connection-handlers.test.ts worker/validation.test.ts
```

### Step 5: Commit

```bash
git add worker/validation.ts worker/validation.test.ts worker/index.ts worker/routes/mcp-connection-handlers.ts worker/routes/mcp-connection-handlers.test.ts
git commit -m "feat: manage project MCP connections"
```

---

## Task 5: Expose configured native read tools to the existing sidechat runtime

**Files:**

- Create: `worker/chat-runtime/sidechat/build-mcp-tools.ts`
- Create: `worker/chat-runtime/sidechat/build-mcp-tools.test.ts`
- Modify: `worker/chat-runtime/sidechat/build-sidechat-context.ts`
- Modify: `worker/chat-runtime/sidechat/build-sidechat-prompt.ts`
- Modify: `worker/chat-runtime/sidechat/run-sidechat-turn.ts`

### Step 1: Write failing dynamic-tool tests

Assert:

- only enabled, current-fingerprint, `read` tools appear;
- write tools do not appear in phase 2;
- model-facing keys are stable and collision-safe while native names remain exact internally;
- native JSON Schema is passed without provider transformation;
- per-tool instructions are bounded and clearly untrusted project configuration, never system override text;
- trusted external ID and email are supplied to context, not injected into arbitrary parameters;
- system prompt says external ID first, email fallback;
- raw call arguments/results reach only the in-memory model tool loop; and
- sentinels do not enter message content/metadata, WebSocket events, public replies, D1 run rows, or captured logs.

### Step 2: Build AI SDK tools generically

For every eligible setting, create one AI SDK tool from native schema. The executor calls `McpConnectionService.callTool` with exact connection/tool/arguments.

Do not add switch statements for PostHog, Stripe, Slack, Attio, or Linear.

### Step 3: Make the model summarize, never dump

The sidechat prompt must say:

- answer the human's task rather than reproducing records;
- never paste raw MCP output, internal IDs, internal links, hidden metadata, or unnecessary personal data;
- state uncertainty when a tool fails; and
- keep `reply_draft` limited to facts appropriate for the visitor.

Persist only the final safe Maven message and optional structured draft.

### Step 4: Verify

```bash
bun test worker/chat-runtime/sidechat/build-mcp-tools.test.ts worker/chat-runtime/sidechat
```

### Step 5: Commit

```bash
git add worker/chat-runtime/sidechat
git commit -m "feat: give sidechat configured MCP read tools"
```

---

## Task 6: Add the Connections UI using existing project settings patterns

**Files:**

- Modify: `src/pages/QuickActions.tsx`
- Create: `src/components/integrations/McpConnectionsPanel.tsx`
- Create: `src/components/integrations/McpConnectionDialog.tsx`
- Create: `src/components/integrations/McpConnectionRow.tsx`
- Create: `src/components/integrations/McpToolRow.tsx`
- Create: `src/lib/mcp-connections.ts`
- Create: `src/lib/mcp-connections.test.ts`

### Step 1: Implement API/cache helpers first

Add typed TanStack Query keys and safe DTO parsing for list/detail/create/update/delete/connect/refresh/tool settings.

### Step 2: Add compact preset selection

The picker uses compact rows for PostHog, Stripe, Slack, Attio, Linear, and Custom. Selecting a preset fills label/URL/setup copy only. Custom exposes editable URL/auth fields.

Do not render cards for provider actions because presets do not define actions.

### Step 3: Render the native catalog directly

Each tool row shows:

- native name and description;
- enabled control;
- read/write classification;
- optional instructions;
- approval setting disabled/explained for writes until phase 3;
- `needs review` state on drift.

Reuse existing typography, muted surfaces, compact buttons, controls, dialogs, and spacing. No sparkle, marketplace aesthetic, separator rules, or provider-specific copy beyond preset setup.

### Step 4: Cover UI states

Loading, empty, preset selected, Custom, OAuth pending, connected, degraded, empty catalog, tool disabled, read enabled, write pending phase 3, schema changed, reconnecting, and disconnect confirmation.

### Step 5: Verify

```bash
bun test src/lib/mcp-connections.test.ts
bun run lint
bun run build
```

### Step 6: Commit

```bash
git add src
git commit -m "feat: configure generic MCP connections from presets"
```

---

## Task 7: Phase acceptance and provider smoke checks

**Files:**

- Create: `docs/superpowers/verification/2026-08-08-generic-mcp-connections.md`

### Step 1: Automated verification

```bash
bun test
bun run lint
bun run build
```

### Step 2: Generic path proof

Use the fake server to show all presets and Custom take the identical validation, client, discovery, fingerprint, configuration, and call paths.

### Step 3: Leakage proof

Plant unique argument/result/token sentinels and inspect:

- both message channels;
- all dashboard/visitor WebSocket frames;
- public API responses;
- Telegram/email fixtures;
- `mcp_action_runs`;
- captured application logs/errors; and
- built client payloads.

Only the private in-memory tool loop may contain argument/result sentinels. No token sentinel may leave the service call scope.

### Step 4: Provider endpoint smoke checks

Against non-production accounts where available, verify only endpoint discovery/auth for PostHog, Stripe, Slack, Attio, and Linear. If a provider changes setup, update preset URL/docs/copy—not runtime code.

### Step 5: Visual QA

Check the Connections tab at 1440, 1100, 768, and 390 widths; keyboard navigation; 200% zoom; dark mode; and reduced motion.

### Step 6: Architecture grep

```bash
rg -n "MavenIntegrationAgent|providerProfile|canonicalAction|reducerVersion|billing_summary|refund_payment|post_internal_message|attio\.add|linear\.create" src worker shared wrangler.jsonc
```

Expected: no matches introduced by this phase.

### Step 7: Commit verification fixes

Stage only files changed by this phase, then:

```bash
git commit -m "fix: complete generic MCP connection acceptance"
```

Do not deploy or connect production provider accounts without separate user approval.
