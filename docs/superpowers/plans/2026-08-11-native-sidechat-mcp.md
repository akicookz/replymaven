# Native Sidechat and MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dashboard-only, durable human–Maven Sidechat on Cloudflare's native `AIChatAgent` and sub-agent storage, then give it project-owned HTTP and MCP tools with read/write policy, native one-time approval, and project-wide `Always allow`, without changing the public visitor runtime.

**Architecture:** Add one bound `MavenProjectAgent` per project and one facet-only `MavenChatAgent` per support conversation. The child owns its native private transcript and model loop; the parent owns child registration, MCP connection state, current tool policy, persistent grants, and safe audit metadata. Authenticated Hono routes mint short-lived scoped tokens and manage project MCP settings. The dashboard connects directly to the registered child with `useAgent`/`useAgentChat`, adapts native `UIMessage` parts into the existing chat primitives, and keeps the public D1 transcript as the only visitor-facing source of truth.

**Tech Stack:** Bun, TypeScript, React 19, TanStack Query, Hono, Cloudflare Workers, `agents@0.20.x`, `@cloudflare/ai-chat`, `@ai-sdk/react` v3, AI SDK v6, Cloudflare MCP client v2, D1/Drizzle for bounded public context only, native Agent SQLite for private state, Cloudflare Workers Vitest pool, existing Tailwind/shadcn visual system.

## Global Constraints

- The approved source of truth is `docs/superpowers/specs/2026-08-11-native-sidechat-mcp-design.md`. If implementation pressure conflicts with it, stop and amend the design with the user rather than silently changing architecture.
- Keep the existing public widget/Hono/D1/SSE/WebSocket/Telegram/email/delivery/ownership runtime behaviorally unchanged. Do not migrate public chat to Agents.
- Do not create D1 Sidechat messages, runs, leases, revisions, replay cursors, status polling, settlement code, or a private `ConversationDO` channel. Native `AIChatAgent` persistence/recovery is the private runtime.
- Add only one top-level Durable Object binding and Wrangler migration: `MAVEN_PROJECT_AGENT` / `MavenProjectAgent`. Export `MavenChatAgent` from `worker/index.ts`, but do not bind or migrate it.
- Keep the account-level ReplyMaven MCP server in `worker/mcp-server.ts` behaviorally intact. It remains an inbound server; project connections are outbound clients.
- PostHog, Stripe, Slack, Attio, and Linear are URL/auth presentation presets only. Do not add provider actions, identity mappers, schemas, reducers, direct API clients, or provider-specific approval UI.
- Use canonical `customer.externalId`, then canonical normalized email, for external lookup context. Never derive identity from visitor prose or browser metadata.
- Raw MCP/HTTP credentials, headers, inputs, outputs, provider metadata, and reasoning must not be logged, returned by dashboard configuration routes, rendered in either public UI, or written to public D1.
- Read tools do not require approval. Write tools use native AI SDK approval unless an exact current persistent grant exists. Never automatically retry an external write.
- `Add to reply` only replaces/focuses the existing public composer. It never sends. On mobile it must close Sidechat first so the focused textarea is visible. Public image attachments stay mounted and untouched.
- No rollout, feature flag rollout, deployment, push, remote migration, real provider mutation, or production OAuth configuration is part of this plan. Completion means verified locally.
- Use function declarations for named functions/components, strict TypeScript, existing semantic tokens, no separator borders, no sparkle icon, and no new assistant card language.
- Use `apply_patch` for source edits. Run RED before production changes, then GREEN, focused regression, static checks, and the exact task commit.
- Official implementation references reviewed end to end:
  - `https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/`
  - `https://developers.cloudflare.com/agents/communication-channels/chat/client-sdk/`
  - `https://developers.cloudflare.com/agents/runtime/execution/sub-agents/`
  - `https://developers.cloudflare.com/agents/runtime/communication/routing/`
  - `https://developers.cloudflare.com/agents/runtime/operations/cross-domain-authentication/`
  - `https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/`
  - `https://developers.cloudflare.com/agents/model-context-protocol/guides/oauth-mcp-client/`
  - `https://developers.cloudflare.com/agents/model-context-protocol/guides/migrate-to-mcp-sdk-v2/`
  - `https://developers.cloudflare.com/agents/getting-started/testing-your-agent/`

## File Structure

### New shared contracts

- `shared/sidechat-agent.ts` — serializable session, summary, context, tool, policy, audit, and typed data-part contracts shared by Worker and dashboard.

### New Worker Agent/runtime files

- `worker/agents/sidechat/maven-project-agent.ts` — bound parent Agent, native MCP ownership, child registry, parent SQLite policy/audit, execution-time authorization, and cleanup.
- `worker/agents/sidechat/maven-chat-agent.ts` — facet-only `AIChatAgent`, private prompt, native chat loop, dynamic tool construction, completion-only reply-draft persistence.
- `worker/agents/sidechat/agent-auth.ts` — HMAC connection token signing/verification and actor-claim parsing.
- `worker/agents/sidechat/sidechat-context.ts` — bounded D1 public/customer context projection.
- `worker/agents/sidechat/sidechat-prompt.ts` — human-agent private prompt and safe disclosure rules.
- `worker/agents/sidechat/reply-draft-tool.ts` — internal completion-only visitor draft tool/data-part extraction.
- `worker/agents/sidechat/project-tool-proxy.ts` — serializable dynamic-tool descriptors and child-to-parent execution proxy.
- `worker/agents/sidechat/mcp-policy.ts` — annotation classification, name normalization, catalog fingerprints, grants, and approval copy.
- `worker/agents/sidechat/mcp-presets.ts` — five simple endpoint/auth presets and custom URL validation.

### New Worker routes

- `worker/routes/sidechat-agent-handlers.ts` — authenticated session creation and parent/sub-agent routing helpers.
- `worker/routes/project-mcp-handlers.ts` — authenticated project MCP connection/catalog/policy/grant/audit endpoints and OAuth callbacks.

### New dashboard files

- `src/hooks/use-sidechat-agent.ts` — session query, parent/child native Agent connection, `useAgentChat`, accepted-message handshake, native approval calls, and reconnect state.
- `src/lib/inbox/sidechat-message-adapter.ts` — fail-closed `UIMessage` to existing `Message` presentation adapter.
- `src/components/tools/ProjectMcpConnections.tsx` — compact preset/custom connection and discovered-tool policy UI.

### Existing files changed

- `package.json`, `bun.lock`, `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`, `worker-configuration.d.ts` — SDK/test dependencies, local-first dev, and the single parent binding/migration.
- `worker/types.ts`, `worker/index.ts`, `worker/mcp-server.ts` — binding types, route/export wiring, and explicit legacy inbound MCP handler.
- `worker/services/chat-service.ts` — reuse the existing project-scoped conversation and `getRecentPublicMessages(conversationId, 40)` reads; add no Sidechat persistence.
- `worker/chat-runtime/tools/http-tool-executor.ts` — extract a channel-neutral low-level HTTP transport while preserving the existing public ownership wrapper.
- `worker/services/conversation-retention-service.ts`, `worker/services/project-service.ts` or their callers — native child/parent cleanup before public deletion.
- `src/pages/Conversations.tsx`, `src/pages/Tools.tsx` — native Sidechat orchestration and MCP configuration section.
- `src/components/inbox/SidechatPane.tsx`, `Composer.tsx`, `MessageBubble.tsx`, `ConversationRow.tsx`, `SidechatStatusDot.tsx` — live native state, exact action behavior, and status projection.
- `src/lib/inbox/types.ts`, `src/lib/inbox/sidechat.ts` — safe presentation/action types only; no runtime lifecycle state.

