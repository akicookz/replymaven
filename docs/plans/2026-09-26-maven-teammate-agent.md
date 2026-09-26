# Maven as the agent in the team thread

Status: implemented 2026-09-26, phases 1 to 6 committed on `main` (not pushed at time of
writing). Decisions are listed in "Decisions"; what changed during the build is in
"Build notes" at the end. Anything not in this file is out of scope.

## Target behaviour

1. Every conversation starts with Maven, whatever the source (widget, email, ticket form,
   teammate forward).
2. When the customer insists on a person, or Maven cannot resolve, Maven calls
   `request_team_help()`. That starts one Sidechat turn. Maven writes the note; it goes to
   every channel (Slack, Telegram, email) and every teammate with access.
3. From then on delivery follows people. Maven's replies go back on the channel the
   teammate wrote from. Customer messages go to channels where a teammate has written.
4. The first teammate who replies to the customer becomes the assignee.
5. Anyone can talk to Maven from any channel. Only the assignee can send to the customer
   through Maven. Others are told who has it and offered `assign_conversation`.
6. Approvals are conversational. Maven asks in its own words (fixed four-part shape);
   the teammate answers on the same channel; `decide_pending_action` relays the decision.
7. Sidechat is the one private thread per conversation. Channels are transports:
   `post` out, `parseInbound` in. Nothing channel-specific above that.

## Decisions (2026-09-26)

| # | Topic | Decision |
|---|---|---|
| D1 | Forward with no matching conversation | Handle now (phase 3.6): new conversation, mail is a Sidechat turn, Maven finds the customer from the quoted headers. |
| D2 | "Approved" by channel reply | Spike on day one of phase 1. Works → `decide_pending_action` is a plain tool. Fails → report the fallback before writing it. |
| D3 | Trigger for the escalation-note turn | One fixed internal line, origin `system`, never shown. |
| D4 | Re-ping when the customer writes while waiting | Dropped. Only channels where a teammate has written get customer messages. |
| D5 | Author identity storage | New table `channel_identities` with a migration. |
| D6 | Slack author | Owner reinstalls the Slack app with `users:read.email`; authors resolve by email. |
| D7 | Telegram author | `@Maven link` → one-time URL → new SPA page binds the account. |
| D8 | Until phase 6 | Unknown Slack/Telegram authors can talk to Maven but not send through it; their plain replies still reach the customer as today. |
| D9 | Sender name on teammate mail | The bot name (`Maven` by default), nothing else. |
| D10 | Subject on teammate mail | Set by whoever sends the first email in the conversation: Maven's first note line, or the forwarded subject with `Fwd:`/`Re:` stripped. Reused for the whole conversation. |
| D11 | Concurrent teammate messages | Out of scope. Second message while Maven is busy gets "Maven is already working on this." as today. |
| D12 | `email_last_reply` | Removed. Delivery follows the conversation channel. |
| D13 | Naming the model sees | "customer", not "visitor". Object noun "conversation". |

## Shape after the change

```
teammate on Slack / Telegram / email / dashboard / MCP
        │ adapter.parseInbound
        ▼
ingestTeammateMessage ──(human owns + no @BotName)──► appendHuman ──► customer
        │ otherwise                                                    (email if email thread)
        ▼
startSidechatTurn({ text, origin, actorUserId, channelMessageId, replyThreadId })
        │
        ▼
Sidechat turn ── tools ──► reply_to_conversation   assign_conversation
        │                  close_conversation      block_customer
        │                  decide_pending_action   present_reply_draft
        │                  knowledge tools         project tools
        ▼ assistant text
mirrorSidechatReply ──► adapter.post(origin, replyThreadId)

public child: customer message ──► forwardToJoinedTeammates ──► adapter.post(joined)
request_team_help ──► state work ──► Sidechat turn (origin system) ──► post to all
```

---

## Shared building blocks (used by several phases)

### B1. Sidechat user-message metadata

Today `sanitizePrivateMessageForPersistence` (`private-tool-payload.ts:267`) keeps only
`{ createdAt }`. It will keep an allowlist:

```ts
interface SidechatUserMeta {
  createdAt: number;
  origin: "dashboard" | "mcp" | "telegram" | "slack" | "email" | "system";
  actorUserId: string;          // "" = unknown author
  actorDisplayName: string | null;
  channelMessageId: string | null;   // external id, used as the message id too
  replyThreadId: string | null;      // where the reply goes: tg message id, slack ts, email RFC id
  replyRecipient: string | null;     // email address for origin=email
}
```

Assistant messages keep `{ createdAt }` only. `SidechatUIMessage` becomes
`UIMessage<SidechatUserMeta | { createdAt: number }, SidechatDataParts>`.

