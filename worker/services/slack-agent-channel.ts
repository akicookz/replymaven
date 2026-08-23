import { parseAgentBotNameCommand } from "../chat-runtime/routing/public-turn-gates";
import type {
  AgentChannelAdapter,
  AgentChannelInbound,
  AgentChannelResolve,
} from "./agent-channel";
import { readConversationIdFromReplyText } from "./telegram-agent-channel";
import type { SlackService } from "./slack-service";

export function resolveSlackConversation(input: {
  inbound: AgentChannelInbound;
  agentModeConversationIds: string[];
  botName: string | null | undefined;
  threadConversationId: string | null;
}): AgentChannelResolve {
  const conversationId = readConversationIdFromReplyText(
    input.inbound.replyToText,
  );
  if (conversationId) {
    return { kind: "targeted", conversationId };
  }
  if (input.threadConversationId) {
    return { kind: "targeted", conversationId: input.threadConversationId };
  }

  const isCommand = parseAgentBotNameCommand(
    input.inbound.text,
    input.botName,
  ).isCommand;
  if (isCommand && !input.inbound.replyToExternalId) {
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
          `Multiple active conversations. Please reply in a conversation thread or quote a notification to use @${botName} commands.`,
      };
    }
  }

  if (input.inbound.replyToExternalId) {
    return { kind: "none", reason: "no_conversation_id_in_replied_message" };
  }
  return { kind: "none", reason: "not_a_reply" };
}

export function createSlackAgentChannel(input: {
  botName: string | null | undefined;
  storedBotToken: string;
  channelId: string;
  service: SlackService;
}): AgentChannelAdapter {
  return {
    channel: "slack",
    async resolveConversation(fields) {
      const threadId = fields.inbound.replyToExternalId;
      const [agentMode, threadConversationId] = await Promise.all([
        fields.getAgentModeConversations(),
        threadId ? fields.findByChannelThread(threadId) : Promise.resolve(null),
      ]);
      return resolveSlackConversation({
        inbound: fields.inbound,
        agentModeConversationIds: agentMode.map((row) => row.id),
        botName: input.botName,
        threadConversationId,
      });
    },
    async notifyEscalation(fields) {
      return input.service.notifyEscalation(
        input.storedBotToken,
        input.channelId,
        {
          visitorName: fields.visitorName,
          visitorEmail: fields.visitorEmail,
          summary: fields.summary,
          conversationUrl: fields.conversationUrl,
          conversationId: fields.conversationId,
          isUpdate: fields.isUpdate,
          threadTs: fields.threadId,
        },
      );
    },
    async forwardVisitorMessage(fields) {
      await input.service.forwardVisitorMessage(
        input.storedBotToken,
        input.channelId,
        fields.visitorName,
        fields.content,
        fields.conversationId,
        fields.threadId,
      );
    },
    async confirm(fields) {
      await input.service.postMessage(input.storedBotToken, {
        channelId: input.channelId,
        text: fields.text,
        threadTs: fields.replyToExternalId,
      });
    },
  };
}

export function readSlackUrlVerification(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== "url_verification") return null;
  return typeof record.challenge === "string" ? record.challenge : null;
}

export function readSlackMessageInbound(
  payload: unknown,
  projectId: string,
): { inbound: AgentChannelInbound; channelId: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const event = record.event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const message = event as Record<string, unknown>;
  if (message.type !== "message") return null;
  if (typeof message.bot_id === "string") return null;
  if (typeof message.subtype === "string") return null;
  if (typeof message.text !== "string" || !message.text.trim()) return null;
  if (typeof message.ts !== "string") return null;
  if (typeof message.channel !== "string") return null;

  const threadTs = typeof message.thread_ts === "string"
    ? message.thread_ts
    : null;
  return {
    channelId: message.channel,
    inbound: {
      channel: "slack",
      text: message.text,
      actorName: typeof message.user === "string" ? message.user : null,
      commandId: `slack:${projectId}:${message.ts}`,
      externalMessageId: message.ts,
      replyToExternalId: threadTs && threadTs !== message.ts ? threadTs : null,
      replyToText: null,
    },
  };
}