---

## Task 1: Pin the Native SDK Boundary and Register the Agent Classes

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `vite.config.ts`
- Create: `vitest.config.ts`
- Modify: `wrangler.jsonc`
- Modify: `worker-configuration.d.ts`
- Modify: `worker/types.ts`
- Modify: `worker/index.ts`
- Modify: `worker/mcp-server.ts`
- Create: `worker/agents/sidechat/maven-project-agent.ts`
- Create: `worker/agents/sidechat/maven-chat-agent.ts`
- Create: `worker/agents/sidechat/agent-smoke.integration.test.ts`
- Create: `worker/mcp-server.test.ts`

- [ ] **Step 1: Capture the SDK/config RED**

Add an integration test that imports `env` and `SELF` from `cloudflare:test`, asserts `MAVEN_PROJECT_AGENT` exists, hits a test-only parent method, and confirms `MavenChatAgent` is exported without a second production binding. Add an inbound MCP regression asserting `/api/mcp` still initializes the legacy ReplyMaven server after the Agents upgrade.

```ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, test } from "vitest";

describe("native Sidechat Agent registration", () => {
  test("binds only the project parent and keeps the Worker healthy", async () => {
    expect(env.MAVEN_PROJECT_AGENT).toBeDefined();
    const response = await SELF.fetch("https://example.test/api/health");
    expect(response.status).not.toBe(500);
  });
});
```

Run: `bunx vitest run worker/agents/sidechat/agent-smoke.integration.test.ts worker/mcp-server.test.ts`

Expected: FAIL because the test pool, Agent classes, binding, and explicit legacy handler are absent.

- [ ] **Step 2: Install compatible packages and lock exact resolved versions**

Run:

```bash
bun add --exact agents@0.20.0 @cloudflare/ai-chat@0.5.0 @modelcontextprotocol/client@2.0.0-beta.5 @ai-sdk/react@3
bun add --dev vitest@^4.1.0 @cloudflare/vitest-pool-workers
```

Keep `ai` on v6 and keep `@modelcontextprotocol/sdk` exactly `1.29.0` for the inbound legacy server. Confirm `package.json` contains an exact resolved `@ai-sdk/react` 3.x version rather than a range, and add:

```json
"test:agents": "vitest run --config vitest.config.ts"
```

Configure the existing Cloudflare Vite plugin as `cloudflare({ remoteBindings: false })`. This makes `bun run dev` use local Miniflare D1/R2/KV/DO bindings and avoids an implicit remote preview session; it does not alter deployed binding configuration. Any future remote-binding dev session must be an explicit separate command and is outside this implementation.

- [ ] **Step 3: Configure the Workers test pool and single parent binding**

Create `vitest.config.ts` using `cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })`. Add only:

```jsonc
{
  "name": "MAVEN_PROJECT_AGENT",
  "class_name": "MavenProjectAgent"
}
```

to `durable_objects.bindings`, and a second migration object:

```jsonc
{
  "tag": "v2-maven-project-agent",
  "new_sqlite_classes": ["MavenProjectAgent"]
}
```

Do not list `MavenChatAgent` in bindings or migrations. Add `MAVEN_PROJECT_AGENT: DurableObjectNamespace<MavenProjectAgent>` and `SIDECHAT_TOKEN_SECRET: string` to `AppEnv`; regenerate `worker-configuration.d.ts` with `bun run cf-typegen` only after the config is valid.

- [ ] **Step 4: Add minimal native parent/child classes and exact Worker exports**

Start with no product behavior:

```ts
export class MavenProjectAgent extends Agent<AppEnv> {}

export class MavenChatAgent extends AIChatAgent<AppEnv> {
  messageConcurrency = "queue" as const;
  chatRecovery = true;
  maxPersistedMessages = 200;
  waitForMcpConnections = false;
}
```

Export both classes by their exact class names from `worker/index.ts`, but only bind the parent. Task 2 adds the typed parent state after the shared contract exists.

- [ ] **Step 5: Preserve the inverse inbound MCP server explicitly**

Change `worker/mcp-server.ts` to import and call `createLegacyMcpHandler` from `agents/mcp` with the existing v1 `McpServer`. Do not change its routes, scopes, tools, auth, or response behavior.

- [ ] **Step 6: Run GREEN and regression checks**

Run:

```bash
bun run test:agents -- worker/agents/sidechat/agent-smoke.integration.test.ts worker/mcp-server.test.ts
bun test worker/mcp-server.test.ts
./node_modules/.bin/tsc -b --pretty false
git diff --check
```

Expected: all pass; Wrangler shows exactly two top-level SQLite classes total (`ConversationDO`, `MavenProjectAgent`), while `MavenChatAgent` is export-only.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock vite.config.ts vitest.config.ts wrangler.jsonc worker-configuration.d.ts worker/types.ts worker/index.ts worker/mcp-server.ts worker/mcp-server.test.ts worker/agents/sidechat/maven-project-agent.ts worker/agents/sidechat/maven-chat-agent.ts worker/agents/sidechat/agent-smoke.integration.test.ts
git commit -m "chore: add native sidechat agent foundation"
```

---

## Task 2: Add Shared Contracts, Signed Sessions, and Fail-Closed Sub-Agent Routing

**Files:**
- Create: `shared/sidechat-agent.ts`
- Create: `worker/agents/sidechat/agent-auth.ts`
- Create: `worker/agents/sidechat/agent-auth.test.ts`
- Modify: `worker/agents/sidechat/maven-project-agent.ts`
- Create: `worker/agents/sidechat/maven-project-agent.test.ts`
- Create: `worker/routes/sidechat-agent-handlers.ts`
- Create: `worker/routes/sidechat-agent-handlers.test.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Define the RED access matrix and registry attacks**

Tests must cover owner, admin, authorized member, unrelated member, signed-out visitor, archived conversation, wrong project, guessed child, expired token, altered token, parent/child mismatch, and a valid WebSocket upgrade preserving upgrade headers. Specifically assert that a guessed child returns 404 without invoking `subAgent()`.

Run: `bun test worker/agents/sidechat/agent-auth.test.ts worker/agents/sidechat/maven-project-agent.test.ts worker/routes/sidechat-agent-handlers.test.ts`

Expected: FAIL because contracts, token functions, route, and registry gate do not exist.

- [ ] **Step 2: Add serializable shared contracts**

Define these exact core types in `shared/sidechat-agent.ts`:

```ts
export type SidechatStatus = "idle" | "working" | "waiting_approval" | "ready" | "failed";

export interface SidechatSummary {
  conversationId: string;
  childName: string;
  status: SidechatStatus;
  updatedAt: number;
}

export interface MavenProjectState {
  sidechats: Record<string, SidechatSummary>;
}

export interface SidechatSessionResponse {
  parentAgent: "MavenProjectAgent";
  parentName: string;
  childAgent: "MavenChatAgent";
  childName: string;
  token: string;
  expiresAt: number;
  created: boolean;
}

interface SidechatClaimBase {
  userId: string;
  effectiveUserId: string;
  projectId: string;
  parentName: string;
  role: "owner" | "admin" | "member";
  iat: number;
  exp: number;
  aud: "replymaven-sidechat";
  v: 1;
}

export interface SidechatParentClaims extends SidechatClaimBase {
  scope: "parent";
}

export interface SidechatChildClaims extends SidechatClaimBase {
  scope: "child";
  conversationId: string;
  childName: string;
  canSubmit: boolean;
  canApproveOnce: boolean;
  canAlwaysAllow: boolean;
}

export type SidechatActorClaims = SidechatParentClaims | SidechatChildClaims;

export interface SidechatSummarySessionResponse {
  summaries: SidechatSummary[];
  parentAgent: "MavenProjectAgent";
  parentName: string;
  token: string;
  expiresAt: number;
}
```