Dashboard turns: `buildSidechatSendRequest` (`use-sidechat-agent.ts:224`) adds
`metadata: { origin: "dashboard", actorUserId: <from claims on the server>, ... }`. The
server does not trust client metadata: in `onChatMessage` (Sidechat path) the user
message's metadata is overwritten from the verified claims (`claims.userId`, origin
`dashboard`) before persistence.

### B2. `startSidechatTurn` input

`start-sidechat-turn.ts` and `MavenProjectAgent.startSidechatTurn` take:

```ts
{
  conversationId: string;
  text: string;
  origin: SidechatUserMeta["origin"];
  actorUserId: string;
  actorDisplayName?: string | null;
  channelMessageId?: string | null;
  replyThreadId?: string | null;
  replyRecipient?: string | null;
}
```

`submitServerSidechatTurn` builds the user message with `id = channelMessageId ??
crypto.randomUUID()` and the metadata above. If `this.messages` already has that id it
returns `{ accepted: false, reason: "duplicate" }` and nothing runs. Result type gains
`"duplicate"`; callers treat it as success and stay silent.

`lastSidechatTurnOrigin` metadata on the public child stays as the "which channel gets
the reply" pointer and is written by `startSidechatTurn` for every non-dashboard origin
(today: only telegram/slack). It is cleared at the start of a dashboard turn, as today
(`maven-chat-agent.ts:1020`).

### B3. Mirror hook

`MavenChatAgent.onChatResponse` (Sidechat branch, `completed` path, after
`updateSidechatSummary`) calls `parent.mirrorSidechatReply(conversationId, {
messageId, text })` where `text` is the concatenation of the assistant message's `text`
parts, trimmed. Empty text → no call. The parent:

1. Reads the triggering user message (the last `role: "user"` message before this
   assistant message) for `origin`, `replyThreadId`, `replyRecipient`.
2. `origin` dashboard or mcp → return.
3. `origin` system → post to every enabled adapter and every escalation email recipient
   (phase 4).
4. Otherwise → `adapter(origin).post({ conversationId, text, threadId: replyThreadId,
   recipient: replyRecipient })`. Returned thread id is stored via
   `persistChannelThread` (Telegram/Slack) or `channelThreads.email[userId]` (email).

Failures log `sidechat_mirror.failed` with `{ conversationId, origin }` and do not affect
the turn.

The `waiting_approval` completion path also mirrors (Maven's text explains the request).
`failed` status posts nothing; the "working" ack is the only status-only post left.

### B4. `conversation-actions.ts`

```ts
export async function assignConversation(input: {
  db; chatService; projectService; projectId; conversationId;
  assigneeId: string | null; actorName: string | null;
}): Promise<{ ok: true } | { error: "not_assignable" | "not_found" }>;

export async function closeConversation(input: {
  chatService; projectId; conversationId; closeReason?: "resolved" | "ended" | "spam";
}): Promise<{ ok: true } | { error: "not_found" }>;

export async function blockCustomer(input: {
  db; chatService; projectId; conversationId: string | null;
  visitorId: string; visitorEmail: string | null; reason: string | null;
  bannedBy: "dashboard" | "agent";
}): Promise<{ ok: true; closedIds: string[] } | { error: "already_banned" | "not_found" }>;

export async function deliverBotMessageToCustomerChannel(input: {
  env; chatService; project: { id; slug; name }; conversation: PublicConversationRecord;
  message: PublicMessageRecord;
}): Promise<void>;
```

Bodies are lifted from `index.ts` 7935 (assign), 7785 (close), 8002 (ban), and the
send block at 2758. The three routes become thin wrappers. `deliverBotMessageToCustomerChannel`
is a no-op unless `readConversationChannelMetadata(conversation.metadata).channel ===
"email"` and `visitorEmail` is set; then `sendAgentMessageEmail` with `References`
built from every stored `rfcMessageId` in the thread, then `markEmailed`, then stores the
sent mail's RFC id on the message (see B5).

### B5. Learning the RFC id of a sent email

`EmailService.send` returns the Resend id. New `EmailService.resolveRfcMessageId(id)`:
`emails.get(id)` and read `message_id` from the raw response (`(data as
Record<string, unknown>).message_id`; the SDK type omits it, verified live 2026-09-26).
One retry after 2 s if absent. Callers store it: on the public message (`rfcMessageId`,
existing field) for customer mail; in `channelThreads.email[userId]` for teammate mail.

### B6. `markdownToPlainText()`

In `email-service.ts`, built on `marked`'s `Lexer` (already a dependency, used by
`helpdesk-render`). Walks tokens: heading → text line; list items → `- `; links → `text
(url)`, or just `url` when equal; emphasis/strong/code → inner text; code block → the code
indented two spaces; paragraphs separated by a blank line; tables → rows joined with ` | `.
Applied in `sendAgentMessageEmail` to the body and to all teammate mail bodies.

---

## Phase 1: Sidechat action tools

### 1.0 Spike (D2), first task

