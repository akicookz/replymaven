# Sidechat Runtime Clean-Slate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the custom Sidechat runtime completely while retaining the Sidechat presentation layer, the public Maven runtime, and migration `0062` tool-audience policy.

**Architecture:** The cleanup removes Sidechat execution first, then persistence/realtime state, then client orchestration. Retained UI components become controlled presentation components with local open/draft state only; they cannot fetch, submit, persist, replay, or synthesize Sidechat work. Public chat remains on the existing ChatService/SSE/ConversationDO path, and project tools retain their dormant `public | sidechat` policy without an active private executor.

**Tech Stack:** Bun, TypeScript, React 19, TanStack React Query, Hono, Drizzle/D1, Cloudflare Workers and Durable Objects, AI SDK v6.

## Global Constraints

- Do not add `AIChatAgent`, `useAgentChat`, Agent Durable Object bindings, Agent SDK migrations, fibers, MCP execution, or approvals in this cleanup.
- Do not deploy, push, apply remote migrations, or run a destructive local database reset.
- Preserve migration `0062_maven_tool_audiences.sql` and its tool audience/access behavior.
- Preserve the existing `agents` package dependency and account-level ReplyMaven MCP server; that dependency predates Sidechat and is not the private Sidechat runtime.
- Delete unapplied migrations `0063` and `0064`; do not replace them with compensating D1 migrations.
- Preserve the public Maven tool loop, cancellation terminalization, handoff ownership fences, HTTP audit linkage, public ConversationDO replay ordering, Telegram behavior, and widget SSE behavior.
- Preserve the Sidechat visual shell, shared chat primitives, Start/Open entry presentation, responsive layout, status-dot component, and Add-to-reply component contract.
- The interim Sidechat shell must not call a deleted endpoint, imitate acceptance, create fake messages/statuses, or fall back to inline Compose.
- Keep unrelated untracked workspace files untouched: `.superpowers/brainstorm/`, `docs/superpowers/plans/2026-08-06-customers-table.md`, and `public/integrations/lovable.svg`.
- Use function declarations for named functions and components; use Bun for tests and scripts; use `apply_patch` for edits.

## Full-Sweep Classification

### Retain as dormant policy

- `worker/db/drizzle/0062_maven_tool_audiences.sql`
- `worker/validation.ts`: `MavenChannel`, `toolAudienceSchema`, access policy validation
- `worker/services/tool-service.ts` and route/UI policy handling
- `worker/chat-runtime/tools/tool-capability.ts`
- Channel filtering in `build-maven-tool-registry.ts` and its authorization tests
- `worker/chat-runtime/tools/internal/search-knowledge.ts`
- `worker/chat-runtime/tools/internal/search-knowledge.test.ts`
- `worker/routes/tool-handlers.test.ts` and `worker/services/tool-service.test.ts`
- `src/pages/Tools.tsx` and `src/pages/Tools.test.tsx`

These files may continue to contain the literal `sidechat` only as a configured audience value. They do not supply a Sidechat runtime.

### Retain as presentation

- `SidechatPane`, `FocusSidechatLayout`, `SidechatStatusDot`
- Perspective-aware `ChatThread`, `MessageBubble`, and `Composer`
- `src/components/inbox/ReadingPane.tsx`, `src/components/inbox/FocusView.tsx`, and `src/components/inbox/ReadingHeader.tsx`
- The compact-header fix for constrained reading panes
- Pure UI helpers for alignment, Shift+Tab, pane mode, status-dot appearance, archived interaction, and Add-to-reply intent

### Remove completely

- D1 Sidechat message/lifecycle schema and migrations
- Sidechat ChatService methods, queries, leases, runs, retries, settlement, revision, and coordination
- Sidechat HTTP routes and handlers
- Sidechat turn runner, private prompt, role mapping, artifact publication, and `present_reply_draft` runtime tool
- Non-public HTTP execution branch in the current Maven runner/executor
- Sidechat ConversationDO replay and all Sidechat WebSocket events/cursors
- Sidechat React Query caches, optimistic rows, polling, reconciliation, run correlation, and retry orchestration
- Obsolete Sidechat/MCP plans and reports that describe the removed architecture

---

### Task 1: Remove every executable Sidechat server path

