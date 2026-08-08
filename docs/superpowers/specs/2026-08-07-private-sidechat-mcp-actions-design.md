# Private Sidechat and Generic MCP Connections

**Date:** 2026-08-08

**Status:** Revised after architecture review

**Scope:** Dashboard inbox, an internal Maven channel on each conversation, generic MCP connections and presets, native tool configuration, and generic write approval

## 1. Product outcome

The dashboard human needs to talk privately with Maven while handling a customer conversation. Maven can inspect the public conversation, use project MCP connections, prepare a reply, and ask permission before a native MCP write.

The visitor receives only what the human explicitly places in the public reply composer and sends. Sidechat messages, MCP calls/results, progress, and approvals never enter the visitor transcript.

This replaces the one-shot inline Compose interaction. It does not replace the public reply composer, widget delivery, Telegram handoff, or the existing conversation runtime.

## 2. Architecture decision: sidechat is a channel, not a second chat system

Sidechat belongs to the same project conversation:

```text
Conversation
├── public: visitor ↔ support agent / Maven
└── sidechat: dashboard human ↔ Maven
```

It therefore reuses the existing infrastructure end to end:

- the `conversations` row;
- the `messages` table;
- `ChatService`;
- the existing AI SDK v6 model and fallback adapters;
- the existing `ConversationDO` and authenticated dashboard WebSocket;
- the current conversation-detail React Query state; and
- the existing `ChatThread`, `MessageBubble`, and `Composer` primitives.

There is no `MavenSidechatAgent`, separate sidechat Durable Object, sidechat WebSocket token, `sidechat_threads` table, Think runtime, AI Chat SDK runtime, or second chat hook.

No new Durable Object class is required. Generic MCP consumption uses the repository's existing `@modelcontextprotocol/sdk` dependency from a Worker service. Connection/catalog state and AES-GCM-encrypted credentials live in project-scoped D1 rows; a client is opened for discovery or a bounded sidechat turn and then closed.

## 3. Interaction model

### 3.1 Entry point

The current `Compose ⇧⇥` action becomes:

`Start sidechat  ⇧⇥`

There is no icon or decorative AI mark.

- Click or Shift+Tab opens the closed-by-default right pane.
- If the public composer has text, that text is submitted as the first private human message. The public composer clears only after the server accepts it.
- If the composer is empty, submit `Help me respond to {customerFirstName}.`
- Public image attachments remain staged in the public composer; only text moves.
- Once a private history exists, the action reads `Open sidechat` and never creates another channel.

### 3.2 Pane behavior

- One sidechat channel exists per conversation.
- Closing the pane does not cancel a running turn.
- Switching conversations loads that conversation's sidechat while prior work continues.
- A quiet status dot can indicate `working`, `waiting_approval`, `ready`, or `failed`.
- Archived conversations can show existing sidechat history read-only.
- The title is `Sidechat`.
- The subline is `Private · Maven has {customerFirstName}'s context`.
- There is no permanent right rail, visitor preview, alert banner, or duplicate transcript.

### 3.3 Draft handoff

Maven's normal received bubble may contain a structured `reply_draft`. The bubble shows one compact action:

`Add to reply`

It copies the exact draft into the public composer, focuses the caret at the end, and leaves sidechat open. It never sends. The human can edit, attach images, and use the existing Send action.

### 3.4 Write approval

A pending native MCP write is another normal Maven bubble, not a card or alert. Example:

> Refund the $49.00 payment from Aug 2?
>
> This **sends $49.00 back to the customer** and cannot be undone.

The only visible actions, in order, are:

`Always allow` | `Allow once`

- `Always allow` is secondary; `Allow once` is the compact primary action.
- There is no `Not now`, reject button, verified badge, warning panel, nested card, or repeated details.
- Closing the pane defers the decision.
- Important details live in the description; only details requiring attention are bold.
- Approval is accepted only from the authenticated dashboard. Visitor content, Telegram, public APIs, and model output cannot approve a write.

## 4. UI reuse and exact visual language

Sidechat must use the existing chat primitives, not copies that merely look similar.

- `ChatThread` owns scrolling, loading, grouping, date markers, and empty state.
- `MessageBubble` owns sender header, content shell, typography, spacing, and bubble treatment.
- `Composer` owns auto-grow, focus, keyboard behavior, and send controls.
- A small mode/perspective prop changes placement: in sidechat, human `agent` messages are sent bubbles and Maven `bot` messages are received bubbles.
- `reply_draft` and `approval` actions render through slots inside the same bubble shell. They are not nested cards.
- `FocusView` stops maintaining its duplicate bubble renderer and uses the same primitives.

Measurements and tokens come from the current inbox implementation. New UI must not introduce gradients, glows, oversized titles, separator rules, or `transition-all`.

Desktop behavior:

- At 1536px and wider, keep the list visible and use a 400px sidechat pane.
- From 768px through 1535px, hide the list while sidechat is open; use a 380px pane capped at 42vw.
- Compress the reading pane instead of overlaying it.

Below 768px, sidechat replaces the reading pane and a compact back control returns to the conversation.

## 5. Persistence model

### 5.1 Existing `messages` table

Add:

- `channel`: `public | sidechat`, non-null, default `public`;
- `kind`: `text | reply_draft | approval`, non-null, default `text`;
- `metadata`: nullable JSON text for bounded, UI-safe structured parts.

Existing rows migrate implicitly to `public/text`. Sidechat uses existing roles:

- dashboard human: `agent`;
- Maven: `bot`.

Raw MCP arguments/results, credentials, provider objects, and model reasoning are never written to message content or metadata.

### 5.2 Existing `conversations` table

Add projection columns instead of a new table:

- `sidechatStatus`: `idle | working | waiting_approval | ready | failed`;
- `sidechatUnread`: boolean;
- `sidechatLastActivityAt`: timestamp;
- `sidechatRunId` and `sidechatLeaseExpiresAt` for one bounded turn at a time and stale-run recovery.

Sidechat activity never changes public `status`, `lastActivityAt`, assignee, handoff state, delivery state, or conversation ordering.

### 5.3 Public isolation invariant

Every existing public message read/write path must explicitly constrain `channel = public`, including:

- widget history, polling, SSE, and WebSocket replay;
- dashboard public history and pagination;
- conversation-list previews;
- visitor counts and first-turn checks;
- Telegram and email context;
- delivery/read receipts;
- delete/edit routes; and
- public AI transcript construction.

Dedicated `ChatService` methods read and write `channel = sidechat`. No generic method may return both channels by default.

## 6. Runtime and realtime

### 6.1 Authenticated API

Add dashboard-only routes under:

```text
GET  /api/projects/:id/conversations/:convId/sidechat/messages
POST /api/projects/:id/conversations/:convId/sidechat/messages
POST /api/projects/:id/conversations/:convId/sidechat/retry
```

They use the same session, effective-owner, team-role, project, and conversation authorization as the existing conversation detail route. The widget has no sidechat route.

POST stores the human message, atomically claims the conversation's sidechat run lease, returns `202 Accepted`, and asks the existing `ConversationDO` to execute the turn. The DO-backed turn continues when the pane closes or the browser disconnects.

### 6.2 Existing AI runtime

Create a sidechat-specific prompt and orchestration module under the existing `worker/chat-runtime/` tree. It uses `createLanguageModel`, `runWithModelFallback`, AI SDK v6 streaming/tool primitives, current project settings, and the existing model configuration.

The turn receives:

- bounded public transcript from `channel = public`;
- bounded private transcript from `channel = sidechat`;
- linked canonical customer context;
- project knowledge retrieval when useful; and
- enabled native MCP tools when phase 2 is installed.

The model is instructed that customer and tool data are private working context: answer the human's question, do not dump records, do not repeat internal identifiers/links/metadata, and put only the minimum visitor-appropriate facts in a `reply_draft`.

### 6.3 Existing realtime path

Extend `shared/ws-events.ts` and `useConversationWs` with agent-only events:

- `sidechat:message` — a finalized safe sidechat message;
- `sidechat:delta` — ephemeral Maven text for the active turn;
- `sidechat:status` — status/unread projection;
- `sidechat:approval_updated` — safe approval state only.

Add explicit `broadcastSidechat*` helpers that always set `audience: agents`. Never send sidechat data using public `message:new`.

On reconnect, the dashboard refetches the sidechat query. Visitor replay remains public-only.

## 7. Trusted customer identity

Maven receives identity only from the project-scoped `customers` row already linked to the conversation:

1. trusted non-empty `customer.externalId`;
2. normalized trusted `customer.email` as fallback;
3. otherwise no trusted lookup identity.

The prompt tells Maven to prefer external ID whenever a native MCP schema accepts it, and to use email only when external ID is unsupported or returns no match. Visitor message text, widget metadata, `visitorName`, and conversation email snapshots are never promoted to trusted lookup keys.

No provider-specific identity mapper is added. Native MCP schema plus the tool's project-configured instructions determine argument names.

## 8. Generic MCP connections and inert presets

The project connects any supported Streamable HTTP MCP server through one generic `McpConnectionService` built on the existing `@modelcontextprotocol/sdk`. Presets are convenience metadata only:

| Preset | Default URL |
|---|---|
| PostHog | `https://mcp.posthog.com/mcp` |
| Stripe | `https://mcp.stripe.com` |
| Slack | `https://mcp.slack.com/mcp` |
| Attio | `https://mcp.attio.com/mcp` |
| Linear | `https://mcp.linear.app/mcp` |
| Custom | User-entered HTTPS URL |

