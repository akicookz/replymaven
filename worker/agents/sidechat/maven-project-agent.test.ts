import { beforeAll, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { SidechatChildClaims } from "../../../shared/sidechat-agent";
import type { SidechatToolDescriptor } from "../../../shared/sidechat-agent";
import { encodeSidechatToolRef } from "./project-tool-gateway";

const secret = "task-2-test-secret-with-at-least-32-bytes";

class FakeAgent {
  ctx: unknown;
  env: Record<string, unknown>;
  name = "project-1";
  state: unknown;
  mcp = { configureOAuthCallback: mock(() => undefined) };

  constructor(ctx: unknown, env: Record<string, unknown>) {
    this.ctx = ctx;
    this.env = env;
  }

  setState(state: unknown): void {
    this.state = state;
  }

  broadcast(): void {}

  async onConnect(): Promise<void> {}
}

class FakeOAuthProvider {}

class MavenChatAgentMock {}
Object.defineProperty(MavenChatAgentMock, "name", { value: "MavenChatAgent" });

let MavenProjectAgent: typeof import("./maven-project-agent").MavenProjectAgent;
let signSidechatToken: typeof import("./agent-auth").signSidechatToken;

beforeAll(async () => {
  mock.module("agents", () => ({
    Agent: FakeAgent,
    DurableObjectOAuthClientProvider: FakeOAuthProvider,
  }));
  mock.module("../maven/maven-chat-agent", () => ({
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

function createAgent(
  database = new Database(":memory:"),
): InstanceType<typeof MavenProjectAgent> & {
  state: unknown;
  hasSubAgent: ReturnType<typeof mock>;
  subAgent: ReturnType<typeof mock>;
  deleteSubAgent: ReturnType<typeof mock>;
} {
  const agent = new MavenProjectAgent({
    storage: {
      sql: {
        exec<T>(query: string, ...bindings: Array<string | number | null>) {
          const rows = database.query(query).all(...bindings) as T[];
          return { toArray: () => rows };
        },
      },
    },
  } as never, {
    SIDECHAT_TOKEN_SECRET: secret,
    ENCRYPTION_KEY: "11".repeat(32),
  } as never) as ReturnType<typeof createAgent>;
  Object.assign(agent, {
    sql<T>(
      strings: TemplateStringsArray,
      ...bindings: Array<string | number | boolean | null>
    ): T[] {
      return database.query(strings.join("?")).all(...bindings) as T[];
    },
  });
  agent.state = agent.initialState;
  agent.hasSubAgent = mock(() => false);
  agent.subAgent = mock(async () => ({}));
  agent.deleteSubAgent = mock(async () => undefined);
  agent.isSidechatOperational = mock(async () => true);
  return agent;
}

describe("MavenProjectAgent child registry", () => {
  test("stages encrypted write input and consumes it once after reconstruction", async () => {
    const database = new Database(":memory:");
    const descriptor: SidechatToolDescriptor = {
      connectionId: "mcp-linear",
      toolName: "create_issue",
      exposedName: "tool_mcplinear_create_issue",
      displayName: "Create issue",
      description: "Create a Linear issue.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["token"],
        properties: {
          token: { type: "string" },
        },
      },
      catalogFingerprint: "f".repeat(64),
      audience: "sidechat",
      safety: "write",
      access: "write",
      enabled: true,
    };
    const toolRef = encodeSidechatToolRef(descriptor);
    const first = createAgent(database);
    Object.assign(first, {
      canUseSidechatGateway: mock(async () => true),
      resolveSidechatToolDescriptor: mock(async () => descriptor),
    });

    await expect(first.stageProjectToolApproval({
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      actorUserId: "user-1",
      toolCallId: "tool-call-1",
      toolRef,
      argumentsJson: '{"token":"original-secret"}',
    })).resolves.toBe(true);

    const stored = database.query(
      "SELECT ciphertext, created_at, expires_at FROM sidechat_tool_approval_payloads",
    ).get() as {
      ciphertext: string;
      created_at: number;
      expires_at: number;
    };
    expect(stored.ciphertext).not.toContain("original-secret");
    expect(stored.expires_at - stored.created_at).toBe(24 * 60 * 60 * 1_000);

    const reconstructed = createAgent(database);
    const executeResolvedProjectTool = mock(async () => ({
      status: "completed" as const,
      output: { ok: true },
      safeActivity: "Done",
    }));
    Object.assign(reconstructed, {
      resolveSidechatToolDescriptor: mock(async () => descriptor),
      executeResolvedProjectTool,
    });
    const request = {
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      actorUserId: "user-1",
      toolCallId: "tool-call-1",
      toolRef,
      argumentsJson: '{"token":"[redacted]"}',
      approvalMode: "once" as const,
      approvedOnce: true,
    };

    await expect(reconstructed.executeProjectTool(request)).resolves
      .toMatchObject({ status: "completed" });
    expect(executeResolvedProjectTool).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { token: "original-secret" },
        approvalMode: "once",
      }),
    );
    await expect(reconstructed.executeProjectTool(request)).resolves.toEqual({
      status: "denied",
      safeActivity: "Tool unavailable",
      errorCode: "approval_payload_unavailable",
    });
  });

  test("fails closed for conflicting, expired, mismatched, and corrupt staged input", async () => {
    const database = new Database(":memory:");
    const descriptor: SidechatToolDescriptor = {
      connectionId: "mcp-linear",
      toolName: "create_issue",
      exposedName: "tool_mcplinear_create_issue",
      displayName: "Create issue",
      description: "Create a Linear issue.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: {
          title: { type: "string" },
        },
      },
      catalogFingerprint: "f".repeat(64),
      audience: "sidechat",
      safety: "write",
      access: "write",
      enabled: true,
    };
    const toolRef = encodeSidechatToolRef(descriptor);
    const agent = createAgent(database);
    Object.assign(agent, {
      canUseSidechatGateway: mock(async () => true),
      resolveSidechatToolDescriptor: mock(async () => descriptor),
      executeResolvedProjectTool: mock(async () => ({
        status: "completed" as const,
        safeActivity: "Done",
      })),
    });
    const staged = {
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      actorUserId: "user-1",
      toolCallId: "tool-call-2",
      toolRef,
      argumentsJson: '{"title":"Original"}',
    };

    await expect(agent.stageProjectToolApproval(staged)).resolves.toBe(true);
    await expect(agent.stageProjectToolApproval(staged)).resolves.toBe(true);
    await expect(agent.stageProjectToolApproval({
      ...staged,
      argumentsJson: '{"title":"Conflicting"}',
    })).resolves.toBe(false);
    const concurrent = {
      ...staged,
      toolCallId: "concurrent-call",
    };
    await expect(Promise.all([
      agent.stageProjectToolApproval(concurrent),
      agent.stageProjectToolApproval(concurrent),
    ])).resolves.toEqual([true, true]);

    const execute = (overrides: Partial<typeof staged> = {}) =>
      agent.executeProjectTool({
        ...staged,
        ...overrides,
        argumentsJson: '{"title":"[redacted]"}',
        approvalMode: "once",
        approvedOnce: true,
      });

    await expect(execute({ actorUserId: "other-user" })).resolves.toMatchObject({
      status: "denied",
      errorCode: "approval_payload_unavailable",
    });
    await expect(execute()).resolves.toMatchObject({ status: "completed" });

    await agent.stageProjectToolApproval({
      ...staged,
      toolCallId: "expired-call",
    });
    database.query(
      "UPDATE sidechat_tool_approval_payloads SET expires_at = 0 WHERE tool_call_id = ?",
    ).run("expired-call");
    await expect(execute({ toolCallId: "expired-call" })).resolves.toMatchObject({
      status: "denied",
      errorCode: "approval_payload_unavailable",
    });

    await agent.stageProjectToolApproval({
      ...staged,
      toolCallId: "corrupt-call",
    });
    database.query(
      "UPDATE sidechat_tool_approval_payloads SET ciphertext = ? WHERE tool_call_id = ?",
    ).run("not-ciphertext", "corrupt-call");
    await expect(execute({ toolCallId: "corrupt-call" })).resolves.toMatchObject({
      status: "denied",
      errorCode: "approval_payload_unavailable",
    });
  });

  test("grants always-allow only when the exact pending payload is staged", async () => {
    const descriptor: SidechatToolDescriptor = {
      connectionId: "mcp-linear",
      toolName: "create_issue",
      exposedName: "tool_mcplinear_create_issue",
      displayName: "Create issue",
      description: "Create a Linear issue.",
      inputSchema: { type: "object", additionalProperties: true },
      catalogFingerprint: "f".repeat(64),
      audience: "sidechat",
      safety: "write",
      access: "write",
      enabled: true,
    };
    const toolRef = encodeSidechatToolRef(descriptor);
    const agent = createAgent();
    Object.assign(agent, {
      assertRegisteredSidechat: mock(() => undefined),
      canUseSidechatGateway: mock(async () => true),
      canActorAccessProject: mock(async () => true),
      resolveSidechatToolDescriptor: mock(async () => descriptor),
      conversationDirectory: mock(() => ({
        getConversation: () => ({ archivedAt: null }),
      })),
      subAgent: mock(async () => ({
        getPendingApprovalScope: async (
          approvalId: string,
          toolCallId: string,
        ) => ({
          approvalId,
          toolCallId,
          toolRef,
        }),
      })),
    });

    await expect(agent.grantAlwaysForPendingApproval(
      "conversation-1",
      "user-1",
      "approval-1",
      "missing-call",
    )).resolves.toBe(false);

    await agent.stageProjectToolApproval({
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      actorUserId: "user-1",
      toolCallId: "staged-call",
      toolRef,
      argumentsJson: "{}",
    });
    await expect(agent.grantAlwaysForPendingApproval(
      "conversation-1",
      "user-1",
      "approval-2",
      "staged-call",
    )).resolves.toBe(true);
  });

  test("derives authoritative execution identity from the gateway reference", async () => {
    const agent = createAgent();
    const executeResolvedProjectTool = mock(async () => ({
      status: "completed" as const,
      output: { ok: true },
      safeActivity: "Done",
    }));
    Object.assign(agent, { executeResolvedProjectTool });
    const descriptor: SidechatToolDescriptor = {
      connectionId: "mcp-linear",
      toolName: "create_issue",
      exposedName: "tool_mcplinear_create_issue",
      displayName: "Create issue",
      description: "Create a Linear issue.",
      inputSchema: { type: "object" },
      catalogFingerprint: "f".repeat(64),
      audience: "sidechat",
      safety: "read",
      access: "read",
      enabled: true,
    };
    Object.assign(agent, {
      resolveSidechatToolDescriptor: mock(async () => descriptor),
    });

    const result = await agent.executeProjectTool({
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      actorUserId: "user-1",
      toolCallId: "read-call",
      toolRef: encodeSidechatToolRef(descriptor),
      argumentsJson: '{"title":"Checkout failed"}',
      approvalMode: "none",
      approvedOnce: false,
    });

    expect(result.status).toBe("completed");
    expect(executeResolvedProjectTool).toHaveBeenCalledWith({
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      actorUserId: "user-1",
      connectionId: "mcp-linear",
      toolName: "create_issue",
      catalogFingerprint: "f".repeat(64),
      safety: "read",
      access: "read",
      approvalMode: "none",
      input: { title: "Checkout failed" },
    });
  });

  test("rejects malformed gateway references before project execution", async () => {
    const agent = createAgent();
    const executeResolvedProjectTool = mock(async () => {
      throw new Error("must not execute");
    });
    Object.assign(agent, { executeResolvedProjectTool });

    await expect(agent.executeProjectTool({
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      actorUserId: "user-1",
      toolRef: "sct1.invalid",
      argumentsJson: "{}",
      approvalMode: "none",
    })).resolves.toEqual({
      status: "denied",
      safeActivity: "Tool unavailable",
      errorCode: "tool_unavailable",
    });
    expect(executeResolvedProjectTool).not.toHaveBeenCalled();
  });

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

  test("keeps the complete registry in SQL and broadcasts only the changed Sidechat", async () => {
    const agent = createAgent();
    const nativeChildren = new Set<string>();
    agent.hasSubAgent = mock((_class, name: string) =>
      nativeChildren.has(name),
    );
    agent.subAgent = mock(async (_class, name: string) => {
      nativeChildren.add(name);
      return {};
    });

    await agent.registerSidechat("conversation-1");
    await agent.registerSidechat("conversation-2");

    expect(Object.keys(agent.state as Record<string, unknown>)).toEqual([
      "sidechats",
    ]);
    expect((agent.state as { sidechats: Record<string, unknown> }).sidechats)
      .toEqual({
        "conversation-2": expect.objectContaining({
          childName: "sc_conversation-2",
        }),
      });
    expect(await agent.getSidechatSummaries()).toEqual([
      expect.objectContaining({ conversationId: "conversation-2" }),
      expect.objectContaining({ conversationId: "conversation-1" }),
    ]);
  });

  test("migrates the legacy in-state registry into directory SQL", async () => {
    const agent = createAgent();
    agent.state = {
      sidechats: {
        "conversation-1": {
          conversationId: "conversation-1",
          childName: "sc_conversation-1",
          status: "ready",
          updatedAt: 123,
        },
      },
    };
    agent.hasSubAgent = mock(() => true);

    expect(await agent.getSidechatSummaries()).toEqual([
      {
        conversationId: "conversation-1",
        childName: "sc_conversation-1",
        status: "ready",
        updatedAt: 123,
      },
    ]);
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