**Files:**
- Create: `worker/routes/removed-sidechat-routes.integration.test.ts`
- Create: `worker/routes/removed-sidechat-routes.mounted.fixture.test.ts`
- Delete: `worker/chat-runtime/orchestration/run-sidechat-turn.ts`
- Delete: `worker/chat-runtime/orchestration/run-sidechat-turn.test.ts`
- Delete: `worker/chat-runtime/tools/internal/present-reply-draft.ts`
- Delete: `worker/chat-runtime/tools/internal/present-reply-draft.test.ts`
- Delete: `worker/routes/sidechat-handlers.ts`
- Delete: `worker/routes/sidechat-handlers.test.ts`
- Delete: `worker/routes/sidechat-routes.integration.test.ts`
- Delete: `worker/routes/sidechat-routes.mounted.fixture.test.ts`
- Modify: `worker/index.ts`
- Modify: `worker/validation.ts`
- Modify: `worker/validation.test.ts`
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.ts`
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.test.ts`
- Modify: `worker/chat-runtime/agents/support-agent.ts`
- Modify: `worker/chat-runtime/agents/support-agent.test.ts`
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.ts`
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.test.ts`
- Modify: `worker/chat-runtime/prompt/sections.ts`
- Modify: `worker/chat-runtime/types.ts`
- Modify: `worker/chat-runtime/types.test.ts`
- Modify: `worker/chat-runtime/tools/http-tool-executor.ts`
- Modify: `worker/chat-runtime/tools/build-maven-tool-registry.test.ts`

**Interfaces:**
- Consumes: Existing public `runMavenTurn`, `MavenTurnContext`, public tool dependencies, and `MavenChannel` tool policy.
- Produces: A public-only Maven execution boundary; generic tool-policy authorization remains, but no production caller can execute a private Sidechat turn.

- [ ] **Step 1: Write failing behavior tests for the removed route and public result shape**

Create an isolated mounted-Worker fixture using the existing Cloudflare module shims and authenticated owner session. Call the real Hono app at all three legacy paths:

```ts
const paths = [
  "/api/projects/project-1/conversations/conversation-1/sidechat",
  "/api/projects/project-1/conversations/conversation-1/sidechat/messages",
  "/api/projects/project-1/conversations/conversation-1/sidechat/retry",
];

for (const path of paths) {
  const response = await workerModule.default.fetch(
    new Request(`https://app.test${path}`, {
      method: path.endsWith("/sidechat") ? "GET" : "POST",
      headers: { "x-test-user": "owner-1", "content-type": "application/json" },
      body: path.endsWith("/sidechat") ? undefined : "{}",
    }),
    createEnv(),
    createExecutionContext(),
  );
  expect(response.status).toBe(404);
}
```

Add a public `runMavenTurn` regression to the existing real runner harness:

```ts
const result = await runMavenTurn(createPublicOptions());
expect("artifact" in result).toBe(false);
```

These tests catch two real regressions: remounting the old authenticated API and leaking the private reply-draft artifact through the public runtime result.

- [ ] **Step 2: Run the tests and capture RED**

```bash
bun test \
  worker/routes/removed-sidechat-routes.integration.test.ts \
  worker/chat-runtime/orchestration/run-maven-turn.test.ts
```

Expected: FAIL because the owner receives a non-404 response from the mounted custom route and `MavenTurnResult` currently exposes `artifact`.

- [ ] **Step 3: Delete Sidechat routes, validation, scheduling, and broadcasts from the Worker entrypoint**

Remove the three route mounts, `canAccessSidechatRouteProject`, `createSidechatMutationOptions`, background `runSidechatTurn` scheduling, Sidechat broadcast imports, and Sidechat Zod schemas. Keep the authenticated project/team middleware used by unrelated dashboard routes.

The resulting validation boundary keeps the policy type but has no Sidechat request schemas:

```ts
export type MavenChannel = "public" | "sidechat";
export type MavenToolAccess = "read" | "write";

export const toolAudienceSchema = z
  .array(z.enum(["public", "sidechat"]))
  .min(1)
  .max(2)
  .refine((values) => new Set(values).size === values.length, "Duplicate channel");
```

- [ ] **Step 4: Make the existing Maven runner public-only**

Remove `MavenArtifact`, pending/published artifact cells, reply-draft definition insertion, private public-dependency bypass, and the `artifact` getter. Narrow the runner context:

```ts
export type PublicMavenTurnContext = MavenTurnContext & {
  channel: "public";
  actorUserId: null;
};

