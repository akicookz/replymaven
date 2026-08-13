import { createWidgetAgentChatClient } from "./agent-chat-bridge";
import type { ReplyMavenAgentRuntime } from "./lazy-agent-chat-client";

declare global {
  interface Window {
    __ReplyMavenAgentRuntime?: ReplyMavenAgentRuntime;
  }
}

window.__ReplyMavenAgentRuntime = { createWidgetAgentChatClient };
