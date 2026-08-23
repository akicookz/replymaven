# Agent channel adapter

## Goal

Put external messenger traffic behind one adapter. Telegram is the first
adapter. Slack is the second. Maven command effects stay shared.

A later Sidechat investigate path starts from that same command engine
and from MCP. It does not give Slack or Telegram a second Sidechat
runtime.

Dashboard and MCP do not use the messenger adapter for ordinary replies.
They already have a conversation id. They keep calling
`executeChannelBotNameCommand` and `appendHuman` directly.

## Current problem

Telegram owns bind, targeting, notify, forward, confirm, and inbound parse
inside `worker/index.ts` and `TelegramService`. Escalation and human-mode
forwards call Telegram by name. Adding Slack by copying that path would
duplicate targeting and confirmation.

`@BotName` speak-now cannot use Stripe, PostHog, or other Sidechat tools.
Public Maven blocks MCP tools. Sidechat turns only start from the
dashboard WebSocket. MCP and Slack have no way to start that turn.

Maven command effects are already shared. Transport is not. Sidechat
submit is not shared.

## Decision

Three phases.

**Phase 1.** Extract the adapter. Move Telegram onto it. Behavior stays the
same. No Slack product surface. No Sidechat submit.

**Phase 2.** Add Slack as the second adapter. Same inbound and outbound
pipelines. Slack-specific bind, parse, and thread ids only.

**Phase 3.** Add `startSidechatTurn`. `@BotName` can investigate. MCP gets
`ask_maven`. Messengers get a private status ping. Approvals and sending
a draft stay in the dashboard.

WhatsApp is out. Email inbound and outbound stay as they are. Billing
Telegram alerts stay on `TelegramService.sendMessage`. Dead
`notifyBotResolved` is not part of the adapter.

## Channel id

```ts
type AgentChannelId = "telegram" | "slack"
```

Phase 1 only constructs the Telegram adapter. The Slack variant exists in
the type so Phase 2 does not rename the discriminant.

## Resolve result

```ts
type AgentChannelResolve =
  | { kind: "targeted"; conversationId: string }
  | { kind: "ambiguous"; hint: string }
  | { kind: "none"; reason: string }
```

Unknown kinds are invalid. The shared inbound handler switches on `kind`.
It does not read channel-specific fields.

## Inbound update

The webhook parses the vendor payload into this object, then stops:

```ts
interface AgentChannelInbound {
  channel: AgentChannelId
  text: string
  actorName: string | null
  commandId: string
  externalMessageId: string
  replyToExternalId: string | null
  replyToText: string | null
}
```

Non-text updates never become an inbound object. The webhook returns
success and drops them, as Telegram does today.

`commandId` is the idempotency key for `@BotName` apply. Telegram keeps
`telegram:{projectId}:{chatId}:{messageId}`. Slack uses
`slack:{projectId}:{channelId}:{eventTs}`.

## Adapter

```ts
interface AgentChannelAdapter {
  readonly channel: AgentChannelId
  resolveConversation(input: {
    inbound: AgentChannelInbound
    getAgentModeConversations(): Promise<Array<{ id: string }>>
    findByChannelThread(threadId: string): Promise<string | null>
  }): Promise<AgentChannelResolve>
  notifyEscalation(input: {
    conversationId: string
    visitorName: string | null
    visitorEmail: string | null
    summary: string
    conversationUrl: string
    isUpdate: boolean
    threadId: string | null
  }): Promise<string | null>
  forwardVisitorMessage(input: {
    conversationId: string
    visitorName: string | null
    content: string
    threadId: string | null
  }): Promise<void>
  confirm(input: {
    text: string
    replyToExternalId: string
  }): Promise<void>
}
```

`notifyEscalation` returns the new thread id when the vendor created one.
It returns null when the send failed. Callers persist a returned id.
They do not invent one.

`confirm` sends command confirmations, the multi-conversation hint, the
failed-delivery line, and Phase 3 Sidechat status pings. The shared
handler chooses the text. The adapter only posts it.

An adapter does not interpret `@BotName`. It does not call
`generateDirectedResponse`. It does not assign Maven. It does not run
Sidechat tools.

## Shared inbound handler

New module: `worker/services/run-agent-channel-inbound.ts`.

1. Call `adapter.resolveConversation`.
2. `ambiguous`: `adapter.confirm` with the hint. Return.
3. `none`: log `{channel}.reply_dropped` with the resolve `reason`.
   Telegram keeps today's reasons (`not_a_reply`,
   `no_conversation_id_in_replied_message`). Return.
