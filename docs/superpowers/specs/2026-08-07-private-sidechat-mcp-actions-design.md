# Unified Maven Sidechat and MCP Connections

**Date:** 2026-08-09
**Status:** Approved design, revised after routing and infrastructure review
**Scope:** One Maven tool loop for public chat and private sidechat, native MCP tools, and dashboard approval for MCP writes

## 1. Product outcome

ReplyMaven gives the human support agent a private sidechat beside the customer conversation. The human and Maven can investigate, use project tools and MCP connections, approve writes, and prepare a visitor-facing reply. Only the final text the human deliberately adds to the public composer and sends reaches the visitor.

The implementation extends the current conversation, message, chat, and realtime primitives. It does not add a sidechat-specific agent, Durable Object, transcript store, routing loop, or provider action layer.

## 2. Non-negotiable architecture

- One AI SDK v6 `ToolLoopAgent` runs every Maven turn.
- The server-authenticated entry route supplies `channel: "public" | "sidechat"`; the model never classifies the channel.
- Public chat and sidechat use the same prompt builder, tool registry, execution middleware, model fallback, and event consumer with small channel-specific prompt sections.
- Asking a question is ordinary assistant text. There is no `ask_user` action.
- Knowledge retrieval is an internal tool. It is not a pre-loop branch.
- Team handoff is an internal public-only tool. It is not a planner outcome.
- Existing HTTP tools and discovered MCP tools enter the same registry.
- A sidechat draft is produced through the internal sidechat-only `present_reply_draft` tool.
- The only hard gates outside the loop are channel/ownership/persistence, authoritative tool authorization, and dashboard approval for MCP writes.

The current explicit intent classifier and action planner (`search_docs`, `call_tool`, `ask_user`, `offer_handoff`, `compose`, and related branches) are removed after public behavior parity is covered by tests.

## 3. Interaction model

### 3.1 Entry and pane

The current inline `Compose` action becomes:

`Start sidechat  ⇧⇥`

There is no icon or decorative AI treatment.

- Clicking it or pressing Shift+Tab opens the right pane.
- If the public composer has text, that text is submitted as the first private human message. It clears only after the sidechat route accepts and persists it.
- If the public composer is empty, Maven receives `Help me respond to {customerFirstName}.`
- Public attachments remain staged; only text moves.
- An existing thread changes the action copy to `Open sidechat` and is never duplicated.
- The pane is closed by default. Closing it does not cancel accepted work.
- Switching public conversations loads the selected conversation's sidechat while accepted work on the prior conversation continues.

The pane title is `Sidechat`. The subline is `Private · Maven has {customerFirstName}'s context`.

### 3.2 Reuse the existing chat UI

Sidechat uses the existing `ChatThread`, `MessageBubble`, and `Composer` primitives. Those components gain a channel/perspective option; the implementation must not create parallel bubble or composer systems.

- In public chat, visitor bubbles are received and agent/Maven bubbles are sent.
- In sidechat, Maven bubbles are received and the human agent's bubbles are sent.
- `FocusView` is refactored to use `ChatThread` instead of its current duplicate bubble renderer.
- Tool activity is a compact, muted line in the thread. Raw tool arguments and results are never rendered.

When Maven has a visitor-ready reply, `present_reply_draft` attaches exact draft text to a normal Maven message. That bubble contains one compact `Add to reply` action. It fills the existing public composer, focuses the caret at the end, leaves sidechat open, and never sends.

### 3.3 Write approval

An MCP write requiring approval appears as a normal Maven message bubble using the same font, line height, width, padding, radius, and surface as other sidechat messages.

Example:

> Refund the $49.00 payment from Aug 2?
> This **sends $49.00 back to the customer** and cannot be undone.

The only visible actions, in this order, are:

`Always allow` | `Allow once`

- `Always allow` is secondary and `Allow once` is the compact primary action.
- There is no card, alert, verified badge, `Not now`, reject button, or repeated details.
- Important detail stays in the description; only the text needing attention is bold.
- Closing the pane leaves the request pending.
- Only an authenticated dashboard human can approve. Visitor text, model output, widget requests, email ingress, and Telegram cannot approve.

## 4. One message model

The existing `conversations` row remains the thread identity and the existing `messages` table remains the transcript store.

`messages` gains:

- `channel`: `public | sidechat`, default `public`;
- `kind`: `text | reply_draft | approval`, default `text`;
- bounded nullable `metadata` for safe structured UI data.

Existing roles remain unchanged:

- sidechat human: `agent`;
- sidechat Maven: `bot`.

