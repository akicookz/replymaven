# Unified Maven Tool Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ReplyMaven's classifier/planner/compose branches with one channel-aware AI SDK v6 `ToolLoopAgent` while preserving the current public widget's ownership, safety, streaming, persistence, handoff, knowledge, and HTTP-tool behavior.

**Architecture:** The authenticated/public route supplies a trusted `MavenTurnContext`; a shared capability registry filters tools before inference and each executor rechecks authority immediately before execution. Knowledge search and team handoff become normal internal tools, existing HTTP tools are adapted into the registry, and asking a question remains ordinary final text. The public transport and ownership gates stay outside the model loop.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, AI SDK v6 (`ToolLoopAgent`, `tool`, `stepCountIs`), Zod v4, Drizzle/D1, Bun tests.

## Global Constraints

- Execute this plan before the sidechat, MCP connection, and approval plans; all three depend on its interfaces.
- Use Bun only. Never run npm or yarn.
- Keep all backend code Cloudflare Workers-compatible; do not add Node-only APIs.
- Do not add a Cloudflare Agent, Think harness, Durable Object, Workflow, or second message loop.
- Preserve the widget's deterministic scope gate, human-ownership gate, guarded persistence, Telegram path, SSE contract, model fallback, and `[RESOLVED]` handling.
- Channel comes only from server-owned route context. Never accept it from model/tool input.
- Never stream tool arguments or tool results to a browser.
- Existing HTTP tools must remain public-enabled after migration; sidechat access defaults off.
- Tests live beside source files and use `bun:test`.
- Commit steps are checkpoints; do not deploy. Deployment requires separate user approval.

## File Map

| File | Change |
|---|---|
| `worker/db/schema.ts` | Add HTTP-tool channel/access/fingerprint metadata |
| `worker/db/drizzle/0062_maven_tool_audiences.sql` | Add columns with public-compatible defaults |
| `worker/db/maven-tool-audiences.test.ts` | Migration and schema assertions |
| `worker/chat-runtime/types.ts` | Add shared Maven turn/tool/result contracts; remove planner contracts after cutover |
| `worker/chat-runtime/tools/tool-capability.ts` | **Create** authoritative capability helpers and schema fingerprinting |
| `worker/chat-runtime/tools/tool-capability.test.ts` | **Create** audience and stale-schema tests |
| `worker/chat-runtime/tools/build-maven-tool-registry.ts` | **Create** one registry for internal and HTTP tools |
| `worker/chat-runtime/tools/build-maven-tool-registry.test.ts` | **Create** prefilter/executor recheck tests |
| `worker/chat-runtime/tools/internal/search-knowledge.ts` | **Create** AI Search as a model tool |
| `worker/chat-runtime/tools/internal/search-knowledge.test.ts` | **Create** bounded result/source tests |
| `worker/chat-runtime/tools/internal/request-team-help.ts` | **Create** public-only handoff tool |
| `worker/chat-runtime/tools/internal/request-team-help.test.ts` | **Create** channel/precondition tests |
| `worker/chat-runtime/agents/support-agent.ts` | Rename exports to Maven and make it the only loop |
| `worker/chat-runtime/agents/support-agent.test.ts` | **Create** loop configuration tests |
| `worker/chat-runtime/orchestration/run-maven-turn.ts` | **Create** shared turn orchestration and event accumulator |
| `worker/chat-runtime/orchestration/run-maven-turn.test.ts` | **Create** final text/evidence/tool privacy tests |
| `worker/chat-runtime/prompt/build-support-system-prompt.ts` | Replace planner instructions with tool-loop/channel contract |
| `worker/chat-runtime/prompt/build-support-system-prompt.test.ts` | Assert exact public tool-loop rules |
| `worker/chat-runtime/streaming/map-agent-events-to-sse.ts` | Drop raw tool payloads; retain safe status frames |
| `worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts` | Assert inputs/results never reach SSE |
| `worker/chat-runtime/orchestration/handle-widget-message-turn.ts` | Call `runMavenTurn`; retain hard public gates |
| `worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts` | Public parity and ownership regression tests |
| `worker/services/tool-service.ts` | Channel-aware reads and authoritative reload |
| `worker/services/tool-service.test.ts` | Channel defaults/recheck coverage |
| `worker/validation.ts` | Validate HTTP tool audiences and access |
| `worker/validation.test.ts` | Validation tests |
| `worker/index.ts` | Return/update new HTTP-tool settings |
| `src/pages/Tools.tsx` | Add compact Visitor/Sidechat availability and read/write controls |
| `worker/chat-runtime/executor/run-planner-loop.ts` | **Delete after cutover** |
| `worker/chat-runtime/executor/run-planner-loop.test.ts` | **Delete after replacement coverage exists** |
| `worker/chat-runtime/planner/plan-next-action.ts` | **Delete after cutover** |
| `worker/chat-runtime/planner/plan-next-action.test.ts` | **Delete after replacement coverage exists** |
| `worker/chat-runtime/orchestration/run-agentic-pipeline.ts` | **Delete after cutover** |
| `worker/chat-runtime/orchestration/prepare-turn-routing.ts` | **Delete after cutover** |
| `worker/chat-runtime/routing/identify-fast-path.ts` | **Delete; all allowed turns use the loop** |
| `worker/chat-runtime/routing/identify-fast-path.test.ts` | **Delete after replacement coverage exists** |