Write a throwaway script against `worker/agents/sidechat/private-tool-payload.ts` and
the AI SDK: build a message list with an assistant `call_project_tool` part in
`approval-requested`, then a user message, then call `convertToModelMessages` and
`streamText` against the configured model with `removeAbandonedApprovalParts(messages,
true)`. Pass = the provider accepts the history and the model can call a tool. Fail =
provider error on the dangling tool call. Report before continuing.

If it fails: `ingestTeammateMessage` (phase 2) checks
`summary.sidechatStatus === "waiting_approval"` and a verified author, and runs the turn
with `continuation: true` after appending the user message, so the SDK sees the approval
parts as part of a continuation. Maven still reads the reply and calls
`decide_pending_action`. The difference is only which flag the turn runs with.

### 1.1 `conversation-actions.ts`

As in B4. Routes updated. No dashboard behaviour change.

### 1.2 Context

`SidechatCustomerContext` gains:

```ts
origin: SidechatUserMeta["origin"];
assignee: { id: string; name: string } | null;
teammates: Array<{ id: string; name: string }>;   // getAssignableUsers + Maven
links: { conversation: string; tools: string };
```

`MavenProjectAgent.getSidechatContext` fills them from the directory summary
(`assigneeId`), `getAssignableUsers(db, projectId)`, `mavenAssignableUser(botName)`,
`buildConversationDeepLink`, and `${BETTER_AUTH_URL}/app/projects/${id}/support-chat/tools`.
`origin` comes from the triggering user message (passed in by `executeSidechatTurn`).

### 1.3 `action-tools.ts`

```ts
export function buildSidechatActionTools(deps: {
  replyToConversation(text: string, toolCallId: string): Promise<ReplyResult>;
  assignConversation(assigneeId: string): Promise<{ ok: true } | { error: string }>;
  closeConversation(): Promise<{ ok: true } | { error: string }>;
  blockCustomer(reason: string): Promise<{ ok: true } | { error: string }>;
  decidePendingAction?: (decision: "approve" | "reject") => Promise<DecideResult>;
}): ToolSet;
```

`decide_pending_action` is included only when `deps.decidePendingAction` is set, which
`executeSidechatTurn` does when `hasPendingSidechatApproval(messages)`.

Tool descriptions (what the model sees):

- `reply_to_conversation`: "Send this text to the customer in the conversation now. Use
  when the teammate asked you to answer, or the thread is yours."
- `assign_conversation`: "Assign the conversation to a teammate or to yourself. Use ids
  from `teammates` in context."
- `close_conversation`: "Mark the conversation resolved."
- `block_customer`: "Block the customer and close all their open conversations as spam."
- `decide_pending_action`: "Record the teammate's decision on the action waiting for
  approval. Only call this after the teammate answered."

`ReplyResult`:

```ts
| { sent: true; messageId: string }
| { blocked: "assigned_to"; assigneeName: string }
| { blocked: "unknown_author" }
| { error: "conversation_unavailable" }
```

Parent `replyToConversation({ childName, conversationId, actorUserId, toolCallId, text })`:

1. `assertRegisteredSidechat`; summary must exist and not be archived.
2. `actorUserId === ""` → `{ blocked: "unknown_author" }`.
3. `assigneeId` null, `MAVEN_ASSIGNEE_ID`, or equal to `actorUserId` → allowed. Else
   `{ blocked: "assigned_to", assigneeName }` (name from `getAssignableUsers`).
4. `publicChild.appendBotMessageFromSidechat({ messageId: "sidechat-reply:" + toolCallId,
   text, senderName: botName, autoCloseMinutes })` (rename of `appendSidechatDraftAsBot`;
   same body, idempotent on `messageId`).
5. `deliverBotMessageToCustomerChannel`.
6. `{ sent: true, messageId }`.

`sendSidechatReplyDraftAsMaven` (dashboard button) keeps working; it calls step 4 with
`messageId: "sidechat-draft:" + messageId` as today.

### 1.4 Prompt

`buildSidechatSystemPrompt(context)` gains, replacing the last "Reasoning and action"
bullet about drafts:

```
Acting:
- Use reply_to_conversation to answer the customer when the teammate asked you to, or
  when the conversation is assigned to you. Use present_reply_draft only when origin is
  dashboard and the teammate did not say to send, or asked to see it first.
- If reply_to_conversation returns blocked "assigned_to", tell the teammate who has the
  conversation and offer assign_conversation. Do not send. If it returns "unknown_author",
  say you cannot send on their behalf from this channel yet and give links.conversation.
- If you lack a tool or connection for what was asked, say so plainly and give
  links.tools. Never imply it was done.

Writing to a teammate:
- One message per turn. Lead with what you need from them or what you did. Do not retell
  the customer's thread. Name the customer once. One link, at the end, only if they need
  to go there. Plain text: no headings, bullets, bold, emoji. Under 80 words unless they
  asked for detail.
- origin email: first line is the subject when this is the first email of the
  conversation (see context.emailSubject); then a greeting line, the message, and a
  sign-off as {botName}. origin slack or telegram: no greeting, no sign-off.
- Asking for approval, exactly four parts in this order and nothing else:
  1. What the teammate asked for, one sentence.
  2. The action waiting, using the description the approval pause returned, with the
     values that matter.
  3. What happens when approved, one sentence.
  4. "Reply approve or reject here, or open it: {links.conversation}"
```

