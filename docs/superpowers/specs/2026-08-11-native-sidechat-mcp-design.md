# Native Sidechat and MCP Design

**Date:** 2026-08-11
**Status:** Approved in the product-design conversation; awaiting review of this written specification
**Scope:** Dashboard-only Sidechat, native Cloudflare Agent persistence and recovery, project MCP connections, private tools, reply drafts, and dashboard write approvals

## 1. Product outcome

ReplyMaven will add a private Sidechat where a human support agent can work with Maven on one customer conversation. Maven can read the current public conversation and trusted customer context, use project tools and MCP connections, request approval for writes, and prepare a visitor-ready reply.

The public visitor receives only text that the human explicitly moves into the existing public composer and sends. Private messages, reasoning, tool calls, MCP results, connection credentials, approvals, and internal context never enter the public D1 transcript or visitor UI.

This is one complete Sidechat specification. It includes the native chat foundation, MCP presets and custom connections, read and write tools, `Allow once`, project-wide `Always allow`, reply drafts, responsive UI, retention, and local verification.

This work does not migrate the public widget. The existing public Hono, D1, SSE, polling, WebSocket, Telegram, email, delivery-receipt, and ownership behavior remains unchanged.

## 2. Architectural decision

Sidechat uses Cloudflare's native Agent hierarchy:

```text
MavenProjectAgent (one top-level Agent per project)
  ├── MavenChatAgent sc_<conversation-id>
  ├── MavenChatAgent sc_<conversation-id>
  └── native project MCP connections
```

`MavenProjectAgent extends Agent` is the only new top-level Durable Object binding. It owns project MCP connection state, OAuth state, discovered catalogs, tool policy, persistent approval policy, safe action audit metadata, the native sub-agent registry, and display-only Sidechat summaries.

`MavenChatAgent extends AIChatAgent` is an exported facet-only sub-agent class. The project Agent creates one deterministic private child for each public support conversation. Each child has its own isolated SDK-managed SQLite transcript, streaming state, tool-interaction state, and recovery state.

Only `MavenProjectAgent` receives a Wrangler Durable Object binding and SQLite migration entry. `MavenChatAgent` children are framework-managed facets and do not receive separate bindings or Wrangler migration entries.

The project Agent is a connection and policy owner, not another chat runtime. Every private human–Maven conversation uses the same `MavenChatAgent` implementation.

## 3. Why native Agent storage is used

`AIChatAgent` owns the private transcript end to end:

- automatic SQLite message persistence;
- message serialization and concurrency;
- streamed message parts;
- resumable client streams;
- reconnect and multi-client synchronization;
- pending tool results and approval continuation;
- explicit stop handling;
- optional Durable Object eviction recovery;
- message compaction and retention controls.

ReplyMaven does not add Sidechat message tables, message CRUD services, pagination APIs, run IDs, leases, revision counters, settlement transactions, replay cursors, optimistic transcript reconciliation, recovery polling, or private `ConversationDO` events.

There are two deliberately isolated transcripts:

| Transcript | Owner | Purpose |
| --- | --- | --- |
| Public visitor transcript | Existing D1 `messages` and `ChatService` | Widget, dashboard public history, Telegram, email, delivery receipts, billing, retention, and public MCP access |
| Private Sidechat transcript | Native `MavenChatAgent` SQLite | Human–Maven investigation, tools, approvals, and reply drafts |

These are not mirrors. Public messages are read as bounded context for a private turn but are not copied into the private transcript. Private messages are never copied into D1. The only outbound bridge is the human selecting `Add to reply`.

## 4. SDK and dependency boundary

The implementation stays on AI SDK v6. It upgrades and adds only the lockfile-compatible packages required by the current Cloudflare documentation:

- `agents` on the current `0.20.x` compatible line;
- `@cloudflare/ai-chat` on the current compatible line;
- `@ai-sdk/react` v3 for the dashboard React client;
- MCP client v2 packages required by `agents 0.20.x`;
- the legacy MCP SDK version required by the existing account-level ReplyMaven MCP server until that separate server is migrated.

The implementation must resolve and pin mutually compatible exact versions in the lockfile. It must not migrate this repository to AI SDK v7, Think, Sessions, Code Mode, or Cloudflare Workflows.