4. Load the operational conversation. If missing, log
   `conversation_not_found` and return.
5. Call `executeChannelBotNameCommand` with the inbound text, actor
   name, and `commandId`.
6. If handled, `adapter.confirm` with `confirmation`. Return.
7. `appendHuman` with `origin` set to the channel id, the inbound text,
   and `externalReplyTo` set to `replyToExternalId`.
8. If append fails, `adapter.confirm` with
   `That reply did not reach the visitor. Open the conversation in the dashboard and send it from there.`
   Return.

The Telegram webhook in `worker/index.ts` keeps rate limit, secret
check, unverified re-register, and first-chat bind. After bind, it
builds `AgentChannelInbound` from `message.text` and calls this
handler. It does not resolve conversations itself.

Standalone `@BotName` fallback stays Telegram adapter logic: if the
inbound is a command, there is no conversation id in `replyToText`,
and `getAgentModeConversations` returns one row, that row is
targeted. Several rows are `ambiguous`. Zero rows are `none`.

Conversation id from a replied-to body stays
`/Conversation:\s*(\S+)/` on `replyToText`. Slack Phase 2 uses the
same regex on the parent Slack text, then falls back to
`findByChannelThread`.

## Shared outbound

Escalation and visitor forwards do not import `TelegramService`.

They ask the project for enabled adapters. Phase 1 returns Telegram
when `telegramBotToken` and `telegramChatId` are both set. Phase 2
also returns Slack when Slack credentials and a channel id are set.

For each enabled adapter:

1. Read that channel's thread id from `channelThreads`.
2. Call `notifyEscalation` or `forwardVisitorMessage`.
3. If notify returns a thread id, persist it on that channel only.

Email owner-escalation mail stays beside this loop. It is not an
adapter. The current "claim external notification once when Telegram
is absent" rule stays: if any messenger adapter is enabled, that
adapter claims first; email does not double-claim.

Inbound email that lands while a human owns the thread still forwards
through this outbound loop, with `[via email]` on the content, as
today.

Human-mode widget forwards in `MavenChatAgent` use the same loop.

## Thread storage

Source of truth on the public child:

```ts
channelThreads: {
  telegram?: string
  slack?: string
}
```

Missing keys mean that channel has no thread yet.

`PublicConversationRecord` exposes both `channelThreads` and
`telegramThreadId`. `telegramThreadId` is always
`channelThreads.telegram ?? null`. The directory keeps
`telegram_thread_id`. Writers set both. Readers that already use
`telegramThreadId` keep working.

`updatePublicTelegramThreadId` and
`persistTeamRequestTelegramThreadId` write `channelThreads.telegram`
and `telegramThreadId` together. They still reject a change that
would replace a different Telegram thread id.

Phase 2 adds `updatePublicChannelThread(channel, threadId)` and
directory lookup `findByChannelThread(channel, threadId)`. Slack
does not reuse `telegram_thread_id`.

Directory Phase 1 keeps `telegram_thread_id` and
`findByTelegramThreadId`. `findConversationByTelegramThreadId` on
the project agent stays.

## Telegram adapter

`TelegramService` stays the HTTP client: `sendMessage`, `setWebhook`,
`testConnection`, `getTelegramSettings`, token decrypt.

The adapter uses those methods. Notification text builders
(`buildEscalationNotificationText`, visitor-forward HTML) move next
to the adapter or stay on the service and are called only from it.

Webhook bind stays `resolveTelegramChatBinding`. Connected copy
stays the same.

Text-only inbound stays. Images, stickers, and other updates drop
before the shared handler.

## Slack adapter (Phase 2)

Slack credentials live on project settings, encrypted like the
Telegram token:

- `slackBotToken`
- `slackSigningSecret`
- `slackChannelId`

Bind once, same rule as Telegram: a stored channel id is never
repointed by a later event. The owner may paste a channel id.

Inbound path: `POST /api/slack/events/:projectId`. Verify the Slack
signing secret. Answer Slack `url_verification` with the challenge
and stop. Ignore retries already claimed by `commandId`. Parse
`event.text` into `AgentChannelInbound`.

Resolve order:

1. `Conversation:` id in `replyToText`.
2. `findByChannelThread` with Slack `thread_ts`.
3. Standalone `@BotName` single agent-mode conversation.
4. Several agent-mode conversations: `ambiguous`.
5. Else `none`.