`context.emailSubject: string | null` is added: the stored subject, or null when Maven
must write one (phase 3).

### 1.5 `decide_pending_action`

Parent `decidePendingAction({ childName, conversationId, actorUserId, decision })`:

1. `actorUserId === ""` → `{ error: "unknown_author" }`.
2. `sidechat.respondToPendingApproval(decision)` on the child: find the newest
   `approval-requested` part on `call_project_tool` or `apply_knowledge_change`
   (`hasPendingSidechatApproval` logic, but returning the part); set `state:
   "approval-responded"`, `approval: { approved: decision === "approve" }`; persist.
   None found → `{ error: "nothing_pending" }`.
3. Return `{ ok: true, willRun: decision === "approve" }`.

In `onChatResponse` completed path: if the just-finished turn contains a
`decide_pending_action` output with `willRun: true`, call
`runServerSidechatTurn({ actorUserId, continuation: true })`. `runServerSidechatTurn`
gains the `continuation` flag and passes it to `executeSidechatTurn`; `submittedMessageId`
is null for continuations. The approved tool runs at the start of that turn (existing
behaviour), Maven writes the result, B3 mirrors it.

`selectSidechatModelMessages(messages, continuation)` passes
`preserveLatestApproval = continuation || hasPendingSidechatApproval(messages)` (D2 spike
covers this).

### 1.6 Verification

Real project, dashboard Sidechat:
1. "send her: we ship Monday" → public thread shows a Maven message; widget shows it.
2. Two accounts: assignee A, teammate B asks Maven to send → blocked, Maven names A,
   B says "assign it to me" → `assign_conversation`, then send works.
3. Staged write on a connected tool → Maven's four-part request → "approve" → tool runs
   → Maven reports. Then "reject" on another.
4. "close this" → resolved. "block them" → banned and closed.
`bun run lint`, `bunx tsc -b --force`.

---

## Phase 2: Channels become mirrors

### 2.1 `agent-channel.ts`

```ts
export type AgentChannelId = "telegram" | "slack" | "email";

export interface AgentChannelInbound {
  channel: AgentChannelId;
  text: string;
  externalMessageId: string;
  replyToExternalId: string | null;
  replyToText: string | null;            // Telegram only
  author: { userId: string; displayName: string | null; email: string | null };
}

export interface AgentChannelAdapter {
  readonly channel: AgentChannelId;
  resolveConversation(input): Promise<AgentChannelResolve>;   // unchanged
  post(input: {
    conversationId: string;
    text: string;
    threadId: string | null;
    recipient?: string | null;   // email only
    subject?: string | null;     // email only
  }): Promise<string | null>;    // new thread id, or null
}
```

Deleted from the interface: `notifyEscalation`, `forwardVisitorMessage`, `confirm`.

Telegram `post`: `service.sendMessage(token, chatId, html(text), replyTo)`. When
`threadId` is null (first post for this conversation, phase 4), append
`\n\nConversation: <code>{id}</code>\n<a href="{link}">Open conversation</a>` because
`resolveTelegramConversation` reads the id from the replied-to text. Slack `post`:
`service.postMessage({ channelId, text, threadTs: threadId })`; first post appends the
`*Conversation:* \`id\`` line for the same reason.

`telegram-service.ts` / `slack-service.ts`: `notifyEscalation`, `forwardVisitorMessage`,
`buildEscalationNotificationText`, `notifyBotResolved`, `buildBotResolvedNotificationText`
deleted. `sendMessage` / `postMessage` stay.

### 2.2 `ingest-teammate-message.ts` (new; replaces `run-agent-channel-inbound.ts`)

```ts
export async function ingestTeammateMessage(input: {
  adapter: AgentChannelAdapter;
  inbound: AgentChannelInbound;
  botName: string | null | undefined;
  projectId: string;
  chatService: PublicConversationStore;
  getAgentModeConversations(): Promise<Array<{ id: string }>>;
  findByChannelThread(threadId: string): Promise<string | null>;
  startSidechatTurn: typeof startSidechatTurn;
  env: Pick<AppEnv, "MAVEN_PROJECT_AGENT">;
}): Promise<void>
```

Steps:

1. `adapter.resolveConversation`. `ambiguous` → `adapter.post(hint)`. `none` → log
   `{channel}.reply_dropped`, return.