export interface MavenTurnResult {
  fullStream: AsyncIterable<MavenStreamPart>;
  collectedSources: SourceReference[];
  toolActivity: SafeToolActivity[];
  httpExecutionIds: string[];
}
```

`runMavenTurn` must always require `publicToolDependencies`, always create the public `request_team_help` and knowledge tools, and always pass a public context to the HTTP executor. Keep fallback priming, stream terminalization, source collection, tool activity, abort handling, and audit ID collection unchanged.

- [ ] **Step 5: Remove private prompt and role-mapping branches**

Make `buildSupportSystemPrompt` public-only: remove `SupportPromptOptions.channel`, `buildSidechatSupportSystemPrompt`, the channel argument from prompt-section helpers, and private evidence wording. Retain the public `<channel-contract>` text as an unconditional public-safety section.

Replace the channel-aware SDK mapper with a public mapper:

```ts
export function toPublicSdkConversationMessages(
  conversationHistory: ConversationTurnMessage[],
): ModelMessage[] {
  return conversationHistory.map((message) => {
    if (message.role === "visitor") return { role: "user", content: message.content };
    if (message.role === "bot" || message.role === "agent") {
      return { role: "assistant", content: message.content };
    }
    return { role: "system", content: message.content };
  });
}
```

`streamMavenAgent` no longer accepts `channel`; it calls this mapper directly.

- [ ] **Step 6: Remove the non-public HTTP execution shortcut**

Require the public execution dependencies in `createHttpToolDefinition`; delete the branch that executes when `context.channel !== "public"`. The current executor must always follow registry reauthorization, exact public ownership acquisition, rate-limit permit, fetch, and audit persistence. Keep `authorizeCapability` and registry-side dormant Sidechat policy tests; remove only tests that actually execute a Sidechat HTTP tool through the current runner.

- [ ] **Step 7: Delete runtime-only files and tests using `apply_patch`**

Delete the listed runner, handler, reply-draft tool, mounted fixture, integration test, and runtime-only tests. Do not use `rm`, `git checkout`, or a range revert.

- [ ] **Step 8: Run focused public runtime tests and capture GREEN**

Run:

```bash
bun test \
  worker/routes/removed-sidechat-routes.integration.test.ts \
  worker/chat-runtime/orchestration/run-maven-turn.test.ts \
  worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts \
  worker/chat-runtime/agents/support-agent.test.ts \
  worker/chat-runtime/prompt/build-support-system-prompt.test.ts \
  worker/chat-runtime/tools/build-maven-tool-registry.test.ts \
  worker/chat-runtime/tools/tool-capability.test.ts \
  worker/chat-runtime/tools/internal/request-team-help.test.ts
