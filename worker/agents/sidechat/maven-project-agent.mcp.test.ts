import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { ConnectProjectMcpInput } from "./mcp-types";

class FakeAgent {}
class MavenChatAgentMock {}
Object.defineProperty(MavenChatAgentMock, "name", { value: "MavenChatAgent" });

let MavenProjectAgent: typeof import("./maven-project-agent").MavenProjectAgent;

beforeAll(async () => {
  mock.module("agents", () => ({ Agent: FakeAgent }));
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
}) {
  const database = options.database ?? new Database(":memory:");
  let tools = options.tools ?? [];
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
    discoverIfConnected: mock(async () => ({ success: true, state: "ready" })),
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

  test("stores bearer credentials only in the native transport and disables discovered tools", async () => {
    const fixture = createAgent({ tools: [readTool] });
    const connection = await fixture.agent.connectMcp(connectInput());

    expect(fixture.addMcpServer).toHaveBeenCalledTimes(1);
    expect(fixture.addMcpServer.mock.calls[0]?.[2]).toMatchObject({
      id: connection.id,
      callbackHost: "https://app.test",
      callbackPath: "/api/sidechat/mcp/oauth/project-1",
      transport: {
        type: "streamable-http",
        headers: { Authorization: "Bearer private-token" },
      },
    });
    expect(connection).toMatchObject({
      name: "Example MCP",
      state: "ready",
      tools: [
        {
          toolName: "find_customer",
          access: "read",
          enabled: false,
        },
      ],
    });
    const serialized = JSON.stringify(connection);
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("Authorization");
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

  test("preserves exact policy across wake and disables it after catalog change", async () => {
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
      enabled: false,
      access: "read",
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
});