Add the context/tool/audit contracts from the design in the same file. Only the child claim carries `conversationId`, `childName`, and mutation permissions. Neither variant may contain credential-bearing or executable values.

- [ ] **Step 3: Implement two-minute HMAC tokens**

Use Web Crypto HMAC-SHA256 and constant-time byte comparison. Derive `childName` only with `sc_${conversationId}` after validating the ID; do not accept a browser-supplied child name. Sign a canonical JSON payload and reject expiry, future issuance, wrong audience/version, and any route mismatch.

- [ ] **Step 4: Implement the authoritative child registry**

In `MavenProjectAgent`:

```ts
async registerSidechat(conversationId: string): Promise<{
  childName: string;
  created: boolean;
}> {
  const childName = toSidechatChildName(conversationId);
  const created = !this.hasSubAgent(MavenChatAgent, childName);
  await this.subAgent(MavenChatAgent, childName);
  // Decoration is written only after native child creation succeeds.
  this.setState(upsertSidechatSummary(this.state, conversationId, childName));
  return { childName, created };
}

override async onBeforeSubAgent(
  request: Request,
  child: { className: string; name: string },
): Promise<Request | Response | void> {
  if (child.className !== "MavenChatAgent" || !this.hasSubAgent(MavenChatAgent, child.name)) {
    return new Response("Not found", { status: 404 });
  }
  return authorizeSubAgentRequest(request, this.name, child.name, this.env.SIDECHAT_TOKEN_SECRET);
}
```

The authorization helper must return a modified request only when necessary and preserve WebSocket headers.

- [ ] **Step 5: Add the authenticated session route and native routing before SPA fallback**

Mount:

```text
POST /api/projects/:projectId/conversations/:conversationId/sidechat/session
GET  /api/projects/:projectId/sidechat/summaries
/agents/* and nested /sub/* routing
MCP OAuth callback routes
SPA fallback
```

The child session handler must reuse effective-owner/team/project authorization, load the project-scoped conversation, reject archived conversations for creation, call the parent by project ID, register the child, and return the signed response. Existing archived children remain openable through a read-only session mode only when `hasSubAgent` is already true; creation/submission permission is false in that token.

The summary handler returns the parent's current summaries plus a two-minute project-scoped parent token. `MavenProjectAgent.onBeforeConnect` accepts that token for read-only native state sync; it cannot route to a child or execute a tool. `onBeforeSubAgent` requires a child-scoped token and stores its verified actor claims as per-connection state before forwarding. Native approval frames are authorized from that connection state; model-generated text cannot approve.

- [ ] **Step 6: Run GREEN and route-order proof**

Run:

```bash
bun test worker/agents/sidechat/agent-auth.test.ts worker/agents/sidechat/maven-project-agent.test.ts worker/routes/sidechat-agent-handlers.test.ts
bun run test:agents -- worker/agents/sidechat/agent-smoke.integration.test.ts
rg -n 'routeSubAgentRequest|routeAgentRequest|except\(' worker/index.ts
./node_modules/.bin/tsc -b --pretty false
```

Expected: access matrix and registry attacks pass; route output proves Agent routing precedes SPA fallback.

- [ ] **Step 7: Commit**

```bash
git add shared/sidechat-agent.ts worker/agents/sidechat/agent-auth.ts worker/agents/sidechat/agent-auth.test.ts worker/agents/sidechat/maven-project-agent.ts worker/agents/sidechat/maven-project-agent.test.ts worker/routes/sidechat-agent-handlers.ts worker/routes/sidechat-agent-handlers.test.ts worker/index.ts
git commit -m "feat: authenticate native sidechat sessions"
```

---

## Task 3: Build the Native Private Chat Loop and Completion-Only Reply Draft

**Files:**
- Create: `worker/agents/sidechat/sidechat-context.ts`
- Create: `worker/agents/sidechat/sidechat-context.test.ts`
- Create: `worker/agents/sidechat/sidechat-prompt.ts`
- Create: `worker/agents/sidechat/sidechat-prompt.test.ts`
- Create: `worker/agents/sidechat/reply-draft-tool.ts`
- Create: `worker/agents/sidechat/reply-draft-tool.test.ts`
- Modify: `worker/agents/sidechat/maven-project-agent.ts`
- Modify: `worker/agents/sidechat/maven-chat-agent.ts`
- Create: `worker/agents/sidechat/maven-chat-agent.integration.test.ts`

- [ ] **Step 1: Write RED context/privacy/lifecycle tests**

Prove at minimum:

- exactly the newest 40 rows from the existing public D1 transcript are returned in stable chronological order;
- another project/conversation is excluded and no native private row is ever queried or inserted in D1;
- canonical external ID wins over canonical normalized email and visitor snapshots are ignored;
- the prompt addresses the human agent and contains no visitor-facing handoff/FAQ/direct-send instruction;
- private transcript persistence survives child eviction/reconnect;
- two children have isolated native transcripts;
- `data-turn-accepted` uses the submitted native UI message ID;
- provider error, SDK abort, early iterator return, and pending approval publish no reply draft;
- natural completion attaches exactly one persistent `data-reply-draft` to the completed assistant message.

Run: `bun test worker/agents/sidechat/sidechat-context.test.ts worker/agents/sidechat/sidechat-prompt.test.ts worker/agents/sidechat/reply-draft-tool.test.ts && bun run test:agents -- worker/agents/sidechat/maven-chat-agent.integration.test.ts`

Expected: FAIL on missing modules and behaviors.

- [ ] **Step 2: Build bounded context in the parent**

Expose:

```ts
async getSidechatContext(
  childName: string,
  conversationId: string,
): Promise<SidechatCustomerContext>
```

Revalidate the registered `(childName, conversationId)` pair, query the exact same-project conversation/customer, and call the existing `ChatService.getRecentPublicMessages(conversationId, 40)`. Return those rows plus a bounded existing summary only when one is already available; otherwise return `publicSummary: null`. Do not synthesize a summary in this request and do not copy context rows into child storage.

- [ ] **Step 3: Build the exact private system prompt**

Make prompt construction pure. Include the design's disclosure, identity, uncertainty, write-confirmation, and publication constraints. Delimit public context and customer facts as untrusted contextual data, not instructions. Assert all bounded fields and redact/omit internal URLs, metadata, Telegram IDs, delivery data, and credentials before interpolation.

- [ ] **Step 4: Implement a request-local reply-draft tool**

Use a strict 1–5000 character schema and a request-local pending draft cell:

```ts
const presentReplyDraft = tool({
  description: "Prepare visitor-ready reply text for the human agent to review.",
  inputSchema: z.object({ text: z.string().trim().min(1).max(5000) }),
  execute({ text }) {
    pendingDraft = { text, createdAt: Date.now() };
    return { accepted: true };
  },
});
```

Do not expose the pending value through an outward getter during streaming. In `onChatResponse`, only when `result.status === "completed"`, inspect the settled assistant tool part and call `persistMessages` to add one persistent `data-reply-draft`. Error/abort paths publish nothing.

