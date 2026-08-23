# Agent channel adapter implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract messenger transport behind one adapter, add Slack as the second adapter, then let `@BotName` and MCP start a Sidechat investigate turn.

**Architecture:** Phase 1 moves Telegram inbound/outbound onto `AgentChannelAdapter` and a shared inbound handler. Phase 2 adds a Slack adapter on the same pipelines. Phase 3 adds `startSidechatTurn` and an `investigate` command field. Dashboard Sidechat keeps the native socket. Approvals and draft send stay in the dashboard.

**Tech stack:** TypeScript, Bun tests, Hono, Cloudflare Agents, Workers Vitest pool.

**Spec:** `docs/superpowers/specs/2026-08-23-agent-channel-adapter-design.md`

## Global constraints

- Dashboard and MCP ordinary replies do not go through the messenger adapter.
- Maven command effects stay in `executeChannelBotNameCommand` / `applyBotNameCommand`.
- Adapters do not interpret `@BotName`, call `generateDirectedResponse`, assign Maven, or run Sidechat tools.
- `telegramThreadId` remains `channelThreads.telegram ?? null`.
- WhatsApp and an email adapter are out.
- Chat text is never Sidechat tool approval.
- `present_reply_draft` never sends to the visitor.
- `mcp-server.ts` and `telegram-service.ts` must not import `MavenChatAgent`.
- Use Bun for every command.
- No mocked DOM tests.

---

### Task 1: Agent channel types and Telegram resolve

**Files:**
- Create: `worker/services/agent-channel.ts`
- Create: `worker/services/telegram-agent-channel.ts`
- Test: `worker/services/telegram-agent-channel.test.ts`

**Interfaces:**
- Consumes: inbound text, reply-to text, agent-mode conversation ids.
- Produces: `AgentChannelId`, `AgentChannelResolve`, `AgentChannelInbound`, `resolveTelegramConversation(input): AgentChannelResolve`.

- [ ] **Step 1: Write failing resolve tests**

```typescript
import { expect, test } from "bun:test";
import { resolveTelegramConversation } from "./telegram-agent-channel";

const inbound = {
  channel: "telegram" as const,
  text: "@Maven close this",
  actorName: "Ada",
  commandId: "telegram:p:c:1",
  externalMessageId: "1",
  replyToExternalId: null,
  replyToText: null,
};

test("targets a Conversation id in the replied-to text", () => {
  expect(resolveTelegramConversation({
    inbound: {
      ...inbound,
      replyToExternalId: "9",
      replyToText: "Conversation: conv-1",
    },
    agentModeConversationIds: ["conv-2"],
    botName: "Maven",
  })).toEqual({ kind: "targeted", conversationId: "conv-1" });
});

test("targets the only agent-mode conversation for a standalone command", () => {
  expect(resolveTelegramConversation({
    inbound,
    agentModeConversationIds: ["conv-1"],
    botName: "Maven",
  })).toEqual({ kind: "targeted", conversationId: "conv-1" });
});

test("is ambiguous when several agent-mode conversations exist", () => {
  const result = resolveTelegramConversation({
    inbound,
    agentModeConversationIds: ["conv-1", "conv-2"],
    botName: "Maven",
  });
  expect(result.kind).toBe("ambiguous");
});

test("is none for a non-command with no reply", () => {
  expect(resolveTelegramConversation({
    inbound: { ...inbound, text: "hello" },
    agentModeConversationIds: ["conv-1"],
    botName: "Maven",
  })).toEqual({ kind: "none", reason: "not_a_reply" });
});
```

- [ ] **Step 2: Run the tests and verify failure**

```bash
bun test worker/services/telegram-agent-channel.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Add types and the Telegram resolve function**

In `agent-channel.ts` export the spec types: `AgentChannelId`, `AgentChannelResolve`, `AgentChannelInbound`, `AgentChannelAdapter`.

In `telegram-agent-channel.ts` export `resolveTelegramConversation`. Use `/Conversation:\s*(\S+)/` on `replyToText`. For a standalone command (`parseAgentBotNameCommand(text, botName).isCommand` and no conversation id), target one agent-mode id, return `ambiguous` for several, `none` with `not_a_reply` otherwise. For a reply with no conversation id, return `none` with `no_conversation_id_in_replied_message`.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
bun test worker/services/telegram-agent-channel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/agent-channel.ts worker/services/telegram-agent-channel.ts worker/services/telegram-agent-channel.test.ts
git commit -m "$(cat <<'EOF'
feat: add telegram conversation resolve for the agent channel adapter

EOF
)"
```

