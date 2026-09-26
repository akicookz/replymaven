import { MAVEN_ASSIGNEE_ID } from "../../shared/maven-assignee";
import { parseAgentBotNameCommand } from "../chat-runtime/routing/public-turn-gates";
import {
  fallbackAiParticipationForStatus,
  parseChatState,
} from "../chat-runtime/types";
import { type PublicConversationStore } from "../conversations/public-conversation-store";
import { buildConversationDeepLink } from "../lib/deep-links";
import { logError, logWarn } from "../observability";
import type { AgentChannelAdapter, AgentChannelInbound } from "./agent-channel";
import { assignConversation } from "./conversation-actions";
import {
  startSidechatTurn,
  type StartSidechatTurnResult,
} from "./start-sidechat-turn";
import type { AppEnv } from "../types";
import type { DrizzleD1Database } from "drizzle-orm/d1";

// Where Maven's answer goes: the Slack thread, the Telegram message, or the
// RFC id of the teammate's email.
function replyThreadFor(inbound: AgentChannelInbound): string | null {
  if (inbound.channel === "slack") {
    return inbound.replyToExternalId ?? inbound.externalMessageId;
  }
  if (inbound.channel === "email") return inbound.replyToExternalId;
  return inbound.externalMessageId;
}

const FAILED_DELIVERY =
  "That reply did not reach the visitor. Open the conversation in the dashboard and send it from there.";
const BUSY = "Maven is already working on this.";

// One entry for every channel message from a teammate. When Maven owns the
// thread the message is a Sidechat turn; when a human owns it, plain text is a
// reply to the customer and an @BotName prefix still reaches Maven.
export async function ingestTeammateMessage(input: {
  adapter: AgentChannelAdapter;
  inbound: AgentChannelInbound;
  botName: string | null | undefined;
  projectId: string;
  // Access principal for Sidechat tools until the author is known.
  actorUserId: string;
  db: DrizzleD1Database<Record<string, unknown>>;
  chatService: PublicConversationStore;
  env: Pick<AppEnv, "MAVEN_PROJECT_AGENT" | "BETTER_AUTH_URL">;
  getAgentModeConversations(): Promise<Array<{ id: string }>>;
  findByChannelThread(threadId: string): Promise<string | null>;
  startTurn?: typeof startSidechatTurn;
}): Promise<void> {
  const { adapter, inbound } = input;
  const resolved = await adapter.resolveConversation({
    inbound,
    getAgentModeConversations: input.getAgentModeConversations,
    findByChannelThread: input.findByChannelThread,
  });
  if (resolved.kind === "ambiguous") {
    await adapter.post({
      conversationId: "",
      text: resolved.hint,
      threadId: inbound.externalMessageId,
      conversationLink: "",
    });
    return;
  }
  if (resolved.kind === "none") {
    logWarn(`${inbound.channel}.reply_dropped`, { reason: resolved.reason });
    return;
  }

  const conversation = await input.chatService.getOperational(
    input.projectId,
    resolved.conversationId,
  );
  if (!conversation) {
    logWarn(`${inbound.channel}.reply_dropped`, {
      conversationId: resolved.conversationId,
      reason: "conversation_not_found",
    });
    return;
  }
  const conversationLink = buildConversationDeepLink(
    input.env.BETTER_AUTH_URL,
    input.projectId,
    conversation.id,
  );
  const reply = (text: string) =>
    adapter.post({
      conversationId: conversation.id,
      text,
      threadId: inbound.externalMessageId,
      conversationLink,
    }).catch((error: unknown) => {
      logError(`${inbound.channel}.reply_post_failed`, error, {
        conversationId: conversation.id,
      });
      return null;
    });

  const chatState = parseChatState(JSON.stringify(conversation.chatState), {
    fallbackAiParticipation: fallbackAiParticipationForStatus(
      conversation.status,
    ),
  });
  const mention = parseAgentBotNameCommand(inbound.text, input.botName);

  if (chatState.aiParticipation === "human_only" && !mention.isCommand) {
    const appended = await input.chatService.appendHuman({
      projectId: input.projectId,
      conversationId: conversation.id,
      content: inbound.text,
      senderName: inbound.author.displayName,
      ...(inbound.author.userId ? { userId: inbound.author.userId } : {}),
      idempotencyKey: `${inbound.channel}:${inbound.externalMessageId}`,
      origin: inbound.channel,
      externalReplyTo: inbound.replyToExternalId,
    }).catch((error: unknown) => {
      logError(`${inbound.channel}.reply_append_failed`, error, {
        projectId: input.projectId,
        conversationId: conversation.id,
      });
      return null;
    });
    if (!appended) await reply(FAILED_DELIVERY);
    return;
  }

  const text = mention.isCommand ? mention.commandText : inbound.text.trim();
  if (!text) {
    // A bare @BotName hands the thread back to Maven.
    const handed = await assignConversation({
      db: input.db,
      chatService: input.chatService,
      projectId: input.projectId,
      conversationId: conversation.id,
      assigneeId: MAVEN_ASSIGNEE_ID,
      actorName: inbound.author.displayName,
    });
    await reply(
      "error" in handed
        ? "Could not hand this back to Maven."
        : `Handed back to ${input.botName?.trim() || "Maven"}.`,
    );
    return;
  }

  const started: StartSidechatTurnResult = await (input.startTurn ??
    startSidechatTurn)({
    projectId: input.projectId,
    env: input.env,
    conversationId: conversation.id,
    text,
    origin: inbound.channel,
    actorUserId: input.actorUserId,
    authorUserId: inbound.author.userId,
    authorDisplayName: inbound.author.displayName,
    channelMessageId: `${inbound.channel}:${inbound.externalMessageId}`,
    replyThreadId: replyThreadFor(inbound),
    replyRecipient: inbound.author.email,
  });
  if (started.accepted || started.reason === "duplicate") return;
  if (started.reason === "busy") {
    await reply(BUSY);
    return;
  }
  await reply(`Maven could not start that. Open the conversation: ${conversationLink}`);
}
