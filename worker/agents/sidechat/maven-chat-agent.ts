import { AIChatAgent } from "@cloudflare/ai-chat";
import { type Connection, type ConnectionContext } from "agents";
import { type AppEnv } from "../../types";
import { readVerifiedSidechatClaims } from "./agent-auth";

export class MavenChatAgent extends AIChatAgent<AppEnv> {
  messageConcurrency = "queue" as const;
  chatRecovery = true;
  maxPersistedMessages = 200;
  waitForMcpConnections = false;

  override async onConnect(
    connection: Connection,
    context: ConnectionContext,
  ): Promise<void> {
    const claims = readVerifiedSidechatClaims(context.request);
    if (!claims || claims.scope !== "child" || claims.childName !== this.name) {
      throw new Error("Unauthorized Sidechat child connection");
    }
    await super.onConnect(connection, context);
    connection.setState({ sidechatActor: claims });
  }
}
