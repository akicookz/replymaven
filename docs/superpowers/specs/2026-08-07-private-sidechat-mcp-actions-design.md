# Private Sidechat and MCP Connections

**Date:** 2026-08-08
**Status:** Revised after product review; implementation remains split into three plans
**Scope:** Dashboard inbox, private sidechat, generic MCP connections, connection presets, native MCP tool configuration, and generic write approval

## 1. Product outcome

ReplyMaven's dashboard agent needs a private place to investigate a customer issue, use project MCP connections, ask the human agent for approval before a write, and prepare the final visitor-facing reply.

The visitor receives only the normal message the human sends from the existing reply composer. The private thread, MCP tool traffic, progress, approvals, and internal customer context never enter the visitor transcript.

This replaces the current one-shot inline Compose feature end to end. It does not replace the public reply composer, D1 visitor transcript, widget SSE path, or Telegram ownership/handoff.

## 2. Final interaction model

### 2.1 Entry point

The current `Compose ⇧⇥` action in `src/components/inbox/Composer.tsx` becomes:

`Start sidechat  ⇧⇥`

There is no icon or decorative AI mark.

- Clicking the action or pressing Shift+Tab opens the private right pane.
- If the public reply composer contains text, that text becomes the first human message in sidechat.
- The public draft clears only after sidechat accepts the private message. Failure leaves it untouched.
- If the public composer is empty, the first private message is `Help me respond to {customerFirstName}.`
- Public image attachments remain staged. Only text moves.
- Once a private thread exists, the action reads `Open sidechat`. Opening it never creates a duplicate thread or starter message.

### 2.2 Pane behavior

Sidechat is closed by default. Closing it never cancels work.

- One private sidechat exists per project conversation.
- Switching conversations while open loads the selected conversation's sidechat. Prior work continues.
- A quiet status dot indicates working, waiting for approval, ready, or failed. There is no status badge or alert banner.
- Archived conversations may open existing sidechat history read-only.
- Title: `Sidechat`.
- Subline: `Private · Maven has {customerFirstName}'s context`.
- The pane has a close/back control, not a permanent rail, visitor preview, or duplicate conversation panel.

### 2.3 Private conversation and reply draft

The human and Maven talk in the private pane. MCP work appears only as compact activity such as `Stripe · Searching payments`; MCP request/result bodies are not rendered.

When Maven has a visitor-ready answer, it adds a structured reply-draft body to a normal Maven message with one compact action:

`Add to reply`

Selecting it inserts the exact draft into the existing public Composer, focuses the textarea at the end, and leaves sidechat open. It never sends automatically. The human may edit, attach images, and use the existing Send action.

### 2.4 Generic write approval

Any MCP tool configured as a write pauses before execution. Approval is possible only from the authenticated dashboard sidechat. A visitor, widget request, Telegram message, API-key caller, or model-generated text cannot approve it.

The request is rendered inside the same Maven message bubble used by the rest of sidechat. It is not a card, alert, permission panel, or badge.

Example:

> Refund the $49.00 payment from Aug 2?
> This **sends $49.00 back to the customer** and cannot be undone.

The only visible actions, in this order, are:

`Always allow` | `Allow once`

- `Always allow` is visually secondary.
- `Allow once` is the compact primary action.
- There is no `Not now`, rejection button, verified-account badge, warning alert, nested card, or duplicate detail block.
- Closing sidechat defers the decision until approval, invalidation, or expiry.
- Important information remains in the description. Only text needing attention is bold.

`Always allow` is project-wide for the exact connection, native MCP tool name, and current input-schema fingerprint. Reconnecting the account, changing the tool schema, disabling the tool, or changing its read/write classification invalidates the grant.

## 3. Reuse the existing chat UI

Sidechat must use the inbox's existing chat primitives. It must not introduce parallel bubble, thread, markdown, or composer implementations that merely copy their styles.

### 3.1 Existing primitives become reusable

- `ChatThread.tsx` remains the thread primitive for skeletons, date grouping, sender grouping, message spacing, and message layout.
- `MessageBubble.tsx` remains the only bubble shell and Markdown-rendering path. It gains narrow content/action slots for sidechat activity, reply drafts, and approvals.
- `Composer.tsx` remains the only chat composer primitive. A private mode removes uploads and Resolve, changes placeholder/keyboard submission behavior, and otherwise retains its container, textarea auto-grow, focus restoration, and send button.
- `FocusView.tsx` removes its local `FocusBubble` implementation and uses the same `ChatThread`/`MessageBubble` path as ReadingPane and sidechat.
- `SidechatPane.tsx` composes those primitives. It does not own alternate versions of them.