The existing account-level `worker/mcp-server.ts` is the inverse capability: external AI clients connecting to ReplyMaven. It remains intact. Project Sidechat connections are outbound MCP clients owned by `MavenProjectAgent`.

## 5. Agent identity and child registry

The top-level Agent instance name is derived from the authorized project ID. A Sidechat child has a deterministic internal name such as `sc_<conversationId>`.

The framework sub-agent registry is authoritative for child existence. App-owned metadata decorates a child with its project conversation ID and display summary; it does not decide whether the child exists.

The project Agent exposes server-internal methods with narrow serializable interfaces:

```ts
interface SidechatRegistration {
  childName: string;
  conversationId: string;
  createdAt: number;
}

interface SidechatSummary {
  conversationId: string;
  childName: string;
  status: "idle" | "working" | "waiting_approval" | "ready" | "failed";
  updatedAt: number;
}
```

Creating a Sidechat calls `subAgent(MavenChatAgent, childName)` before recording its decoration. Deleting it uses `deleteSubAgent(MavenChatAgent, childName)`. Unknown child names fail closed in `onBeforeSubAgent` and do not wake or create a facet.

The summary status is a display projection only. It can drive quiet inbox dots, but it cannot start, stop, approve, execute, settle, or recover a turn. The child transcript and native pending-interaction state remain authoritative.

## 6. Authentication and routing

Sidechat is available only in the authenticated dashboard. The widget, public message route, Telegram, email ingress, and public ReplyMaven MCP server have no route to a private child.

The dashboard requests a Sidechat session from an authenticated Hono endpoint:

```text
POST /api/projects/:projectId/conversations/:conversationId/sidechat/session
```

The route performs the same effective-owner, team membership, project access, conversation ownership, and archive checks used by the existing dashboard conversation routes. On first access it asks the project Agent to create the registered child. It returns the parent/sub-agent route and a two-minute signed connection token.

The token contains only:

- authenticated user ID and effective owner ID;
- project ID and conversation ID;
- parent and child instance names;
- team role and Sidechat permission claims;
- issued-at, expiry, audience, and token version.

It contains no customer context, provider credential, MCP result, tool input, or transcript data.

The parent validates the token before forwarding a WebSocket upgrade to the child. The child also validates the signed token supplied with each chat request before using actor claims. Browser-provided IDs, roles, email addresses, customer identity, and tool permissions are never trusted.

Connection identity is stored as per-connection state. Native approval frames are accepted only from authenticated dashboard connections whose token permits one-time write approval. `Always allow` uses a separate authenticated owner/admin mutation before the native approval response is submitted.

Agent and OAuth callback routes are mounted before the SPA fallback. No raw OAuth or bearer secret is placed in a browser URL; only the provider-issued authorization URL and SDK OAuth callback state use the native flow.

## 7. Sidechat interaction

### 7.1 Entry

Sidechat is closed by default. The existing public composer action remains text-only:

```text
Start sidechat  ⇧⇥
```

There is no sparkle icon or decorative AI mark.

- Clicking the action or pressing unmodified Shift+Tab opens Sidechat.
- If the public composer contains text, that exact text becomes the first private human message.
- If it is empty, the first private message is `Help me respond to {customerFirstName}.`
- The client generates the message ID before submission.
- At the start of `onChatMessage`, the child emits a transient `data-turn-accepted` part carrying that exact ID.
- The public text clears only when that matching native accepted signal arrives.
- A connection or submission failure leaves the public text unchanged.
- Public image attachments never move or clear.
- If the registered child already exists, the action reads `Open sidechat`; opening it does not submit another turn.

The keyboard handler ignores composition, repeat, Control, Option/Alt, Meta, and extra modifier combinations. Legacy inline Compose does not return.

### 7.2 Pane lifecycle

- Closing Sidechat does not stop Maven.
- Switching conversations connects the pane to the selected child; the prior child continues.
- Generic React cleanup does not cancel the server turn because `cancelOnClientAbort` is false.
- An explicit stop control, if rendered for a live turn, uses the SDK's native `stop()` behavior.
- One private transcript exists per public conversation.
- Archived conversations may open existing history read-only but cannot submit, retry, approve, or add a draft.
- A quiet 7px status dot appears on the conversation row and beside `Open sidechat` for working, waiting approval, ready, or failed. It is never replaced by a badge or alert banner.