2. `chatService.getOperational`. Missing → log, return.
3. `chatState = parseChatState(conversation.chatState)`.
4. `mention = parseAgentBotNameCommand(text, botName)`.
5. If `chatState.aiParticipation === "human_only"` and `!mention.isCommand`:
   `appendHuman({ content: text, senderName: author.displayName, userId: author.userId
   || undefined, origin: channel, externalReplyTo: replyToExternalId, idempotencyKey:
   channel + ":" + externalMessageId })`. Failure → `adapter.post(FAILED_DELIVERY)`. Return.
6. Else: `text = mention.isCommand ? mention.commandText : text`. Empty after strip →
   treat as bare handback: `assignConversation(MAVEN_ASSIGNEE_ID)` and post "Handed back
   to {botName}." (keeps today's bare `@Maven` behaviour without a classifier).
7. `startSidechatTurn({ conversationId, text, origin: channel, actorUserId:
   author.userId, actorDisplayName, channelMessageId: channel + ":" + externalMessageId,
   replyThreadId: externalMessageId (Telegram) | replyToExternalId ?? externalMessageId
   (Slack) | inbound RFC id (email), replyRecipient: author.email })`.
8. `busy` → `adapter.post("Maven is already working on this.")`. `archived` / `failed` →
   `adapter.post("Maven could not start that. Open the conversation: {link}")`.
   `duplicate` → nothing.

### 2.3 Mirroring

B3. `pingSidechatStatus` keeps only the `working` ack for telegram/slack origins
(`"Maven is looking into that."`). `sidechatPingText` shrinks to that one case.
`forwardVisitorToJoinedHumans` keeps its rule and signature minus the `email` block; it
calls `adapter.post` for `agent_channel` routes. Email joined routes are handled by the
email adapter in phase 3 (it receives `activeHumanRoutes` and posts to each
`kind: "email"` user).

### 2.4 Webhooks

`index.ts` Telegram (`1640`) and Slack (`1795`): replace `runAgentChannelInbound` with
`ingestTeammateMessage`. Author until phase 6: `{ userId: "", displayName:
first_name | slack user id, email: null }`. Remove the `executeChannelBotNameCommand`
calls and the `appendHuman` closures (moved into ingest).

### 2.5 Verification

Slack: escalation thread exists from an earlier run; "@Maven tell him Monday" while Maven
owns → customer gets it, Slack thread gets Maven's line. Plain "we ship Monday" after a
human took over → customer, as today. Telegram same two cases.

---

## Phase 3: Email as a channel

### 3.1 `email-agent-channel.ts`

```ts
export function createEmailAgentChannel(input: {
  service: EmailService;
  project: { id: string; slug: string; name: string };
  botName: string | null;
  recipients(): Promise<Array<{ userId: string; email: string; name: string }>>; // escalation
  joinedEmailUsers(conversationId: string): Promise<Array<{ userId: string; email: string }>>;
  readThreads(conversationId): Promise<{ subject: string | null; byUser: Record<string, string> }>;
  writeThread(conversationId, userId, rfcId, subject): Promise<void>;
}): AgentChannelAdapter
```

- `resolveConversation`: the inbound handler already resolved it
  (`resolveInboundConversation`); the adapter returns `targeted` with that id.
- `post({ conversationId, text, threadId, recipient, subject })`: one send per recipient.
  `from: "{botName} <{slug}@updates.replymaven.com>"`, `replyTo:
  "{slug}+c{conversationId}@…"`, `subject` = stored subject, `In-Reply-To`/`References` =
  `threadId` (the RFC id of the mail being answered, or the stored last id for that
  user). Body = `markdownToPlainText(text)`. After send, B5 resolves the RFC id and
  `writeThread` stores it. Returns that id.
- Recipient selection lives in the parent's mirror step: origin email → the author;
  system (escalation) → `recipients()`; customer forward → `joinedEmailUsers`.

`PublicChannelThreads` gains `email?: { subject: string; byUser: Record<string, string> }`.
`publicChannelThreads()` helper and `persistChannelThread` handle the new shape;
`readChannelThreadId(conversation, "email")` returns null (per-user lookup is explicit).

### 3.2 Inbound-mail handler

Agent branch (`index.ts` from `} else if (agentUser) {` to the end of that block)
replaced by:

```ts
await ingestTeammateMessage({
  adapter: emailAdapter,
  inbound: {
    channel: "email", text: cleanedText, externalMessageId: emailId,
    replyToExternalId: rfcMessageId, replyToText: null,
    author: { userId: agentUser.id, displayName: agentUser.name, email: agentUser.email },
  },
  ...
});
```

`replyThreadId` for email turns is the inbound `rfcMessageId` (B2 step 7). Visitor
branch unchanged. `getEscalationRecipientEmails` → `getEscalationRecipients()` returning
`{ userId, email, name }[]`; `selectProjectEscalationRecipientEmails` adapts.

### 3.3 Customer email plain text

- `build-support-system-prompt.ts` `buildChannelContract("email")` adds: "Plain text
  only. No markdown: no asterisks, hashes, backticks, or bracket links. Write URLs bare."