```

Expected: PASS with no Sidechat runner/route/artifact tests remaining and all public loop/fallback/cancellation/tool tests green.

- [ ] **Step 9: Commit the executable-runtime removal**

```bash
git add worker/index.ts worker/validation.ts worker/validation.test.ts worker/chat-runtime worker/routes
git commit -m "refactor: remove custom sidechat execution runtime"
```

---

### Task 2: Remove Sidechat D1 persistence and ChatService lifecycle

**Files:**
- Delete: `worker/db/drizzle/0063_internal_sidechat_channel.sql`
- Delete: `worker/db/drizzle/0064_sidechat_coordination_revision.sql`
- Delete: `worker/db/drizzle/meta/0063_snapshot.json`
- Delete: `worker/db/drizzle/meta/0064_snapshot.json`
- Delete: `worker/db/sidechat-channel.test.ts`
- Modify: `worker/db/drizzle/meta/_journal.json`
- Modify: `worker/db/schema.ts`
- Modify: `worker/services/chat-service.ts`
- Modify: `worker/services/chat-service.test.ts`
- Modify: `worker/services/billing-service.ts`
- Modify: `worker/services/billing-service.test.ts`
- Modify: `worker/services/dashboard-service.ts`
- Modify: `worker/services/conversation-retention-service.ts`
- Modify: `worker/services/conversation-retention-service.test.ts`
- Modify: `worker/durable-objects/conversation-do.ts`
- Modify: `worker/realtime/broadcast.ts`
- Modify: `worker/realtime/broadcast.test.ts`
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts`
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts`
- Modify: `worker/mcp-server.ts`
- Modify: `worker/index.ts`

**Interfaces:**
- Consumes: Public-only execution from Task 1 and the existing pre-Sidechat D1 tables.
- Produces: Public-only `messages` rows and public-only conversation services without custom channel/lifecycle columns.

- [ ] **Step 1: Write a failing public-schema compatibility test**

Add a focused ChatService harness whose real SQLite `conversations` and `messages` tables contain every public column but none of the custom Sidechat columns. Seed one conversation and one visitor message, then exercise the real service:

```ts
test("public conversation and message reads require no private Sidechat columns", async () => {
  const { service, conversationId } = createPublicOnlySchemaHarness();

  const conversation = await service.getConversationById(conversationId);
  const messages = await service.getPublicMessages(conversationId);

  expect(conversation?.id).toBe(conversationId);
  expect(messages.map((message) => message.content)).toEqual(["Hello"]);
});
```

The hand-written fixture must derive its columns from migration `0062`, not from the current Drizzle schema. This catches any public query that still selects or filters Sidechat lifecycle/message columns.

- [ ] **Step 2: Run the test and capture RED**

```bash
bun test worker/services/chat-service.test.ts -t "requires no private Sidechat columns"
```

Expected: FAIL with SQLite `no such column` from the current Sidechat-aware public query.

- [ ] **Step 3: Delete migrations and restore the migration journal to 0062**

Delete only SQL/snapshots `0063` and `0064`. Remove exactly their two journal entries; do not renumber or edit `0062_snapshot.json`. The final journal tail is:

```json
{
  "idx": 62,
  "version": "6",
  "when": 1786205342238,
  "tag": "0062_maven_tool_audiences",
  "breakpoints": true
}
```

Keep this existing `0062` journal object verbatim; only delete the later `0063` and `0064` objects.

- [ ] **Step 4: Remove D1 columns and indexes from Drizzle schema**

Delete the five Sidechat conversation fields, the message `channel`, `kind`, and `metadata` fields, and `idx_messages_conversation_channel_created`. Keep all pre-existing public message fields and indexes.

- [ ] **Step 5: Refactor ChatService to public-only storage**

Delete all Sidechat input/result types, coordination helpers, expiry normalization, claim/start/settle/complete methods, Sidechat history/pagination methods, and Sidechat inserts.

Keep explicit public method names where callers already use them, but remove channel predicates and synthetic channel projections. Replace the generic channel lookup with:

```ts
async getPublicMessageById(messageId: string): Promise<MessageRow | null> {
  const rows = await this.db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  return rows[0] ?? null;
}
```

Public inserts return ordinary `MessageRow` objects without `channel`, `kind`, or `metadata`. Conversation list/detail/update projections no longer expose Sidechat fields or run expired-lease normalization.

- [ ] **Step 6: Remove downstream channel predicates without weakening public behavior**

Update billing counts, dashboard counts, email/delivery/read lookups, retention attachment collection, MCP history, widget polling, dashboard pagination, and deletion to use the sole public message table. Preserve:

- public ownership compare-and-set behavior;
- delivery/read receipt timestamp ordering;
- email lookup and delete scoping by conversation/project;
- billing bot-role/status rules;
- all-channel attachment cleanup comments by replacing them with ordinary conversation attachment cleanup;
- explicit tenant and conversation predicates.

- [ ] **Step 7: Remove server Sidechat realtime functions while preserving public lossless replay**

Delete `broadcastSidechatMessage`, delta/activity/status broadcasts, Sidechat row sanitizers, private replay, private cursor lookup, and Sidechat resume fields from the DO reader interface. Keep `StableMessagePosition`, the one-second inclusive public replay lookback, `(createdAt,id)` filtering/sorting, agent/visitor audience checks, and all public dashboard/widget events.

Use `getPublicMessageById` in ConversationDO resume and receipt handlers.

- [ ] **Step 8: Update fixtures and focused tests**

Remove Sidechat columns from SQLite fixtures. Rewrite public row assertions to match the schema shape without adding fake `channel: "public"`. Keep regression coverage for:

- public detail/pagination/replay;
- public delivery/read/email/delete;
- billing usage;
- retention attachment cleanup;
- dashboard totals;
- public message broadcast payload privacy;
- same-second public replay peers.

- [ ] **Step 9: Run focused persistence/realtime tests and capture GREEN**

```bash
bun test \
  worker/services/chat-service.test.ts \
  worker/services/billing-service.test.ts \
  worker/services/conversation-retention-service.test.ts \
  worker/realtime/broadcast.test.ts \
  worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts
```

Expected: PASS; no custom Sidechat storage/replay remains, while public message behavior stays green.

- [ ] **Step 10: Verify the real local D1 requires no down migration**

Run read-only inspection:

```bash
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/73896bcafb35014843e8a8f74204245747b7a69a46687a59aa49b4ba48893804.sqlite \
  "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 5;"
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/73896bcafb35014843e8a8f74204245747b7a69a46687a59aa49b4ba48893804.sqlite \
  "PRAGMA table_info(conversations);"
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/73896bcafb35014843e8a8f74204245747b7a69a46687a59aa49b4ba48893804.sqlite \
  "PRAGMA table_info(messages);"
