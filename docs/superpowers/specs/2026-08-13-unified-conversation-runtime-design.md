# Unified Conversation Runtime Design

**Date:** 2026-08-13

**Status:** Approved direction; implementation planning

## Objective

Replace ReplyMaven's separate public visitor-chat runtime and native Sidechat
runtime with one Cloudflare Agents SDK runtime implementation. Public visitor
conversations and private Sidechats remain separate `MavenChatAgent` child
instances because they have different transcripts and audiences, but they use
the same class, lifecycle, persistence model, routing, recovery, and tool
infrastructure.

The final system has no canonical public transcript or operational
conversation state in D1. D1 continues to own product data such as users,
projects, customers, subscriptions, usage ledgers, knowledge-base metadata,
tool definitions, and project settings.

## Source-of-truth boundaries

### `MavenChatAgent` child SQLite

For a public child named `pub_<conversationId>`, the child is authoritative
for:

- the complete public transcript;
- message authorship, sources, attachments, delivery/read/email timestamps;
- AI-versus-human ownership and its revision;
- active, waiting-agent, agent-replied, closed, snoozed, and archived state;
- priority, assignment, Telegram thread reference, visitor presence, and
  conversation-scoped metadata;
- turn queueing, cancellation, partial output, streaming, and recovery.

For a private child named `sc_<conversationId>`, the child remains
authoritative for the private Sidechat transcript, approvals, reply drafts,
and Sidechat turn lifecycle.

### `MavenProjectAgent` SQLite

The project parent owns the child registry, access policy, shared MCP/tool
connections, and a project-wide conversation directory. The directory is a
query-optimized read model containing summaries needed to render and filter
the dashboard inbox. It is updated after an authoritative child mutation and
is never used to reconstruct a transcript.

Dashboard list requests query this one indexed directory. They never fan out
to every child. Opening one conversation connects to only that conversation's
public child.

### D1

D1 remains authoritative for:

- accounts, sessions, teams, projects, and project membership;
- customers and visitor-to-customer identity mappings;
- subscriptions, plan limits, and usage counters;
- project settings, widget configuration, resources, knowledge-base metadata,
  API keys, HTTP tool definitions, and audit records;
- temporary migration checkpoints and compatibility projections while the
  cutover is reversible.

The steady state contains no `conversations` or `messages` tables. D1 records
that refer to a conversation, such as tool-execution audit rows or visitor-ban
provenance, retain the conversation ID as an un-enforced string rather than a
foreign key.

## Runtime topology

```text
MavenProjectAgent(projectId)
  project tool/MCP ownership
  conversation directory
  child registry and access gate
  |
  +-- MavenChatAgent(pub_<conversationId>)  public transcript/runtime
  +-- MavenChatAgent(pub_<conversationId>)  public transcript/runtime
  +-- MavenChatAgent(sc_<conversationId>)   private Sidechat transcript/runtime
```

The public and private children are not two runtime implementations. They are
instances of the same class with channel-specific policies selected from the
trusted child-name prefix and signed connection claims. A browser-supplied
request body cannot select its channel.

The children are SDK sub-agent facets: each has isolated SQLite, WebSocket
connections, and execution, but is colocated with its project parent and does
not require another top-level Durable Object binding. The parent remains the
only bound Agent class.

Cloudflare's `AIChatAgent` provides message persistence, the WebSocket chat
protocol, streaming, client resumption, multi-client synchronization, turn
concurrency, cancellation, partial-output persistence, server-driven message
methods, and optional durable recovery. Cloudflare sub-agents provide child
registration, isolated SQLite, typed RPC, routing, lifecycle, and the parent
access hook. ReplyMaven implements the model invocation, prompts, tools,
business policies, directory schema, auth claims, and external integrations.

## Common `MavenChatAgent`

The current Sidechat-specific class moves to `worker/agents/maven/` and becomes
a small lifecycle dispatcher. Sidechat policy remains in focused Sidechat
modules; public policy lives in focused public modules. This preserves one
runtime without creating a single unmaintainable method.

The class keeps these common settings:

- `messageConcurrency = "queue"`;
- `chatRecovery = true`;
- `waitForMcpConnections = false`;
- automatic `AIChatAgent` persistence and WebSocket protocol;
- exact parent-path and signed-claim validation.

`maxPersistedMessages` is channel-specific: Sidechat retains its current
bounded private history, while public transcripts are not silently truncated.
Model context is bounded independently from stored history.

## Public message representation

