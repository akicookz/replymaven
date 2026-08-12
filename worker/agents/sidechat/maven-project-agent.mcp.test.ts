import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { ConnectProjectMcpInput } from "./mcp-types";

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

  async onConnect(): Promise<void> {}
}
class FakeOAuthProvider {}
class MavenChatAgentMock {}
Object.defineProperty(MavenChatAgentMock, "name", { value: "MavenChatAgent" });

let MavenProjectAgent: typeof import("./maven-project-agent").MavenProjectAgent;

beforeAll(async () => {
  mock.module("agents", () => ({
    Agent: FakeAgent,
    DurableObjectOAuthClientProvider: FakeOAuthProvider,
  }));
  mock.module("./maven-chat-agent", () => ({
    MavenChatAgent: MavenChatAgentMock,
  }));
  ({ MavenProjectAgent } = await import("./maven-project-agent"));
});

interface NativeTool {
  serverId: string;
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

function sqlTag(database: Database) {
  return function execute<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: Array<string | number | boolean | null>
  ): T[] {
    let statement = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) {
      statement += `?${strings[index + 1] ?? ""}`;
    }
    return database.query(statement).all(...values) as T[];
  };
}

function connectInput(
  overrides: Partial<ConnectProjectMcpInput> = {},
): ConnectProjectMcpInput {
  return {
    name: "Example MCP",
    presetKey: null,
    url: "https://mcp.example.com/",
    authMode: "bearer",
    bearerToken: "private-token",
    callbackHost: "https://app.test",
    callbackPath: "/api/sidechat/mcp/oauth/project-1",
    ...overrides,
  };
}

function createAgent(options: {
  database?: Database;
  tools?: NativeTool[];
  resultState?: "ready" | "authenticating";
  failAfterNativeRegistration?: boolean;
}) {
  const database = options.database ?? new Database(":memory:");
  let tools = options.tools ?? [];
  let discoveryResult:
    | { success: true; state: "ready" }
    | { success: false; state: "connected"; error: string } = {
      success: true,
      state: "ready",
    };
  const servers: Record<string, Record<string, unknown>> = {};
  const addMcpServer = mock(
    async (
      name: string,
      url: string,
      addOptions: {
        id: string;
        transport?: { headers?: Record<string, string> };
      },
    ) => {
      const id = addOptions.id;
      const state = options.resultState ?? "ready";
      servers[id] = {
        name,
        server_url: url,
        auth_url:
          state === "authenticating"
            ? "https://provider.example.com/oauth"
            : null,
        state,
        error: null,
        instructions: null,
        capabilities: null,
      };
      if (options.failAfterNativeRegistration) {
        throw new Error(
          'Failed to discover server capabilities: {"code":-32601,"message":"Method not found"}',
        );
      }
      return state === "authenticating"
        ? {
            id,
            state,
            authUrl: "https://provider.example.com/oauth",
          }
        : { id, state };
    },
  );
  const removeMcpServer = mock(async (id: string) => {
    delete servers[id];
  });
  const mcp = {
    waitForConnections: mock(async () => undefined),
    discoverIfConnected: mock(async (serverId: string) => {
      const server = servers[serverId];
      if (server) {
        server.state = discoveryResult.state;
        server.error = discoveryResult.success ? null : discoveryResult.error;
      }
      return discoveryResult;
    }),
    listTools: mock(({ serverId }: { serverId: string }) =>
      tools.map((tool) => ({ ...tool, serverId })),
    ),
    callTool: mock(async () => ({ content: [{ type: "text", text: "private" }] })),
  };
  const agent = Object.create(MavenProjectAgent.prototype) as MavenProjectAgent;
  Object.assign(agent, {
    name: "project-1",
    sql: sqlTag(database),
    mcp,
    addMcpServer,
    removeMcpServer,
    getMcpServers() {
      return { servers, tools, prompts: [], resources: [] };
    },
  });
  return {
    agent,
    database,
    addMcpServer,
    removeMcpServer,
    mcp,
    servers,
    setTools(next: NativeTool[]) {
      tools = next;
    },
    setServerState(
      connectionId: string,
      state: string,
      error: string | null = null,
    ) {
      const server = servers[connectionId];
      if (!server) throw new Error("Missing native MCP server");
      server.state = state;
      server.error = error;
    },
    setDiscoveryResult(
      result:
        | { success: true; state: "ready" }
        | { success: false; state: "connected"; error: string },
    ) {
      discoveryResult = result;
    },
  };
}

const readTool: NativeTool = {
  serverId: "ignored-until-connected",
  name: "find_customer",
  title: "Find customer",
  description: "Find a customer",
  inputSchema: {
    type: "object",
    properties: { externalId: { type: "string" } },
  },
  annotations: { readOnlyHint: true, destructiveHint: false },
};

