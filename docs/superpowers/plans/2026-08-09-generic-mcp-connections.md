# Generic MCP Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project connect any supported Streamable HTTP MCP server, discover its native tools, configure each tool as read or write, and expose enabled reads to Maven's existing sidechat loop without provider-specific actions or data models.

**Architecture:** ReplyMaven uses the installed `@modelcontextprotocol/sdk` directly from ordinary Worker requests. D1 stores project-scoped connection/catalog settings and AES-GCM-encrypted auth state; no integration Agent or Durable Object is added. PostHog, Stripe, Slack, Attio, and Linear are label-and-URL presets only. Native tool schemas enter the shared Maven registry through a generic adapter and are hard-coded sidechat-only.

**Tech Stack:** Cloudflare Workers, Hono, Drizzle/D1, `@modelcontextprotocol/sdk` 1.29 (`Client`, `StreamableHTTPClientTransport`, `OAuthClientProvider`), AI SDK v6 tools, Web Crypto, React 19, TanStack Query, Bun tests.

## Global Constraints

- Complete the unified Maven loop and sidechat plans first.
- Do not add provider-specific actions, schemas, mappings, reducers, query builders, result summaries, or customer-field configuration.
- Presets contain exactly an ID, display label, and official MCP URL. Custom connections add a user-supplied URL.
- OAuth servers with dynamic client registration use the standard SDK flow. Slack does not support dynamic client registration, so its preset uses one ReplyMaven-owned confidential OAuth app configured as Worker secrets; the preset remains URL-only in project UI.
- A custom OAuth server that lacks dynamic client registration is out of scope for v1 unless it can use encrypted headers instead.
- Use only MCP Streamable HTTP in v1. Do not support local stdio servers in Workers.
- MCP tools are always sidechat-only. No database/API/UI option can make them public.
- Discovery never enables a tool automatically. Owner/admin reviews its native description/schema, labels it read/write, and enables it.
- This plan executes only tools labeled `read`. Writes fail closed until the approval plan is complete.
- Native arguments/results may reach the LLM transiently, but never the browser, public transcript, D1 payload columns, logs, traces, or analytics.
- Use the linked customer external ID first and normalized email only as fallback. Never infer canonical identity from visitor text.
- OAuth tokens, client information/secrets, PKCE verifier, and custom headers are encrypted with the existing `ENCRYPTION_KEY`.
- Validate the initial URL and every redirect against HTTPS/private-network/metadata-service rules.
- Use function declarations for named functions/components and Bun for commands.
- Commit steps are checkpoints; do not deploy.

## File Map

| File | Change |
|---|---|
| `worker/db/schema.ts` | Add outbound project MCP connection/catalog/run tables |
| `worker/db/drizzle/0064_project_mcp_connections.sql` | Create project-scoped MCP tables |
| `worker/db/project-mcp-schema.test.ts` | **Create** schema/migration/security assertions |
| `worker/validation.ts` | Add connection, OAuth callback, catalog-setting schemas |
| `worker/validation.test.ts` | MCP validation tests |
| `worker/types.ts` | Optional platform Slack MCP OAuth client secrets |
| `worker/security/outbound-url.ts` | **Create** shared SSRF-safe URL/fetch helpers |
| `worker/security/outbound-url.test.ts` | **Create** URL/redirect tests |
| `worker/chat-runtime/tools/http-tool-executor.ts` | Reuse shared outbound URL helper |
| `worker/services/project-mcp-service.ts` | **Create** connection/catalog/auth/run persistence |
| `worker/services/project-mcp-service.test.ts` | **Create** project scoping/encryption/catalog tests |
| `worker/mcp-client/presets.ts` | **Create** inert preset constants |
| `worker/mcp-client/presets.test.ts` | **Create** exact URL/no-provider-logic tests |
| `worker/mcp-client/oauth-provider.ts` | **Create** D1-backed SDK `OAuthClientProvider` |
| `worker/mcp-client/oauth-provider.test.ts` | **Create** state/PKCE/token encryption tests |
| `worker/mcp-client/client.ts` | **Create** transient SDK client factory and catalog/call helpers |
| `worker/mcp-client/client.test.ts` | **Create** connect/discover/call/close/result-boundary tests |
| `worker/mcp-client/tool-adapter.ts` | **Create** native MCP catalog to `MavenToolDefinition` adapter |
| `worker/mcp-client/tool-adapter.test.ts` | **Create** audience/read/recheck/collision tests |
| `worker/chat-runtime/context/resolve-private-customer-context.ts` | **Create** external-ID-first trusted identity context |
| `worker/chat-runtime/context/resolve-private-customer-context.test.ts` | **Create** identity-order/fail-closed tests |
| `worker/chat-runtime/orchestration/run-maven-turn.ts` | Include enabled MCP reads on sidechat turns |
| `worker/chat-runtime/orchestration/run-maven-turn.test.ts` | MCP visibility/privacy tests |
| `worker/chat-runtime/prompt/build-support-system-prompt.ts` | Add private identity and native MCP usage rules |
| `worker/chat-runtime/prompt/build-support-system-prompt.test.ts` | Exact disclosure/identity prompt tests |
| `worker/routes/project-mcp-handlers.ts` | **Create** testable CRUD/connect/callback/catalog handlers |
| `worker/routes/project-mcp-handlers.test.ts` | **Create** auth/role/project-boundary tests |
| `worker/index.ts` | Mount outbound MCP routes before SPA fallback |
| `src/pages/McpProjectConnections.tsx` | **Create** project connection/catalog tab |
| `src/pages/QuickActions.tsx` | Add `Connections` tab to existing Actions & Tools page |
| `src/pages/McpConnections.tsx` | Clarify this account page is ReplyMaven-as-server |