```

Expected from the planning sweep: local migrations end at `0060`; neither table has Sidechat runtime columns. Do not modify or rebuild the local database. If the database changed between planning and execution, stop and report before any local D1 mutation.

- [ ] **Step 11: Commit persistence removal**

```bash
git add worker/db worker/services worker/durable-objects worker/realtime worker/chat-runtime/orchestration/handle-widget-message-turn.ts worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts worker/mcp-server.ts worker/index.ts
git commit -m "refactor: remove sidechat persistence lifecycle"
```

---

### Task 3: Remove Sidechat WebSocket and client data orchestration

**Files:**
- Modify: `shared/ws-events.ts`
- Modify: `src/lib/use-conversation-ws.ts`
- Modify: `src/lib/use-conversation-ws.test.ts`
- Modify: `src/pages/Conversations.tsx`
- Modify: `src/lib/inbox/types.ts`

**Interfaces:**
- Consumes: Public-only realtime and D1 services from Task 2.
- Produces: Public-only dashboard WebSocket state plus local Sidechat pane visibility/draft state; no Sidechat network/cache layer.

- [ ] **Step 1: Write failing client transport behavior tests**

Use the real conversation reducer with one public message already present, then feed the retired private event as an unknown server frame. The clean client must ignore it rather than mutating any transcript or cursor:

```ts
test("ignores retired private Sidechat frames", () => {
  const initial = reduceConversationMessageEvent(emptyPublicState(), {
    type: "message:new",
    conversationId: "conversation-1",
    message: createPublicPayload("public-1", 1_000),
  });

  const next = reduceConversationMessageEvent(initial, {
    type: "sidechat:message",
    conversationId: "conversation-1",
    message: {
      id: "private-1",
      role: "bot",
      content: "private",
      createdAt: 2_000,
    },
  } as unknown as ServerEvent);

  expect(next).toEqual(initial);
});
```

In the real socket harness, capture the JSON sent after `open` and assert the exact public resume frame:

```ts
expect(sentFrames[0]).toEqual({
  type: "resume",
  lastMessageId: "public-1",
});
```

These tests catch a private event being accepted by the public dashboard client and a private cursor leaking into reconnect protocol state.

- [ ] **Step 2: Run tests and capture RED**

```bash
bun test src/lib/use-conversation-ws.test.ts
```

Expected: FAIL because Sidechat reducers, resume cursors, and page cache/runtime strings exist.

- [ ] **Step 3: Reduce the shared WebSocket contract to public events**

Delete `SidechatStatus`, coordination snapshots, Sidechat message metadata/payloads/events, `isSidechatServerEvent`, and `lastSidechatMessageId`. Keep public event unions, customer updates, `StableMessagePosition`, and public cursor comparison.

- [ ] **Step 4: Remove Sidechat state from the WebSocket hook**

Delete Sidechat cache/message types, ephemeral stores, terminal reducers, cache synchronization helpers, and all Sidechat event cases. Keep public query-cache reconciliation, visitor/agent connection behavior, public ordered dedupe, optimistic-public reconciliation, abort/reconnect, and customer refresh handling.

- [ ] **Step 5: Remove Sidechat network/cache orchestration from Conversations**

Delete Sidechat history queries, polling projection merges, fetch generations, optimistic message insertion, POST/retry/pagination mutations, accepted-run bookkeeping, reconciliation effects, and persisted status derivation.

Retain only local view state:

```ts
const [sidechatOpen, setSidechatOpen] = useState(false);
const [sidechatDrafts, setSidechatDrafts] = useState<Record<string, string>>({});

function openSidechat(): void {
  setSidechatOpen(true);
}

function closeSidechat(): void {
  setSidechatOpen(false);
}
```

Switching conversations changes the local draft key but performs no Sidechat fetch. No effect or mutation may clear the public draft, because nothing is durably accepted in this interim state.

- [ ] **Step 6: Remove persisted Sidechat fields from frontend domain types**

Delete `sidechatStatus`, `sidechatRunId`, `sidechatUpdatedAt`, and `sidechatRevision` from `Conversation`. Delete the D1-derived `channel` field from `Message`. Keep presentation-only action types separate from persisted message data in Task 4.

- [ ] **Step 7: Run client/public realtime tests and capture GREEN**

```bash
bun test \
  src/lib/use-conversation-ws.test.ts \
  src/lib/use-customer-ws.test.ts \
  worker/realtime/broadcast.test.ts