const writeTool: NativeTool = {
  ...readTool,
  name: "update_customer",
  title: "Update customer",
  description: "Update a customer",
  annotations: { readOnlyHint: false, destructiveHint: true },
};

describe("MavenProjectAgent native MCP connections", () => {
  test("serializes concurrent connection mutations without duplicating native state", async () => {
    const fixture = createAgent({ tools: [readTool] });
    const results = await Promise.allSettled([
      fixture.agent.connectMcp(connectInput()),
      fixture.agent.connectMcp(connectInput()),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(fixture.addMcpServer).toHaveBeenCalledTimes(1);
  });

  test("stores bearer credentials only in the native transport and defaults discovered tools to ask", async () => {
    const fixture = createAgent({ tools: [readTool] });
    const connection = await fixture.agent.connectMcp(connectInput());

    expect(fixture.addMcpServer).toHaveBeenCalledTimes(1);
    expect(fixture.addMcpServer.mock.calls[0]?.[2]).toMatchObject({
      id: connection.id,
      callbackHost: "https://app.test",
      callbackPath: "/api/sidechat/mcp/oauth/project-1",
      transport: {
        type: "auto",
        headers: { Authorization: "Bearer private-token" },
      },
    });
    expect(connection).toMatchObject({
      name: "Example MCP",
      state: "ready",
      tools: [
        {
          toolName: "find_customer",
          access: "write",
          enabled: true,
        },
      ],
    });
    const serialized = JSON.stringify(connection);
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("Authorization");
  });

  test("removes native registration when connection or discovery fails", async () => {
    const fixture = createAgent({ failAfterNativeRegistration: true });

    await expect(fixture.agent.connectMcp(connectInput())).rejects.toThrow(
      "Method not found",
    );
    expect(Object.keys(fixture.servers)).toEqual([]);
    expect(fixture.removeMcpServer).toHaveBeenCalledTimes(1);
  });

  test("returns OAuth as authenticating without inventing a provider adapter", async () => {
    const fixture = createAgent({ resultState: "authenticating" });
    const connection = await fixture.agent.connectMcp(
      connectInput({
        name: "Attio",
        presetKey: "attio",
        url: "https://mcp.attio.com/mcp",
        authMode: "oauth",
        bearerToken: undefined,
      }),
    );

    expect(connection).toMatchObject({
      presetKey: "attio",
      state: "authenticating",
      authUrl: "https://provider.example.com/oauth",
      tools: [],
    });
  });

  test("keeps pending preset OAuth registration across URL canonicalization", async () => {
    const fixture = createAgent({ resultState: "authenticating" });
    const connection = await fixture.agent.connectMcp(
      connectInput({
        name: "Stripe",
        presetKey: "stripe",
        url: "https://mcp.stripe.com/",
        authMode: "oauth",
        bearerToken: undefined,
      }),
    );

    const listed = await fixture.agent.listMcpConnections();

    expect(listed).toEqual([
      expect.objectContaining({
        id: connection.id,
        presetKey: "stripe",
        state: "authenticating",
      }),
    ]);
    expect(fixture.removeMcpServer).not.toHaveBeenCalled();
  });

  test("discovers tools when OAuth has connected the transport but not the catalog", async () => {
    const fixture = createAgent({ resultState: "authenticating" });
    const connection = await fixture.agent.connectMcp(
      connectInput({
        name: "PostHog",
        presetKey: "posthog",
        url: "https://mcp.posthog.com/mcp?readonly=true&mode=tools",
        authMode: "oauth",
        bearerToken: undefined,
      }),
    );
    fixture.setServerState(connection.id, "connected");
    fixture.setTools([readTool]);

    const [reconciled] = await fixture.agent.listMcpConnections();

    expect(fixture.mcp.discoverIfConnected).toHaveBeenCalledWith(
      connection.id,
      { timeoutMs: 30_000 },
    );
    expect(reconciled).toMatchObject({
      state: "ready",
      tools: [{ toolName: "find_customer" }],
    });
  });

  test("keeps PostHog safety read-only while defaulting permission to ask", async () => {
    const fixture = createAgent({
      tools: [{
        ...readTool,
        name: "query_events",
        annotations: undefined,
      }],
    });
    const connection = await fixture.agent.connectMcp(connectInput({
      name: "PostHog",
      presetKey: "posthog",
      url: "https://mcp.posthog.com/mcp?readonly=true&mode=tools",
      authMode: "oauth",
      bearerToken: undefined,
    }));

    expect(connection.tools).toEqual([
      expect.objectContaining({
        toolName: "query_events",
        safety: "read",
        access: "write",
        enabled: true,
        source: {
          kind: "mcp",
          name: "PostHog",
          icon: "/integrations/posthog.svg",
        },
      }),
    ]);
    const updated = await fixture.agent.updateMcpToolPolicy(connection.id, [{
      toolName: connection.tools[0]!.toolName,
      catalogFingerprint: connection.tools[0]!.catalogFingerprint,
      enabled: true,
      access: "write",
    }]);
    expect(updated?.tools[0]).toMatchObject({
      safety: "read",
      access: "write",
      enabled: true,
    });
  });

  test("never lets write or destructive tools bypass approval", async () => {
    const fixture = createAgent({ tools: [writeTool] });
    const connection = await fixture.agent.connectMcp(connectInput());
    const tool = connection.tools[0]!;

    await expect(fixture.agent.updateMcpToolPolicy(connection.id, [{
      toolName: tool.toolName,
      catalogFingerprint: tool.catalogFingerprint,
      enabled: true,
      access: "read",
    }])).rejects.toThrow("cannot bypass approval");
  });

  test("persists read, write, and destructive safety groups across wake", async () => {
    const ordinaryWriteTool: NativeTool = {
      ...writeTool,
      name: "create_customer",
      title: "Create customer",
      annotations: { readOnlyHint: false, destructiveHint: false },
    };
    const fixture = createAgent({
      tools: [readTool, ordinaryWriteTool, writeTool],
    });
    const connected = await fixture.agent.connectMcp(connectInput());

    expect(connected.tools.map((tool) => [tool.toolName, tool.safety])).toEqual([
      ["create_customer", "write"],
      ["find_customer", "read"],
      ["update_customer", "destructive"],
    ]);

    const restored = createAgent({
      database: fixture.database,
      tools: [],
    });
    Object.assign(restored.servers, fixture.servers);
    restored.setServerState(connected.id, "authenticating");
    const [afterWake] = await restored.agent.listMcpConnections();

    expect(afterWake?.tools.map((tool) => [tool.toolName, tool.safety])).toEqual([
      ["create_customer", "write"],
      ["find_customer", "read"],
      ["update_customer", "destructive"],
    ]);
  });

  test("removes legacy preset connections whose server policy changed", async () => {
    const fixture = createAgent({ tools: [readTool] });
    const legacy = await fixture.agent.connectMcp(connectInput({
      name: "PostHog",
      presetKey: "posthog",
      url: "https://mcp.posthog.com/mcp",
      authMode: "oauth",
      bearerToken: undefined,
    }));

    await expect(fixture.agent.listMcpConnections()).resolves.toEqual([]);
    expect(fixture.removeMcpServer).toHaveBeenCalledWith(legacy.id);
  });

  test("reduces a failed discovery to a safe issue without provider details", async () => {
    const fixture = createAgent({ resultState: "authenticating" });
    const connection = await fixture.agent.connectMcp(
      connectInput({
        name: "PostHog",
        presetKey: "posthog",
        url: "https://mcp.posthog.com/mcp?readonly=true&mode=tools",
        authMode: "oauth",
        bearerToken: undefined,
      }),
    );
    fixture.setServerState(connection.id, "connected");
    fixture.setDiscoveryResult({
      success: false,
      state: "connected",
      error: "provider secret details must stay private",
    });

    const [reconciled] = await fixture.agent.listMcpConnections();

    expect(reconciled).toMatchObject({
      state: "connected",
      issue: "tool_discovery_failed",
      tools: [],
    });
    expect(JSON.stringify(reconciled)).not.toContain("provider secret details");
  });

  test("preserves exact policy across wake and resets it to ask after catalog change", async () => {
    const fixture = createAgent({ tools: [readTool] });
    const connected = await fixture.agent.connectMcp(connectInput());
    const [initial] = connected.tools;
    if (!initial) throw new Error("Expected discovered tool");
    await fixture.agent.updateMcpToolPolicy(connected.id, [
      {
        toolName: initial.toolName,
        catalogFingerprint: initial.catalogFingerprint,
        enabled: true,
        access: "read",
      },
    ]);

    const restored = createAgent({
      database: fixture.database,
      tools: [readTool],
    });
    Object.assign(restored.servers, fixture.servers);
    const [afterWake] = await restored.agent.listMcpConnections();
    expect(afterWake?.tools[0]).toMatchObject({ enabled: true, access: "read" });
    expect(restored.mcp.waitForConnections).toHaveBeenCalled();

    restored.setTools([
      {
        ...readTool,
        inputSchema: {
          type: "object",
          required: ["externalId"],
          properties: { externalId: { type: "string" } },
        },
      },
    ]);
    const refreshed = await restored.agent.refreshMcpCatalog(connected.id);
    expect(refreshed?.tools[0]).toMatchObject({
      enabled: true,
      access: "write",
    });
    expect(refreshed?.tools[0]?.catalogFingerprint).not.toBe(
      initial.catalogFingerprint,
    );
  });

  test("keeps project Agent catalogs isolated and removes native state on disconnect", async () => {
    const first = createAgent({ tools: [readTool] });
    const second = createAgent({
      tools: [{ ...readTool, name: "find_issue", title: "Find issue" }],
    });
    const firstConnection = await first.agent.connectMcp(connectInput());
    const secondConnection = await second.agent.connectMcp(
      connectInput({ name: "Other MCP", url: "https://other.example.com/mcp" }),
    );

    expect((await first.agent.listMcpConnections())[0]?.tools[0]?.toolName).toBe(
      "find_customer",
    );
    expect((await second.agent.listMcpConnections())[0]?.tools[0]?.toolName).toBe(
      "find_issue",
    );
    expect(secondConnection.id).not.toBe(firstConnection.id);

    await expect(first.agent.disconnectMcp(firstConnection.id)).resolves.toBe(true);
    await expect(first.agent.listMcpConnections()).resolves.toEqual([]);
    expect(first.removeMcpServer).toHaveBeenCalledWith(firstConnection.id);
    await expect(first.agent.disconnectMcp(firstConnection.id)).resolves.toBe(false);
  });

  test("matches persistent grants exactly and invalidates them on policy, catalog, and disconnect changes", async () => {
    const fixture = createAgent({ tools: [writeTool] });
    const connection = await fixture.agent.connectMcp(connectInput());
    const discovered = connection.tools[0];
    if (!discovered) throw new Error("Expected discovered write tool");
    await fixture.agent.updateMcpToolPolicy(connection.id, [{
      toolName: discovered.toolName,
      catalogFingerprint: discovered.catalogFingerprint,
      enabled: true,
      access: "write",
    }]);
    fixture.database.query(`
      INSERT INTO sidechat_always_allow_grants (
        connection_id, tool_name, catalog_fingerprint, access,
        granted_by, created_at
      ) VALUES (?, ?, ?, 'write', 'owner-1', 1)
    `).run(connection.id, discovered.toolName, discovered.catalogFingerprint);

    expect((await fixture.agent.listMcpConnections())[0]?.tools[0]).toMatchObject({
      enabled: true,
      access: "write",
      alwaysAllowed: true,
    });

    await fixture.agent.updateMcpToolPolicy(connection.id, [{
      toolName: discovered.toolName,
      catalogFingerprint: discovered.catalogFingerprint,
      enabled: false,
      access: "write",
    }]);
    expect(fixture.database.query(
      "SELECT * FROM sidechat_always_allow_grants",
    ).all()).toEqual([]);

    await fixture.agent.updateMcpToolPolicy(connection.id, [{
      toolName: discovered.toolName,
      catalogFingerprint: discovered.catalogFingerprint,
      enabled: true,
      access: "write",
    }]);
    fixture.database.query(`
      INSERT INTO sidechat_always_allow_grants (
        connection_id, tool_name, catalog_fingerprint, access,
        granted_by, created_at
      ) VALUES (?, ?, ?, 'write', 'owner-1', 2)
    `).run(connection.id, discovered.toolName, discovered.catalogFingerprint);
    fixture.setTools([{
      ...writeTool,
      inputSchema: {
        type: "object",
        required: ["externalId"],
        properties: { externalId: { type: "string" } },
      },
    }]);
    const changed = await fixture.agent.refreshMcpCatalog(connection.id);
    expect(changed?.tools[0]?.alwaysAllowed).toBe(false);
    expect(fixture.database.query(
      "SELECT * FROM sidechat_always_allow_grants",
    ).all()).toEqual([]);

    const current = changed?.tools[0];
    if (!current) throw new Error("Expected refreshed write tool");
    await fixture.agent.updateMcpToolPolicy(connection.id, [{
      toolName: current.toolName,
      catalogFingerprint: current.catalogFingerprint,
      enabled: true,
      access: "write",
    }]);
    fixture.database.query(`
      INSERT INTO sidechat_always_allow_grants (
        connection_id, tool_name, catalog_fingerprint, access,
        granted_by, created_at
      ) VALUES (?, ?, ?, 'write', 'owner-1', 3)
    `).run(connection.id, current.toolName, current.catalogFingerprint);
    await expect(fixture.agent.disconnectMcp(connection.id)).resolves.toBe(true);
    expect(fixture.database.query(
      "SELECT * FROM sidechat_always_allow_grants",
    ).all()).toEqual([]);
  });
});