Every existing public read, replay, delivery receipt, email, Telegram, widget, summary, canned-response, and deletion query must explicitly require `channel = public`. New sidechat methods explicitly require `channel = sidechat`. There is no generic unscoped transcript method available to a route.

The conversation row stores only compact sidechat coordination fields: status (`idle | working | waiting_approval | ready | failed`), active run ID, lease expiry, and last sidechat activity. No `sidechat_threads` table is added.

## 5. Message routing and loop

### 5.1 Deterministic channel routing

The route is the classification:

- widget message endpoint creates a `public` turn;
- authenticated dashboard sidechat endpoint creates a `sidechat` turn.

The server constructs a trusted turn context containing project, conversation, channel, actor, ownership snapshot, and sidechat run lease. Channel is never accepted in model/tool input.

### 5.2 Shared loop

Both routes call:

```typescript
runMavenTurn({ context, messages, currentMessage, modelConfig })
```

The shared runtime:

1. builds the common Maven prompt plus the channel contract;
2. asks the registry for tools authorized for that context;
3. runs one `ToolLoopAgent` until final text, approval pause, or the step limit;
4. consumes text/tool events without sending tool payloads to either browser;
5. persists the final message into the correct channel using a channel-specific service method.

The public route retains existing deterministic scope safety, human-ownership checks, guarded bot-message persistence, status updates, Telegram delivery, and SSE response behavior. Those are transport and ownership boundaries, not model routing.

## 6. Tool audience and authorization

Every model-visible tool has server-owned capability metadata:

```typescript
type MavenChannel = "public" | "sidechat";

interface ToolCapability {
  id: string;
  projectId: string;
  connectionId: string | null;
  modelName: string;
  displayName: string;
  source: "internal" | "http" | "mcp";
  allowedChannels: MavenChannel[];
  access: "read" | "write";
  enabled: boolean;
  schemaFingerprint: string;
}
```

Authorization happens twice:

1. Registry filter: before inference, remove any tool whose enabled state, channel, project, or schema fingerprint does not match the turn.
2. Executor recheck: immediately before execution, reload the authoritative record and repeat the project, channel, enabled, access, connection, and fingerprint checks.

This prevents prompt injection and stale model/tool state from crossing the boundary. Hiding a tool in the prompt or relying on the model to avoid it is not authorization.

Defaults:

| Tool source | Public | Sidechat | Approval |
|---|---:|---:|---|
| Knowledge search | Yes | Yes | Never |
| Team handoff | Yes | No | Never |
| Existing HTTP tools | Existing project setting | Optional project setting | Existing behavior in v1 |
| Native MCP reads | No | Yes | Never |
| Native MCP writes | No | Yes | Dashboard policy |
| `present_reply_draft` | No | Yes | Never |

MCP tools are hard-coded sidechat-only in v1. No configuration or API accepts `public` for an MCP tool.

## 7. Generic MCP connections and presets

ReplyMaven is a generic Streamable HTTP MCP client using the existing `@modelcontextprotocol/sdk`. It does not add provider-specific actions, schemas, reducers, mappings, or result models.

PostHog, Stripe, Slack, Attio, and Linear are inert connection presets containing only a label and official MCP server URL. `Custom` accepts another validated HTTPS Streamable HTTP endpoint.

After OAuth or bearer authentication, ReplyMaven discovers the server's native tool catalog. Project owners/admins can:

- enable or disable each native tool;
- label it `read` or `write`;
- choose the write approval policy.

The model receives each enabled native tool's name, description, and input schema unchanged except for a collision-safe local model name. There are no canonical customer actions.

For customer lookup Maven uses the trusted customer linked to the conversation: non-empty `customer.externalId` first, then normalized `customer.email`. The prompt clearly labels both as private canonical identity and tells Maven never to guess from visitor text.

## 8. MCP data boundary

MCP arguments and raw results may reach the LLM transiently because they are working context. They must not reach the public transcript, dashboard browser, D1 message metadata, application logs, traces, or analytics.

The sidechat system contract says:

- use private customer data to reason, not to dump records;
- never repeat raw payloads, complete event lists, identifiers, internal links, metadata, tokens, headers, or unrelated fields;
- mention only the minimum customer-safe fact needed in a proposed reply;
- never claim an action succeeded unless the tool result confirms it;
- use the canonical external ID first and email only as fallback.

Prompting is not the only boundary: the stream adapter drops tool-call arguments/results, MCP run records store only safe audit metadata, and the human must still choose `Add to reply` and Send.

## 9. Generic MCP write approvals