Outbound posts into `slackChannelId`. If `channelThreads.slack` is
set, the post is a thread reply. The returned `ts` is stored as
`channelThreads.slack`.

`appendHuman` origin becomes `"slack"`. Add that literal to the
existing origin union in the same Phase 2 change.

Plan gate: new `slack` flag next to `telegram`. Starter off.
Standard and business on, same as Telegram. Tools page gets a Slack
live-agent card, separate from the existing `send_to_slack` HTTP
tool preset.

## Sidechat investigate (Phase 3)

`@Maven, check what happened to his billing` is a Sidechat job. It
is not a public speak-now. Speak-now still has no tools. Public
Maven still cannot call MCP tools.

### Command field

Add one field to `BotNameDecision`:

```ts
investigate: "now" | "none"
```

`parseBotNameDecision` treats a missing `investigate` as `"none"`.
A present value that is not `now` or `none` makes the whole
decision invalid.

Close and ban still win. If `effect` is `close` or `ban`, ignore
`investigate`, `ownership`, `instructions`, and `speak`.

If `investigate` is `now`, ignore `speak`. Do not call
`generateDirectedResponse`. Apply ownership and instructions first.
Then call `startSidechatTurn`.

The interpret prompt gains this field. Examples of expected
decisions, not matchers:

- “check his billing” / “look in Stripe” / “what happened in
  PostHog” → `investigate: "now"`, `speak: "silent"`
- “explain pricing to them now” → `investigate: "none"`,
  `speak: "now"`

Confirmation when investigate starts:
`Maven is looking into that.`

Confirmation when Sidechat is already `working` or
`waiting_approval`:
`Maven is already working on this.`

### Server submit

New module: `worker/services/start-sidechat-turn.ts`.

```ts
type SidechatTurnOrigin = "mcp" | "telegram" | "slack"

interface StartSidechatTurnInput {
  projectId: string
  conversationId: string
  text: string
  actorUserId: string
  origin: SidechatTurnOrigin
}

type StartSidechatTurnResult =
  | { accepted: true; status: "working" }
  | { accepted: false; reason: "busy" | "archived" | "failed" }
```

Steps:

1. Load the operational public conversation. Missing or archived
   returns `{ accepted: false, reason: "archived" }`.
2. Call parent `registerSidechat(conversationId)`.
3. If current Sidechat status is `working` or `waiting_approval`,
   return `{ accepted: false, reason: "busy" }`.
4. Call child `submitServerSidechatTurn`. That RPC appends the
   agent text as a Sidechat user message and runs the existing
   Sidechat turn body. It does not require a dashboard token or
   WebSocket.
5. Return `{ accepted: true, status: "working" }` when the child
   accepts the turn.

`actorUserId` is the signed-in user for MCP. For Telegram and Slack
it is the project owner id. Tool audit and write approvals still
use that actor. A write still needs the existing Sidechat approval
flow. Chat text is never approval.

The dashboard Sidechat pane keeps the native Agent socket. This
function does not replace that socket.

`mcp-server.ts` and `telegram-service.ts` must not import
`MavenChatAgent`. They import `startSidechatTurn` and a status
reader only. Update
`worker/agents/sidechat/sidechat-privacy.test.ts` so those files
may mention Sidechat status strings, but still must not contain
`MavenChatAgent`, `data-reply-draft`, or `data-safe-activity`.

### MCP

New tool `ask_maven`:

- Scope: `conversations:reply`
- Input: `projectId`, `conversationId`, `text` (1–5000), `confirm`
- Calls `startSidechatTurn` with `origin: "mcp"` and
  `actorUserId: context.userId`
- Returns `{ ok, accepted, status, confirmation }`

Do not make the client type `@BotName` inside `send_agent_reply`.
`send_agent_reply` still runs `executeChannelBotNameCommand`, so a
leading `@BotName` investigate line also works.

New read tool `get_sidechat_status`:

- Scope: `conversations:reply`
- Input: `projectId`, `conversationId`
- Returns `{ status, hasDraft, waitingApproval }`
- `hasDraft` is true when a `present_reply_draft` part exists on
  the latest Sidechat assistant message
- No private transcript, no tool payloads, no draft text

Approving a tool and applying a draft stay in the dashboard.

### Messenger pings

After a Sidechat turn that started from `telegram` or `slack`,
status changes ping that conversation's adapter:

- `working` → `Maven is looking into that.`
- `waiting_approval` → `Maven needs approval in the dashboard.`
- `ready` → `Maven has a draft in the dashboard.`
- `failed` → `Maven could not finish. Open Sidechat in the dashboard.`

