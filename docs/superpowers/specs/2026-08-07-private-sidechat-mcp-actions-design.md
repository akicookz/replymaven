# Private Sidechat and MCP Action System

**Date:** 2026-08-07  
**Status:** Approved in the product-design conversation; implementation is split into three plans  
**Scope:** Dashboard inbox, private agent runtime, project MCP connections, safe customer-data reads, and approved writes

## 1. Product outcome

ReplyMaven's dashboard agent needs a private place to investigate a customer issue, use project tools and MCP connections, ask the human agent for approval when a write is required, and prepare the final visitor-facing reply.

The visitor must receive only the normal message the human sends from the existing reply composer. The private reasoning thread, MCP responses, progress, approvals, and internal customer context never enter the visitor transcript.

This replaces the current one-shot inline Compose feature end to end. It does not replace the public reply composer, the existing D1 conversation transcript, the widget SSE path, or Telegram ownership/handoff.

## 2. Final interaction model

### 2.1 Entry point

The current `Compose ⇧⇥` action in `src/components/inbox/Composer.tsx` becomes:

`Start sidechat  ⇧⇥`

There is no icon. In particular, there is no sparkle icon or decorative AI mark.

- Clicking the action or pressing Shift+Tab opens the private right pane.
- If the reply composer contains text, that text becomes the first human message in the sidechat.
- The public reply composer clears only after the private message has been accepted by the sidechat agent. A connection or submission error leaves the original text untouched.
- If the reply composer is empty, the first private message is `Help me respond to {customerFirstName}.`
- Pending public image attachments remain staged in the public composer. Only text moves to sidechat.
- If a sidechat already exists for the selected conversation, the action copy becomes `Open sidechat`; Shift+Tab opens it without creating a second thread.

### 2.2 Pane behavior

The sidechat is closed by default. Closing it does not cancel work.

- One private sidechat exists per project conversation.
- Switching conversations while the pane is open loads the selected conversation's sidechat. Work on the previous conversation continues.
- A quiet status dot on the conversation row and beside `Open sidechat` indicates working, waiting for approval, ready, or failed. There is no status badge or alert banner.
- Archived conversations may open an existing sidechat read-only, but cannot start new work or add a draft to the disabled public composer.
- The sidechat title is `Sidechat`.
- The subline is `Private · Maven has {customerFirstName}'s context`.
- The pane has a close button. It does not have a permanent toggle rail, duplicate visitor preview, or separate "what the visitor sees" panel.

### 2.3 Private conversation

The human and Maven talk in the right pane. Maven may show compact activity lines such as `Stripe · Checking recent payments`, but raw tool payloads are never rendered.

When Maven has a visitor-ready answer, it attaches a structured `reply_draft` to a normal Maven message. That message includes one compact action:

`Add to reply`

Selecting it inserts the exact draft into the existing public reply composer, focuses the textarea at the end, and leaves the sidechat open. It never sends automatically. The human can edit the draft, attach images, and use the existing Send action.

### 2.4 Approval interaction

Writes are approved only in the authenticated dashboard sidechat. A visitor, public widget, email ingress, Telegram command, or model-generated text cannot approve a write.

The approval request is a normal received-message bubble, not a card, alert, permission panel, or account badge. It uses the same font size, line height, bubble width, padding, radius, and surface as Maven's other private messages.

Example copy, addressed to the human agent:

> Refund the $49.00 payment from Aug 2?  
> This **sends $49.00 back to the customer** and cannot be undone.

The only visible actions, in this order, are:

`Always allow` | `Allow once`

- `Always allow` is visually secondary.
- `Allow once` is the compact primary action.
- There is no `Not now`, reject button, verified-account badge, warning alert, nested card, or duplicate detail block.
- Closing the sidechat defers the decision. The durable request remains pending until approved, invalidated, or expired.
- Important details live in the description. Only text requiring attention is bold.

`Always allow` means project-wide permission for the exact canonical action on the exact connection and action-schema version. Changing the MCP tool mapping, reconnecting a different account, or incrementing the action schema invalidates the grant.

## 3. Responsive layout and exact visual language