### 7.3 Conversation rendering

The pane reuses the existing `ChatThread`, `MessageBubble`, and `Composer` primitives. It does not introduce an assistant-specific card system.

- Human messages use the existing sent-message perspective.
- Maven messages use the existing received-message perspective.
- Reasoning is never rendered.
- Raw MCP arguments and results are never rendered.
- Tool activity renders only compact bounded copy such as `Stripe · Checking payments`.
- Errors render as normal Maven messages or compact retry affordances.
- The title is `Sidechat`.
- The subline is `Private · Maven has {customerFirstName}'s context`.
- Closing the pane does not expose a permanent rail or leave an overlay sliver.

## 8. Reply drafts and public publication boundary

Maven prepares a visitor-facing response by emitting a persistent typed data part:

```ts
interface ReplyDraftData {
  type: "data-reply-draft";
  id: string;
  data: {
    text: string;
    createdAt: number;
  };
}
```

The data part is attached to an ordinary Maven message and persists in the native private transcript. The UI renders it as normal message content with one compact action:

```text
Add to reply
```

Selecting it:

- replaces the public composer text exactly;
- leaves public image attachments untouched;
- on desktop leaves Sidechat open;
- on mobile returns to the public reading pane so the textarea is visible;
- focuses the visible public textarea;
- places the caret at the end;
- never sends the public message.

The existing public composer and `ChatService` reply route remain the only visitor publication path. There is no automatic Sidechat send, background publisher, or direct write into public D1 messages.

An incomplete, errored, aborted, or interrupted turn cannot publish a `data-reply-draft`. The child emits the draft only from a naturally completed model/tool loop.

## 9. Trusted context construction

Before every private turn, the child asks its project parent for a fresh bounded context snapshot. The parent reads existing D1 services and returns:

```ts
interface SidechatCustomerContext {
  projectId: string;
  conversationId: string;
  conversationStatus: string;
  archivedAt: number | null;
  customer: {
    id: string;
    name: string | null;
    externalId: string | null;
    email: string | null;
  } | null;
  publicSummary: string | null;
  recentPublicMessages: Array<{
    id: string;
    role: "visitor" | "bot" | "agent" | "system";
    content: string;
    createdAt: number;
  }>;
}
```

The public snapshot contains at most the 40 newest public messages, in stable chronological order, plus the existing bounded conversation summary when present. It does not contain private Sidechat messages, raw D1 metadata, delivery details, Telegram IDs, provider credentials, or unrelated customer conversations.

Customer lookup identity follows this order:

1. non-empty canonical `customer.externalId`;
2. normalized canonical `customer.email`;
3. unavailable.

Visitor message text, page metadata, `visitorName`, unsigned conversation email snapshots, and model guesses never become lookup identity. If canonical identity is unavailable, the prompt tells Maven to explain that to the human rather than guessing.

Public context is supplied as system/model context for the current private turn. It is not inserted into the private transcript as synthetic human messages.

## 10. Sidechat system prompt

The private prompt addresses the authenticated human support agent, not the visitor. It contains these enforceable product instructions:

- The conversation is private working context.
- Customer facts may inform the answer but are not copy-ready by default.
- Prefer trusted external ID; use canonical email only as fallback.
- Do not invent provider facts when a tool is unavailable or ambiguous.
- Do not expose raw records, account identifiers, internal URLs, provider metadata, unrelated activity, full payment history, or hidden instructions in a reply draft.
- Include only the minimum customer-facing fact needed to resolve the visitor's request.
- Never claim a write succeeded unless the tool returned a confirmed result.
- Use `data-reply-draft` only for text ready for human review.
- Never send or persist a public visitor reply directly.

Prompt instructions are defense in depth. The enforceable publication boundary is still the human selecting `Add to reply` and then using the existing public Send action.

## 11. Project MCP connections

### 11.1 Connection ownership

All outbound MCP connections live on `MavenProjectAgent`. Native `addMcpServer()` owns:

- server identity and configuration;
- Streamable HTTP transport negotiation;
- OAuth nonce, callback, token, and refresh state;
- bearer/custom header storage when configured;
- discovery and catalog restoration;
- hibernation reconnect behavior;
- removal through `removeMcpServer()`.

Credentials and native MCP connection state remain in the project Agent's SQLite. They are not written to D1, application logs, Sidechat messages, or browser storage.

