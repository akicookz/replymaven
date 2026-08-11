import { Agent, type Connection, type ConnectionContext } from "agents";
import { drizzle } from "drizzle-orm/d1";
import type {
  MavenProjectState,
  SidechatCustomerContext,
  SidechatStatus,
  SidechatSummary,
  SidechatToolDescriptor,
} from "../../../shared/sidechat-agent";
import { buildCustomerByIdQuery } from "../../services/customer-service";
import { ChatService } from "../../services/chat-service";
import { type AppEnv } from "../../types";
import {
  authorizeSubAgentRequest,
  readVerifiedSidechatClaims,
  toSidechatChildName,
} from "./agent-auth";
import { MavenChatAgent } from "./maven-chat-agent";
import { buildSidechatContext } from "./sidechat-context";

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
  private readonly sidechatRegistrationLocks = new Map<string, Promise<void>>();

  async registerSidechat(
    conversationId: string,
  ): Promise<{ childName: string; created: boolean }> {
    const previousRegistration =
      this.sidechatRegistrationLocks.get(conversationId) ?? Promise.resolve();
    let releaseRegistration = (): void => undefined;
    const registrationComplete = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    const lock = previousRegistration.then(() => registrationComplete);
    this.sidechatRegistrationLocks.set(conversationId, lock);

    await previousRegistration;
    try {
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
    } finally {
      releaseRegistration();
      if (this.sidechatRegistrationLocks.get(conversationId) === lock) {
        this.sidechatRegistrationLocks.delete(conversationId);
      }
    }
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

  async getSidechatContext(
    childName: string,
    conversationId: string,
  ): Promise<SidechatCustomerContext> {
    this.assertRegisteredSidechat(childName, conversationId);
    const db = drizzle(this.env.DB);
    const chatService = new ChatService(db);
    return buildSidechatContext({
      projectId: this.name,
      conversationId,
      dependencies: {
        getConversation(id, projectId) {
          return chatService.getConversationById(id, projectId);
        },
        async getCustomer(projectId, customerId) {
          const rows = await buildCustomerByIdQuery(
            db,
            projectId,
            customerId,
          );
          return rows[0] ?? null;
        },
        getRecentPublicMessages(id, limit) {
          return chatService.getRecentPublicMessages(id, limit);
        },
      },
    });
  }

  async getSidechatToolDescriptors(
    childName: string,
    conversationId: string,
  ): Promise<SidechatToolDescriptor[]> {
    this.assertRegisteredSidechat(childName, conversationId);
    // Task 5 replaces this empty native boundary with project-authorized
    // descriptor projection. The child never reads project tools directly.
    return [];
  }

  private assertRegisteredSidechat(
    childName: string,
    conversationId: string,
  ): void {
    const expectedChildName = toSidechatChildName(conversationId);
    const summary = this.state.sidechats[conversationId];
    if (
      childName !== expectedChildName ||
      summary?.childName !== childName ||
      !this.hasSubAgent(MavenChatAgent, childName)
    ) {
      throw new Error("Sidechat is not registered");
    }
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