---

### Task 2: Shared inbound handler

**Files:**
- Create: `worker/services/run-agent-channel-inbound.ts`
- Test: `worker/services/run-agent-channel-inbound.test.ts`

**Interfaces:**
- Consumes: `AgentChannelAdapter`, `executeChannelBotNameCommand` result shape, `appendHuman`.
- Produces: `runAgentChannelInbound(input): Promise<void>`.

- [ ] **Step 1: Write failing handler tests with a fake adapter**

Cover: ambiguous confirm, none logs and does not append, command confirm, normal append with `origin: "telegram"`, append failure confirm, missing conversation. The fake adapter records `confirm` calls. The command stub returns `{ handled: true, confirmation: "Bot resumed." }` or `{ handled: false }`.

- [ ] **Step 2: Run the tests and verify failure**

```bash
bun test worker/services/run-agent-channel-inbound.test.ts
```

Expected: FAIL because the handler is missing.

- [ ] **Step 3: Implement the handler**

Follow spec steps 1–8. Log `{channel}.reply_dropped` on `none` and on a missing conversation (`conversation_not_found`). Failed append confirms with `That reply did not reach the visitor. Open the conversation in the dashboard and send it from there.`

- [ ] **Step 4: Run the tests and verify they pass**

```bash
bun test worker/services/run-agent-channel-inbound.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/run-agent-channel-inbound.ts worker/services/run-agent-channel-inbound.test.ts
git commit -m "$(cat <<'EOF'
feat: run messenger inbound through one agent channel handler

EOF
)"
```

---

### Task 3: Telegram adapter and thin webhook

**Files:**
- Modify: `worker/services/telegram-agent-channel.ts`
- Modify: `worker/index.ts` Telegram webhook (about 1373–1586)
- Test: existing Telegram webhook / public-agent tests that cover bind, drop, command, failed reply

**Interfaces:**
- Consumes: `TelegramService.sendMessage`, `resolveTelegramConversation`, `runAgentChannelInbound`.
- Produces: `createTelegramAgentChannel(service, settings): AgentChannelAdapter`.

- [ ] **Step 1: Add adapter methods that wrap `TelegramService`**

`notifyEscalation` calls `notifyEscalation` and returns the message id string or null. `forwardVisitorMessage` calls `forwardVisitorMessage`. `confirm` calls `sendMessage` with `replyToExternalId` parsed as a number. `resolveConversation` calls `resolveTelegramConversation` with `getAgentModeConversations` ids. Phase 1 `findByChannelThread` may return null.

- [ ] **Step 2: Thin the webhook**

Keep rate limit, secret check, unverified re-register, and `resolveTelegramChatBinding`. After bind, if `message.text` is missing, return `{ ok: true }`. Otherwise build `AgentChannelInbound` and call `runAgentChannelInbound`. Remove inline conversation resolve, command apply, and append.

- [ ] **Step 3: Run the existing Telegram tests**

```bash
bun test worker/services/telegram-service.test.ts worker/services/telegram-chat-binding.test.ts worker/services/apply-bot-name-command.test.ts
```

Expected: PASS. User-visible bind, drop, command, and failed-reply outcomes stay the same.

- [ ] **Step 4: Commit**

```bash
git add worker/services/telegram-agent-channel.ts worker/index.ts
git commit -m "$(cat <<'EOF'
feat: move telegram inbound onto the agent channel adapter

EOF
)"
```

---

### Task 4: channelThreads beside telegramThreadId

**Files:**
- Modify: `shared/maven-conversation.ts`
- Modify: `worker/agents/maven/public/public-conversation-state.ts`
- Modify: `worker/agents/maven/maven-chat-agent.ts` `updatePublicTelegramThreadId` and `persistTeamRequestTelegramThreadId`
- Test: `worker/conversations/public-conversation-dto.test.ts` and existing telegram-thread persist tests