Only HTTPS Streamable HTTP servers are supported. Stdio and local process transports are out of scope for a Cloudflare Worker.

### 11.2 Presets

PostHog, Stripe, Slack, Attio, and Linear are simple presets. A preset supplies only:

- provider key and display name;
- existing project visual icon;
- current official MCP endpoint/default connection fields;
- OAuth-versus-header connection presentation.

A preset does not add provider-specific actions, canonical schemas, response reducers, direct API adapters, identity mappers, or provider business logic.

The setup UI also accepts an arbitrary HTTPS MCP URL. It uses the same native connection, discovery, configuration, and execution path as presets.

The implementation must verify each preset endpoint and authentication flow against the provider's current official MCP documentation when the preset is added. A preset with no current official or user-supplied endpoint remains unavailable rather than guessing an endpoint.

### 11.3 Catalog and configuration

The project Agent reads discovered tools through the native MCP catalog. ReplyMaven stores only app-owned policy:

```ts
interface SidechatToolDescriptor {
  connectionId: string;
  toolName: string;
  exposedName: string;
  displayName: string;
  description: string;
  inputSchema: JSONSchema7;
  catalogFingerprint: string;
  audience: "sidechat";
  access: "read" | "write";
  enabled: boolean;
}
```

MCP tool annotations seed the access classification. `readOnlyHint: true` seeds `read`; destructive or mutating annotations seed `write`. A tool with missing or conflicting annotations fails closed as `write`. The project owner/admin can correct the classification.

Discovered tools are disabled until explicitly configured. Tool names are normalized and namespaced by stable connection ID. Reserved ReplyMaven internal names cannot be shadowed by MCP tools.

A catalog refresh updates descriptions and schemas. A schema fingerprint change does not silently preserve a persistent write grant.

## 12. Existing ReplyMaven tools

The private registry may include:

- existing knowledge search;
- configured project HTTP tools whose stored audience contains `sidechat`;
- enabled configured MCP tools;
- the internal reply-draft data-part producer.

The public-only `request_team_help` tool is never available in Sidechat. Public ownership and Telegram handoff behavior remain on the existing public runtime.

Every registry build re-reads current project policy. A tool disabled or reclassified after the model saw an earlier catalog is rejected at execution time.

## 13. MCP tool proxy

AI SDK tool functions cannot be serialized across Agent RPC. The parent therefore supplies serializable descriptors, and the child constructs AI SDK dynamic tools with JSON Schema inputs.

Execution uses a narrow parent call:

```ts
interface ExecuteProjectToolRequest {
  childName: string;
  conversationId: string;
  actorUserId: string;
  connectionId: string;
  toolName: string;
  catalogFingerprint: string;
  access: "read" | "write";
  input: unknown;
}

interface ExecuteProjectToolResult {
  status: "completed" | "denied" | "unavailable" | "ambiguous" | "failed";
  output?: unknown;
  safeActivity: string;
  errorCode?: string;
}
```

Immediately before execution, the parent verifies:

- the child is registered to the same project conversation;
- the conversation is not archived;
- the connection still exists and is ready;
- the current catalog still contains the exact tool;
- the descriptor fingerprint still matches;
- the tool remains enabled for Sidechat;
- the access classification still matches;
- the actor is permitted to use Sidechat;
- a write has current approval or a matching persistent grant.

The parent then retrieves the live tool function from `this.mcp.getAITools()` and invokes it locally. OAuth credentials and executable closures never cross RPC.

The model receives the tool result. The browser UI receives only bounded activity presentation. Application code does not log raw input or output. Native private tool parts may exist inside the authenticated child transcript when required for AI SDK continuation and approval, but they never enter public D1, visitor transport, Telegram, email, or public MCP responses.

Every external call has a bounded timeout. ReplyMaven does not automatically retry writes. An abort after a provider has accepted a write cannot undo that external side effect; the result is reported honestly rather than treated as cancelled.

## 14. Write approvals

### 14.1 Native one-time approval

Configured read tools execute without approval. Configured write tools use AI SDK `needsApproval` unless a current persistent grant matches.

An approval request is rendered as a normal Maven received-message bubble using the same width, type size, padding, radius, and surface as other private messages. It is not a card, alert, verified-account badge, or nested panel.

Example:

> Run Stripe's refund tool for the selected payment?
> This **can send money back to the customer** and may not be reversible.

The only visible actions, in order, are:

```text
Always allow | Allow once
```

- `Always allow` is visually secondary.
- `Allow once` is the compact primary action.
- Both controls have a 28px visible height, 12.5–13px text, an 8px radius, and a surrounding or pseudo-element hit area of at least 40px.
- There is no `Not now`, visible reject button, or visitor approval control.
- Closing the pane leaves the native approval pending.

`Allow once` submits the SDK approval response for the exact pending tool call. Duplicate approval frames are idempotent under the native first-terminal-result behavior.

### 14.2 Project-wide persistent permission

`Always allow` is ReplyMaven policy because AI SDK's native approval is per call. The authenticated UI first records:

```ts
interface AlwaysAllowScope {
  projectId: string;
  connectionId: string;
  toolName: string;
  catalogFingerprint: string;
}
```

Only owner/admin may create or revoke this policy. A project member whose role permits Sidechat writes may approve once but may not create persistent permission.

After the grant succeeds, the client submits the native approval response for the current call. Future registry builds omit `needsApproval` only for that exact current scope.

Removing or reconnecting the connection, changing its URL/account, disabling the tool, changing access classification, or changing the catalog/schema fingerprint invalidates the grant. Server-side authorization and validation still run even when approval is not requested.

### 14.3 Approval copy

Approval copy is generated from the configured connection display name, tool display name/description, access classification, and bounded primitive input values. It must address the human agent. Only details requiring attention are bold.

There are no provider-specific approval components. Unknown tools receive accurate generic write language rather than invented refund, cancellation, or deletion semantics.

## 15. Safe audit metadata

The project Agent stores one bounded audit row per external execution:

- project, conversation child, connection, and tool identifiers;
- catalog fingerprint and access classification;
- actor ID when available;
- approval mode: `none | once | always`;
- status: `completed | denied | unavailable | ambiguous | failed`;
- start time, finish time, and duration;
- bounded safe activity text and error code.

It does not store raw tool inputs, raw outputs, OAuth tokens, request headers, customer records, provider metadata, or model reasoning.

Audit rows are private project operational metadata. They are not inserted into either transcript and are not exposed to visitors.

## 16. Native turn lifecycle

`MavenChatAgent` uses these SDK settings:

- `messageConcurrency = "queue"`, because every human message matters;
- `chatRecovery = true`, so an interrupted turn can recover after Durable Object eviction or deployment;
- `maxPersistedMessages = 200`;
- model context pruning independent of stored history;
- MCP waiting disabled on the child because MCP connections belong to the parent;
- reasoning excluded from client-visible output;
- generic client cleanup does not cancel the server turn.

At the start of an accepted turn, the child:

1. validates the signed request claims;
2. emits `data-turn-accepted` for the submitted human message ID;
3. tells the parent to project `working`;
4. loads fresh public/customer context and the current tool catalog;
5. runs one native AI SDK `streamText` loop with bounded steps and the Agent turn's native abort signal. A raw browser disconnect is not treated as cancellation while `cancelOnClientAbort` is false.

When the response reaches a native boundary:

- pending approval projects `waiting_approval`;
- a completed reply draft projects `ready`;
- completed work without a draft projects `idle`;
- a terminal error projects `failed`;
- an aborted or interrupted partial response cannot publish a reply draft.

No projection update is a prerequisite for the native outcome.

## 17. Error behavior

### Sidechat connection

If token creation or WebSocket connection fails, the pane shows a compact retry state. The original public draft remains untouched.

### Model or recovery failure

The client uses native error/recovery state. It does not finalize partial text as a reply draft. Retry or regenerate uses native chat operations rather than a custom retry endpoint.

### Missing trusted identity

The relevant customer tool is not invoked with a guessed identity. Maven tells the human which canonical profile field is missing.

### MCP unavailable or OAuth expired

The tool returns `unavailable` with bounded safe activity. The connection UI shows the native failed/authenticating state and offers reconnect. Maven may prepare a reply without the fact but must state uncertainty internally and must not invent it.

### Catalog mismatch

The parent rejects the invocation, refreshes the native catalog, and requires the model or human to retry with the current definition. It never executes by tool-name guess and never returns a raw result as fallback.