### 3.1 Desktop

The existing inbox remains the base layout: project sidebar, conversation list, and reading pane.

- At 1536px and wider, the conversation list remains visible and the sidechat is 400px wide.
- From 768px through 1535px, opening sidechat hides the conversation list and gives the reading pane the remaining width; the sidechat is 380px wide, capped at 42vw.
- Focus mode becomes conversation plus sidechat. The centered conversation card keeps its existing max width within the available space.
- The reading pane compresses. The sidechat does not overlay it.

### 3.2 Mobile

Below 768px, sidechat replaces the reading pane in the same screen. A compact back control closes sidechat and restores the conversation. It is not a drawer over the conversation and does not leave a sliver of the right pane permanently visible.

### 3.3 Component measurements

New UI uses the existing tokens and components rather than introducing a second assistant aesthetic:

- Pane: `glass-reading`, `text-ink-*`, existing wallpaper blur.
- Private bubbles: `max-w-[88%]`, `rounded-[20px]`, 14.5px text, 1.5 line height, `bg-bubble-received` for Maven and `bg-bubble-sent` for the human.
- Pane horizontal inset: 16px on narrow screens and 20px on desktop.
- Sidechat header: 14px semibold title, 11.5–12px muted subline.
- Approval buttons: 28px visible height, 12.5–13px text, 8px radius. Their interactive hit area must still reach 40px using surrounding padding or a pseudo-element.
- Sidechat composer: the existing `glass-bar`/20px-radius language, a 14–14.5px auto-growing textarea, and the existing 32px circular send button.
- No new gradients, oversized titles, ornamental glow, sparkle icon, horizontal divider, `border-t`, `border-b`, or nested card stack.
- Motion uses targeted opacity/transform/width transitions, 180–220ms, and respects `prefers-reduced-motion`. Never use `transition-all`.

### 3.4 Required visual states

Visual QA must cover all of these at 1440x1000, 1100x900, 768x900, and 390x844:

1. Sidechat closed.
2. Empty sidechat immediately after opening.
3. Existing private history.
4. Streaming/private work in progress.
5. Read-action activity.
6. Pending write approval with long critical detail.
7. Ready reply draft with `Add to reply`.
8. Failed work with a retry affordance.
9. Conversation switch while prior work continues.
10. Focus mode.
11. Archived/read-only conversation.
12. Keyboard focus, 200% zoom, and reduced motion.

## 4. Runtime architecture

### 4.1 Preserve the public source of truth

The current public architecture remains untouched:

- D1 `conversations` and `messages` remain the visitor transcript source of truth.
- `ChatService` remains the only public reply persistence path.
- Widget SSE, polling, delivery receipts, Telegram handoff, and `ConversationDO` realtime behavior remain in place.
- No sidechat message is inserted into `messages`.
- The only bridge from private to public is the human selecting `Add to reply`, followed by the existing dashboard send path.

### 4.2 Cloudflare Agents

Add two new Durable Object classes:

1. `MavenSidechatAgent extends Think` — one instance per project conversation. It owns the private message tree, durable turn recovery, streaming, structured reply drafts, and write approval state.
2. `MavenIntegrationAgent extends Agent` — one instance per project MCP connection. It owns that connection's MCP client, OAuth/token state, discovered catalog, and deterministic tool execution.

The sidechat agent calls the integration agent through typed RPC. The integration agent is not model-facing and never generates text.

The sidechat agent configuration is intentionally narrow:

- `sendReasoning = false`.
- `includeMcpTools = false`.
- `workspaceBash = false`.
- `beforeTurn().activeTools` contains only ReplyMaven-owned safe reads, approved actions, and the `presentReplyDraft` action. Think's workspace tools are not active.
- Chat recovery remains enabled with a bounded stall timeout.
- The public `runTurn()` API is wrapped behind a ReplyMaven adapter because Think remains experimental.

Use `@cloudflare/think` and `@cloudflare/ai-chat` on top of `agents@0.20.x`/current lockfile-compatible releases while keeping this repository on AI SDK v6. Do not migrate the stable public widget to Chat SDK in this work.