---

### Task 1: Add minimal outbound MCP persistence

**Files:**
- Modify: `worker/db/schema.ts`
- Create: `worker/db/project-mcp-schema.test.ts`
- Generate: `worker/db/drizzle/0064_project_mcp_connections.sql`

**Tables:**

```typescript
projectMcpConnections: {
  id, projectId, preset, displayName, serverUrl,
  authMode: "oauth" | "headers" | "none",
  encryptedAuth, status: "connecting" | "needs_auth" | "connected" | "error" | "disconnected",
  connectionVersion, catalogFingerprint, lastErrorCode,
  lastConnectedAt, createdAt, updatedAt
}

projectMcpOauthSessions: {
  id, projectId, connectionId, actorUserId, stateHash,
  encryptedCodeVerifier, expiresAt, createdAt
}

projectMcpTools: {
  id, connectionId, toolName, modelName, description,
  inputSchema, schemaFingerprint,
  access: "read" | "write", enabled,
  discoveredAt, updatedAt
}

projectMcpRuns: {
  id, connectionId, toolId, conversationId, sidechatRunId,
  status: "success" | "error" | "timeout" | "unknown",
  duration, errorCode, createdAt
}
```

- [ ] **Step 1: Write the failing schema/migration tests**

Assert all foreign keys/cascades, project/connection indexes, unique `(connection_id, tool_name)`, unique `model_name`, no input/output/response/header/token columns in run/tool tables, and encrypted auth columns only on connection/session tables.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/db/project-mcp-schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add Drizzle tables and generate the named migration**

Run: `bun run db:generate --name project_mcp_connections`.

Use `crypto.randomUUID()` IDs, timestamp conventions from `AGENTS.md`, cascade project/connection deletes, and `set null` for deleted conversations on safe run metadata.

- [ ] **Step 4: Run the schema test**

Run: `bun test worker/db/project-mcp-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the checkpoint**

```bash
git add worker/db/schema.ts worker/db/drizzle worker/db/project-mcp-schema.test.ts
git commit -m "feat: add project MCP persistence"
```

### Task 2: Share a strict outbound URL boundary

**Files:**
- Create: `worker/security/outbound-url.ts`
- Create: `worker/security/outbound-url.test.ts`
- Modify: `worker/chat-runtime/tools/http-tool-executor.ts`

**Interfaces:**

```typescript
export function assertSafeOutboundHttpsUrl(raw: string): URL;