---

### Task 1: Persist authoritative HTTP-tool audiences

**Files:**
- Modify: `worker/db/schema.ts`
- Create: `worker/db/maven-tool-audiences.test.ts`
- Generate: `worker/db/drizzle/0062_maven_tool_audiences.sql`
- Modify: `worker/services/tool-service.ts`
- Modify: `worker/services/tool-service.test.ts`
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`

**Interfaces:**

```typescript
export type MavenChannel = "public" | "sidechat";
export type MavenToolAccess = "read" | "write";

interface HttpToolPolicyInput {
  allowedChannels: MavenChannel[];
  access: MavenToolAccess;
}
```

- [ ] **Step 1: Write failing schema and validation tests**

Assert that `tools` contains `allowed_channels`, `access`, and `schema_fingerprint`; `createToolSchema` defaults to `allowedChannels: ["public"]` and `access: "read"`; `updateToolSchema` rejects an empty audience array and duplicate channel values.

```typescript
expect(createToolSchema.parse(validTool)).toMatchObject({
  allowedChannels: ["public"],
  access: "read",
});
expect(() => updateToolSchema.parse({ allowedChannels: [] })).toThrow();
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `bun test worker/db/maven-tool-audiences.test.ts worker/validation.test.ts worker/services/tool-service.test.ts`
Expected: FAIL because the columns, schemas, and channel-aware service methods do not exist.

- [ ] **Step 3: Add the Drizzle columns and indexes**

Add to `tools`:

```typescript
allowedChannels: text("allowed_channels").notNull().default('["public"]'),
access: text("access", { enum: ["read", "write"] })
  .notNull()
  .default("read"),
schemaFingerprint: text("schema_fingerprint").notNull().default("legacy-v1"),
```

Add `idx_tools_project_enabled` on `(projectId, enabled)`. Generate the named migration with:

`bun run db:generate --name maven_tool_audiences`

Inspect `0062_maven_tool_audiences.sql` and verify every existing row defaults to public-only without disabling it.

- [ ] **Step 4: Add validation and serialization helpers**

Use one reusable schema:

```typescript
const toolAudienceSchema = z
  .array(z.enum(["public", "sidechat"]))
  .min(1)
  .max(2)
  .refine((values) => new Set(values).size === values.length, "Duplicate channel");
```

Extend create/update schemas with `allowedChannels` and `access`. Store `allowedChannels` as JSON only after Zod validation.

- [ ] **Step 5: Make `ToolService` channel-aware**

Add:

```typescript
async getEnabledToolsForChannel(
  projectId: string,
  channel: MavenChannel,
): Promise<ToolRow[]>;

async getAuthoritativeTool(
  projectId: string,
  toolId: string,
): Promise<ToolRow | null>;
```

`getEnabledToolsForChannel` may filter the small project tool set after validated JSON parsing, but it must fail closed on malformed JSON. Extend `updateTool` picks with all three new fields.

- [ ] **Step 6: Run the focused tests**

Run: `bun test worker/db/maven-tool-audiences.test.ts worker/validation.test.ts worker/services/tool-service.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit the checkpoint**

```bash
git add worker/db/schema.ts worker/db/drizzle worker/db/maven-tool-audiences.test.ts worker/services/tool-service.ts worker/services/tool-service.test.ts worker/validation.ts worker/validation.test.ts
git commit -m "feat: add authoritative tool audiences"
```

### Task 2: Define the shared Maven turn and capability contracts

**Files:**
- Modify: `worker/chat-runtime/types.ts`
- Create: `worker/chat-runtime/tools/tool-capability.ts`
- Create: `worker/chat-runtime/tools/tool-capability.test.ts`

**Interfaces:**

```typescript
export interface MavenTurnContext {
  channel: MavenChannel;
  projectId: string;
  conversationId: string;
  actorUserId: string | null;
  customerId: string | null;
  ownership: ChatOwnershipSnapshot;
}