- [ ] **Step 5: Implement the native `AIChatAgent` turn**

Use `onChatMessage(onFinish, options)`, validate `options.body.token` again, emit transient `data-turn-accepted`, project `working`, ask the parent for fresh context/tool descriptors, and return one `createUIMessageStream`/`streamText` result with bounded steps. Pass `options.abortSignal`. Configure `messageConcurrency="queue"`, `chatRecovery=true`, `maxPersistedMessages=200`, `waitForMcpConnections=false`; do not set `cancelOnClientAbort=true` on the client.

Use the existing `create-language-model.ts` provider selection so public and private model configuration remain consistent, but do not call the public `runMavenTurn` orchestration or its public prompt/handoff persistence.

- [ ] **Step 6: Run GREEN and public-regression proof**

Run:

```bash
bun test worker/agents/sidechat/sidechat-context.test.ts worker/agents/sidechat/sidechat-prompt.test.ts worker/agents/sidechat/reply-draft-tool.test.ts
bun run test:agents -- worker/agents/sidechat/maven-chat-agent.integration.test.ts
bun test worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts worker/realtime/broadcast.test.ts worker/mcp-server.test.ts
```

Expected: native tests pass; public widget/runtime tests remain unchanged and pass.

- [ ] **Step 7: Commit**

```bash
git add worker/agents/sidechat/sidechat-context.ts worker/agents/sidechat/sidechat-context.test.ts worker/agents/sidechat/sidechat-prompt.ts worker/agents/sidechat/sidechat-prompt.test.ts worker/agents/sidechat/reply-draft-tool.ts worker/agents/sidechat/reply-draft-tool.test.ts worker/agents/sidechat/maven-project-agent.ts worker/agents/sidechat/maven-chat-agent.ts worker/agents/sidechat/maven-chat-agent.integration.test.ts
git commit -m "feat: run native private sidechat turns"
```

---

## Task 4: Connect the Existing Sidechat UI to Native Chat State

**Files:**
- Create: `src/hooks/use-sidechat-agent.ts`
- Create: `src/hooks/use-sidechat-agent.test.tsx`
- Create: `src/lib/inbox/sidechat-message-adapter.ts`
- Create: `src/lib/inbox/sidechat-message-adapter.test.ts`
- Modify: `src/pages/Conversations.tsx`
- Modify: `src/components/inbox/SidechatPane.tsx`
- Modify: `src/components/inbox/Composer.tsx`
- Modify: `src/components/inbox/ConversationRow.tsx`
- Modify: `src/components/inbox/SidechatStatusDot.tsx`
- Modify: `src/lib/inbox/types.ts`
- Modify: `src/lib/inbox/sidechat.ts`
- Modify: `src/components/inbox/SidechatPane.test.tsx`
- Modify: `src/components/inbox/Composer.test.tsx`
- Modify: `src/lib/inbox/sidechat.test.ts`
- Create: `src/pages/Conversations.sidechat.test.tsx`

- [ ] **Step 1: Write RED UI/data-boundary tests**

Cover empty/populated Start, Open-existing without submission, matching `data-turn-accepted` clearing only an unchanged captured public text, failed submission preservation, attachment continuity, conversation switch, close without cancellation, reconnect, multi-tab sync, stop, archived read-only, safe activity, failed retry, status dots, and mobile/desktop exact Add-to-reply behavior. Add fail-closed adapter tests that drop reasoning, raw tool input/output, unknown data parts, credentials, and provider metadata.

Run: `bun test src/hooks/use-sidechat-agent.test.tsx src/lib/inbox/sidechat-message-adapter.test.ts src/pages/Conversations.sidechat.test.tsx src/components/inbox/SidechatPane.test.tsx src/components/inbox/Composer.test.tsx src/lib/inbox/sidechat.test.ts`

Expected: FAIL because the hook/adapter do not exist and the pane is disabled.

- [ ] **Step 2: Implement the fail-closed native message adapter**

Map only text and these known data parts:

```ts
type SidechatPresentationPart =
  | { type: "data-turn-accepted"; data: { messageId: string } }
  | { type: "data-safe-activity"; data: { label: string; status: "started" | "success" | "error" } }
  | { type: "data-reply-draft"; id: string; data: { text: string; createdAt: number } };
```

Translate native tool approval parts into synthetic existing `Message` rows keyed by `${uiMessage.id}:${toolCallId}`. Never put full tool input/result in `content` or `presentationAction`. Unknown parts return no rendered message.

- [ ] **Step 3: Implement the Agent hook**

The hook must:

1. request `/sidechat/session` through TanStack Query;
2. supply the short-lived token in the Agent connection query and call `useAgent({ agent: "MavenProjectAgent", name: projectId, sub: [{ agent: "MavenChatAgent", name: childName }] })`;
3. call `useAgentChat({ agent, resume: true, cancelOnClientAbort: false, onData })`;
4. submit the pre-generated UI message ID with `{ body: { token } }`;
5. expose native `messages`, `status`, `error`, `stop`, retry/regenerate, `addToolApprovalResponse`, and accepted IDs;
6. refresh a two-minute session token without treating a component unmount as a server cancellation.

- [ ] **Step 4: Replace the disabled pane wiring without replacing primitives**

Remove `data-sidechat-runtime-unavailable`. Pass adapted messages, live draft, native send/stop/retry, and approval handlers through `SidechatPane` into the existing `ChatThread`, `MessageBubble`, and `Composer`. Keep Sidechat closed by default and the stable focus-mode public composer tree.

- [ ] **Step 5: Implement exact accepted-only transfer and Add-to-reply behavior**

On first Start, capture `{messageId, textSnapshot, conversationId}`. Clear public text only when the matching accepted data part arrives and current text still equals the captured snapshot; never clear images. Empty Start submits the trusted default only after the session says the child was newly created. Existing child only opens.

For Add-to-reply, set exact public text. At `<768px`, close Sidechat first, wait for the public textarea to be visible, then increment the focus command; at desktop keep it open. Assert caret end and zero public sends.

- [ ] **Step 6: Render parent summary dots without making them authoritative**

Fetch `GET /api/projects/:projectId/sidechat/summaries` with the conversation list, seed the rows by `conversationId`, and connect a second read-only `useAgent` instance to `MavenProjectAgent` with the returned parent token for live native state. `ConversationRow` and `Open sidechat` render only the existing 7px dot. Native child status/error remains the open pane authority. Expired parent tokens refresh through the same authenticated summary endpoint; no D1 projection or custom realtime event is added.

- [ ] **Step 7: Run GREEN and frontend regressions**

Run:

```bash
bun test src/hooks/use-sidechat-agent.test.tsx src/lib/inbox/sidechat-message-adapter.test.ts src/pages/Conversations.sidechat.test.tsx src/components/inbox/SidechatPane.test.tsx src/components/inbox/Composer.test.tsx src/lib/inbox/sidechat.test.ts
bun test src
./node_modules/.bin/tsc -b --pretty false
```