export async function safeOutboundFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response>;
```

- [ ] **Step 1: Write failing URL and redirect tests**

Reject non-HTTPS, credentials in URLs, localhost, loopback, RFC1918, link-local, IPv6 local ranges, integer/hex IP aliases, `*.internal`, Cloudflare metadata targets, and URLs over 2,048 characters. Test a safe public URL and a safe request. Mock a redirect to a private target and require rejection.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/security/outbound-url.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement validation and manual redirect handling**

`safeOutboundFetch` sets `redirect: "manual"`, validates each `Location`, permits at most three redirects, preserves abort signals, and strips `Authorization`, `Cookie`, and custom credential headers when origin changes.

- [ ] **Step 4: Make existing HTTP tools use the shared helper**

Delete duplicate blocked-host logic from `http-tool-executor.ts`. Preserve its current timeout/mapping behavior and tests.

- [ ] **Step 5: Run tests**

Run: `bun test worker/security/outbound-url.test.ts worker/chat-runtime/tools`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/security worker/chat-runtime/tools/http-tool-executor.ts
git commit -m "refactor: share outbound request security"
```

### Task 3: Add inert presets and project-scoped connection persistence

**Files:**
- Create: `worker/mcp-client/presets.ts`
- Create: `worker/mcp-client/presets.test.ts`
- Create: `worker/services/project-mcp-service.ts`
- Create: `worker/services/project-mcp-service.test.ts`

**Preset contract:**

```typescript
export interface McpPreset {
  id: "posthog" | "stripe" | "slack" | "attio" | "linear";
  label: string;
  serverUrl: string;
}

export const MCP_PRESETS: readonly McpPreset[] = [
  { id: "posthog", label: "PostHog", serverUrl: "https://mcp.posthog.com/mcp" },
  { id: "stripe", label: "Stripe", serverUrl: "https://mcp.stripe.com" },
  { id: "slack", label: "Slack", serverUrl: "https://mcp.slack.com/mcp" },
  { id: "attio", label: "Attio", serverUrl: "https://mcp.attio.com/mcp" },
  { id: "linear", label: "Linear", serverUrl: "https://mcp.linear.app/mcp" },
] as const;
```