Public messages use AI SDK `UIMessage` rows in the child's native message
table. AI SDK roles are augmented with persisted ReplyMaven metadata so human
agents and the AI can both appear as assistant-facing responses without losing
authorship.

Required metadata includes:

```typescript
interface PublicMessageMetadata {
  v: 1;
  channel: "public";
  projectId: string;
  conversationId: string;
  author: "visitor" | "bot" | "agent" | "system";
  senderName: string | null;
  senderAvatar: string | null;
  userId: string | null;
  imageUrls: string[];
  sources: PublicSourceReference[];
  createdAt: number;
  deliveredAt: number | null;
  readAt: number | null;
  emailedAt: number | null;
  systemKind: string | null;
}
```

Text, file, source, tool, and data parts remain native UI-message parts. Every
API and UI adapter uses one conversion module; business services do not depend
on Drizzle `MessageRow` after the compatibility phase.

## Public operational state

Each public child owns a single-row custom SQLite table for operational state.
Keeping this state beside the transcript allows visitor submission, human
takeover, cancellation, and message persistence to be serialized by one
Durable Object.

Human takeover is executed against the child, not by updating a remote D1 row.
The child aborts an active AI request, advances the ownership revision, applies
the documented partial-output policy, persists the human message, and then
updates the parent summary. This removes the current split-brain race between
the SSE runtime and D1 ownership guards.

When a visitor submits while the conversation is human-owned, `AIChatAgent`
has already persisted the visitor message. The public turn policy returns an
empty successful UI-message stream, forwards the visitor message to Telegram,
and does not invoke the model.

## Project directory and dashboard list

`MavenProjectAgent` creates an indexed `conversation_directory` table rather
than storing all conversations in `this.state`. The table contains one row per
public conversation with the fields needed for search, filters, counts,
pagination, Telegram-thread lookup, billing-log metadata filters, and
summaries. That includes the visitor/contact snapshot, presence timestamps,
status/action fields, metadata JSON, last-message preview/author, total and bot
message counts, and child revision. It also contains the associated Sidechat
child name and Sidechat status where present. Full messages and mutable
AI/human ownership state are not duplicated into the directory.

The dashboard flow is:

1. Hono authenticates the dashboard user and project access through D1.
2. Hono calls `MavenProjectAgent.listConversations()` once.
3. The parent performs an indexed cursor query and returns summaries.
4. Hono batch-loads referenced customer and assignee profiles from D1.
5. The dashboard renders the page and holds one project-parent connection for
   summary updates.
6. Selecting a row obtains a signed public-child session and connects directly
   to that child for transcript sync.

The parent directory may lag a child mutation only for the duration of a
failed/retried summary RPC. Child state is authoritative. Idempotent summary
revisions and reconciliation repair gaps without reading transcripts into the
parent.

## Authentication

Public widget and dashboard connections receive different short-lived signed
claims. Claims bind the project, parent, child name, conversation ID, audience,
actor, capabilities, issuance time, and expiry. The parent validates the exact
child path in `onBeforeSubAgent`; the child validates the claim again in
`onConnect` and on submitted turns.

Widget tokens are carried in the cross-domain WebSocket URL because browser
WebSocket handshakes cannot reliably attach arbitrary authorization headers.
Dashboard tokens are minted only after Better Auth and project-membership
checks.

`AIChatAgent`'s normal browser protocol carries the client's current transcript
so it can reconcile and persist chat state. That is acceptable for the trusted
dashboard Sidechat, but the public widget is untrusted. The common child wraps
the SDK message handler with a public-channel guard using the SDK's exported
protocol parser. A visitor request is forwarded to the SDK only when the
server's current transcript is an exact immutable prefix and the request adds
exactly one size-bounded `user` message with allowed parts and no client-owned
authorship metadata. Direct transcript replacement, clear, regenerate,
assistant/system injection, and client-tool frames are rejected without
mutation. Resume and cancellation frames remain SDK-owned. The child stamps
the accepted visitor's server-owned metadata before model execution.

## Tools and retrieval

There is no search sub-agent. `search_knowledge` remains a server tool in the
same model loop. The parent owns shared MCP and HTTP tool configuration; the
child requests descriptors and executes project tools through typed parent
RPC. Public and private policies decide which channel is allowed to see or run
each tool.

The existing public prompt, retrieval, scope classification, escalation, and
tool modules are retained where their contracts are already channel-neutral.
The custom POST/SSE envelope is removed after the widget cutover.

## External channels and system consumers