- `sendAgentMessageEmail`: body through `markdownToPlainText` (B6).
- After each customer send, store the RFC id (B5) so `References` chains both ways.

### 3.4 Subject and sender (D9, D10)

- Sender name: `botName?.trim() || "Maven"`.
- Subject: `channelThreads.email.subject`. Set the first time an email goes out on the
  conversation: from Maven's note first line (system origin, phase 4) or from the
  forwarded subject (3.6). Later sends reuse it. `replySubject()` helper is deleted for
  teammate mail; customer mail keeps its own rules.

### 3.5 Verification

From team@launchfast.shop: escalation arrives (phase 4 dependency: until then, trigger a
turn from Slack and confirm the email leg by replying to a customer-forward mail);
reply "go ahead and refund 40" → in-thread answer that no refund tool exists, with the
tools link; reply "approve" on a staged write; check threading in Gmail and Apple Mail.

### 3.6 Teammate forward with no conversation (D1)

In the inbound handler, before the `create` branch: if the sender matches a teammate
(the existing owner/member lookup, moved up), and no conversation resolved:

1. Create a conversation with `visitorId: emailVisitorId(project.id, "forward:" +
   emailId)`, `visitorName: null`, `visitorEmail: null`, metadata `{ channel: "email",
   subject: stripForwardPrefix(subject), forwardedBy: agentUser.id }`.
2. `ingestTeammateMessage` with the full mail text (quoted part included: the cleaner
   strips quotes, so pass `emailText` raw here, capped at 20k chars).
3. Prompt addition: "If the conversation has no customer yet and the teammate's message
   contains a forwarded email, take the customer's name and address from its `From:`
   line, set them with `set_customer_contact`, and continue."

New tool `set_customer_contact({ name?, email? })` → `chatService.updateConversation({
visitorName, visitorEmail })` plus `CustomerIdentityService.resolveCustomer` /
`createCustomer` / `linkConversation` (same steps as the visitor `create` branch). Only
allowed while `visitorEmail` is null.

Rate limit: the existing `inbound-create` limiter keyed by sender applies.

---

## Phase 4: Escalation is Maven writing

### 4.1 `request_team_help`

- `requestTeamHelpInputSchema = z.object({}).strict()`. `RequestTeamHelpInput` empty.
- `execute` keeps everything up to and including the ownership claim and
  `createEscalation` state work. `summary` parameters removed from `createEscalation`,
  `getAcceptedTeamRequest`, `repairAcceptedTeamRequest`, `addTeamRequestSummary`,
  `completeTeamRequestSummary`; `teamRequestSummary` metadata is no longer written. The
  `reviewSummaryMessageId` reservation stays (the pill is written in 4.2).
- After state work: `startSidechatTurn({ conversationId, text: TEAM_HELP_TRIGGER,
  origin: "system", actorUserId: "" })`. `TEAM_HELP_TRIGGER = "Team help requested."`.
- Support prompt (`build-support-system-prompt.ts:68`): "call request_team_help with a
  concise factual summary" → "call request_team_help". Line 71 unchanged.
- Ticket form (`index.ts:1443`) and the repair path call the same thing.

### 4.2 Note delivery

`mirrorSidechatReply` for origin `system`:

1. Post to every enabled Telegram/Slack adapter with `threadId: null`; store returned ids
   via `persistChannelThread`.
2. Email: `subject` = first line of the note (D10), body = the rest. Store subject. One
   send per `getEscalationRecipients()`; store each RFC id.
3. `appendSystem({ kind: "review_summary", content: note, idempotencyKey:
   reviewSummaryMessageId })` so the inbox pill is Maven's note.
4. `completeTeamRequestSummary` equivalents that gate `teamRequestSummaryPending` flip
   to done here.

`createEscalation` loses `agentChannels`, `sendEscalationEmails`, `EscalationEmailSender`,
`isUpdate`, `persistTelegramThreadId`, `persistChannelThread`,
`claimExternalNotificationAttempt`, `releaseExternalNotificationAttempt` (the claim now
guards the Sidechat trigger instead: `claimTeamRequestNotification` is called before
`startSidechatTurn`, released if the turn is refused).

### 4.3 Prompt for system origin

```
origin system: nobody wrote to you. The customer needs a person. Write the note you
would send a colleague: who the customer is, what they want, what you tried, what you
need. First line is the email subject (short, specific). No greeting.
```

### 4.4 Verification

Widget → "I want a human" → Slack, Telegram, and inbox mail all carry Maven's note; inbox
Needs You with the pill; reply on each channel reaches Maven.

---

## Phase 5: Delete the classifier path