### Invalid approval

If connection, tool, access, actor permission, or fingerprint changed after approval was requested, execution returns `denied`. The stale approval does not run the tool.

### Timeout or ambiguous write

The audit records `ambiguous`; the model receives a safe `could not confirm` outcome. ReplyMaven never retries the write automatically and never claims success.

## 18. Responsive and visual requirements

The retained Sidechat shell remains the visual source of truth.

### Desktop

- At 1536px and wider, conversation list, reading pane, and 400px Sidechat remain visible.
- From 768px through 1535px, Sidechat is 380px capped at 42vw and the conversation list hides.
- The reading pane compresses; Sidechat does not overlay it.
- Focus mode keeps a stable conversation/composer tree beside the Sidechat pane so public attachments are not remounted or lost.

### Mobile

Below 768px, Sidechat replaces the reading pane. A compact text back control restores the conversation. `Add to reply` returns to the visible public composer before issuing the focus command.

### Component language

- Reuse existing glass, text, wallpaper, bubble, composer, focus, and motion tokens.
- Private bubbles use the same 14–14.5px message typography and existing sent/received surfaces.
- Approval buttons have compact visible height but at least 40px interactive targets.
- No gradients, ornamental glow, sparkle icon, oversized assistant title, separator rules, alert banners, nested card stacks, or permanent right rail.
- Motion uses targeted opacity, transform, and width transitions and respects reduced motion.
- Important approval detail is carried by description text; only text needing attention is bold.

## 19. Project configuration UI

The existing project Tools area gains a compact `MCP connections` section rather than a new assistant design language.

It provides:

- preset buttons for PostHog, Stripe, Slack, Attio, and Linear;
- one custom MCP URL action;
- native connection status and OAuth popup handling;
- disconnect/reconnect;
- discovered tool rows with enabled state and read/write classification;
- persistent approval state and revoke action;
- bounded safe recent activity metadata.

Rows reuse current typography, spacing, muted surfaces, compact controls, and accessible hit targets. Provider identity is text-led with existing integration icons. There are no provider-specific action forms.

The account Settings > MCP page remains the inverse external-client capability and receives copy clarification only if current wording could confuse it with project outbound connections.

## 20. Retention and deletion

Private message retention is bounded by `maxPersistedMessages = 200` and the project's conversation retention lifecycle.

- Manual conversation deletion calls the project Agent's idempotent child-deletion method before deleting the public D1 conversation.
- Automated conversation retention uses the same child-deletion method.
- If private deletion fails, public deletion does not silently proceed; the operation reports failure so private data is not orphaned.
- Project deletion destroys the project Agent and all registered descendants before D1 cascade cleanup.
- Disconnecting an MCP connection removes its native SDK server registration and invalidates tool and approval policy for that connection.
- Audit retention follows the existing project operational-retention period and contains no raw payloads.

Archiving does not delete private history. It immediately prevents new Sidechat submissions and approvals. Work already approved and dispatched to an external provider may complete; the audit and UI report the actual outcome.

## 21. Local verification requirements

There is no rollout, deployment, push, production migration, or remote OAuth configuration in this implementation. Everything must be verified locally before deployment is considered in a separate user-approved decision.

### 21.1 Automated behavior

Tests must prove:

1. owner, admin, authorized member, unrelated member, and visitor access behavior;
2. guessed parent/child names cannot create or access a child;
3. two projects and two conversations have isolated transcripts, context, connections, policies, and tools;
4. native message persistence, reconnect, multi-tab synchronization, browser cleanup, and eviction recovery;
5. accepted-only public draft clearing and untouched public attachments;
6. no private message is written to D1 or broadcast through `ConversationDO`;
7. public widget, Telegram, email, delivery receipts, public handoff, and public MCP behavior remain unchanged;
8. preset and custom MCP connection, OAuth callback, hibernation restoration, catalog refresh, disconnect, and SSRF rejection;
9. read execution, default-write classification, disabled tools, audience filtering, reserved-name collision, and stale fingerprint denial;
10. `Allow once`, role-gated `Always allow`, grant invalidation, duplicate approval, and stale approval;
11. confirmed, denied, unavailable, failed, timed-out, and ambiguous write outcomes without automatic write retry;
12. raw credentials, request headers, tool payloads, and reasoning are absent from public responses, public D1, application logs, and rendered visitor content;
13. reply-draft completion-only publication and exact `Add to reply` behavior;
14. archive, conversation deletion, retention deletion, project deletion, and MCP disconnect cleanup.