**Interfaces:**
- Consumes: current `telegramThreadId` writers.
- Produces: `channelThreads: { telegram?: string; slack?: string }` on `PublicConversationRecord`.

- [ ] **Step 1: Add `channelThreads` to the public record**

Default `{}`. When reading stored state, if `channelThreads` is missing, set `{ telegram: telegramThreadId }` when `telegramThreadId` is non-null. Writers of Telegram thread ids set both `telegramThreadId` and `channelThreads.telegram`. Keep the reject rule that refuses a different Telegram thread id.

- [ ] **Step 2: Run record and persist tests**

```bash
bun test worker/conversations/public-conversation-dto.test.ts worker/chat-runtime/post-turn/escalation.test.ts worker/chat-runtime/tools/internal/request-team-help.test.ts
```

Expected: PASS. Persist still exposes `telegramThreadId`.

- [ ] **Step 3: Commit**

```bash
git add shared/maven-conversation.ts worker/agents/maven/public/public-conversation-state.ts worker/agents/maven/maven-chat-agent.ts
git commit -m "$(cat <<'EOF'
feat: store messenger thread ids in channelThreads

EOF
)"
```

---

### Task 5: Shared outbound for escalation and visitor forwards

**Files:**
- Create: `worker/services/enabled-agent-channels.ts`
- Modify: `worker/chat-runtime/post-turn/escalation.ts`
- Modify: `worker/agents/maven/maven-chat-agent.ts` human-mode forward
- Modify: `worker/index.ts` inbound-email Telegram forward
- Test: `worker/chat-runtime/post-turn/escalation.test.ts`

**Interfaces:**
- Consumes: project Telegram settings, `AgentChannelAdapter`.
- Produces: `listEnabledAgentChannels(input): AgentChannelAdapter[]`.

- [ ] **Step 1: Change escalation tests to assert adapter notify**

The test fake should implement `notifyEscalation` on an adapter, not `TelegramService.notifyEscalation` as the only path. Repeat-escalation still uses the stored Telegram thread id as `threadId`. Persist still writes `telegramThreadId` and `channelThreads.telegram`.

- [ ] **Step 2: Implement `listEnabledAgentChannels`**

Phase 1: return the Telegram adapter when `telegramBotToken` and `telegramChatId` are set. Escalation and both visitor-forward call sites loop enabled adapters. Email owner mail stays beside the loop. The claim-once rule uses “any messenger adapter enabled,” not the Telegram name.

- [ ] **Step 3: Run escalation and related tests**

```bash
bun test worker/chat-runtime/post-turn/escalation.test.ts worker/chat-runtime/tools/internal/request-team-help.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add worker/services/enabled-agent-channels.ts worker/chat-runtime/post-turn/escalation.ts worker/agents/maven/maven-chat-agent.ts worker/index.ts
git commit -m "$(cat <<'EOF'
feat: send escalation and visitor forwards through enabled adapters

EOF
)"
```

---

### Task 6: Slack adapter (Phase 2)

**Files:**
- Create: `worker/services/slack-agent-channel.ts`
- Create: `worker/services/slack-agent-channel.test.ts`
- Modify: `worker/index.ts` (new `POST /api/slack/events/:projectId`)
- Modify: `worker/db/schema.ts` project settings
- Modify: `worker/services/billing-service.ts` plan limits
- Modify: `src/pages/Tools.tsx` Slack live-agent card
- Modify: `shared/maven-conversation.ts` origin union
- Modify: `worker/agents/maven/conversation-directory.ts` `findByChannelThread`

**Interfaces:**
- Consumes: Slack signing secret, `event.text`, `thread_ts`.
- Produces: Slack `AgentChannelAdapter`, origin `"slack"`.

- [ ] **Step 1: Write Slack resolve and signature tests**

Resolve order from the spec. Signature test: bad signature rejected. `url_verification` returns the challenge.

- [ ] **Step 2: Implement Slack adapter, webhook, settings, plan flag**

Encrypt `slackBotToken` and `slackSigningSecret` like the Telegram token. Bind once. Starter plan `slack: false`. Standard and business `true`. Tools card is separate from `send_to_slack`.

Add `updatePublicChannelThread("slack", ts)` and directory `findByChannelThread("slack", ts)`. Do not reuse `telegram_thread_id`.