Expected: all pass; no raw native tool or reasoning payload is rendered.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/use-sidechat-agent.ts src/hooks/use-sidechat-agent.test.tsx src/lib/inbox/sidechat-message-adapter.ts src/lib/inbox/sidechat-message-adapter.test.ts src/pages/Conversations.tsx src/pages/Conversations.sidechat.test.tsx src/components/inbox/SidechatPane.tsx src/components/inbox/SidechatPane.test.tsx src/components/inbox/Composer.tsx src/components/inbox/Composer.test.tsx src/components/inbox/ConversationRow.tsx src/components/inbox/SidechatStatusDot.tsx src/lib/inbox/types.ts src/lib/inbox/sidechat.ts src/lib/inbox/sidechat.test.ts
git commit -m "feat: connect dashboard to native sidechat"
```

---

## Task 5: Proxy Existing Knowledge and HTTP Tools Through the Project Parent

**Files:**
- Create: `worker/agents/sidechat/project-tool-proxy.ts`
- Create: `worker/agents/sidechat/project-tool-proxy.test.ts`
- Modify: `worker/agents/sidechat/maven-project-agent.ts`
- Modify: `worker/agents/sidechat/maven-chat-agent.ts`
- Modify: `worker/chat-runtime/tools/http-tool-executor.ts`
- Modify: `worker/chat-runtime/tools/http-tool-executor.test.ts`
- Modify: `worker/services/tool-service.ts`
- Modify: `worker/services/tool-service.test.ts`

- [ ] **Step 1: Write RED tool isolation and reauthorization tests**

Prove knowledge is available to Sidechat, `request_team_help` is absent, public-only HTTP tools are absent, Sidechat HTTP tools are descriptors only, disabled/reclassified/schema-changed tools fail at execution, reserved names cannot collide, archive blocks dispatch, timeout works, caller abort reaches fetch, raw input/output are not written to `tool_executions`, and public HTTP execution semantics remain byte-for-byte compatible at the observable boundary.

Run: `bun test worker/agents/sidechat/project-tool-proxy.test.ts worker/chat-runtime/tools/http-tool-executor.test.ts worker/services/tool-service.test.ts worker/chat-runtime/tools/internal/search-knowledge.test.ts`

Expected: FAIL on missing proxy and current public-specific HTTP transport.

- [ ] **Step 2: Extract a channel-neutral low-level HTTP transport**

Split `http-tool-executor.ts` into:

```ts
export async function executeHttpToolRequest(
  request: PreparedHttpToolRequest,
  options: { abortSignal?: AbortSignal },
): Promise<unknown>;

export function createPublicHttpToolDefinition(/* existing arguments */): MavenToolDefinition;
```

Keep URL validation, SSRF protection, header decryption, timeout, response-size bounds, and safe error mapping in the low-level transport. Keep public ownership CAS, tool-message permit, public audit linkage, and existing `ToolService.logExecution` only in the public wrapper.

- [ ] **Step 3: Build serializable descriptors in the parent**

Return a fixed descriptor for the existing `search_knowledge` definition plus `ToolService.getEnabledToolsForChannel(projectId, "sidechat")` descriptors. Execute knowledge search inside the parent through the existing `createSearchKnowledgeTool`/`runAiSearch` implementation. Use the existing canonical schema fingerprint helper and reserved-name validator. Descriptors contain JSON Schema and presentation metadata only.

- [ ] **Step 4: Build child dynamic tools and parent execution RPC**

The child converts descriptors with AI SDK `dynamicTool`/`jsonSchema`; every `execute` calls:

```ts
await parent.executeProjectTool({
  childName: this.name,
  conversationId: claims.conversationId,
  actorUserId: claims.userId,
  connectionId: descriptor.connectionId,
  toolName: descriptor.toolName,
  catalogFingerprint: descriptor.catalogFingerprint,
  access: descriptor.access,
  input,
});
```

The parent re-reads registration, archive state, actor access, current tool row, channel, access, enabled state, schema, and fingerprint immediately before dispatch. The final external fetch runs inside the existing `ChatService.runExternalActionIfOperational(conversationId, projectId, action)` guard so its short D1 `externalActionStartedAt` lease remains mutually exclusive with archive. This existing general external-side-effect fence is not a Sidechat turn/run lease and is not used for message persistence or recovery. Existing HTTP Sidechat reads/writes use the same approval policy added in Task 8; until then, expose reads and report writes as approval-required/unavailable.

- [ ] **Step 5: Store only parent-local safe audit metadata**

Create the parent SQLite `sidechat_action_audit` table with identifiers, access, approval mode, status, timestamps/duration, bounded activity, and error code. No input/output/header/token columns are permitted. Do not call the D1 raw-payload `ToolService.logExecution` for Sidechat.

- [ ] **Step 6: Run GREEN and public parity**

Run:

```bash
bun test worker/agents/sidechat/project-tool-proxy.test.ts worker/chat-runtime/tools/http-tool-executor.test.ts worker/services/tool-service.test.ts worker/chat-runtime/tools/internal/search-knowledge.test.ts
bun test worker/chat-runtime/tools worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts
./node_modules/.bin/tsc -b --pretty false
```

Expected: all pass, including existing public ownership/permit/audit tests.

- [ ] **Step 7: Commit**

```bash
git add worker/agents/sidechat/project-tool-proxy.ts worker/agents/sidechat/project-tool-proxy.test.ts worker/agents/sidechat/maven-project-agent.ts worker/agents/sidechat/maven-chat-agent.ts worker/chat-runtime/tools/http-tool-executor.ts worker/chat-runtime/tools/http-tool-executor.test.ts worker/chat-runtime/tools/internal/search-knowledge.ts worker/chat-runtime/tools/internal/search-knowledge.test.ts worker/services/tool-service.ts worker/services/tool-service.test.ts
git commit -m "feat: expose project tools to sidechat"
```

---

## Task 6: Add Native Project MCP Connections and Simple Presets

**Files:**
- Create: `worker/agents/sidechat/mcp-presets.ts`
- Create: `worker/agents/sidechat/mcp-presets.test.ts`
- Create: `worker/agents/sidechat/mcp-policy.ts`
- Create: `worker/agents/sidechat/mcp-policy.test.ts`
- Modify: `worker/agents/sidechat/maven-project-agent.ts`
- Create: `worker/agents/sidechat/maven-project-agent.mcp.integration.test.ts`
- Create: `worker/routes/project-mcp-handlers.ts`
- Create: `worker/routes/project-mcp-handlers.test.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Write RED connection/preset/catalog/security tests**

Cover preset constants, arbitrary HTTPS URL, HTTP/file/stdio rejection, native SSRF rejection, OAuth `authenticating` response, manual bearer/custom headers without returning them, catalog restoration after hibernation, refresh, disconnect, two-project isolation, stable namespacing, reserved collision, annotation classification, missing/conflicting annotation defaulting to write, and tools disabled until configured.

Run: `bun test worker/agents/sidechat/mcp-presets.test.ts worker/agents/sidechat/mcp-policy.test.ts worker/routes/project-mcp-handlers.test.ts && bun run test:agents -- worker/agents/sidechat/maven-project-agent.mcp.integration.test.ts`

Expected: FAIL because outbound MCP management is absent.

- [ ] **Step 2: Define the five presentation-only presets**

```ts
export const MCP_PRESETS = {
  posthog: { label: "PostHog", url: "https://mcp.posthog.com/mcp", auth: "oauth_or_bearer", icon: "/integrations/posthog.svg" },
  stripe: { label: "Stripe", url: "https://mcp.stripe.com", auth: "oauth_or_bearer", icon: "/integrations/stripe.svg" },
  slack: { label: "Slack", url: "https://mcp.slack.com/mcp", auth: "manual_bearer", icon: "/integrations/slack.svg" },
  attio: { label: "Attio", url: "https://mcp.attio.com/mcp", auth: "oauth", icon: "/integrations/attio.svg" },
  linear: { label: "Linear", url: "https://mcp.linear.app/mcp", auth: "oauth_or_bearer", icon: "/integrations/linear.svg" },
} as const;
```

