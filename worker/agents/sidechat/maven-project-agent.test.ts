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
} {
  const agent = new MavenProjectAgent({} as never, {
    SIDECHAT_TOKEN_SECRET: secret,
  } as never) as ReturnType<typeof createAgent>;
  agent.state = agent.initialState;
  agent.hasSubAgent = mock(() => false);
  agent.subAgent = mock(async () => ({}));
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
});