Dashboard-started Sidechat turns do not ping messengers. MCP does
not get a messenger ping. MCP uses `get_sidechat_status`.

## What does not change

- Dashboard reply route.
- Email as a visitor or agent message path.
- Idle takeover.
- Assign Maven from the inbox menu.
- `lastTelegramCommandId` / `lastTelegramCommandConfirm` key names.
- Widget visitor `@BotName` invocation.
- Public Maven tool channel rules. MCP tools stay Sidechat-only.
- Sidechat approval: chat text is never approval.
- `present_reply_draft` never sends to the visitor.

Phase 1 and Phase 2 do not change the `BotNameDecision` shape.
Phase 3 adds `investigate` only.

## Error handling

Notify and forward failures log and swallow. They do not fail the
visitor turn or the inbound webhook.

Inbound append failure tells the agent in that channel with
`That reply did not reach the visitor. Open the conversation in the dashboard and send it from there.`
Slack Phase 2 uses the same sentence.

Unverified Telegram updates still process and re-register the
webhook. Slack rejects a bad signature with 401 and does not apply
the event.

`startSidechatTurn` failures return `accepted: false`. They do not
write a visitor-visible bot row.

## Tests

Phase 1:

- Adapter resolve: reply-to conversation id, standalone one
  conversation, standalone several conversations, no match,
  non-command with no reply.
- Shared inbound handler: command confirm, normal append, append
  failure confirm, missing conversation, ambiguous confirm. Use a
  fake adapter.
- Escalation and human-mode forward call the adapter, not
  `TelegramService.notifyEscalation` / `forwardVisitorMessage`
  directly.
- Telegram thread persist still writes `telegramThreadId` and
  `channelThreads.telegram`.
- Existing Telegram webhook tests keep the same user-visible
  outcomes: bind, drop, command, failed reply.

Phase 2:

- Slack signature reject.
- Slack resolve order, including `thread_ts` lookup.
- Origin `"slack"` on appended human rows.
- Escalation posts to both enabled adapters and stores each thread
  id separately.

Phase 3:

- Missing `investigate` parses as `"none"`.
- Close and ban ignore `investigate`.
- `investigate: "now"` calls `startSidechatTurn` and does not call
  `generateDirectedResponse`.
- Busy Sidechat returns the already-working confirmation.
- `ask_maven` calls `startSidechatTurn` with `origin: "mcp"`.
- `get_sidechat_status` returns status flags only.
- Messenger pings fire for telegram/slack origins only.
- Privacy test still forbids `MavenChatAgent` in `mcp-server.ts`
  and `telegram-service.ts`.

No mocked DOM tests.

## Scope

- Phase 1: adapter types, Telegram adapter, shared inbound handler,
  shared outbound loop, `channelThreads` written beside
  `telegramThreadId`.
- Phase 2: Slack adapter, Slack webhook, Slack settings and Tools
  UI, plan flag, origin `"slack"`, directory lookup by Slack thread.
- Phase 3: `investigate` field, `startSidechatTurn`, child server
  submit RPC, MCP `ask_maven` and `get_sidechat_status`, messenger
  status pings.
- No WhatsApp.
- No email adapter.
- No MCP or messenger tool-approval UI.
- No MCP or messenger “send the draft” action.
- No help-center rewrite in Phase 1. Phase 2 updates the Telegram
  and agent-handoff articles so they name Slack as a second
  messenger. Phase 3 updates those articles and the MCP tools
  article for `ask_maven`.

## Runtime files

Phase 1 touches:

- `worker/services/agent-channel.ts` (types)
- `worker/services/run-agent-channel-inbound.ts`
- `worker/services/telegram-agent-channel.ts`
- `worker/index.ts` Telegram webhook (thin)
- `worker/chat-runtime/post-turn/escalation.ts`
- `worker/agents/maven/maven-chat-agent.ts` human-mode forward
- `worker/index.ts` inbound-email Telegram forward
- public conversation state writers for `channelThreads`
- `shared/maven-conversation.ts` (`channelThreads` plus existing
  `telegramThreadId`)

Phase 2 adds Slack modules and settings columns. It does not grow
the Telegram webhook.

Phase 3 adds:

- `worker/services/start-sidechat-turn.ts`
- `worker/services/sidechat-status.ts`
- `submitServerSidechatTurn` on `MavenChatAgent`
- `investigate` on `BotNameDecision` / `applyBotNameCommand`
- MCP `ask_maven` and `get_sidechat_status`