Public conversation behavior and appearance must remain unchanged after this refactor.

### 3.2 Responsive layout

- At 1536px and wider, the conversation list remains visible and sidechat is 400px wide.
- From 768px through 1535px, opening sidechat hides the conversation list; sidechat is 380px wide, capped at 42vw.
- Focus mode becomes conversation plus sidechat. The focus card keeps its existing max width in the remaining space.
- Below 768px, sidechat replaces the reading pane in the same screen. It is not an overlay/drawer and leaves no permanent sliver.

### 3.3 Existing visual measurements

- Pane uses `glass-reading`, `text-ink-*`, and the existing wallpaper blur.
- Bubbles retain `MessageBubble`'s `max-w-9/10 sm:max-w-3/4`, `px-3.5 py-2.5`, 14.5px text, `leading-normal`, `rounded-bubble`, and six-pixel tail corner.
- Human messages use the existing sent treatment; Maven messages use the existing received treatment.
- Thread horizontal padding follows the existing `ChatThread` primitive. Sidechat may reduce only its outer desktop inset to fit the narrower pane; bubble internals do not change.
- Header is 14px semibold with an 11.5–12px muted subline.
- Approval controls are 28px visibly high, 12.5–13px text, and eight-pixel radius, with a minimum 40px interactive target.
- Private Composer uses the existing `glass-bar`, 20px radius, 14.5px textarea, auto-grow behavior, and 32px circular send control.
- No new gradients, oversized titles, glow, sparkle icon, horizontal divider, `border-t`, `border-b`, nested card stack, or `transition-all`.
- Motion is limited to opacity/transform/width at 180–220ms and respects reduced motion.

### 3.4 Required visual states

Visual QA covers these states at 1440x1000, 1100x900, 768x900, and 390x844:

1. Sidechat closed.
2. Empty sidechat after opening.
3. Existing private history.
4. Streaming/private work.
5. MCP activity.
6. Pending write approval with long critical detail.
7. Ready reply draft with `Add to reply`.
8. Failed work with retry.
9. Conversation switch while prior work continues.
10. Focus mode.
11. Archived/read-only conversation.
12. Keyboard focus, 200% zoom, and reduced motion.

## 4. Runtime architecture

### 4.1 Preserve the public source of truth

- D1 `conversations` and `messages` remain the visitor transcript source of truth.
- `ChatService` remains the only public reply persistence path.
- Widget SSE, polling, delivery receipts, Telegram handoff, and `ConversationDO` realtime remain unchanged.
- No private sidechat message is inserted into `messages`.
- The only bridge to public output is `Add to reply`, followed by the existing dashboard Send path.

### 4.2 Cloudflare agents

Add two generic Durable Object classes:

1. `MavenSidechatAgent extends Think` — one instance per project conversation. It owns the private message tree, recovery, streaming, reply drafts, and pending approval state.
2. `MavenIntegrationAgent extends Agent` — one instance per project MCP connection. It owns one generic MCP client, OAuth/token state, catalog, and native tool execution.

The integration agent contains no PostHog, Stripe, Slack, Attio, or Linear execution branches. It exposes catalog entries and exact native tools through a generic typed RPC bridge. The sidechat agent creates AI SDK tools dynamically from enabled catalog entries and executes them through that bridge.

Sidechat uses `sendReasoning = false` and `workspaceBash = false`. Only project-enabled MCP tools and `presentReplyDraft` are active. Public widget chat is not migrated to Chat SDK in this work.

### 4.3 Authentication

The dashboard obtains a two-minute HMAC-signed token from an authenticated project/conversation route. It includes user/effective-owner IDs, project/conversation/agent IDs, role/approval claims, timestamps, audience, and version—never customer data or provider credentials.

Agent and MCP OAuth routes run before the SPA fallback. The widget cannot address either new agent class.

### 4.4 Private status projection

Think stores the private transcript in Durable Object SQLite. D1 stores only `sidechat_threads`: project/conversation/agent IDs, `idle | working | waiting_approval | ready | failed`, unread, bounded safe preview, and timestamps.