- [ ] **Step 3: Run Slack and origin tests**

```bash
bun test worker/services/slack-agent-channel.test.ts
```

Expected: PASS. Escalation with both adapters stores each thread id separately.

- [ ] **Step 4: Generate the settings migration**

```bash
bun run db:generate
```

Check the SQL adds the Slack columns. Then `bun run db:migrate:dev`.

- [ ] **Step 5: Commit**

```bash
git add worker/services/slack-agent-channel.ts worker/services/slack-agent-channel.test.ts worker/index.ts worker/db/schema.ts worker/services/billing-service.ts src/pages/Tools.tsx shared/maven-conversation.ts worker/agents/maven/conversation-directory.ts
git commit -m "$(cat <<'EOF'
feat: add slack as the second agent channel adapter

EOF
)"
```

---

### Task 7: Investigate field on BotNameDecision (Phase 3)

**Files:**
- Modify: `worker/services/bot-name-decision.ts`
- Modify: `worker/services/bot-name-decision.test.ts`
- Modify: `worker/services/ai-service.ts` interpret prompt
- Modify: `worker/services/apply-bot-name-command.ts`
- Modify: `worker/services/apply-bot-name-command.test.ts`

**Interfaces:**
- Consumes: current `BotNameDecision`.
- Produces: `investigate: "now" | "none"` and `confirmBotNameDecision` strings for investigate / busy.

- [ ] **Step 1: Write failing parse and apply tests**

```typescript
expect(parseBotNameDecision({
  ownership: "human",
  instructions: "set",
  speak: "silent",
  effect: "none",
  reason: null,
})?.investigate).toBe("none");

expect(parseBotNameDecision({
  ownership: "human",
  instructions: "set",
  speak: "silent",
  effect: "none",
  investigate: "maybe",
  reason: null,
})).toBeNull();
```

Apply tests: `investigate: "now"` calls `startSidechatTurn` and does not call `generateDirectedResponse`. Close/ban do not call it. Busy result confirms `Maven is already working on this.` Success confirms `Maven is looking into that.`

- [ ] **Step 2: Run the tests and verify failure**

```bash
bun test worker/services/bot-name-decision.test.ts worker/services/apply-bot-name-command.test.ts
```

Expected: FAIL on missing `investigate` handling.

- [ ] **Step 3: Implement parse, confirm, and apply**

Add `investigate` to the interface. Missing key → `"none"`. Invalid key → null decision. Close/ban ignore it. `investigate: "now"` ignores `speak`. Add `startSidechatTurn` to `ApplyBotNameCommandDeps`.

Add the field to the interpret prompt in `ai-service.ts`.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
bun test worker/services/bot-name-decision.test.ts worker/services/apply-bot-name-command.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/bot-name-decision.ts worker/services/bot-name-decision.test.ts worker/services/ai-service.ts worker/services/apply-bot-name-command.ts worker/services/apply-bot-name-command.test.ts
git commit -m "$(cat <<'EOF'
feat: let @BotName start a sidechat investigate turn

EOF
)"
```

---

### Task 8: startSidechatTurn and child server submit

**Files:**
- Create: `worker/services/start-sidechat-turn.ts`
- Create: `worker/services/start-sidechat-turn.test.ts`
- Modify: `worker/agents/maven/maven-chat-agent.ts` (`submitServerSidechatTurn`)
- Modify: `worker/agents/maven/maven-project-agent.ts` (thin RPC wrapper if needed)
- Test: `worker/agents/sidechat/maven-chat-agent.integration.test.ts`

**Interfaces:**
- Consumes: `registerSidechat`, Sidechat status, actor user id.
- Produces:

```typescript
type SidechatTurnOrigin = "mcp" | "telegram" | "slack";

type StartSidechatTurnResult =
  | { accepted: true; status: "working" }
  | { accepted: false; reason: "busy" | "archived" | "failed" };

