import { parseAgentBotNameCommand } from "../chat-runtime/routing/public-turn-gates";
import type {
  AgentChannelAdapter,
  AgentChannelInbound,
  AgentChannelResolve,
} from "./agent-channel";
import { escapeHtml, type TelegramService } from "./telegram-service";

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
  repliedConversationId?: string | null;
}): AgentChannelResolve {
  if (input.repliedConversationId) {
    return { kind: "targeted", conversationId: input.repliedConversationId };
  }
  // Threads started before the message index keep working by their id line.
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

// The first post for a conversation carries the id line because
// resolveTelegramConversation reads it back from the replied-to message.
export function buildTelegramPostText(input: {
  text: string;
  conversationId: string;
  conversationLink: string;
  newThread: boolean;
}): string {
  const body = escapeHtml(input.text);
  if (!input.newThread) return body;
  return [
    body,
    "",
    `<b>Conversation:</b> <code>${escapeHtml(input.conversationId)}</code>`,
    `<a href="${input.conversationLink}">Open conversation</a>`,
  ].join("\n");
}

export function createTelegramAgentChannel(input: {
  botName: string | null | undefined;
  storedBotToken: string;
  chatId: string;
  service: TelegramService;
  recordMessage?: (conversationId: string, messageId: string) => Promise<void>;
}): AgentChannelAdapter {
  return {
    channel: "telegram",
    async resolveConversation(fields) {
      const repliedTo = fields.inbound.replyToExternalId;
      const [agentMode, repliedConversationId] = await Promise.all([
        fields.getAgentModeConversations(),
        repliedTo ? fields.findByChannelThread(repliedTo) : Promise.resolve(null),
      ]);
      return resolveTelegramConversation({
        inbound: fields.inbound,
        agentModeConversationIds: agentMode.map((row) => row.id),
        botName: input.botName,
        repliedConversationId,
      });
    },
    async post(fields) {
      const result = await input.service.sendMessage(
        input.storedBotToken,
        input.chatId,
        buildTelegramPostText({
          text: fields.text,
          conversationId: fields.conversationId,
          conversationLink: fields.conversationLink,
          newThread: fields.threadId === null,
        }),
        fields.threadId ? parseTelegramReplyId(fields.threadId) : undefined,
      );
      if (result.message_id == null) return null;
      const messageId = String(result.message_id);
      if (fields.conversationId && input.recordMessage) {
        await input.recordMessage(fields.conversationId, messageId).catch(
          () => undefined,
        );
      }
      return messageId;
    },
  };
}
