import { parseAgentBotNameCommand } from "../chat-runtime/routing/public-turn-gates";
import type {
  AgentChannelAdapter,
  AgentChannelInbound,
  AgentChannelResolve,
} from "./agent-channel";
import type { TelegramService } from "./telegram-service";

const CONVERSATION_ID_IN_TEXT = /Conversation:\s*(\S+)/;

export function readConversationIdFromReplyText(
  replyToText: string | null,
): string | null {
  if (!replyToText) return null;
  const match = replyToText.match(CONVERSATION_ID_IN_TEXT);
  return match?.[1] ?? null;
}

export function resolveTelegramConversation(input: {
  inbound: AgentChannelInbound;
  agentModeConversationIds: string[];
  botName: string | null | undefined;
}): AgentChannelResolve {
  const conversationId = readConversationIdFromReplyText(
    input.inbound.replyToText,
  );
  if (conversationId) {
    return { kind: "targeted", conversationId };
  }

  const isCommand = parseAgentBotNameCommand(
    input.inbound.text,
    input.botName,
  ).isCommand;
  if (isCommand && !input.inbound.replyToText) {
    if (input.agentModeConversationIds.length === 1) {
      return {
        kind: "targeted",
        conversationId: input.agentModeConversationIds[0]!,
      };
    }
    if (input.agentModeConversationIds.length > 1) {
      const botName = input.botName?.trim() || "BotName";
      return {
        kind: "ambiguous",
        hint:
          `Multiple active conversations. Please reply directly to a forwarded visitor message or notification to use @${botName} commands.`,
      };
    }
  }

  if (input.inbound.replyToExternalId) {
    return { kind: "none", reason: "no_conversation_id_in_replied_message" };
  }
  return { kind: "none", reason: "not_a_reply" };
}

function parseTelegramReplyId(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function createTelegramAgentChannel(input: {
  botName: string | null | undefined;
  storedBotToken: string;
  chatId: string;
  service: TelegramService;
}): AgentChannelAdapter {
  return {
    channel: "telegram",
    async resolveConversation(fields) {
      const agentMode = await fields.getAgentModeConversations();
      return resolveTelegramConversation({
        inbound: fields.inbound,
        agentModeConversationIds: agentMode.map((row) => row.id),
        botName: input.botName,
      });
    },
    async notifyEscalation(fields) {
      const messageId = await input.service.notifyEscalation(
        input.storedBotToken,
        input.chatId,
        {
          visitorName: fields.visitorName,
          visitorEmail: fields.visitorEmail,
          summary: fields.summary,
          conversationUrl: fields.conversationUrl,
          conversationId: fields.conversationId,
          isUpdate: fields.isUpdate,
          replyToMessageId: fields.threadId
            ? parseTelegramReplyId(fields.threadId)
            : undefined,
        },
      );
      return messageId == null ? null : String(messageId);
    },
    async forwardVisitorMessage(fields) {
      await input.service.forwardVisitorMessage(
        input.storedBotToken,
        input.chatId,
        fields.visitorName,
        fields.content,
        fields.conversationId,
        fields.threadId ? parseTelegramReplyId(fields.threadId) : undefined,
      );
    },
    async confirm(fields) {
      await input.service.sendMessage(
        input.storedBotToken,
        input.chatId,
        fields.text,
        parseTelegramReplyId(fields.replyToExternalId),
      );
    },
  };
}