function startSidechatTurn(input: {
  projectId: string;
  conversationId: string;
  text: string;
  actorUserId: string;
  origin: SidechatTurnOrigin;
}): Promise<StartSidechatTurnResult>;
```

- [ ] **Step 1: Write failing unit tests for busy, archived, and accept**

Use a fake parent/child. Busy when status is `working` or `waiting_approval`. Archived when the public conversation is missing or archived. Accept calls `submitServerSidechatTurn`.

- [ ] **Step 2: Implement `startSidechatTurn`**

MCP passes `context.userId`. Telegram and Slack pass `project.userId`. Do not import this module into `telegram-service.ts`.

- [ ] **Step 3: Add `submitServerSidechatTurn` on the child**

Reuse the existing Sidechat execute path (tools, `present_reply_draft`, status updates). Do not require a dashboard token. If the child is not operational, return failed. Run the turn with `waitUntil` so the webhook/MCP request can return after accept.

- [ ] **Step 4: Run unit and Sidechat integration tests**

```bash
bun test worker/services/start-sidechat-turn.test.ts
bun run test:agents -- worker/agents/sidechat/maven-chat-agent.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/start-sidechat-turn.ts worker/services/start-sidechat-turn.test.ts worker/agents/maven/maven-chat-agent.ts worker/agents/maven/maven-project-agent.ts
git commit -m "$(cat <<'EOF'
feat: start sidechat turns from the worker without a dashboard socket

EOF
)"
```

---

### Task 9: MCP ask_maven and status, messenger pings

**Files:**
- Create: `worker/services/sidechat-status.ts`
- Modify: `worker/mcp-server.ts`
- Modify: `worker/agents/sidechat/sidechat-privacy.test.ts`
- Modify: `worker/agents/maven/maven-project-agent.ts` `updateSidechatSummary`
- Test: `worker/mcp-helpdesk-tools.test.ts` or a new `worker/mcp-server-sidechat.test.ts`

**Interfaces:**
- Consumes: `startSidechatTurn`, Sidechat summary status, latest draft presence.
- Produces: MCP tools `ask_maven` and `get_sidechat_status`.

- [ ] **Step 1: Write MCP tool tests**

`ask_maven` requires `conversations:reply`, calls `startSidechatTurn` with `origin: "mcp"`, returns `{ ok, accepted, status, confirmation }`. `get_sidechat_status` returns `{ status, hasDraft, waitingApproval }` and no transcript.

- [ ] **Step 2: Implement the tools and status reader**

`hasDraft` is true when the latest Sidechat assistant message has a `present_reply_draft` part. Do not return draft text or tool payloads.

- [ ] **Step 3: Ping messengers only for telegram/slack origins**

Store the last investigate origin on Sidechat metadata or the public metadata key `lastSidechatTurnOrigin`. `updateSidechatSummary` pings enabled adapters only when that origin is `telegram` or `slack`. Copy:

- `working` → `Maven is looking into that.`
- `waiting_approval` → `Maven needs approval in the dashboard.`
- `ready` → `Maven has a draft in the dashboard.`
- `failed` → `Maven could not finish. Open Sidechat in the dashboard.`

Dashboard-started turns leave the origin unset and do not ping.

- [ ] **Step 4: Update the privacy test**

Keep the ban on `MavenChatAgent`, `data-reply-draft`, and `data-safe-activity` in `mcp-server.ts` and `telegram-service.ts`. Allow `start-sidechat-turn` imports in MCP.

```bash
bun test worker/agents/sidechat/sidechat-privacy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/sidechat-status.ts worker/mcp-server.ts worker/agents/sidechat/sidechat-privacy.test.ts worker/agents/maven/maven-project-agent.ts
git commit -m "$(cat <<'EOF'
feat: add ask_maven and sidechat status pings

EOF
)"
```

---

### Task 10: Docs and full validation

**Files:**
- Help articles only in Phase 2 and Phase 3, after the matching code ships
- `AGENTS.md` command and notify prose if it still names removed Telegram methods

- [ ] **Step 1: Run the repo checks**

```bash
bun test
bun run test:agents
bun run lint
bunx tsc -b --force
```

Report pre-existing failures plainly.

- [ ] **Step 2: Update help and AGENTS.md only for shipped phases**

Phase 1: no help rewrite. Phase 2: Telegram and agent-handoff articles name Slack. Phase 3: those articles plus MCP tools name `ask_maven`. Do not claim Telegram is the only command path.

- [ ] **Step 3: Commit docs if they changed**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
docs: describe agent channel adapters and ask_maven

EOF
)"
```
