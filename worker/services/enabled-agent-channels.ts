import type { AgentChannelAdapter } from "./agent-channel";
import type { AppEnv } from "../types";
import { createSlackAgentChannel } from "./slack-agent-channel";
import type { SlackService } from "./slack-service";
import { createTelegramAgentChannel } from "./telegram-agent-channel";
import type { TelegramService } from "./telegram-service";
import {
  createEmailAgentChannel,
  type EmailChannelEnablement,
} from "./email-agent-channel";

export interface TelegramChannelEnablement {
  storedBotToken?: string | null;
  chatId?: string | null;
  botName?: string | null;
  service: TelegramService;
  recordMessage?: (conversationId: string, messageId: string) => Promise<void>;
}

// Records each bot post in the project agent's message index.
export function telegramMessageRecorder(
  env: Pick<AppEnv, "MAVEN_PROJECT_AGENT">,
  projectId: string,
): (conversationId: string, messageId: string) => Promise<void> {
  return async (conversationId, messageId) => {
    const { getAgentByName } = await import("agents");
    const parent = await getAgentByName(
      env.MAVEN_PROJECT_AGENT,
      projectId,
    ) as unknown as {
      recordChannelMessage(
        channel: "telegram",
        externalId: string,
        conversationId: string,
      ): Promise<void>;
    };
    await parent.recordChannelMessage("telegram", messageId, conversationId);
  };
}

export interface SlackChannelEnablement {
  storedBotToken?: string | null;
  channelId?: string | null;
  botName?: string | null;
  service: SlackService;
}

export function listEnabledAgentChannels(input: {
  telegram?: TelegramChannelEnablement | null;
  slack?: SlackChannelEnablement | null;
  email?: EmailChannelEnablement | null;
}): AgentChannelAdapter[] {
  const channels: AgentChannelAdapter[] = [];
  if (input.email) channels.push(createEmailAgentChannel(input.email));
  const telegram = input.telegram;
  if (telegram?.storedBotToken && telegram.chatId) {
    channels.push(createTelegramAgentChannel({
      botName: telegram.botName,
      storedBotToken: telegram.storedBotToken,
      chatId: telegram.chatId,
      service: telegram.service,
      recordMessage: telegram.recordMessage,
    }));
  }
  const slack = input.slack;
  if (slack?.storedBotToken && slack.channelId) {
    channels.push(createSlackAgentChannel({
      botName: slack.botName,
      storedBotToken: slack.storedBotToken,
      channelId: slack.channelId,
      service: slack.service,
    }));
  }
  return channels;
}