Delete: `bot-name-decision.ts`, `apply-bot-name-command.ts`, `run-bot-name-command.ts`,
`email-last-reply.ts`, `run-agent-channel-inbound.ts`, `sendEscalationNotification`,
`sendVisitorReplyToAgentEmail`, `replySubject` (teammate use), `interpretBotNameCommand`,
`generateDirectedResponse`, `sidechatPingText` cases other than `working`,
`RESERVED_PUBLIC_METADATA_KEYS` entries `lastTelegramCommandId` /
`lastTelegramCommandConfirm` (keep `agentHandbackInstructions`, `lastHumanCommandAt`,
`lastSidechatTurnOrigin`).

Dashboard reply (`index.ts:7494`) and MCP `send_agent_reply` (`mcp-server.ts:535`): the
ingest rule inline (no adapter): `@BotName …` → `startSidechatTurn(origin: "dashboard" |
"mcp", actorUserId: user.id)`; bare `@BotName` → `assignConversation(Maven)`; plain text →
`appendHuman` as today. MCP `ask_maven` description: "Maven may reply to the customer or
act on the conversation."

`AGENTS.md`: rewrite the Sidechat paragraph under "Conversation runtime", the "Live agent
handoff" section, the "Messenger methods" table, and every `@BotName` sentence, to this
file's model. Remove `[HANDOFF_REQUESTED]` mention only if the token file is also
removed (it is not; leave it).