Status changes broadcast only the projection through the authenticated dashboard realtime channel. The private transcript is never copied into D1.

## 5. Customer context

The private model context may include the canonical customer linked to the conversation:

1. Prefer non-empty `customer.externalId` when searching an MCP system.
2. Fall back to normalized `customer.email` only when external ID is absent or the native tool cannot use it.
3. If neither exists, tell the human the customer profile must be linked or completed.

Visitor-authored text, widget metadata, `visitorName`, and unverified conversation email snapshots are never treated as trusted identity.

Because the MCP layer is generic, there is no provider-specific identity mapper. Maven follows the native MCP tool schema and the system instruction above.

## 6. MCP connections and presets

### 6.1 One generic client

A project may connect any compatible remote Streamable HTTP MCP server. The same generic client handles URL validation, OAuth or bearer authentication, catalog discovery, native tool execution, reconnect, and disconnect.

OAuth/client state lives in `MavenIntegrationAgent` SQLite. D1 and React never receive provider tokens or authorization headers.

### 6.2 Presets are inert metadata only

The initial connection picker includes PostHog, Stripe, Slack, Attio, Linear, and Custom.

A preset contains only:

- stable preset ID;
- display name and existing provider icon asset;
- default remote MCP URL;
- generic authentication mode/setup copy;
- official documentation URL.

Verified default URLs:

- PostHog: `https://mcp.posthog.com/mcp`
- Stripe: `https://mcp.stripe.com`
- Slack: `https://mcp.slack.com/mcp`
- Attio: `https://mcp.attio.com/mcp`
- Linear: `https://mcp.linear.app/mcp`

Presets do not provide action templates, canonical action names, schema matchers, reducers, provider prompts, identity rules, output transforms, or provider-specific runtime code. Selecting a preset simply fills the generic connection form.

### 6.3 Configure native tools directly

After connection, the generic client discovers the server's native tool catalog. Every tool starts disabled. In the connection detail, an owner/admin configures each tool directly:

- enabled/disabled for sidechat;
- read or write classification;
- for writes, `Ask every time` or `Always allow` policy;
- optional short project instruction appended to the tool description.

MCP safety annotations may suggest a classification, but never enable a tool or grant write permission automatically. A changed input schema disables the tool until an owner/admin reviews it again.

There is no separate canonical-action mapping screen and no provider-specific `Agent actions` catalog.

## 7. Data boundary

MCP tool results may reach the private LLM context, as requested. There is no provider reducer or normalization layer.

The path is:

`native MCP tool -> private Maven model context -> private Maven message/reply draft -> human Add to reply -> existing public send`

Rules:

- Native MCP request/result bodies are never rendered as chat parts or sent to the browser.
- Tool results may be retained only inside the private agent transcript/state required for continuity.
- Provider credentials, authorization headers, and OAuth tokens never enter model context.
- Tool request/results are not copied to D1, public `messages`, Telegram, widget APIs, activity logs, or traces.
- The sidechat system prompt explicitly says provider data is context, not copy: answer the human's question concisely; never dump records, identifiers, internal links, hidden metadata, or full tool responses; never place them in a visitor reply.
- Visible activity contains only connection label, native tool display name, state, and safe error code.
- A draft still requires `Add to reply` and public Send.

Prompt rules are the requested disclosure control. The hard architectural boundary prevents private tool traffic from entering visitor-facing storage or transport.

## 8. Generic write permissions

Think durable-pause Actions provide the approval ledger for any enabled native MCP tool classified as write.

- `Allow once` approves the exact pending tool-call execution and argument hash.
- `Always allow` saves permission for `(projectId, connectionId, toolName, inputSchemaFingerprint)` and approves the current call.
- Reconnect, schema change, classification change, or disable invalidates persistent permission.
- Owner/admin may change persistent policy. A member with approval rights may approve once but cannot persist `Always allow`.
- Pending calls expire after a project-wide configurable duration, default 24 hours. Expiry rejects the paused call and never executes it.
- Exact pending tool arguments remain private in the sidechat Durable Object. The browser receives only the human-readable descriptor and its hash.
- An approved write is dispatched once. Timeout after dispatch becomes `outcome_unknown`; it is never automatically retried.