Re-verify each endpoint/auth mode against current official provider docs during implementation. If an official endpoint changed, update this one constants file and its cited test fixture; do not create a provider adapter. Slack remains manual bearer in v1 because its official remote server does not offer dynamic client registration.

- [ ] **Step 3: Add native parent MCP methods**

Expose authenticated parent RPC methods behind Hono handlers:

```ts
connectMcp(input: ConnectMcpInput): Promise<McpConnectionView>
listMcpConnections(): Promise<McpConnectionView[]>
refreshMcpCatalog(connectionId: string): Promise<McpCatalogView>
disconnectMcp(connectionId: string): Promise<void>
```

Use `addMcpServer(name, url, { id, callbackPath, callbackHost, transport: { type: "streamable-http", headers } })`, `getMcpServers()`, `this.mcp.listTools()`, and `removeMcpServer()`. Credentials remain in native Agent storage. Responses return masked auth mode/status only.

- [ ] **Step 4: Normalize and fingerprint the native catalog**

Namespace exposed model names by stable connection ID; reject reserved names. Fingerprint the current description/input schema/annotations. Seed access from MCP annotations; missing/conflicting signals become `write`. Insert app policy rows disabled by default into parent SQLite `mcp_tool_policy`.

- [ ] **Step 5: Add authenticated project configuration and callback routes**

Add owner/admin connection mutations, project-member read views when permitted, catalog/policy/audit reads, disconnect, and OAuth callback routing before SPA fallback. Never accept `projectId`, role, connection ownership, or callback destination from OAuth state without signed/native verification.

- [ ] **Step 6: Run GREEN and hibernation/security integration tests**

Run:

```bash
bun test worker/agents/sidechat/mcp-presets.test.ts worker/agents/sidechat/mcp-policy.test.ts worker/routes/project-mcp-handlers.test.ts
bun run test:agents -- worker/agents/sidechat/maven-project-agent.mcp.integration.test.ts
./node_modules/.bin/tsc -b --pretty false
```

Expected: all pass; test storage proves credentials are absent from D1 and route JSON.

- [ ] **Step 7: Commit**

```bash
git add worker/agents/sidechat/mcp-presets.ts worker/agents/sidechat/mcp-presets.test.ts worker/agents/sidechat/mcp-policy.ts worker/agents/sidechat/mcp-policy.test.ts worker/agents/sidechat/maven-project-agent.ts worker/agents/sidechat/maven-project-agent.mcp.integration.test.ts worker/routes/project-mcp-handlers.ts worker/routes/project-mcp-handlers.test.ts worker/index.ts
git commit -m "feat: connect project mcp servers"
```

---

## Task 7: Add MCP Connection and Tool Policy UI to the Existing Tools Page

**Files:**
- Create: `src/components/tools/ProjectMcpConnections.tsx`
- Create: `src/components/tools/ProjectMcpConnections.test.tsx`
- Modify: `src/pages/Tools.tsx`
- Modify: `src/pages/Tools.test.tsx`
- Modify: `src/pages/Settings.tsx` or the exact account MCP page containing current copy, only if copy is ambiguous

- [ ] **Step 1: Write RED configuration UI tests**

Cover five preset buttons, custom HTTPS URL, Slack manual-token copy, OAuth popup/authenticating/ready/failed states, reconnect/disconnect, discovered disabled tools, read/write classification, enable toggle, `Always allow` display/revoke, safe activity, role-disabled mutations, keyboard expansion, 40px hit targets, masked credential preservation, and no raw tool payload rendering.

Run: `bun test src/components/tools/ProjectMcpConnections.test.tsx src/pages/Tools.test.tsx`

Expected: FAIL because the section does not exist.

- [ ] **Step 2: Add a compact section to the existing Tools visual language**

Render `ProjectMcpConnections` inside `ToolsPanel`; do not create a new app route or assistant-specific styling. Reuse `/public/integrations/{posthog,stripe,slack,attio,linear}.svg`, muted rows, current typography, existing switch/select/button primitives, no internal separator borders, and text-led provider names.

- [ ] **Step 3: Implement native connection state and credential-safe mutations**

Use TanStack Query for the Hono endpoints. OAuth opens the returned authorization URL and polls/refetches bounded status. Token/header inputs are write-only: configured views show “Connected” or masked state and policy-only updates omit credential fields entirely.

- [ ] **Step 4: Implement catalog policy controls**

Each tool row shows connection, tool name, bounded description, enabled switch, and read/write selector. Unknown/default write state is explicit. Owner/admin can mutate; authorized member sees the effective policy but cannot create persistent grants or change connection/catalog policy.

- [ ] **Step 5: Run GREEN and responsive component checks**

Run:

```bash
bun test src/components/tools/ProjectMcpConnections.test.tsx src/pages/Tools.test.tsx
bun test src/pages/Tools.test.tsx src/components/inbox
./node_modules/.bin/tsc -b --pretty false
```

Expected: all pass; no masked secret is submitted on policy-only updates.

- [ ] **Step 6: Commit**

```bash
git add src/components/tools/ProjectMcpConnections.tsx src/components/tools/ProjectMcpConnections.test.tsx src/pages/Tools.tsx src/pages/Tools.test.tsx src/pages/Settings.tsx
git commit -m "feat: configure project mcp connections"
```

If the account MCP copy is already unambiguous and `Settings.tsx` is unchanged, omit it from `git add`.

---

## Task 8: Wire Native Write Approvals and Exact Persistent Grants

**Files:**
- Modify: `shared/sidechat-agent.ts`
- Modify: `worker/agents/sidechat/mcp-policy.ts`
- Modify: `worker/agents/sidechat/mcp-policy.test.ts`
- Modify: `worker/agents/sidechat/project-tool-proxy.ts`
- Modify: `worker/agents/sidechat/project-tool-proxy.test.ts`
- Modify: `worker/agents/sidechat/maven-project-agent.ts`
- Modify: `worker/agents/sidechat/maven-chat-agent.ts`
- Modify: `worker/routes/project-mcp-handlers.ts`
- Modify: `worker/routes/project-mcp-handlers.test.ts`
- Modify: `src/hooks/use-sidechat-agent.ts`
- Modify: `src/hooks/use-sidechat-agent.test.tsx`
- Modify: `src/lib/inbox/sidechat-message-adapter.ts`
- Modify: `src/lib/inbox/sidechat-message-adapter.test.ts`
- Modify: `src/components/inbox/MessageBubble.tsx`
- Create: `src/components/inbox/MessageBubble.test.tsx`

- [ ] **Step 1: Write RED approval and side-effect safety tests**

Cover read-no-approval, write-needs-approval, `Allow once`, duplicate approval, pending persistence across close/reconnect/eviction, member once approval, member always denial, owner/admin always grant, exact grant match, invalidation by disconnect/reconnect/URL/access/schema fingerprint/disable, stale approval denial, archive-before-dispatch denial, timeout/ambiguous write with zero automatic retry, and safe generic approval copy.

Add a deterministic test where archive/takeover occurs immediately before parent dispatch; assert the external mock receives zero requests. Add a test where provider acceptance occurs before an abort; assert audit is `ambiguous`/actual result rather than falsely `cancelled` and no retry occurs.

