import { AIChatAgent } from "@cloudflare/ai-chat";
import { type AppEnv } from "../../types";

export class MavenChatAgent extends AIChatAgent<AppEnv> {
  messageConcurrency = "queue" as const;
  chatRecovery = true;
  maxPersistedMessages = 200;
  waitForMcpConnections = false;
}
