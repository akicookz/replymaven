import type { AgentChannelAdapter } from "./agent-channel";
import { createSlackAgentChannel } from "./slack-agent-channel";
import type { SlackService } from "./slack-service";
import { createTelegramAgentChannel } from "./telegram-agent-channel";
import type { TelegramService } from "./telegram-service";

export interface TelegramChannelEnablement {
  storedBotToken?: string | null;
  chatId?: string | null;
  botName?: string | null;
  service: TelegramService;
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
}): AgentChannelAdapter[] {
  const channels: AgentChannelAdapter[] = [];
  const telegram = input.telegram;
  if (telegram?.storedBotToken && telegram.chatId) {
    channels.push(createTelegramAgentChannel({
      botName: telegram.botName,
      storedBotToken: telegram.storedBotToken,
      chatId: telegram.chatId,
      service: telegram.service,
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