### 4.3 Authentication

The dashboard requests a short-lived sidechat connection token through the existing authenticated Hono project route. That route performs the same team/project authorization as the conversation detail route.

The token contains:

- user ID and effective owner ID;
- project ID and conversation ID;
- agent instance name;
- team role and action permission claims;
- issued-at, expiry, audience, and version.

It is HMAC signed, expires in two minutes, is scoped to one agent instance, and carries no provider credentials or customer data. `MavenSidechatAgent.onConnect` validates it before accepting the WebSocket and stores only the authorization claims on the connection.

Agent and MCP OAuth routes run before the SPA fallback. The widget has no route to either new agent class.

### 4.4 Private status projection

Think stores the private transcript in Durable Object SQLite. D1 stores only a small dashboard projection so the inbox list can show status without opening every agent:

`sidechat_threads`

- project ID and conversation ID (unique);
- deterministic agent instance name;
- status: `idle | working | waiting_approval | ready | failed`;
- unread boolean;
- last safe preview (bounded, no raw tool data);
- last activity and timestamps.

Status changes broadcast through the existing dashboard realtime channel as a new `sidechat:status` event. Conversation list responses include the projection. The private transcript is never copied into D1.

## 5. Trusted customer identity

Actions resolve identity only from the project-scoped `customers` record already linked to the conversation.

Resolution order:

1. Non-empty trusted `customer.externalId`.
2. Normalized trusted `customer.email`.
3. Fail closed with `customer_identity_missing`.

Visitor message text, widget metadata, `visitorName`, and unverified conversation email snapshots are never used to select an external account. If no canonical customer is linked, Maven tells the human to link or create the customer profile. Identity conflicts fail without guessing or merging.

Each connection profile defines how ReplyMaven's external ID maps to the provider's identity field. Email remains a fallback, never the preferred key.

## 6. MCP consumer and provider profiles

### 6.1 Generic client, thin profiles

The MCP transport is generic. A project can connect any Streamable HTTP MCP server supported by the Cloudflare Agents client. OAuth is handled by the Agents SDK and stored in the integration agent's SQLite; bearer headers are submitted directly to the agent and never stored in D1.

Connecting a server does not expose all discovered tools to Maven. The setup flow discovers the catalog, then requires an owner to review explicit canonical-action mappings. Unknown tools stay disabled.

Thin built-in profiles supply mapping and normalization rules for PostHog, Stripe, Slack, Attio, and Linear. A mapping is accepted only when the selected tool's input schema satisfies the profile contract. A changed catalog returns the mapping to `needs_review` instead of guessing.

### 6.2 Canonical read actions

Initial reads are deliberately small and bounded:

#### PostHog — `customer.posthog.events`

Input: trusted identity plus `from`, `to`, optional event-name filter, optional property filters, and limit (default 25, maximum 100).

Output: ordered normalized events with event name, timestamp, and allowlisted primitive properties. No complete person, session, or event payload.

#### Stripe — `customer.stripe.billing_summary`

Output:

- whether a subscription exists;
- subscription status and product/plan label;
- current period start and renewal date;
- cancel-at-period-end, cancel date, and canceled date;
- recent payment activity (maximum 10) normalized as purchase, upgrade, downgrade, renewal, refund, or failed payment with date, amount, currency, and status.

No complete Stripe customer, subscription, invoice, charge, payment method, address, tax, or metadata object reaches Maven.

#### Slack — `customer.slack.search`

Input: trusted identity, date range, project-configured channel allowlist, and maximum 10 hits.

Output: channel name, author display name, timestamp, bounded excerpt, and permalink. No full thread dump, member profile, or workspace export.

#### Attio — `customer.attio.record`

Output: matched person/company label, project-allowlisted attributes, relationship stage, owner, and maximum 10 recent notes/tasks. No complete record payload.

#### Linear — `customer.linear.issues`

Output: maximum 10 linked issues with identifier, title, status, priority, assignee, updated date, and URL. No full workspace or issue history.

### 6.3 Canonical write actions

Initial writes are:

- `customer.stripe.refund_payment`;
- `customer.stripe.cancel_subscription_at_period_end`;
- `customer.slack.post_internal_message`;
- `customer.attio.add_note`;
- `customer.linear.create_issue`.

PostHog remains read-only in v1.

Every write uses a two-stage contract:

1. Prepare: resolve trusted identity, validate current provider state, generate an opaque preparation ID, encrypt the exact provider arguments, calculate an input hash, attach a human-readable safe summary, and set an action-specific expiry.
2. Execute: after approval, load the sealed preparation, revalidate identity and provider preconditions, enforce idempotency, call the exact mapped MCP tool once, reduce the result, and mark the preparation settled.

The model and approval descriptor receive the preparation ID and safe summary, not the raw provider arguments.

## 7. Data boundary

Prompt instructions are defense in depth, not the security boundary.

The enforceable path is:

`raw MCP response -> provider reducer in MavenIntegrationAgent -> normalized safe fact -> MavenSidechatAgent -> private sidechat -> structured reply draft -> human Add to reply -> existing public send`

Rules:

- Raw MCP responses exist only in the integration agent execution scope and are reduced before RPC returns.
- Direct MCP tools are never passed to the LLM.
- Raw provider payloads, request headers, OAuth tokens, plaintext tool arguments, and complete tool outputs are not logged, traced, streamed to the browser, written to D1, or inserted into either transcript. Exact write arguments may exist only as authenticated ciphertext in `action_preparations` until execution/expiry.
- Action activity stores action name, connection ID, status, duration, approval actor/mode, schema version, timestamps, idempotency hash, and a bounded safe summary only.
- Workers traces remain disabled for the new agents until a production redaction test proves that message/tool payloads are not captured.
- The sidechat system prompt says private customer facts are context, not copy; never paste identifiers, internal links, raw records, hidden metadata, or unsupported claims into a proposed visitor reply.
- A reply draft still requires the human to select `Add to reply` and then Send.

## 8. Approval and policy model

Think Actions with `kind: "durable-pause"` provide the durable approval ledger and resume behavior for single external writes. Cloudflare Workflows are not added for these one-step writes. They remain the future primitive for multi-step business workflows with several durable stages or external waits.

ReplyMaven adds project policy around Think Actions:

- `Allow once` approves only the exact execution ID and authoritative descriptor hash.
- `Always allow` writes a project policy for `(projectId, connectionId, canonicalActionId, actionSchemaVersion, mappingVersion)`, then approves the current execution.
- Read actions never require approval, but must be enabled in project action settings.
- Write actions default to `every_time` approval.
- Owner/admin may change persistent policy. A member may approve once when their project role grants write approval but may not create an always-allow policy.
- Reconnect, mapping edit, schema-version change, account change, or action disable immediately invalidates persistent permission.
- Server-side value limits and precondition checks apply even when an action is always allowed.
- Approval requests expire (15 minutes for payments/subscription changes, 24 hours for Slack/Attio/Linear writes). Expiry resolves the durable pause as rejected with reason `expired`; it never executes.
- There is no visible rejection action in the compact bubble. Closing the pane simply leaves the request pending.

## 9. Project configuration UI

The existing project `Actions & Tools` page gains two tabs without creating a separate design language:

1. Existing `Actions` — widget shortcuts/contact form.
2. Existing `Tools` — generic public-bot HTTP tools.
3. `Connections` — outbound MCP servers available to sidechat.
4. `Agent actions` — canonical read/write enablement, mapping status, approval policy, and safe activity.

The account-level Settings > MCP page remains the inverse capability: external AI clients connecting to ReplyMaven's MCP server. Its copy is clarified so it cannot be confused with project provider connections.

Connection and action rows reuse current page typography, muted surfaces, compact controls, and spacing. Rows are separated by space/background contrast, never horizontal rules. Provider names are text-led; no sparkle treatment is added.

## 10. Persistence model

New D1 tables:

### `sidechat_threads`

Private-thread status projection described in section 4.4.

### `integration_connections`