`agentHandbackInstructions` (the enum path's `instructions: set`, e.g. "from now on tell
people the sale ends Friday"): becomes an optional argument,
`assign_conversation({ assigneeId, instructions? })`. When `assigneeId` is Maven and
`instructions` is given, it is written to `agentHandbackInstructions`; the public
prompt's `<agent-instructions>` section reads it unchanged. This is added in phase 1 with
the tool, listed here because it is what replaces the deleted enum.

---

## Phase 6: Who is writing on Slack and Telegram

### 6.1 Schema (D5)

`worker/db/schema.ts`:

```ts
export const channelIdentities = sqliteTable("channel_identities", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => authSchema.users.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => authSchema.users.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: ["slack", "telegram"] }).notNull(),
  externalId: text("external_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`).notNull(),
}, (t) => [
  uniqueIndex("uq_channel_identities_owner_channel_external").on(t.ownerId, t.channel, t.externalId),
  index("idx_channel_identities_user").on(t.userId),
]);
```

`bun run db:generate`, then `db:migrate:dev`; prod migration before the deploy that
ships phase 6 (see memory: deploy-requires-prod-migration).

### 6.2 Slack (D6)

`SlackService.lookupUserEmail(token, userId)` → `users.info`. In the Slack webhook:
resolve `channel_identities` by `(project.userId, "slack", message.user)`; miss →
lookup email → match owner or accepted member with access → insert → author.
`users:read.email` missing → `users.info` returns `missing_scope`; log once per project
per hour and leave the author unknown. Tools page shows "Reinstall Slack to identify
teammates" when that error was seen (stored in KV `slack-scope-missing:{projectId}`,
1 h TTL).

### 6.3 Telegram (D7)

- Ingest special case, before step 4: text is exactly `@{botName} link` (case-insensitive)
  → mint token `HMAC(ENCRYPTION_KEY, { ownerId, telegramUserId, exp: +15 min })`, post
  "Open this link while signed in to ReplyMaven: {BETTER_AUTH_URL}/app/link/telegram?token=…".
- Route `GET /api/team/link/telegram?token=` (session-authenticated) verifies the token,
  checks the signed-in user is the owner or an accepted member of `ownerId`, upserts the
  row, returns `{ ok: true }`.
- SPA route `/app/link/telegram` (`src/pages/LinkTelegram.tsx`): calls the route on load,
  shows "Telegram linked" or the error, one button back to Team. Uses existing `Button`
  and `Card` primitives; no new components.

### 6.4 After identity

Webhooks pass `author.userId` from the table. `reply_to_conversation` and
`decide_pending_action` work for Slack/Telegram authors. `appendHuman` from those
channels stores `userId`, so the assignee is set on their plain replies too.

---

## Self-review against the code (done 2026-09-26)

Checked before writing this version; each item is a place the plan could have been wrong.

1. **`sanitizePrivateMessageForPersistence` strips metadata** to `{ createdAt }`
   (`private-tool-payload.ts:267`). Without B1 every origin/author field would be lost on
   persist. B1 is therefore a hard dependency of phases 1 to 3.
2. **Approval parts are dropped on a fresh turn** (`removeAbandonedApprovalParts`,
   `selectSidechatModelMessages(…, continuation=false)`). Without the D2 spike outcome,
   1.5 cannot be written. Spike is task one.
3. **`onChatResponse` is the single completion point** for both the WebSocket path and
   `runServerSidechatTurn` (which calls it at `maven-chat-agent.ts:1170`). B3 hooks
   there, so one hook covers both.
4. **`runServerSidechatTurn` hard-codes `continuation: false`** (`1133`, `1145`). 1.5
   needs the flag threaded through; `executeSidechatTurn` already accepts it.
5. **`appendSidechatDraftAsBot` is idempotent on `messageId`** (returns the existing
   message when the payload matches). Using `sidechat-reply:{toolCallId}` makes a retried
   tool call safe.
6. **Assign route already does the Maven hand-back** (`index.ts:7965`). B4 lifts it; the
   tool and the route cannot drift.
7. **Telegram resolution depends on `Conversation: <id>` in the replied-to text**
   (`telegram-agent-channel.ts:9`). 2.1 keeps that line on the first post per
   conversation. Slack resolves by `thread_ts` via `findConversationByChannelThread`; the
   first post's returned `ts` must be stored, which `persistChannelThread` already does.
8. **`activeHumanRoutes` is set from `message.origin` in `appendHuman`**
   (`maven-chat-agent.ts:2142`, `activeHumanRouteFromMessage`). Email routes need
   `userId` on the message; the email ingest passes it, so joined-email forwarding keeps
   working after `forwardVisitorToJoinedHumans` loses its `email` block.
9. **Resend exposes `message_id` for sent mail** at runtime (`emails.get`), not in the
   SDK type (6.9.2). B5 reads it from the raw response. Verified with a live call.
10. **`resolveInboundConversation` returns `create` for any unmatched sender**
    (`inbound-email-routing.ts:244`). 3.6 must run the teammate check before that
    branch, otherwise the forward bug stays.
11. **`request_team_help` state machine** (contact fields, acceptance token, repair) is
    independent of `summary` except for `teamRequestSummary` metadata and the two
    summary-completion store methods. 4.1 removes only those; the pill id reservation
    stays because 4.2 writes the pill.
12. **The ticket form escalates through `createEscalation` directly** (`index.ts:1443`)
    with its own summary. After 4.1 it calls the same state-only function and the same
    trigger; the form's content is already the customer's first message, so Maven's note
    covers it.
13. **`notifyBotResolved` has no caller.** Safe to delete in 2.1.
14. **MCP has `userId` and `userName`** (`mcp-tool-helpers.ts:16`), so MCP-origin turns
    are verified authors from day one. Dashboard has `claims.userId`. Email has
    `agentUser.id`. Only Slack/Telegram are unknown until phase 6, as D8 states.
15. **Dashboard `@BotName` composer path** goes through `executeChannelBotNameCommand`
    today (`index.ts:7494`); phase 5 replaces it. Until phase 5, the old path and the new
    tools coexist without conflict because the old path never touches Sidechat tools.
16. **Widget**: no contract changes. `appendBotMessageFromSidechat` produces the same
    `PublicMessageRecord` shape the widget already renders.
17. **Lint baseline**: 2 pre-existing errors (`worker/auth.ts:25`,
    `support-prompt-builders.ts:129`) are not touched by this plan.

## Order and checkpoints

1.0 spike → 1 → 2 → 3 (3.6 last) → 4 → 5 → 6. Each phase ends with `bun run lint`,
`bunx tsc -b --force`, and its Verification list, before the next starts. One commit per
phase; push only on explicit go. D1 migration only in phase 6, applied to prod before that
deploy.


## Build notes (2026-09-26)

- D2 outcome: neither option. A fresh turn with a pending approval in the model view throws
  `MissingToolResultsError` before the provider is called, and an approved tool only runs
  when the approval response is the last model message. So: the pending approval stays out of
  the model history and is described in `context.pendingApproval`; `decide_pending_action`
  flips the stored part; the continuation resumes the approval-bearing message (like the
  dashboard button) with the model view cut at the step after the approval. The wrap-up after
  an approval pause strips unanswered calls and ends with a user turn (Gemini rejects prompts
  ending in a model turn).
- `context.author` (verified teammate, id + name) was added back: "assign it to me" needs it.
- Inside a public turn `chatService` is the child agent, not the store. Anything a tool calls
  must exist on the child too (`updateChannelThread`, `updateEmailThread`, and
  `updatePendingTeamRequestContact` are the ones used).
- `request_team_help` takes `customerName` / `customerEmail` from the model; the regex
  contact parser accepts one to three capitalised words. Before this, two-word names looped.
- `visitor_bans.banned_from_conversation_id` had a FK to the frozen `conversations` table, so
  bans on any post-migration conversation failed (dashboard too). Migration `0075` drops it.
- Migration `0075` also adds `channel_identities`. It must run on prod before deploy.
- Not verified locally: real Telegram delivery (stored token answers 401 from local dev),
  Slack `users.info` lookup, inbound teammate email including forwards (Resend webhook
  targets production). 3.6 is built: a teammate's mail with no conversation creates a
  customer-less one, the raw mail is the Sidechat turn, and `set_customer_contact` records
  the customer (verified from the dashboard Sidechat).
- Dashboard shows the system trigger line as a "You" message in the Sidechat. Cosmetic.
