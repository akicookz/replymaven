import { Agent, type Connection, type ConnectionContext } from "agents";
import type {
  MavenProjectState,
  SidechatStatus,
  SidechatSummary,
} from "../../../shared/sidechat-agent";
import { type AppEnv } from "../../types";
import {
  authorizeSubAgentRequest,
  readVerifiedSidechatClaims,
  toSidechatChildName,
} from "./agent-auth";
import { MavenChatAgent } from "./maven-chat-agent";

function upsertSidechatSummary(
  state: MavenProjectState,
  conversationId: string,
  childName: string,
  status: SidechatStatus,
  updatedAt = Date.now(),
): MavenProjectState {
  return {
    ...state,
    sidechats: {
      ...state.sidechats,
      [conversationId]: {
        conversationId,
        childName,
        status,
        updatedAt,
      },
    },
  };
}

export class MavenProjectAgent extends Agent<AppEnv, MavenProjectState> {
  initialState: MavenProjectState = { sidechats: {} };

  async registerSidechat(
    conversationId: string,
  ): Promise<{ childName: string; created: boolean }> {
    const childName = toSidechatChildName(conversationId);
    const created = !this.hasSubAgent(MavenChatAgent, childName);
    await this.subAgent(MavenChatAgent, childName);
    const existing = this.state.sidechats[conversationId];
    this.setState(
      upsertSidechatSummary(
        this.state,
        conversationId,
        childName,
        existing?.status ?? "idle",
      ),
    );
    return { childName, created };
  }

  async getSidechatRegistration(
    conversationId: string,
  ): Promise<{ childName: string } | null> {
    const childName = toSidechatChildName(conversationId);
    return this.hasSubAgent(MavenChatAgent, childName) ? { childName } : null;
  }

  async getSidechatSummaries(): Promise<SidechatSummary[]> {
    return Object.values(this.state.sidechats)
      .filter((summary) =>
        this.hasSubAgent(MavenChatAgent, summary.childName),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async updateSidechatSummary(
    conversationId: string,
    status: SidechatStatus,
  ): Promise<boolean> {
    const childName = toSidechatChildName(conversationId);
    if (!this.hasSubAgent(MavenChatAgent, childName)) return false;
    this.setState(
      upsertSidechatSummary(
        this.state,
        conversationId,
        childName,
        status,
      ),
    );
    return true;
  }

  override shouldConnectionBeReadonly(): boolean {
    return true;
  }

  override async onConnect(
    connection: Connection,
    context: ConnectionContext,
  ): Promise<void> {
    const claims = readVerifiedSidechatClaims(context.request);
    if (!claims || claims.scope !== "parent" || claims.parentName !== this.name) {
      throw new Error("Unauthorized Sidechat parent connection");
    }
    await super.onConnect(connection, context);
    connection.setState({ sidechatActor: claims });
  }

  override async onBeforeSubAgent(
    request: Request,
    child: { className: string; name: string },
  ): Promise<Request | Response | void> {
    if (
      child.className !== MavenChatAgent.name ||
      !this.hasSubAgent(MavenChatAgent, child.name)
    ) {
      return new Response("Not found", { status: 404 });
    }
    return authorizeSubAgentRequest(
      request,
      this.name,
      child.name,
      this.env.SIDECHAT_TOKEN_SECRET,
    );
  }
}

export { upsertSidechatSummary };
