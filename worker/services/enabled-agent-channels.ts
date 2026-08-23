import type { AgentChannelAdapter } from "./agent-channel";
import { createTelegramAgentChannel } from "./telegram-agent-channel";
import type { TelegramService } from "./telegram-service";

export interface TelegramChannelEnablement {
  storedBotToken?: string | null;
  chatId?: string | null;
  botName?: string | null;
  service: TelegramService;
}

export function listEnabledAgentChannels(input: {
  telegram?: TelegramChannelEnablement | null;
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
  return channels;
}