export interface MavenToolCapability {
  id: string;
  projectId: string;
  connectionId: string | null;
  modelName: string;
  displayName: string;
  source: "internal" | "http" | "mcp";
  allowedChannels: MavenChannel[];
  access: MavenToolAccess;
  enabled: boolean;
  schemaFingerprint: string;
}

export interface MavenToolDefinition {
  capability: MavenToolCapability;
  description: string;
  inputSchema: FlexibleSchema<unknown>;
  execute(input: unknown, options: { abortSignal?: AbortSignal }): Promise<unknown>;
  reauthorize(): Promise<MavenToolCapability | null>;
}
```

- [ ] **Step 1: Write failing capability tests**

Cover public/sidechat allow/deny, disabled tools, project mismatch, fingerprint mismatch, and stable SHA-256 fingerprint output for equivalent JSON schemas.

```typescript
expect(authorizeCapability(sidechatContext, publicOnly)).toEqual({
  ok: false,
  code: "channel_not_allowed",
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/chat-runtime/tools/tool-capability.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure authorization helpers**

Export:

```typescript
export function authorizeCapability(
  context: MavenTurnContext,
  capability: MavenToolCapability,
): { ok: true } | { ok: false; code: MavenToolAuthorizationError };

export async function fingerprintJsonSchema(schema: unknown): Promise<string>;

export function parseAllowedChannels(raw: string): MavenChannel[];
```

`fingerprintJsonSchema` recursively sorts object keys before SHA-256 hashing with Web Crypto. `parseAllowedChannels` returns `[]` on malformed/unknown values.

- [ ] **Step 4: Add the new types without deleting planner types yet**

Keep the compile green during cutover. Planner type deletion happens only in Task 7 after all imports move.

- [ ] **Step 5: Run tests and typecheck**

Run: `bun test worker/chat-runtime/tools/tool-capability.test.ts && bun run build`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/chat-runtime/types.ts worker/chat-runtime/tools/tool-capability.ts worker/chat-runtime/tools/tool-capability.test.ts
git commit -m "feat: define Maven tool capabilities"
```

### Task 3: Build one registry with defense-in-depth authorization

**Files:**
- Create: `worker/chat-runtime/tools/build-maven-tool-registry.ts`
- Create: `worker/chat-runtime/tools/build-maven-tool-registry.test.ts`
- Modify: `worker/chat-runtime/tools/http-tool-executor.ts`
- Delete after cutover: `worker/chat-runtime/tools/build-tool-registry.ts`

**Interfaces:**

```typescript
export interface MavenToolRegistryResult {
  tools: ToolSet;
  capabilities: Map<string, MavenToolCapability>;
}

export function buildMavenToolRegistry(options: {
  context: MavenTurnContext;
  definitions: MavenToolDefinition[];
  onStart?: (event: SafeToolActivity) => void;
  onFinish?: (event: SafeToolActivity) => void;
}): MavenToolRegistryResult;
```

- [ ] **Step 1: Write failing registry tests**

Tests must prove:

- a public-only tool is absent from a sidechat registry;
- an MCP tool is absent from a public registry even if malformed persisted metadata claims public access;
- a tool disabled after registry construction is rejected by `reauthorize` before its side effect runs;
- a changed fingerprint is rejected;
- lifecycle callbacks contain only ID/display name/source/status/duration, never input/output.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/chat-runtime/tools/build-maven-tool-registry.test.ts`
Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement the registry wrapper**

For each initially authorized definition, build an AI SDK tool whose executor performs the second check:

```typescript
execute: async (input, { abortSignal }) => {
  const authoritative = await definition.reauthorize();
  if (!authoritative) return { error: "tool_unavailable" };
  const authorization = authorizeCapability(options.context, authoritative);
  if (!authorization.ok) return { error: authorization.code };
  if (authoritative.schemaFingerprint !== definition.capability.schemaFingerprint) {
    return { error: "tool_schema_changed" };
  }
  return definition.execute(input, { abortSignal });
}
```

Hard-code `source === "mcp" && channel === "public"` to deny even before normal audience checks.

- [ ] **Step 4: Adapt existing HTTP tools**

Move dynamic Zod parameter construction into an HTTP adapter that produces `MavenToolDefinition`. Retain the current SSRF, timeout, mapping, truncation, and abort behavior. Its `reauthorize` reloads `ToolService.getAuthoritativeTool`, decrypts headers only after authorization, and recomputes the fingerprint from persisted parameters.

- [ ] **Step 5: Run tests**

Run: `bun test worker/chat-runtime/tools/build-maven-tool-registry.test.ts worker/services/tool-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/chat-runtime/tools worker/services/tool-service.ts worker/services/tool-service.test.ts
git commit -m "feat: build channel-aware Maven tool registry"
```

### Task 4: Turn knowledge search into an internal tool

**Files:**
- Create: `worker/chat-runtime/tools/internal/search-knowledge.ts`
- Create: `worker/chat-runtime/tools/internal/search-knowledge.test.ts`
- Modify: `worker/chat-runtime/retrieval/run-ai-search.ts`

**Interfaces:**

```typescript
interface SearchKnowledgeInput {
  query: string;
}

interface SearchKnowledgeResult {
  found: boolean;
  context: string;
  sources: SourceReference[];
  topScore: number;
}
```

- [ ] **Step 1: Write failing tests**

Cover both channels, one bounded query, 12,000-character context cap, maximum five safe sources, an empty-result shape, and a normalized unavailable result. Assert raw AI Search response objects are not returned.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/chat-runtime/tools/internal/search-knowledge.test.ts`
Expected: FAIL because the internal tool does not exist.

- [ ] **Step 3: Implement `createSearchKnowledgeTool`**

```typescript
export function createSearchKnowledgeTool(dependencies: {
  env: AppEnv;
  db: DrizzleD1Database<Record<string, unknown>>;
  context: MavenTurnContext;
  collectSources(sources: SourceReference[]): void;
}): MavenToolDefinition;
```

Use the existing `runAiSearch` implementation with the project filter. The tool accepts only `query`; project ID comes from trusted context. Merge/dedupe sources into the turn accumulator, not message/tool logs.

- [ ] **Step 4: Add exact prompt guidance**

The common tool-loop prompt must say: search knowledge when project facts are needed; answer directly when it is not; ask a normal conversational question if information is missing; never invent a search result.

- [ ] **Step 5: Run tests**

Run: `bun test worker/chat-runtime/tools/internal/search-knowledge.test.ts worker/chat-runtime/retrieval/run-ai-search.test.ts worker/chat-runtime/prompt/build-support-system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/chat-runtime/tools/internal worker/chat-runtime/retrieval/run-ai-search.ts worker/chat-runtime/prompt
git commit -m "feat: expose knowledge search to Maven loop"
```

### Task 5: Turn handoff into a public-only internal tool

**Files:**
- Create: `worker/chat-runtime/tools/internal/request-team-help.ts`
- Create: `worker/chat-runtime/tools/internal/request-team-help.test.ts`
- Modify: `worker/chat-runtime/post-turn/escalation.ts`

**Interfaces:**

```typescript
interface RequestTeamHelpInput {
  summary: string;
}

type RequestTeamHelpResult =
  | { status: "requested"; visitorMessage: string }
  | { status: "contact_required"; requiredFields: Array<"name" | "email"> }
  | { status: "unavailable"; visitorMessage: string };
```

- [ ] **Step 1: Write failing tests**

Cover sidechat exclusion, explicit public availability, contact-required without changing ownership, one successful escalation, idempotent repeated calls, and authoritative ownership recheck before Telegram side effects.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/chat-runtime/tools/internal/request-team-help.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the adapter around existing escalation behavior**

The tool schema accepts only a bounded summary. Conversation/project/customer/contact state comes from trusted dependencies. Reuse `createEscalation`; do not recreate Telegram logic. If contact is missing, return structured state so Maven asks for it as ordinary text on the same turn.

- [ ] **Step 4: Remove planner-only handoff decisions from prompts**

Replace `offer_handoff`, `collect_contact`, and `escalate` language with the native tool rule. Keep exact existing product wording helpers for visitor-facing handoff messages.

- [ ] **Step 5: Run focused tests**

Run: `bun test worker/chat-runtime/tools/internal/request-team-help.test.ts worker/chat-runtime/post-turn/escalation.test.ts worker/chat-runtime/contact-support/contact-support.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/chat-runtime/tools/internal/request-team-help.ts worker/chat-runtime/tools/internal/request-team-help.test.ts worker/chat-runtime/post-turn/escalation.ts worker/chat-runtime/prompt
git commit -m "feat: expose team handoff to Maven loop"
```

### Task 6: Make `ToolLoopAgent` the only Maven loop

**Files:**
- Modify: `worker/chat-runtime/agents/support-agent.ts`
- Create: `worker/chat-runtime/agents/support-agent.test.ts`
- Create: `worker/chat-runtime/orchestration/run-maven-turn.ts`
- Create: `worker/chat-runtime/orchestration/run-maven-turn.test.ts`
- Modify: `worker/chat-runtime/streaming/map-agent-events-to-sse.ts`
- Modify: `worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts`
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.ts`
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.test.ts`

**Interfaces:**

```typescript
export interface MavenTurnResult {
  fullStream: AsyncIterable<MavenStreamPart>;
  collectedSources: SourceReference[];
  toolActivity: SafeToolActivity[];
}

export async function runMavenTurn(options: {
  context: MavenTurnContext;
  dependencies: MavenTurnDependencies;
  conversationHistory: ConversationTurnMessage[];
  currentMessage: string;
  image?: SupportAgentImage | null;
}): Promise<MavenTurnResult>;
```

- [ ] **Step 1: Write failing loop tests**

Inject a fake model/stream and assert:

- one agent owns tool selection and final composition;
- `stepCountIs(8)` is the only loop bound;
- the loop can search, call an HTTP tool, and then produce final text without a compose model call;
- a plain question produces final text without an `ask_user` tool;
- tool inputs/results are available to the loop but absent from browser events;
- source references collected from multiple searches are deduped and bounded.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/chat-runtime/agents/support-agent.test.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts`
Expected: FAIL.

- [ ] **Step 3: Promote `streamSupportAgent` to the shared Maven agent**

Rename the export to `streamMavenAgent`, accept a ready `ToolSet`, delete its HTTP-specific registry construction and `streamText` fallback, and configure every turn through the same agent:

```typescript
const agent = new ToolLoopAgent({
  model,
  instructions: options.systemPrompt,
  tools: options.tools,
  stopWhen: stepCountIs(8),
  toolChoice: Object.keys(options.tools).length ? "auto" : "none",
  temperature: 0.3,
  maxOutputTokens: 2048,
});
```

An empty registry still uses this `ToolLoopAgent` with `toolChoice: "none"`; there is no second no-tool generation path.

- [ ] **Step 4: Implement `runMavenTurn`**

Build internal and HTTP definitions, create the registry, build the common prompt with `channel`, run the agent once, and return a stream accumulator. Do not call a classifier, planner, fast-path composer, or second model.

- [ ] **Step 5: Make the SSE adapter payload-safe**

Map text deltas and safe status labels. Explicitly discard `tool-call.input`, `tool-result.output`, reasoning parts, provider metadata, and unknown object payloads. A public safe status frame may contain only:

```typescript
{ phase: "tool", message: "Checking project information" }
```

- [ ] **Step 6: Run focused tests**

Run: `bun test worker/chat-runtime/agents/support-agent.test.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts worker/chat-runtime/prompt/build-support-system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit the checkpoint**

```bash
git add worker/chat-runtime/agents worker/chat-runtime/orchestration/run-maven-turn.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/chat-runtime/streaming worker/chat-runtime/prompt
git commit -m "feat: run Maven through one tool loop"
```

### Task 7: Cut the public widget over and delete the branch planner

**Files:**
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts`
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts`
- Delete: `worker/chat-runtime/executor/run-planner-loop.ts`
- Delete: `worker/chat-runtime/executor/run-planner-loop.test.ts`
- Delete: `worker/chat-runtime/planner/plan-next-action.ts`
- Delete: `worker/chat-runtime/planner/plan-next-action.test.ts`
- Delete: `worker/chat-runtime/orchestration/run-agentic-pipeline.ts`
- Delete: `worker/chat-runtime/orchestration/prepare-turn-routing.ts`
- Delete: `worker/chat-runtime/routing/identify-fast-path.ts`
- Delete: `worker/chat-runtime/routing/identify-fast-path.test.ts`
- Modify: `worker/chat-runtime/types.ts`

- [ ] **Step 1: Add public parity tests before changing the handler**

Cover greeting, FAQ/knowledge answer, HTTP lookup, missing-information question, handoff with/without contact, resolved token, human takeover during generation, archived conversation, model fallback, abort, and final sources. Assert `runMavenTurn` is called once per allowed turn.

- [ ] **Step 2: Run the handler test and retain the failure output**

Run: `bun test worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts`
Expected: new assertions FAIL because the handler still calls `prepareTurnRouting`/`runAgenticTurn`.

- [ ] **Step 3: Replace only the model-routing section**

Keep request validation, saved visitor message, scope gate, operational conversation check, ownership snapshot, abort, model fallback, guarded bot insert, realtime broadcast, Telegram, and final SSE handling. Replace classifier/fast-path/planner calls with:

```typescript
const turn = await runMavenTurn({
  context: {
    channel: "public",
    projectId: context.project.id,
    conversationId: context.conversation.id,
    actorUserId: null,
    customerId: context.conversation.customerId,
    ownership: ownershipAtTurnStart,
  },
  dependencies,
  conversationHistory,
  currentMessage: context.payload.content,
  image,
});
```

- [ ] **Step 4: Delete obsolete planner code and types**

Use `rg` to prove no production imports remain, then delete the listed files and planner-only types/prompt sections. Do not delete the deterministic scope classifier or ownership state machine.

- [ ] **Step 5: Run public runtime tests**

Run:

```bash
bun test worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts worker/chat-runtime/tools worker/chat-runtime/post-turn worker/chat-runtime/contact-support worker/chat-runtime/streaming
```

Expected: PASS.

- [ ] **Step 6: Run the full backend suite and build**

Run: `bun test worker shared && bun run build`
Expected: no new failures; if an unrelated baseline failure exists, record its exact test and confirm it also fails before this task's changes.

- [ ] **Step 7: Commit the checkpoint**

```bash
git add worker/chat-runtime
git commit -m "refactor: replace planner with unified Maven loop"
```

### Task 8: Expose HTTP-tool audience settings without changing the visual system

**Files:**
- Modify: `worker/index.ts`
- Modify: `src/pages/Tools.tsx`

- [ ] **Step 1: Add route-level tests to `worker/services/tool-service.test.ts` or extract route handlers if direct route tests become unwieldy**

Assert owner/admin can change channels/access, a member cannot expand tool audience, malformed JSON never reaches storage, and API responses return parsed `allowedChannels`.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test worker/services/tool-service.test.ts worker/validation.test.ts`
Expected: FAIL on missing route behavior.

- [ ] **Step 3: Update CRUD routes**

Parse/serialize audiences at the API boundary, recompute `schemaFingerprint` whenever name/description/parameters change, and require owner/admin for audience or access changes. Existing members retain existing non-policy edits only if current routes already allow them.

- [ ] **Step 4: Add compact settings to the existing tool form**

Reuse current labels, selects, switches, spacing, and card surface. Add:

- `Available to visitors` switch (on for migrated tools);
- `Available in sidechat` switch (off by default);
- `Access` select (`Read` / `Write`).

Do not add a new page, badge stack, gradient, divider, or sparkle icon.

- [ ] **Step 5: Run build and visually inspect Tools**

Run: `bun run build` and `bun run dev`. Inspect the existing Actions & Tools route at desktop and 390px width. Confirm labels wrap, controls retain current compact sizing, and no row separators were introduced.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add worker/index.ts src/pages/Tools.tsx
git commit -m "feat: configure tool audiences"
```

### Task 9: Final verification and public parity checkpoint

**Files:**
- Verify: all files in this plan's File Map
- Modify only if a verification failure is caused by this implementation

- [ ] Run `rg -n "runPlannerLoop|planNextAction|prepareTurnRouting|runAgenticTurn|identifyFastPath" worker src` and expect no production matches.
- [ ] Run `rg -n "tool-result|toolCall.*input|toolResult.*output" worker/chat-runtime/streaming` and inspect every match to prove payloads are discarded.
- [ ] Run `bun test worker/chat-runtime worker/services/tool-service.test.ts worker/validation.test.ts shared`.
- [ ] Run `bun run build`.
- [ ] Run `bun run lint`; fix only new errors and record unrelated pre-existing failures exactly.
- [ ] In local development, exercise greeting, knowledge question, HTTP tool, missing-info question, handoff, human takeover mid-stream, and abort. Do not deploy.
- [ ] Commit only the verification fixes, if any:

```bash
git add worker src
git commit -m "test: verify unified Maven loop"
```