Project, display name, provider kind (`posthog | stripe | slack | attio | linear | custom`), MCP server URL, integration-agent instance name, stable SDK server ID, state, catalog fingerprint, last error code, last connected time, timestamps. No tokens or headers.

### `integration_action_mappings`

Connection, canonical action ID, selected MCP tool name, profile version, mapping version, reducer version, schema fingerprint, enabled/read-write kind, review state, timestamps.

### `action_policies`

Project, connection, canonical action ID, action schema version, mapping version, approval mode (`every_time | always`), enabled flag, actor, timestamps. Unique on the policy scope.

### `action_preparations`

Project, conversation, connection, canonical action ID, encrypted provider arguments, safe descriptor JSON, input hash, idempotency key hash, status, expiry, settled time, timestamps. Never stores a raw response.

### `action_runs`

Project, conversation, connection, canonical action ID, preparation ID, status, approval mode/actor, duration, provider result reference hash, safe summary, error code, timestamps. No raw input/output.

OAuth credentials and MCP client state live only in `MavenIntegrationAgent` Durable Object SQLite.

## 11. Errors and recovery

- Sidechat connection failure: keep public draft intact and show a compact private retry state after the pane opens.
- Interrupted Think turn: reconnect and resume the durable stream; do not finalize partial output.
- MCP unavailable: return a normalized unavailable error, mark only that connection degraded, and let Maven prepare a reply without inventing facts.
- Identity missing/conflict: fail closed and tell the human what profile link must be fixed.
- Reducer/schema mismatch: disable the mapping and mark it `needs_review`; never return the raw payload as fallback.
- Approval from stale UI: refetch the authoritative pending descriptor and compare its hash before enabling either button.
- Provider timeout or ambiguous write result: mark `unknown`, do not retry the side effect automatically, and ask the human to verify provider state.
- Duplicate approve: idempotent no-op.
- Expired/stale prepared action: reject and prepare a fresh request.

## 12. Retention and deletion

Private sidechat lifetime follows its public conversation. Manual conversation deletion and automated retention call the sidechat agent's idempotent destroy method before deleting the D1 projection. Failed cleanup is queued and retried. Removing a project destroys its integration agents and sidechat agents before D1 cascade cleanup.

Action-preparation ciphertext is deleted after its audit retention window; settled run metadata follows the project's audit retention. Disconnecting an MCP connection removes the SDK server registration and destroys its integration-agent state after the D1 row is marked disconnected.

## 13. Rollout

The implementation ships in three independently verifiable phases:

1. Private Sidechat Foundation — Cloudflare Think/AI Chat runtime, authenticated private thread, structured draft, inbox layout, status projection, and complete removal of inline Compose.
2. Safe MCP Read Actions — generic MCP connection agent, catalog review, trusted identity, five provider profiles, reducer boundary, and project connection/action settings.
3. Write Actions and Approvals — sealed preparations, Think durable-pause actions, exact approval bubble, always/once policy, five provider writes, idempotency, expiry, and audit metadata.

Each phase is guarded by a server-side feature flag until its automated, responsive, keyboard, and production-like visual acceptance suite passes. Deployment remains a separate user-approved action.

## 14. Explicitly out of scope

- Replacing the public widget transcript or SSE delivery with `@cloudflare/ai-chat`.
- Sending a sidechat draft automatically.
- Exposing private sidechat to visitors or Telegram.
- Directly exposing an arbitrary MCP tool to Maven.
- Code Mode, browser automation, shell/workspace tools, or model-written integration code.
- A permanently open right rail.
- A visitor-preview pane.
- Multi-stage business workflows; use Cloudflare Workflows when one is designed.

## 15. Current official primitives used

- [Think](https://developers.cloudflare.com/agents/harnesses/think/)
- [Think Actions](https://developers.cloudflare.com/agents/harnesses/think/actions/)
- [Think programmatic submissions](https://developers.cloudflare.com/agents/harnesses/think/programmatic-submissions/)
- [MCP client API](https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/)
- [Cross-domain and WebSocket authentication](https://developers.cloudflare.com/agents/runtime/operations/cross-domain-authentication/)
- [Human-in-the-loop patterns](https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/)