Run: `bun test worker/agents/sidechat/mcp-policy.test.ts worker/agents/sidechat/project-tool-proxy.test.ts worker/routes/project-mcp-handlers.test.ts src/hooks/use-sidechat-agent.test.tsx src/lib/inbox/sidechat-message-adapter.test.ts src/components/inbox/MessageBubble.test.tsx`

Expected: FAIL because native approvals and grants are not connected.

- [ ] **Step 2: Configure native per-call approval in child tools**

For every current write descriptor without a matching parent grant, set AI SDK `needsApproval`. Keep read tools approval-free. The child never decides that a stale grant matches; it asks the parent for the current descriptor/grant state while building and the parent rechecks again at execution.

- [ ] **Step 3: Render the exact compact approval bubble**

Use native `isToolUIPart`, `getToolPartState`, `getToolApproval`, `getToolCallId`, and `getToolName` in the adapter. The synthetic normal Maven bubble contains bounded human-directed description and only:

```text
Always allow | Allow once
```

Buttons use 28px visible controls inside at least 40px hit areas, 12.5–13px text, 8px radius, secondary Always and primary Once. No reject/Not now/card/alert/badge.

- [ ] **Step 4: Submit native once approval and authenticated always grant**

`Allow once` calls `addToolApprovalResponse({ id: toolCallId, approved: true })`. `Always allow` first POSTs the exact authenticated scope:

```ts
{
  connectionId,
  toolName,
  catalogFingerprint,
}
```

then submits the same native approval response. Only owner/admin can persist/revoke `always_allow_grants`; authorized members can approve once.

- [ ] **Step 5: Execute behind final parent reauthorization and audit safely**

Immediately before `this.mcp.getAITools({ serverId })[exposedName].execute(input)`, recheck child registration, connection readiness, current catalog, fingerprint, enabled/access policy, actor, and native/persistent approval, then dispatch inside `ChatService.runExternalActionIfOperational`. Use one bounded timeout, no write retry, and one safe parent audit row. The browser sees only safe activity/result status.

- [ ] **Step 6: Run GREEN and approval recovery integration**

Run:

```bash
bun test worker/agents/sidechat/mcp-policy.test.ts worker/agents/sidechat/project-tool-proxy.test.ts worker/routes/project-mcp-handlers.test.ts src/hooks/use-sidechat-agent.test.tsx src/lib/inbox/sidechat-message-adapter.test.ts src/components/inbox/MessageBubble.test.tsx
bun run test:agents -- worker/agents/sidechat/maven-chat-agent.integration.test.ts worker/agents/sidechat/maven-project-agent.mcp.integration.test.ts
./node_modules/.bin/tsc -b --pretty false
```

Expected: all approval, persistence, invalidation, and no-retry tests pass.

- [ ] **Step 7: Commit**

```bash
git add shared/sidechat-agent.ts worker/agents/sidechat/mcp-policy.ts worker/agents/sidechat/mcp-policy.test.ts worker/agents/sidechat/project-tool-proxy.ts worker/agents/sidechat/project-tool-proxy.test.ts worker/agents/sidechat/maven-project-agent.ts worker/agents/sidechat/maven-chat-agent.ts worker/routes/project-mcp-handlers.ts worker/routes/project-mcp-handlers.test.ts src/hooks/use-sidechat-agent.ts src/hooks/use-sidechat-agent.test.tsx src/lib/inbox/sidechat-message-adapter.ts src/lib/inbox/sidechat-message-adapter.test.ts src/components/inbox/MessageBubble.tsx src/components/inbox/MessageBubble.test.tsx
git commit -m "feat: approve sidechat write tools"
```

---

## Task 9: Complete Cleanup, Retention, Archive, and Privacy Fences

**Files:**
- Modify: `worker/agents/sidechat/maven-project-agent.ts`
- Modify: `worker/agents/sidechat/maven-chat-agent.ts`
- Create: `worker/agents/sidechat/sidechat-cleanup.integration.test.ts`
- Modify: `worker/services/conversation-retention-service.ts`
- Modify: `worker/services/conversation-retention-service.test.ts`
- Create: `worker/routes/project-cleanup.ts`
- Create: `worker/routes/project-cleanup.test.ts`
- Modify: `worker/services/project-service.test.ts`
- Modify: `worker/index.ts`
- Create: `worker/agents/sidechat/sidechat-privacy.test.ts`

- [ ] **Step 1: Write RED cleanup/archive/privacy tests**

Prove child deletion precedes public conversation deletion, a failed child delete blocks public deletion, retention uses the same cleanup dependency, project Agent destruction precedes D1 project deletion, disconnect removes native MCP state and invalidates policies/grants, archive blocks new sends/approvals/execution, already-dispatched writes report honestly, and no private data appears in D1 messages, `ConversationDO`, public SSE/polling, Telegram, email, public MCP, logs, route JSON, or rendered visitor data.

Run: `bun test worker/services/conversation-retention-service.test.ts worker/services/project-service.test.ts worker/agents/sidechat/sidechat-privacy.test.ts && bun run test:agents -- worker/agents/sidechat/sidechat-cleanup.integration.test.ts`

Expected: FAIL because deletion hooks and complete privacy assertions are absent.

- [ ] **Step 2: Add idempotent parent cleanup methods**

```ts
async destroySidechat(conversationId: string): Promise<void> {
  const childName = toSidechatChildName(conversationId);
  if (this.hasSubAgent(MavenChatAgent, childName)) {
    this.deleteSubAgent(MavenChatAgent, childName);
  }
  this.setState(removeSidechatSummary(this.state, conversationId));
}

async destroyProjectData(): Promise<void> {
  for (const child of this.listSubAgents(MavenChatAgent)) {
    this.deleteSubAgent(MavenChatAgent, child.name);
  }
  for (const serverId of Object.keys(this.getMcpServers().servers)) {
    await this.removeMcpServer(serverId);
  }
  await this.destroy();
}
```

Match the installed SDK's declared sync/async return types exactly. The behavior is idempotent even if a child/server was already removed.

- [ ] **Step 3: Wire deletion ordering**

Inject an Agent cleanup callback into `purgeExpiredArchivedConversations`/`purgeOneClaimedConversation`. Call it after R2 ownership checks but before D1 conversation deletion; on failure leave the D1 row claimed for retry and count `failed`. Put the existing project-delete ordering in the new tested `project-cleanup.ts` helper: verify ownership, destroy the parent, then call `ProjectService.deleteProject`. The current repo has no manual conversation-delete route, so do not add one and do not add a visitor delete route.

- [ ] **Step 4: Enforce archive at every active boundary**

Session creation, child `onChatMessage`, approval mutation, and parent external execution all re-read archive state. Closing the pane is not archive. A write already dispatched cannot be revoked; record its real confirmed/ambiguous/failed outcome without retry.

- [ ] **Step 5: Run GREEN plus public/privacy sweep**

Run:

```bash
bun test worker/services/conversation-retention-service.test.ts worker/services/project-service.test.ts worker/routes/project-cleanup.test.ts worker/agents/sidechat/sidechat-privacy.test.ts
bun run test:agents -- worker/agents/sidechat/sidechat-cleanup.integration.test.ts
bun test worker/realtime worker/mcp-server.test.ts worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts
rg -n 'sidechat|MavenChatAgent|data-reply-draft|data-safe-activity' worker/db worker/realtime worker/mcp-server.ts widget
```

Expected: tests pass; residue search has no Sidechat storage/broadcast/widget/inbound-MCP implementation, aside from an explicit test assertion or harmless type import reviewed line by line.

- [ ] **Step 6: Commit**