```

Expected: PASS; no Sidechat transport/cache symbol remains, and public live/replay tests stay green.

- [ ] **Step 8: Commit transport/orchestration removal**

```bash
git add shared/ws-events.ts src/lib/use-conversation-ws.ts src/lib/use-conversation-ws.test.ts src/pages/Conversations.tsx src/lib/inbox/types.ts
git commit -m "refactor: remove sidechat client orchestration"
```

---

### Task 4: Preserve a presentation-only Sidechat shell

**Files:**
- Modify: `src/lib/inbox/sidechat.ts`
- Modify: `src/lib/inbox/sidechat.test.ts`
- Modify: `src/lib/inbox/types.ts`
- Modify: `src/components/inbox/SidechatPane.tsx`
- Modify: `src/components/inbox/SidechatPane.test.tsx`
- Modify: `src/components/inbox/Composer.tsx`
- Modify: `src/components/inbox/Composer.test.tsx`
- Modify: `src/components/inbox/SidechatStatusDot.tsx`
- Modify: `src/components/inbox/MessageBubble.tsx`
- Modify: `src/components/inbox/ChatThread.tsx`
- Modify: `src/components/inbox/ConversationRow.tsx`
- Modify: `src/components/inbox/ReadingPane.tsx`
- Modify: `src/components/inbox/FocusView.tsx`
- Modify: `src/components/inbox/FocusSidechatLayout.tsx`
- Modify: `src/pages/Conversations.tsx`

**Interfaces:**
- Consumes: Local `sidechatOpen` and per-conversation draft state from Task 3.
- Produces: Controlled UI components with no runtime imports; future SDK work can supply messages, status, send, approval, and Add-to-reply data through props.

- [ ] **Step 1: Rewrite UI tests first to define the inert shell**

Replace runtime orchestration tests with presentation contracts:

```tsx
test("opens the retained Sidechat shell without network or fake acceptance", async () => {
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    throw new Error("unexpected fetch");
  }) as typeof fetch;

  // Render the real inbox shell, click Start sidechat, then assert:
  expect(document.querySelector("[data-sidechat-pane]")?.getAttribute("aria-hidden"))
    .toBe("false");
  expect(document.querySelector("[data-sidechat-runtime-unavailable]"))
    .not.toBeNull();
  expect(fetchCount).toBe(0);
});
```

Keep tests for Shift+Tab modifier/composition guards, responsive pane widths, 40px dismiss targets, focus-mode component identity, archived read-only presentation, and controlled Add-to-reply replacement/focus/no-send.

- [ ] **Step 2: Run UI tests and capture RED**

```bash
bun test \
  src/lib/inbox/sidechat.test.ts \
  src/components/inbox/SidechatPane.test.tsx \
  src/components/inbox/Composer.test.tsx
```

Expected: FAIL because current components require run/status/retry/fetch orchestration and expose active private submission.

- [ ] **Step 3: Strip `sidechat.ts` to presentation helpers**

Retain only:

```ts
export type ChatPerspective = "public" | "sidechat";
export type SidechatPresentationStatus =
  | "idle" | "working" | "waiting_approval" | "ready" | "failed";
export type SidechatPaneMode = "desktop" | "compact" | "mobile";

export function deriveMessagePresentation(
  perspective: ChatPerspective,
  role: MessageRole,
  senderName: string | null,
  visitorName: string | null,
): MessagePresentation {
  const isReceived = perspective === "sidechat"
    ? role === "bot"
    : role === "visitor";
  if (perspective === "sidechat") {
    return { isReceived, senderLabel: role === "bot" ? "Maven" : "You" };
  }
  return {
    isReceived,
    senderLabel: role === "visitor"
      ? (senderName ?? visitorName ?? "Visitor")
      : role === "bot"
        ? "Maven · AI"
        : (senderName ?? "Agent"),
  };
}

export function deriveComposerShiftTabIntent(
  input: ComposerKeyboardInput,
): ComposerShiftTabIntent | null {
  if (
    input.key !== "Tab" || !input.shiftKey || input.ctrlKey || input.metaKey ||
    input.altKey || input.isComposing || input.repeat
  ) return null;
  return input.contract === "public" ? "start_sidechat" : null;
}

export function deriveMessageActions(
  perspective: ChatPerspective,
  action: MessagePresentationAction | undefined,
  readOnly: boolean,
): MessageActions {
  const allowActions = perspective === "sidechat" && !readOnly;
  return {
    addToReply: allowActions && action?.type === "add_to_reply",
    approveAlways: allowActions && action?.type === "approval",
    approveOnce: allowActions && action?.type === "approval",
  };
}

export function deriveAddToReplyIntent(draft: string): AddToReplyIntent {
  return {
    draft,
    draftMode: "replace",
    focusPublicComposer: true,
    caret: "end",
    send: false,
    keepSidechatOpen: true,
  };
}

export function deriveSidechatPaneMode(viewportWidth: number): SidechatPaneMode {
  if (viewportWidth >= 1536) return "desktop";
  if (viewportWidth >= 768) return "compact";
  return "mobile";
}