Agent behavior tests use the Cloudflare Workers Vitest pool and real Agent/Durable Object storage where lifecycle semantics matter. Pure policy, prompt, and rendering functions retain fast Bun unit coverage.

### 21.2 Visual and interaction matrix

Inspect the real dashboard at 1440×1000, 1100×900, 768×900, and 390×844 for:

1. closed Sidechat;
2. first open with empty public draft;
3. first open with populated public draft;
4. existing private history;
5. streaming/working;
6. safe read-tool activity;
7. pending write approval with long critical detail;
8. reply draft and post-`Add to reply` public focus;
9. MCP unavailable/error and retry;
10. conversation switch while prior work continues;
11. focus mode;
12. archived read-only state;
13. 200% zoom, keyboard-only use, visible focus, and reduced motion.

Every viewport must have no horizontal page overflow, clipped header controls, inaccessible approval actions, or overlapping 40px targets.

### 21.3 Repository gates

Before claiming completion, run:

- focused Agent, auth, MCP, approval, tool, prompt, and Sidechat UI suites;
- complete `bun test`;
- Worker and full-project TypeScript builds;
- changed-file ESLint and full-source lint attribution;
- production Worker/SPA build and widget regression build;
- `git diff --check`;
- exact residue searches proving no custom Sidechat message route, run, lease, revision, replay cursor, D1 channel, or inline Compose returned;
- migration review proving only the new Wrangler Agent migration was added and no D1 Sidechat migration exists.

The logged-in local dashboard must be exercised end to end without sending a public visitor reply, changing real provider data, deploying, or using production OAuth credentials.

## 22. Explicitly out of scope

- Migrating the public widget or public transcript to `AIChatAgent`.
- Mirroring private messages into D1.
- Restoring any custom Sidechat run, lease, revision, route, replay, or recovery implementation.
- Provider-specific ReplyMaven actions, API clients, schemas, reducers, or business workflows.
- Automatically sending a reply draft.
- Letting visitors view Sidechat or approve tools.
- Workflows, Think, Sessions, Code Mode, browser automation, or shell tools.
- Stdio MCP servers.
- Automatic retries for external writes.
- Deployment, push, production migration, remote provider connection, or staged rollout.

## 23. Official platform references reviewed

- [Chat agents](https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/)
- [Client SDK](https://developers.cloudflare.com/agents/communication-channels/chat/client-sdk/)
- [Sub-agents](https://developers.cloudflare.com/agents/runtime/execution/sub-agents/)
- [Agents as tools](https://developers.cloudflare.com/agents/runtime/execution/agent-tools/)
- [Routing](https://developers.cloudflare.com/agents/runtime/communication/routing/)
- [Cross-domain authentication](https://developers.cloudflare.com/agents/runtime/operations/cross-domain-authentication/)
- [WebSockets](https://developers.cloudflare.com/agents/runtime/communication/websockets/)
- [Long-running agents](https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/)
- [Human-in-the-loop](https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/)
- [MCP client API](https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/)
- [MCP OAuth client guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/oauth-mcp-client/)
- [MCP transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/)
- [MCP SDK v2 migration](https://developers.cloudflare.com/agents/model-context-protocol/guides/migrate-to-mcp-sdk-v2/)
- [Add Agents to an existing project](https://developers.cloudflare.com/agents/getting-started/add-to-existing-project/)
- [Agent configuration](https://developers.cloudflare.com/agents/runtime/operations/configuration/)
- [Testing Agents](https://developers.cloudflare.com/agents/getting-started/testing-your-agent/)
- [Official multi-AI-chat sub-agent example](https://github.com/cloudflare/agents/tree/main/examples/multi-ai-chat)

## 24. Acceptance statement

The feature is complete only when the local dashboard provides a durable private human–Maven Sidechat, uses native SDK persistence and recovery, connects project MCP servers through simple presets or a custom URL, safely distinguishes reads and writes, supports the approved compact approval interaction, prepares an exact reply draft, and leaves all public visitor behavior unchanged.

No part of that claim depends on a custom Sidechat lifecycle or an unverified remote deployment.