Verify these endpoints against first-party documentation before implementation: [PostHog](https://posthog.com/docs/model-context-protocol), [Stripe](https://docs.stripe.com/mcp), [Slack](https://docs.slack.dev/ai/slack-mcp-server/), [Attio](https://docs.attio.com/mcp/overview), and [Linear](https://linear.app/docs/mcp).

- [ ] **Step 1: Write failing preset/service tests**

Assert preset objects contain only `id`, `label`, and `serverUrl`; no actions or schemas. Cover project-scoped CRUD, encrypted auth round-trip, no plaintext secret in stored row, expired OAuth-session consumption, catalog replacement transaction, disconnected connection exclusion, and run metadata without payloads.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/mcp-client/presets.test.ts worker/services/project-mcp-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `ProjectMcpService`**

Required methods:

```typescript
listConnections(projectId: string): Promise<ProjectMcpConnection[]>;
createConnection(input: CreateProjectMcpConnection): Promise<ProjectMcpConnection>;
getConnection(projectId: string, connectionId: string): Promise<ProjectMcpConnection | null>;
saveEncryptedAuth(projectId: string, connectionId: string, encryptedAuth: string): Promise<void>;
createOauthSession(input: NewMcpOauthSession): Promise<McpOauthSession>;
consumeOauthSessionByState(actorUserId: string, state: string, now: Date): Promise<McpOauthSession | null>;
replaceCatalog(connectionId: string, tools: DiscoveredMcpTool[], fingerprint: string): Promise<void>;
listEnabledReadTools(projectId: string): Promise<ProjectMcpTool[]>;
getAuthoritativeTool(projectId: string, toolId: string): Promise<ProjectMcpToolWithConnection | null>;
disconnect(projectId: string, connectionId: string): Promise<boolean>;
logSafeRun(input: SafeMcpRunInput): Promise<void>;
```

Catalog refresh preserves enabled/access only when the same tool name and schema fingerprint remain; changed schemas disable the row for review.

- [ ] **Step 4: Run tests**

Run: `bun test worker/mcp-client/presets.test.ts worker/services/project-mcp-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the checkpoint**

```bash
git add worker/mcp-client/presets.ts worker/mcp-client/presets.test.ts worker/services/project-mcp-service.ts worker/services/project-mcp-service.test.ts
git commit -m "feat: persist generic MCP connections"
```

### Task 4: Implement SDK OAuth and transient MCP clients

**Files:**
- Create: `worker/mcp-client/oauth-provider.ts`
- Create: `worker/mcp-client/oauth-provider.test.ts`
- Create: `worker/mcp-client/client.ts`
- Create: `worker/mcp-client/client.test.ts`

**Interfaces:**

```typescript
export class ProjectMcpOAuthProvider implements OAuthClientProvider {
  get redirectUrl(): URL;
  get clientMetadata(): OAuthClientMetadata;
  state(): Promise<string>;
  clientInformation(): Promise<OAuthClientInformationMixed | undefined>;
  saveClientInformation(value: OAuthClientInformationMixed): Promise<void>;
  tokens(): Promise<OAuthTokens | undefined>;
  saveTokens(value: OAuthTokens): Promise<void>;
  redirectToAuthorization(url: URL): never;
  saveCodeVerifier(value: string): Promise<void>;
  codeVerifier(): Promise<string>;
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void>;
}

export async function withProjectMcpClient<T>(options: ProjectMcpClientOptions, run: (client: Client) => Promise<T>): Promise<T>;
export async function discoverProjectMcpTools(options: ProjectMcpClientOptions): Promise<DiscoveredMcpTool[]>;
export async function callProjectMcpTool(options: ProjectMcpCallOptions): Promise<unknown>;
```

- [ ] **Step 1: Write failing OAuth/client tests**

Use a fake Streamable HTTP transport/fetch. Cover initial 401 authorization redirect, state and PKCE persistence, callback code exchange, token refresh save, credential invalidation, dynamic client registration save, bearer/custom header mode, `client.close()` in success/error cases, paginated `listTools`, 30-second call timeout, and 64-KiB model-result cap with an explicit truncation marker. Add a Slack case that returns static confidential client information and never attempts dynamic registration.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/mcp-client/oauth-provider.test.ts worker/mcp-client/client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the OAuth provider against encrypted service state**

Throw a typed `McpAuthorizationRequired` from `redirectToAuthorization`; handlers catch it and return the URL. `state()` returns a random value whose SHA-256 hash is persisted. Never log URL query strings because authorization codes may be present.

Use one fixed redirect URL, `${origin}/api/mcp-client/oauth/callback`, so confidential OAuth providers can register it once. Add optional `MCP_SLACK_CLIENT_ID` and `MCP_SLACK_CLIENT_SECRET` to `AppEnv`; load them only when the authoritative connection preset is `slack`. `clientInformation()` returns the static Slack client there and the persisted dynamically registered client everywhere else. Never write the Slack client secret to D1.

- [ ] **Step 4: Implement the transient client helper**

Use:

```typescript
const client = new Client({ name: "replymaven", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(serverUrl, {
  authProvider,
  fetch: safeOutboundFetch,
  requestInit: { headers: decryptedHeaders },
});
await client.connect(transport);
try {
  return await run(client);
} finally {
  await transport.close().catch(() => undefined);
}
```

Do not keep clients in module-global state. `callProjectMcpTool` returns the native result to the in-process model adapter but never logs or persists it.

- [ ] **Step 5: Run tests**

Run: `bun test worker/mcp-client/oauth-provider.test.ts worker/mcp-client/client.test.ts worker/security/outbound-url.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/mcp-client worker/security
git commit -m "feat: connect to Streamable HTTP MCP servers"
```

### Task 5: Add authenticated connection and catalog routes

**Files:**
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`
- Create: `worker/routes/project-mcp-handlers.ts`
- Create: `worker/routes/project-mcp-handlers.test.ts`
- Modify: `worker/index.ts`

**Routes:**

```text
GET    /api/projects/:id/mcp-connections
POST   /api/projects/:id/mcp-connections
POST   /api/projects/:id/mcp-connections/:connectionId/connect
GET    /api/mcp-client/oauth/callback
POST   /api/projects/:id/mcp-connections/:connectionId/refresh
PATCH  /api/projects/:id/mcp-connections/:connectionId/tools/:toolId
DELETE /api/projects/:id/mcp-connections/:connectionId
```

- [ ] **Step 1: Write failing handler tests**

Cover project owner/admin mutations, read access for project members, member mutation denial, cross-project 404, preset URL server ownership, custom HTTPS validation, encrypted header input, OAuth redirect result, fixed callback state/actor/expiry validation, Slack preset unavailable when platform secrets are missing, Slack static-client success when configured, catalog discovery, changed schema disabling, write tool retained but not executable, and disconnect cleanup.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/routes/project-mcp-handlers.test.ts worker/validation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add exact schemas**

```typescript
const boundedMcpHeadersSchema = z
  .record(z.string().min(1).max(100), z.string().max(2048))
  .refine((headers) => Object.keys(headers).length <= 20, "Maximum 20 headers");

export const createProjectMcpConnectionSchema = z.discriminatedUnion("preset", [
  z.object({
    preset: z.enum(["posthog", "stripe", "slack", "attio", "linear"]),
    authMode: z.enum(["oauth", "headers", "none"]),
    headers: boundedMcpHeadersSchema.optional(),
  }),
  z.object({
    preset: z.literal("custom"),
    displayName: z.string().min(1).max(100),
    serverUrl: safeHttpsUrlSchema,
    authMode: z.enum(["oauth", "headers", "none"]),
    headers: boundedMcpHeadersSchema.optional(),
  }),
]);

export const updateProjectMcpToolSchema = z.object({
  enabled: z.boolean().optional(),
  access: z.enum(["read", "write"]).optional(),
}).refine((value) => Object.keys(value).length > 0);
```

- [ ] **Step 4: Implement handlers and mount before SPA fallback**

Use shared project/effective-owner checks. Owner/admin is required for create/connect/refresh/tool settings/delete. The fixed callback hashes `state`, resolves one unexpired OAuth session, then rechecks the authenticated actor and project access before exchanging the code. Return tool descriptions and input schema, but never encrypted auth. Callback responses redirect to `/app/projects/:id/quick-actions?tab=connections&connection=:id` with a non-secret status code.

- [ ] **Step 5: Run tests**

Run: `bun test worker/routes/project-mcp-handlers.test.ts worker/validation.test.ts worker/services/project-mcp-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/routes/project-mcp-handlers.ts worker/routes/project-mcp-handlers.test.ts worker/index.ts worker/validation.ts worker/validation.test.ts
git commit -m "feat: add project MCP connection API"
```

### Task 6: Adapt enabled native reads into the shared Maven registry

**Files:**
- Create: `worker/mcp-client/tool-adapter.ts`
- Create: `worker/mcp-client/tool-adapter.test.ts`
- Create: `worker/chat-runtime/context/resolve-private-customer-context.ts`
- Create: `worker/chat-runtime/context/resolve-private-customer-context.test.ts`
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.ts`
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.test.ts`
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.ts`
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.test.ts`

**Trusted customer context:**

```typescript
export interface PrivateCustomerContext {
  name: string | null;
  preferredIdentity:
    | { kind: "external_id"; value: string; emailFallback: string | null }
    | { kind: "email"; value: string }
    | null;
}
```

- [ ] **Step 1: Write failing identity and adapter tests**

Assert external ID wins over email, email is normalized, unlinked/missing identity returns null, visitor message content and conversation email snapshot are ignored, model names are collision-safe, public registry always excludes MCP, disabled/write/stale tools are excluded, executor reloads connection/tool/fingerprint immediately before call, and run logs contain no args/results.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/chat-runtime/context/resolve-private-customer-context.test.ts worker/mcp-client/tool-adapter.test.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts`
Expected: FAIL.

- [ ] **Step 3: Resolve only the linked canonical customer**

Look up `conversation.customerId` inside the same project, trim `externalId`, normalize customer email with the existing customer normalization helper, and return null on mismatch/missing link. Do not consult `visitorName`, `visitorEmail`, widget metadata, or message text.

- [ ] **Step 4: Implement the generic native-tool adapter**

Convert stored JSON Schema to an AI SDK-compatible input schema using the SDK/AI SDK's supported JSON-schema adapter. Capability is always:

```typescript
{
  projectId: row.projectId,
  connectionId: row.connectionId,
  source: "mcp",
  allowedChannels: ["sidechat"],
  access: row.access,
  enabled: row.enabled,
  schemaFingerprint: row.schemaFingerprint,
}
```

This phase includes only `access === "read"`. Execute with `callProjectMcpTool`, log safe status/duration/error code, and return the native bounded result directly to the loop.

- [ ] **Step 5: Add exact identity/tool privacy instructions**

The private prompt says the identity is canonical, use external ID first and email only if external ID is absent/not accepted by the native tool, never guess a different identity from conversation text, and never repeat identifiers/raw results to the human or visitor-ready draft.

- [ ] **Step 6: Register MCP reads only for sidechat**

`runMavenTurn` loads MCP definitions only when `context.channel === "sidechat"`. The authoritative executor still rechecks channel so a stale registry cannot bypass it.

- [ ] **Step 7: Run tests**

Run: `bun test worker/chat-runtime/context/resolve-private-customer-context.test.ts worker/mcp-client/tool-adapter.test.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/chat-runtime/prompt/build-support-system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit the checkpoint**

```bash
git add worker/mcp-client/tool-adapter.ts worker/mcp-client/tool-adapter.test.ts worker/chat-runtime
git commit -m "feat: expose native MCP reads to sidechat"
```

### Task 7: Add the compact Connections tab

**Files:**
- Create: `src/pages/McpProjectConnections.tsx`
- Modify: `src/pages/QuickActions.tsx`
- Modify: `src/pages/McpConnections.tsx`

- [ ] **Step 1: Add pure UI-state coverage where logic is non-trivial**

Extract/test preset-to-request conversion, OAuth return-state parsing, tool update payloads, schema-change state copy, and role-based editability in a colocated helper if required.

- [ ] **Step 2: Add `Connections` to the existing segment control**

The tab order is `Actions`, `Tools`, `Connections`. Preserve the current header, typography, segment sizing, query-param routing, and hidden-tab behavior.

- [ ] **Step 3: Build the connection list with current components**

Show a compact `Add connection` action, text-led preset choices, Custom, connection status, native tool rows, enable switch, and Read/Write select. A preset click submits its fixed URL; there are no provider-specific forms or action choices.

Use spacing and muted background contrast, never row separators. Do not add sparkle icons, provider dashboards, canonical actions, mapping UI, or result previews.

- [ ] **Step 4: Handle OAuth and headers**

OAuth opens the returned authorization URL in the current tab. Headers mode accepts bounded key/value pairs and never redisplays secret values; show `Configured` after save. On callback, refetch and focus the connection row.

- [ ] **Step 5: Clarify the inverse account MCP page**

Change its heading/subcopy to state that this page connects external AI clients **to ReplyMaven**. Do not merge account/server connections with project/outbound connections.

- [ ] **Step 6: Run build and visual checks**

Run: `bun run build` and `bun run dev`. Inspect empty, connecting, authorization-return, connected catalog, schema-changed, error, long tool name/schema, member read-only, and mobile states.

- [ ] **Step 7: Commit the checkpoint**

```bash
git add src/pages/McpProjectConnections.tsx src/pages/QuickActions.tsx src/pages/McpConnections.tsx
git commit -m "feat: configure project MCP connections"
```

### Task 8: End-to-end MCP read verification

**Files:**
- Verify: all files in this plan's File Map
- Modify only if a verification failure is caused by this implementation

- [ ] Run `rg -n "posthog|stripe|slack|attio|linear" worker/mcp-client worker/services/project-mcp-service.ts` and confirm matches exist only in `presets.ts`/preset tests, not execution logic.
- [ ] Run `rg -n "allowedChannels.*public|channel.*public" worker/mcp-client worker/routes/project-mcp-handlers.ts` and inspect every match; no MCP path may grant public access.
- [ ] Run `rg -n "input|output|result|headers|tokens" worker/db/schema.ts worker/services/project-mcp-service.ts` and confirm run rows never store payloads and auth values are encrypted.
- [ ] With a test MCP server, verify OAuth/headers/none auth, discovery, enable read, sidechat call, schema refresh disable, reconnect, disconnect, timeout, and provider error.
- [ ] Inspect the dashboard network/WS payloads and Worker logs; raw MCP arguments/results must be absent.
- [ ] Verify a public widget turn cannot see or call any MCP model tool, including a forged tool-call replay test.
- [ ] Run `bun test worker/mcp-client worker/routes/project-mcp-handlers.test.ts worker/services/project-mcp-service.test.ts worker/chat-runtime worker/security worker/validation.test.ts`.
- [ ] Run `bun run build` and `bun run lint`; fix only new failures.
- [ ] Commit verification fixes, if any:

```bash
git add worker src
git commit -m "test: verify generic MCP reads"
```