export function deriveConversationInteractionState(
  archivedAt?: string | null,
): ConversationInteractionState {
  const readOnly = Boolean(archivedAt);
  return { readOnly, showComposer: !readOnly, showMessageActions: !readOnly };
}
```

Keep the current `deriveSidechatStatusDot` switch unchanged except for changing its parameter type from the deleted WebSocket `SidechatStatus` to `SidechatPresentationStatus`. Its exact idle/working/waiting/ready/failed mappings remain covered by `sidechat.test.ts`.

Delete orchestrator state/events, entry plans, optimistic messages, history snapshots/generations, reconciliation/merge functions, accepted-run transitions, ephemeral cleanup, busy derivation, and runtime response types.

- [ ] **Step 4: Separate presentation actions from persisted messages**

Replace database-shaped Sidechat metadata with an optional UI-only action on `Message`:

```ts
export type MessagePresentationAction =
  | { type: "add_to_reply"; draft: string }
  | { type: "approval" };

export interface Message {
  // existing public fields
  presentationAction?: MessagePresentationAction;
}
```

`MessageBubble` derives buttons only from `perspective` and `presentationAction`; no shared WebSocket metadata type is imported. This retains the visual contract without prescribing the future Agent SDK wire format.

- [ ] **Step 5: Make SidechatPane a controlled unavailable shell**

Remove `status`, `runId`, continuation, history pagination, retry, and active send props. Accept `messages`, draft state, close, and Add-to-reply callbacks as controlled presentation props. Render a concise development-only unavailable state and a disabled private composer:

```tsx
<p data-sidechat-runtime-unavailable className="text-[12px] text-ink-6">
  Sidechat runtime is not connected in this development build.
</p>

<Composer
  draft={draft}
  setDraft={setDraft}
  convId={conversation.id}
  mode={{ kind: "sidechat", disabled: true }}