There are no provider-specific refund, cancellation, message, note, issue, or PostHog rules in ReplyMaven. Available behavior is exactly what the connected MCP server advertises and the project enables.

## 9. Project configuration UI

The existing project `Actions & Tools` page gains one tab:

1. Existing `Actions`.
2. Existing `Tools`.
3. `Connections` — MCP presets, custom connections, native tool configuration, write policy, and safe recent activity.

There is no separate `Agent actions` tab.

The account Settings > MCP page remains the inverse capability: external clients connecting to ReplyMaven's MCP server. Its copy is clarified accordingly.

Connections reuse the existing page shell, typography, muted surfaces, compact controls, spacing, and dialog primitives. Provider presets are compact picker rows, not marketplace cards. Rows use spacing/background contrast, never separator rules.

## 10. Persistence model

New D1 tables:

### `sidechat_threads`

Private-thread status projection from section 4.4.

### `integration_connections`

Project, optional preset ID, display name, MCP URL, integration-agent instance name, stable SDK server ID, state, catalog fingerprint, safe error code, connected time, and timestamps. No credentials.

### `integration_tool_settings`

Connection, native tool name, input-schema fingerprint, enabled flag, `read | write`, `every_time | always`, optional project instruction, configuring actor, and timestamps. Unique per connection/tool/schema fingerprint.

### `mcp_tool_runs`

Project, conversation, connection, native tool name, status, approval mode/actor, duration, argument hash, safe error code, and timestamps. No raw arguments or result.

OAuth state, catalog bodies, private transcript, pending tool arguments, and durable approvals live only in the relevant Durable Object SQLite.

## 11. Errors and recovery

- Sidechat connection failure keeps the public draft intact and offers compact retry.
- Interrupted Think turns reconnect and resume; partial output is not finalized.
- MCP unavailable marks only that connection degraded and returns a safe private error.
- Missing trusted customer identity tells the human to fix the linked profile.
- Catalog/schema change disables affected native tools until reviewed.
- Stale approval refetches the authoritative pending descriptor/hash.
- Ambiguous write outcome becomes `outcome_unknown` and is not retried.
- Duplicate approval is idempotent.
- Disconnect removes MCP registration/credentials and destroys the connection agent after D1 records the pending cleanup.

## 12. Retention and deletion

Private sidechat lifetime follows its public conversation. Manual and automated deletion invoke the sidechat agent's idempotent destroy method before deleting the D1 projection; failed cleanup is retried durably.

Project/connection deletion destroys integration-agent state and credentials. Safe `mcp_tool_runs` metadata follows project audit retention. Raw MCP results are never placed in D1.

## 13. Rollout

1. Private Sidechat Foundation — Think/AI Chat runtime, existing-chat-primitive refactor, authenticated private thread, draft bridge, responsive layout, and removal of inline Compose.
2. MCP Connection Presets — one generic MCP client, inert presets, native catalog/tool configuration, customer context, and Connections UI.
3. Generic MCP Write Approval — durable pause for any configured write tool, exact approval bubble, always/once policy, expiry, no automatic retry, and safe activity metadata.

Each phase is feature-flagged until automated, responsive, keyboard, and production-like visual acceptance passes. Deployment remains separately approved by the user.

## 14. Explicitly out of scope

- Provider-specific actions, profiles, reducers, mappings, schemas, prompts, or runtime branches.
- Automatically configuring or enabling native MCP tools from a preset.
- A separate Agent actions catalog.
- Replacing public widget chat with AI Chat.
- Sending drafts automatically.
- Exposing sidechat to visitors or Telegram.
- Browser/shell/workspace tools or model-written integration code.
- Permanent sidechat rail or visitor-preview pane.
- Multi-stage business workflows.

## 15. Current official primitives and preset sources

- [Cloudflare Think](https://developers.cloudflare.com/agents/harnesses/think/)
- [Cloudflare Think Actions](https://developers.cloudflare.com/agents/harnesses/think/actions/)
- [Cloudflare MCP client API](https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/)
- [PostHog MCP](https://posthog.com/docs/model-context-protocol)
- [Stripe MCP](https://docs.stripe.com/mcp)
- [Slack MCP](https://docs.slack.dev/ai/slack-mcp-server)
- [Attio MCP](https://docs.attio.com/mcp/overview)
- [Linear MCP](https://linear.app/docs/mcp)
