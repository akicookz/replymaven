import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { SidechatChildClaims } from "../../../shared/sidechat-agent";

const secret = "task-2-test-secret-with-at-least-32-bytes";

class FakeAgent {
  env = { SIDECHAT_TOKEN_SECRET: secret };
  name = "project-1";
  state: unknown;

  setState(state: unknown): void {
    this.state = state;
  }

  async onConnect(): Promise<void> {}
}

class MavenChatAgentMock {}
Object.defineProperty(MavenChatAgentMock, "name", { value: "MavenChatAgent" });

let MavenProjectAgent: typeof import("./maven-project-agent").MavenProjectAgent;
let signSidechatToken: typeof import("./agent-auth").signSidechatToken;

beforeAll(async () => {
  mock.module("agents", () => ({ Agent: FakeAgent }));
  mock.module("./maven-chat-agent", () => ({
    MavenChatAgent: MavenChatAgentMock,
  }));
  ({ MavenProjectAgent } = await import("./maven-project-agent"));
  ({ signSidechatToken } = await import("./agent-auth"));
});

function childClaims(): SidechatChildClaims {
  const issuedAt = Math.floor(Date.now() / 1_000);
  return {
    userId: "user-1",
    effectiveUserId: "owner-1",
    projectId: "project-1",
    parentName: "project-1",
    role: "owner",
    iat: issuedAt,
    exp: issuedAt + 120,
    aud: "replymaven-sidechat",
    v: 1,
    scope: "child",
    conversationId: "conversation-1",
    childName: "sc_conversation-1",
    canSubmit: true,
    canApproveOnce: true,
    canAlwaysAllow: true,
  };
}

function createAgent(): InstanceType<typeof MavenProjectAgent> & {
  state: unknown;
  hasSubAgent: ReturnType<typeof mock>;
  subAgent: ReturnType<typeof mock>;
  deleteSubAgent: ReturnType<typeof mock>;
} {
  const agent = new MavenProjectAgent({} as never, {
    SIDECHAT_TOKEN_SECRET: secret,
  } as never) as ReturnType<typeof createAgent>;
  agent.state = agent.initialState;
  agent.hasSubAgent = mock(() => false);
  agent.subAgent = mock(async () => ({}));
  agent.deleteSubAgent = mock(async () => undefined);
  agent.isSidechatOperational = mock(async () => true);
  return agent;
}

describe("MavenProjectAgent child registry", () => {
  test("creates the native child before recording its summary", async () => {
    const agent = createAgent();
    const result = await agent.registerSidechat("conversation-1");

    expect(result).toEqual({
      childName: "sc_conversation-1",
      created: true,
    });
    expect(agent.subAgent).toHaveBeenCalledTimes(1);
    expect(agent.state).toEqual({
      sidechats: {
        "conversation-1": {
          conversationId: "conversation-1",
          childName: "sc_conversation-1",
          status: "idle",
          updatedAt: expect.any(Number),
        },
      },
    });
  });

  test("does not decorate state when native child creation fails", async () => {
    const agent = createAgent();
    agent.subAgent = mock(async () => {
      throw new Error("facet creation failed");
    });

    await expect(agent.registerSidechat("conversation-1")).rejects.toThrow(
      "facet creation failed",
    );
    expect(agent.state).toEqual({ sidechats: {} });
  });

  test("reports only one newly-created child across concurrent starts", async () => {
    const agent = createAgent();
    let registered = false;
    let releaseCreation: (() => void) | undefined;
    const creationGate = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });
    agent.hasSubAgent = mock(() => registered);
    agent.subAgent = mock(async () => {
      await creationGate;
      registered = true;
      return {};
    });

    const first = agent.registerSidechat("conversation-1");
    const second = agent.registerSidechat("conversation-1");
    releaseCreation?.();

    expect(await Promise.all([first, second])).toEqual([
      { childName: "sc_conversation-1", created: true },
      { childName: "sc_conversation-1", created: false },
    ]);
  });

  test("returns 404 for a guessed child without invoking subAgent", async () => {
    const agent = createAgent();
    const response = await agent.onBeforeSubAgent(
      new Request("https://app.test/agents/parent/sub/child/guessed"),
      { className: "MavenChatAgent", name: "sc_guessed" },
    );

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(404);
    expect(agent.subAgent).not.toHaveBeenCalled();
  });

  test("forwards an exact registered child with verified claims", async () => {
    const agent = createAgent();
    agent.hasSubAgent = mock(() => true);
    const token = await signSidechatToken(childClaims(), secret);
    const request = new Request(
      `https://app.test/agents/maven-project-agent/project-1/sub/maven-chat-agent/sc_conversation-1?token=${token}`,
      { headers: { Upgrade: "websocket", "Sec-WebSocket-Key": "key" } },
    );

    const result = await agent.onBeforeSubAgent(request, {
      className: "MavenChatAgent",
      name: "sc_conversation-1",
    });

    expect(result).toBeInstanceOf(Request);
    expect((result as Request).headers.get("upgrade")).toBe("websocket");
    expect((result as Request).headers.get("sec-websocket-key")).toBe("key");
  });

  test("rejects a stale writable reconnect after the conversation is archived", async () => {
    const agent = createAgent();
    agent.hasSubAgent = mock(() => true);
    agent.isSidechatOperational = mock(async () => false);
    const token = await signSidechatToken(childClaims(), secret);
    const result = await agent.onBeforeSubAgent(
      new Request(
        `https://app.test/agents/parent/sub/child/sc_conversation-1?token=${token}`,
      ),
      { className: "MavenChatAgent", name: "sc_conversation-1" },
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(409);
  });

  test("keeps the registry summary when native child deletion fails", async () => {
    const agent = createAgent();
    agent.state = {
      sidechats: {
        "conversation-1": {
          conversationId: "conversation-1",
          childName: "sc_conversation-1",
          status: "idle",
          updatedAt: 1,
        },
      },
    };
    agent.hasSubAgent = mock(() => true);
    agent.deleteSubAgent = mock(async () => {
      throw new Error("native delete failed");
    });

    await expect(agent.destroySidechat("conversation-1")).rejects.toThrow(
      "native delete failed",
    );
    expect(agent.state).toEqual({
      sidechats: {
        "conversation-1": expect.objectContaining({
          childName: "sc_conversation-1",
        }),
      },
    });
  });

  test("removes children and MCP transports before destroying project storage", async () => {
    const agent = createAgent() as ReturnType<typeof createAgent> & {
      listSubAgents: ReturnType<typeof mock>;
      getMcpServers: ReturnType<typeof mock>;
      removeMcpServer: ReturnType<typeof mock>;
      destroy: ReturnType<typeof mock>;
    };
    const events: string[] = [];
    agent.listSubAgents = mock(() => [
      { className: "MavenChatAgent", name: "sc_a", createdAt: 1 },
      { className: "MavenChatAgent", name: "sc_b", createdAt: 2 },
    ]);
    agent.deleteSubAgent = mock(async (_class, name: string) => {
      events.push(`child:${name}`);
    });
    agent.getMcpServers = mock(() => ({
      servers: { "mcp-1": {}, "mcp-2": {} },
    }));
    agent.removeMcpServer = mock(async (id: string) => {
      events.push(`mcp:${id}`);
    });
    agent.destroy = mock(async () => {
      events.push("destroy");
    });

    await agent.destroyProjectData();

    expect(events).toEqual([
      "child:sc_a",
      "child:sc_b",
      "mcp:mcp-1",
      "mcp:mcp-2",
      "destroy",
    ]);
  });
});
