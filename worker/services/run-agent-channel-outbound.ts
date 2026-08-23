import type { AgentChannelAdapter } from "./agent-channel";
import { readChannelThreadId } from "./agent-channel";
import type { PublicChannelThreads } from "../../shared/maven-conversation";

export async function forwardVisitorThroughAgentChannels(input: {
  channels: AgentChannelAdapter[];
  conversationId: string;
  visitorName: string | null;
  content: string;
  channelThreads?: PublicChannelThreads | null;
  telegramThreadId?: string | null;
}): Promise<void> {
  for (const adapter of input.channels) {
    await adapter.forwardVisitorMessage({
      conversationId: input.conversationId,
      visitorName: input.visitorName,
      content: input.content,
      threadId: readChannelThreadId(
        {
          channelThreads: input.channelThreads,
          telegramThreadId: input.telegramThreadId ?? null,
        },
        adapter.channel,
      ),
    });
  }
}