/>
```

The send button and Cmd/Ctrl+Enter do nothing while disabled. No toast, fake optimistic row, synthetic status, or request occurs.

- [ ] **Step 6: Keep Start/Open presentation without persisted status**

The public composer continues to expose `Start sidechat` and Shift+Tab. Simplify its controlled mode to:

```ts
type PublicComposerMode = {
  kind: "public";
  onStartSidechat: () => void;
  sidechatOpen: boolean;
};
```

During the interim, use `Open sidechat` while the local shell is open and `Start sidechat` otherwise. Delete `sidechatExists` and `sidechatStatus` props from Composer, ReadingPane, FocusView, and their callers. Remove Sidechat dots from conversation rows because there is no authoritative status. Keep `SidechatStatusDot` as an isolated presentation component for the future adapter.

ReadingPane and FocusView import `SidechatPresentationStatus` only if required by controlled Story/test props; they must not consume a shared transport type.

- [ ] **Step 7: Preserve Add-to-reply component behavior**

Keep the exact controlled command: replace the public draft, focus the visible public textarea at its end, keep the pane open, and never send. It may be exercised only by supplying a presentation message in component tests; no fake agent message is created in the application.

- [ ] **Step 8: Run presentation and frontend tests and capture GREEN**

```bash
bun test src/lib/inbox src/components/inbox src/pages/Tools.test.tsx
```

Expected: PASS; the Sidechat UI remains visually reusable and accessible with zero runtime/network dependency.

- [ ] **Step 9: Commit the presentation-only shell**

```bash
git add src/lib/inbox src/components/inbox src/pages/Conversations.tsx
git commit -m "refactor: keep sidechat presentation shell only"
```

---

### Task 5: Delete obsolete architecture documents and enforce the clean-slate sweep

**Files:**
- Delete: `docs/superpowers/specs/2026-08-07-private-sidechat-mcp-actions-design.md`
- Delete: `docs/superpowers/plans/2026-08-09-internal-sidechat-channel.md`
- Delete: `docs/superpowers/plans/2026-08-09-generic-mcp-connections.md`
- Delete: `docs/superpowers/plans/2026-08-09-generic-mcp-write-approvals.md`
- Delete: `docs/superpowers/plans/2026-08-09-unified-maven-tool-loop.md`
- Delete: `.superpowers/sdd/2026-08-09-unified-maven-tool-loop/task-7-report.md`
- Delete: `.superpowers/sdd/2026-08-09-unified-maven-tool-loop/task-8-report.md`
- Preserve: `.superpowers/sdd/2026-08-09-unified-maven-tool-loop/evidence/*.png`
- Preserve: `docs/superpowers/specs/2026-08-10-sidechat-runtime-clean-slate-design.md`
- Preserve: `docs/superpowers/plans/2026-08-10-sidechat-runtime-clean-slate.md`

**Interfaces:**
- Consumes: Completed source cleanup from Tasks 1–4.
- Produces: An audited list of allowed remaining Sidechat references. Human documentation is verified by review and repository commands, not a brittle source-grep unit test.

- [ ] **Step 1: Delete obsolete architecture documents**

Delete the old private Sidechat design, its implementation plan, the MCP plans built on that runtime, and the unified-loop plan/reports that prescribe private prompt/runtime behavior. Git history remains the archive. Preserve the approved clean-slate design/plan and visual evidence images.

- [ ] **Step 2: Run exact production and tracked-document sweeps**

Run:

```bash
rg -n \
  'runSidechatTurn|sidechatRunId|sidechatLeaseExpiresAt|sidechatRevision|SidechatCoordinationSnapshot|sidechat:(message|delta|activity|status)|present_reply_draft|/sidechat/(messages|retry)|sidechat_status|sidechat_run_id|sidechat_lease_expires_at|sidechat_revision|message_metadata|idx_messages_conversation_channel_created' \
  worker src shared docs .superpowers \
  --glob '!docs/superpowers/specs/2026-08-10-sidechat-runtime-clean-slate-design.md' \
  --glob '!docs/superpowers/plans/2026-08-10-sidechat-runtime-clean-slate.md' \
  --glob '!worker/routes/removed-sidechat-routes.mounted.fixture.test.ts'
```

Expected: no matches.

Then classify every remaining literal `sidechat`:

```bash
rg -n -i 'sidechat|side chat' worker src shared docs .superpowers \
  --glob '!docs/superpowers/specs/2026-08-10-sidechat-runtime-clean-slate-design.md' \
  --glob '!docs/superpowers/plans/2026-08-10-sidechat-runtime-clean-slate.md' \
  --glob '!worker/routes/removed-sidechat-routes.mounted.fixture.test.ts'
```

Every match must be one of:

- dormant tool-policy audience/configuration;
- presentation component/type/test/copy;
- the isolated regression proving the three retired custom HTTP routes remain `404`;
- no match in backend persistence, runtime, realtime, route, or client cache code.

- [ ] **Step 3: Run the complete automated verification matrix**

```bash
bun test
./node_modules/.bin/tsc -b --pretty false
bunx eslint \
  shared/ws-events.ts \
  src/lib/use-conversation-ws.ts \
  src/lib/inbox \
  src/components/inbox \
  src/pages/Conversations.tsx \
  worker/chat-runtime \
  worker/db/schema.ts \
  worker/durable-objects/conversation-do.ts \
  worker/index.ts \
  worker/realtime \
  worker/services \
  worker/validation.ts
git diff --check
```

Run the request-signal integration test outside the socket-restricted sandbox if the known port-0 failure appears:

```bash
bun test worker/request-signal.integration.test.ts
```

Run the production build with the workspace Node runtime if Bun's known worktree CWD bug recurs:

```bash
node ./node_modules/vite/bin/vite.js build
```

Expected: all branch-owned tests/typechecks/changed-file lint/build checks pass. Record pre-existing unrelated full-lint findings separately.

- [ ] **Step 4: Review the entire cleanup diff for accidental public regressions**

Review:

```bash
git diff be201f0 --stat
git diff be201f0 -- worker/chat-runtime worker/services worker/durable-objects worker/realtime shared
git diff be201f0 -- src/components/inbox src/lib src/pages/Conversations.tsx
git status --short
```

Explicitly confirm:

- no widget/public route changed from SSE to a new transport;
- no public ownership, rate-limit, abort, persistence, or audit guard was removed;
- no Telegram or MCP-server public history behavior was broadened;
- no tool credential or policy field was changed;
- no unrelated untracked file was staged;
- no `0063`/`0064` migration or snapshot remains;
- no inline Compose route or UI returned.

- [ ] **Step 5: Commit the sweep and stale-document removal**

```bash
git add docs/superpowers .superpowers/sdd/2026-08-09-unified-maven-tool-loop
git commit -m "chore: enforce sidechat clean slate"
```

- [ ] **Step 6: Produce the post-cleanup rescan report**

Write `docs/superpowers/reviews/2026-08-10-sidechat-clean-slate-review.md` containing:

- deleted runtime inventory;
- retained presentation inventory;
- retained tool-policy inventory;
- exact sweep commands and outputs;
- tests/typecheck/lint/build results;
- local D1 read-only schema/migration result;
- remaining literal `sidechat` references classified by file;
- explicit statement that no SDK architecture was introduced;
- any unrelated baseline failures.

Commit the report separately:

```bash
git add docs/superpowers/reviews/2026-08-10-sidechat-clean-slate-review.md
git commit -m "docs: review sidechat clean baseline"
```

The SDK architecture may be brainstormed only after this report shows a clean result.