A preset contains only ID, label, icon path, default URL, documentation URL, and short setup copy. It must not define actions, mappings, schema matchers, reducers, prompts, identity rules, parameter bindings, or provider runtime branches.

After connection, owners review the discovered native catalog. Every tool is disabled by default and can be configured with:

- enabled;
- access: `read` or `write`;
- optional short instructions for Maven; and
- write approval policy.

Configuration is bound to the exact connection, native tool name, and input-schema fingerprint. Catalog drift disables the tool until reviewed.

## 9. Data boundary

The LLM may receive native MCP inputs and results as private turn context. The system does not automatically expose those values anywhere else.

Enforced boundaries:

- MCP credentials and authorization headers remain encrypted at rest and are decrypted only inside the Worker call scope.
- Native inputs/results are not stored in D1 messages, browser frames, public transcripts, Telegram, widget APIs, analytics, or traces.
- Only model-written safe sidechat text, structured drafts, safe approval descriptors, and bounded status metadata are persisted/rendered.
- The public bridge remains human-controlled: `Add to reply`, edit, then Send.
- Tool and model telemetry for this path is payload-free until redaction tests prove otherwise.

Prompt rules are the requested content policy, not a claim that the model never sees data. Human review before public send remains the final disclosure checkpoint.

## 10. Generic write approval

Any configured native tool marked `write` uses the same interception path.

1. The dynamic tool wrapper receives native arguments from Maven.
2. If an exact persistent policy already allows the tool, execute it.
3. Otherwise, the MCP service AES-GCM-encrypts the exact arguments under an opaque execution ID and returns a safe human descriptor.
4. Sidechat persists a normal `approval` message containing only that descriptor and execution reference.
5. An authenticated human chooses `Always allow` or `Allow once`.
6. The server reloads the authoritative pending call; it ignores browser-supplied tool names and arguments.
7. The MCP service executes once, then a new private model continuation receives the raw result transiently and prepares the safe final answer/draft.

`Always allow` is scoped to `(project, connection, native tool name, input-schema fingerprint)`. Reconnect, account change, schema drift, disabling the tool, or changing access invalidates it.

There is no Think durable pause. Idempotency and state transitions live in generic project-scoped D1 records: `prepared -> executing -> succeeded | failed | unknown | expired`.

## 11. Project configuration UI

The existing `Actions & Tools` area gains a `Connections` tab. It includes compact preset selection, Custom, connection state, discovered native tools, per-tool access/instructions/approval, and safe recent activity.

It reuses current page shells, typography, controls, dialogs, surfaces, and spacing. Presets are compact picker rows, not marketplace cards. No provider-specific action list is shown.

## 12. Errors, cleanup, and retention

- A failed sidechat submission leaves the public draft intact.
- A stale sidechat lease becomes `failed` and can be retried without duplicating a finalized message.
- MCP unavailability yields a safe private error; Maven must not invent provider facts.
- Ambiguous write outcomes become `unknown` and are never retried automatically.
- Expired approvals never execute.
- Conversation deletion removes both channels and pending executions through existing D1 cascades.
- Project deletion removes its MCP connections, encrypted credentials, settings, policies, and pending executions through D1 cascades.

## 13. Rollout

1. **Internal Sidechat Channel** — schema isolation, ChatService filters, existing ConversationDO/AI runtime, reused UI primitives, draft bridge, responsive pane, and removal of inline Compose.
2. **Generic MCP Connections** — one Worker MCP client service, inert presets, catalog review, native tool configuration, trusted customer context, and Connections UI.
3. **Generic Write Approval** — native write interception, exact pending call, same-bubble approval, always/once policy, idempotency, expiry, and safe audit metadata.

Each phase stays behind a server-side feature flag until unit, integration, leakage, responsive, keyboard, zoom, and reduced-motion checks pass. Deployment requires separate user approval.

## 14. Explicitly out of scope

- A separate sidechat agent/chat infrastructure.
- Migrating the public widget to Chat SDK.
- Provider-specific MCP actions, profiles, reducers, or mappings.
- Automatically enabling tools from a preset.
- Sending a draft automatically.
- Exposing sidechat to visitors or Telegram.
- A permanent right rail or visitor-preview pane.
- Multi-stage workflows that need hours/days of durable orchestration.

## 15. Official MCP preset sources

- [Cloudflare Agents MCP client](https://developers.cloudflare.com/agents/model-context-protocol/client/)
- [PostHog MCP](https://posthog.com/docs/model-context-protocol)
- [Stripe MCP](https://docs.stripe.com/mcp)
- [Slack MCP](https://docs.slack.dev/ai/slack-mcp-server)
- [Attio MCP](https://docs.attio.com/mcp/overview)
- [Linear MCP](https://linear.app/docs/mcp)