All conversation readers and writers use a channel-neutral
`PublicConversationStore` boundary during migration. Its final implementation
routes to the project parent and public child.

- Telegram resolves `telegramThreadId` through the parent directory and
  appends human messages through the child.
- Dashboard replies, system messages, delivery/read receipts, email markers,
  deletion, archive, reopen, snooze, assignment, and priority are child RPCs.
- Sidechat obtains public context from the sibling public child rather than
  D1.
- MCP conversation reads call the public child.
- Customer pages query conversation summaries by customer/visitor through the
  project parent, while customer profiles remain in D1.
- Billing limits continue to use the D1 usage ledger. Billing logs and product
  dashboard statistics query per-project Agent aggregates.
- Archived-conversation retention uses Agents SDK schedules and deletes the
  public child, its Sidechat child, and conversation-scoped R2 attachments.

## Client migration

The React dashboard uses `useAgentChat` for the selected public child and a
project-parent Agent connection for list updates.

The vanilla widget mounts a headless React bridge that uses Cloudflare's
`useAgent` and `useAgentChat`, because those hooks own the complete native chat
sync, resume, multi-tab, server-pushed-message, and recovery lifecycle. The
bridge exposes an imperative controller to the existing widget DOM code; it
does not rewrite the visible widget in React or copy the hook's wire protocol.
Its adapter maps native UI messages into the existing DOM rendering functions,
presence behavior, notifications, delivery/read receipts, and optimistic send
state. The current POST/SSE parser, message polling, history buffer submission,
and `ConversationDO` socket are removed only after native chat behavior passes
real-widget browser verification and the bundle-size gate.

## Migration and rollback

The migration is a staged strangler, not an in-place table deletion:

1. Introduce neutral contracts and route every current reader/writer through a
   D1-backed compatibility implementation with no behavior change.
2. Add the parent directory and public child implementation behind
   `PUBLIC_CONVERSATION_STORE=legacy|agent`, defaulting to `legacy`.
3. Backfill and continuously mirror directory summaries while D1 remains
   authoritative. Do not pre-import message transcripts that can still change.
4. Verify directory counts, IDs, statuses, and summary revisions per project.
5. With explicit deployment approval, switch to `agent`. Existing transcripts
   import idempotently into the child on first access; all new writes go to the
   child.
6. During the rollback window, mirror committed Agent messages and state into
   D1 as a compatibility projection. The Agent remains authoritative.
7. Require parity checks and zero legacy endpoint traffic before disabling the
   projection.
8. Move remaining global consumers, delete legacy routes and services, drop
   D1 `messages` and `conversations`, and remove `ConversationDO` through a new
   Durable Object deletion migration.

No stage changes production configuration or deploys without explicit user
approval. Before the Agent-authoritative switch, rollback means selecting the
legacy implementation. During the compatibility-projection window, rollback
is allowed only after parity verification. After projection removal, rollback
requires an explicit Agent-to-D1 export and is not treated as a feature flag.

## Observability and acceptance criteria

The migration records runtime selection, import result, transcript checksum,
directory revision, summary-retry count, turn duration, recovery status, and
legacy-route traffic without logging message contents or tokens.

The design is complete when:

- visitor and Sidechat turns execute through the same `MavenChatAgent` class;
- public messages and operational state are authoritative only in the public
  child SQLite;
- the dashboard list performs one project-parent query with no child fan-out;
- widget and dashboard clients use the native Agent chat protocol;
- human takeover cannot persist a later AI completion as a normal bot reply;
- Telegram, MCP, customer, billing-log, dashboard-stat, upload, and retention
  consumers no longer read D1 conversations/messages;
- no production code imports the D1 `messages` or `conversations` tables;
- `ConversationDO`, custom public SSE streaming, and legacy polling are gone;
- all backend, Agent integration, widget build, lint, and production build
  checks pass.

## Non-goals

- Combining public and private transcripts into one physical Agent instance.
- Creating a separate knowledge-search Agent.
- Adopting the experimental Sessions API.
- Changing AI providers, model selection, prompts, tool permissions, or plan
  limits except where required to preserve existing behavior.
- Keeping a permanent dual-write message store.
- Deploying as part of the implementation-planning work.

## Primary SDK references

- https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/
- https://developers.cloudflare.com/agents/runtime/execution/sub-agents/
- https://developers.cloudflare.com/agents/communication-channels/chat/client-sdk/
- https://developers.cloudflare.com/agents/runtime/operations/cross-domain-authentication/
- https://github.com/cloudflare/agents/tree/main/examples/multi-ai-chat