Write behavior is derived only from the project-owned native tool setting. The model does not choose whether a call is a write or whether approval is required.

When a native MCP write is called:

1. the executor rechecks the connection, tool, channel, access label, enabled state, and schema fingerprint;
2. if an active matching `always` policy exists, execute immediately;
3. otherwise encrypt the exact arguments, hash the authoritative descriptor, persist a short-lived pending call, and stop the turn without contacting the MCP server;
4. render the safe descriptor as an `approval` sidechat bubble;
5. after `Allow once` or `Always allow`, atomically claim and execute the exact sealed call once;
6. persist only safe status metadata and submit the tool result back into a new turn of the same Maven loop so Maven can finish the response.

`Always allow` is project-wide for `(projectId, connectionId, toolName, schemaFingerprint)`. A reconnect, changed schema fingerprint, disabled tool, changed access label, or changed account invalidates the policy.

Approval expiry is 15 minutes. Ambiguous provider results are recorded as `unknown` and never retried automatically. Duplicate approval is an idempotent no-op.

## 10. Existing realtime infrastructure

The existing `ConversationDO` and dashboard WebSocket carry both channels.

- Existing `message:*` events remain public-message events and may reach visitor sockets.
- New `sidechat:*` events are broadcast with `audience: "agents"` and are never sent to visitor sockets.
- Dashboard reconnect replays public and sidechat messages with separate cursors.
- Partial model deltas are ephemeral; the durable source after reconnect is the persisted sidechat message.

No additional Durable Object class or WebSocket endpoint is introduced.

## 11. Visual behavior

The sidechat pane extends the existing inbox design exactly:

- closed by default;
- no permanent rail or visitor preview;
- at 1536px and wider, 400px wide and the conversation list remains visible;
- from 768px to 1535px, 380px wide capped at 42vw and the conversation list hides;
- below 768px, sidechat replaces the reading pane and a compact back action restores it;
- the reading pane compresses; sidechat does not overlay it.

Use current `glass-reading`, `glass-bar`, ink, received/sent bubble, radius, typography, and shadow tokens. The approval actions are 28px visually with a 40px hit target. Motion is 180–220ms targeted opacity/transform/width and respects reduced motion. Do not use `transition-all`, new gradients, glow, dividers, nested card stacks, or sparkle icons.

Required visual QA covers closed, empty, history, working, tool activity, approval, ready draft, failure, conversation switch, focus mode, archived mode, keyboard focus, 200% zoom, reduced motion, and the 1440x1000, 1100x900, 768x900, and 390x844 viewports.

## 12. Persistence

New or changed D1 state is limited to:

- message channel/kind/safe metadata;
- compact sidechat coordination on `conversations`;
- outbound project MCP connections and encrypted auth state;
- discovered native MCP tool settings;
- sealed pending MCP calls;
- project-wide MCP write policies;
- safe MCP run audit metadata.

OAuth tokens, client registration data, PKCE verifier, bearer headers, and pending write arguments are AES-GCM encrypted with the existing `ENCRYPTION_KEY`. Raw MCP results are never stored.

Conversation and project deletion cascade through sidechat messages, connections, tool settings, pending calls, policies, and runs. Disconnecting a connection revokes/deletes stored credentials, disables its tools, and invalidates its pending calls and policies.

## 13. Delivery sequence

Implementation is split into four independently testable plans:

1. Unified Maven Tool Loop — replace the classifier/planner with one `ToolLoopAgent` and channel-aware tool capabilities while preserving public behavior.
2. Internal Sidechat Channel — add channel-safe persistence/realtime, shared chat UI, sidechat routes, and `present_reply_draft`.
3. Generic MCP Connections — add presets, OAuth/bearer connection management, native catalog discovery, and sidechat-only native tools.
4. Generic MCP Write Approvals — add sealed calls, compact approval bubbles, once/always policy, idempotent execution, and same-loop continuation.

Each plan uses TDD and ends with targeted tests, `bun test`, `bun run build`, `bun run lint`, and visual verification where applicable. Deployment is never part of these plans and requires separate approval.

## 14. Explicitly out of scope

- a separate sidechat agent, Think agent, integration agent, or Durable Object;
- a second planner/classifier/compose loop;
- provider-specific PostHog, Stripe, Slack, Attio, or Linear actions;
- provider reducers or canonical tool mappings;
- exposing an MCP tool to the visitor;
- automatic public sending;
- showing raw tool payloads in either chat;
- multi-stage business workflows;
- changing the existing account-level ReplyMaven MCP server beyond clarifying its inverse purpose.