```bash
git add worker/agents/sidechat/maven-project-agent.ts worker/agents/sidechat/maven-chat-agent.ts worker/agents/sidechat/sidechat-cleanup.integration.test.ts worker/agents/sidechat/sidechat-privacy.test.ts worker/services/conversation-retention-service.ts worker/services/conversation-retention-service.test.ts worker/routes/project-cleanup.ts worker/routes/project-cleanup.test.ts worker/services/project-service.test.ts worker/index.ts
git commit -m "fix: clean up native sidechat data safely"
```

---

## Task 10: Verify the Complete Feature Locally, Including the Logged-In Dashboard

**Files:**
- Create: `docs/superpowers/reports/2026-08-11-native-sidechat-mcp-verification.md`
- Create: `docs/superpowers/reports/2026-08-11-native-sidechat-mcp-evidence/` for screenshots and JSON measurements
- Modify production/tests only for defects reproduced during this task; every fix gets its own RED and focused commit before final verification resumes

- [ ] **Step 1: Run the complete automated matrix fresh**

Run from a clean worktree:

```bash
bun test
bun run test:agents
./node_modules/.bin/tsc -p tsconfig.worker.json --noEmit --pretty false
./node_modules/.bin/tsc -b --pretty false
bun run lint
bun run build
bun run widget:build
git diff --check
```

Expected: zero branch-owned failures. If full lint reports existing base debt, prove each finding is byte-identical to the plan base; do not label new failures as pre-existing.

- [ ] **Step 2: Run exact architecture residue proofs**

Run:

```bash
rg -n 'sidechat_(messages|runs|leases|revisions)|sidechatRunId|sidechatLease|sidechatRevision|replaySidechat|sidechat:status' worker src shared
rg -n 'compose-draft|composeAgentDraft|inline Compose|Sparkles' worker src
rg -n 'MavenChatAgent' wrangler.jsonc
rg -n 'new_sqlite_classes' wrangler.jsonc
find worker/db/drizzle -type f -newer docs/superpowers/specs/2026-08-11-native-sidechat-mcp-design.md -print
```

Expected:

- no custom Sidechat lifecycle/storage/replay symbols;
- no legacy inline Compose runtime;
- no `MavenChatAgent` binding/migration;
- exactly one new Wrangler SQLite class, `MavenProjectAgent`;
- no new D1 Sidechat migration.

- [ ] **Step 3: Start local development without weakening production config**

Run `bun run db:migrate:dev`, then `bun run dev`. Confirm the Task 1 `remoteBindings: false` configuration starts local Miniflare without creating a remote preview session. Do not change production binding declarations or disable dashboard auth.

- [ ] **Step 4: Exercise the logged-in dashboard end to end without sending publicly**

Using the user's existing authenticated local dashboard session:

1. Open a real dashboard conversation.
2. Start Sidechat with an empty public draft and verify the trusted default appears privately.
3. Start on a second conversation with populated public text; verify native accepted signal clears only that text and leaves attachments.
4. Close/reopen, reload, open a second tab, and switch conversations while work continues.
5. Confirm private transcript recovery and isolated child histories.
6. Trigger a safe read-only local/mock tool and inspect only bounded activity.
7. Trigger a mock write, verify `Always allow | Allow once`, close/reopen with approval pending, approve once, then test owner/admin persistent grant and revocation against a local mock MCP server.
8. Generate a reply draft and select `Add to reply`; verify exact text, visible focus/caret, attachments preserved, Sidechat open on desktop and closed on mobile.
9. Do **not** click public Send, do not alter a real provider, and do not use production OAuth credentials.
10. Archive and confirm read-only behavior.

- [ ] **Step 5: Inspect the required visual matrix**

Capture the real dashboard at 1440×1000, 1100×900, 768×900, and 390×844 for all 13 states in the design. Record `clientWidth`, `scrollWidth`, pane widths, visible control rectangles, overlaps, focus target, caret position, and reduced-motion transition styles. Also inspect keyboard-only and 200% zoom.

Every state must preserve existing typography/bubbles/glass surfaces, use the compact approval buttons, and have zero horizontal page overflow, clipped header controls, or overlapping sub-40px targets.

- [ ] **Step 6: Inspect privacy and no-public-send evidence**

After the E2E run, inspect local D1/public message API/visitor polling/ConversationDO frames/Telegram and email mocks/inbound MCP responses/application logs. Record that no Sidechat message, private context, tool payload, token, header, reasoning, approval, or draft entered a public path, and that the public message count did not increase.

- [ ] **Step 7: Write the verification report**

The report must contain:

- exact base and final commit hashes;
- exact commands and exit codes;
- automated scenario matrix with evidence paths;
- all four viewport measurements and screenshots;
- MCP mock server configuration and read/write/approval results;
- public-runtime regression results;
- privacy/residue/migration proof;
- local limitations stated narrowly;
- confirmation: no public reply, real provider write, deploy, push, remote migration, or remote OAuth configuration.

- [ ] **Step 8: Request a Superpowers code review and fix every load-bearing finding**

Use `superpowers:requesting-code-review` over the entire implementation range. For every valid finding, use `superpowers:receiving-code-review`, reproduce RED, fix narrowly, rerun focused and full verification, append the report, and commit the fix. Repeat until the reviewer returns clean.

- [ ] **Step 9: Commit verification evidence**

```bash
git add docs/superpowers/reports/2026-08-11-native-sidechat-mcp-verification.md docs/superpowers/reports/2026-08-11-native-sidechat-mcp-evidence
git commit -m "test: verify native sidechat locally"
```

Do not push or deploy. Stop the dev server and any local mock MCP server, confirm their ports are clear, and leave the worktree clean.

---

## Final Acceptance Checklist

- [ ] One native `MavenProjectAgent` binding exists per project; `MavenChatAgent` is facet-only.
- [ ] Native `AIChatAgent` owns all private message persistence, concurrency, approvals, reconnect, and recovery.
- [ ] No custom Sidechat runtime lifecycle/storage/replay infrastructure exists.
- [ ] Public visitor chat and inbound ReplyMaven MCP behavior are unchanged.
- [ ] Session/sub-agent routing is authenticated and guessed children fail closed before wakeup.
- [ ] Private context is bounded, project-scoped, canonical-identity-first, and never copied into D1 transcript rows.
- [ ] Existing Sidechat shell uses real native messages and native status without a second visual language.
- [ ] Accepted-only draft transfer, public attachment continuity, exact Add-to-reply, mobile focus, and zero auto-send are proven.
- [ ] Existing knowledge/HTTP tools respect Sidechat audience and execution-time policy.
- [ ] PostHog, Stripe, Slack, Attio, and Linear are simple presets through the same generic MCP client path.
- [ ] Custom HTTPS MCP servers use the same native path and SSRF controls.
- [ ] Read/write classification fails closed, disabled tools stay unavailable, reserved names cannot collide, and stale fingerprints deny execution.
- [ ] `Allow once` uses native approval; `Always allow` is exact owner/admin project policy and invalidates correctly.
- [ ] External writes are never automatically retried and ambiguous results are reported honestly.
- [ ] Raw credentials/tool payloads/reasoning are absent from browser presentation, logs, public D1, visitor transport, Telegram, email, and inbound MCP.
- [ ] Conversation retention/deletion and project deletion remove native private state before public rows.
- [ ] All automated, visual, privacy, migration, residue, and logged-in local E2E gates pass.
- [ ] No rollout, deploy, push, remote migration, production OAuth, real provider mutation, or public visitor reply occurred.
