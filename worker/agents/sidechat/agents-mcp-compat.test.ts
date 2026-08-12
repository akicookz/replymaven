import { beforeAll, describe, expect, mock, test } from "bun:test";

let MCPClientManager: typeof import("agents/mcp/client").MCPClientManager;

beforeAll(async () => {
  mock.module("cloudflare:workers", () => ({
    DurableObject: class DurableObject {},
    RpcTarget: class RpcTarget {},
    WorkerEntrypoint: class WorkerEntrypoint {},
    env: {},
    exports: {},
  }));
  ({ MCPClientManager } = await import("agents/mcp/client"));
});

interface TestMcpConnection {
  connectionState: string;
  client: {
    getServerCapabilities(): Record<string, unknown>;
    getInstructions(): string | undefined;
    listTools(): Promise<{
      tools: Array<{
        name: string;
        inputSchema: { type: "object" };
      }>;
    }>;
    listResources(): Promise<never>;
    listResourceTemplates(): Promise<never>;
    listPrompts(): Promise<never>;
  };
}

interface TestMcpManager {
  createConnection(
    id: string,
    url: string,
    options: { transport: { type: "auto" } },
  ): TestMcpConnection;
}

function createStorage(): DurableObjectStorage {
  return {
    sql: {
      exec() {
        return [];
      },
    },
  } as unknown as DurableObjectStorage;
}

describe("Cloudflare Agents MCP compatibility", () => {
  test("treats embedded -32601 responses from optional catalogs as empty", async () => {
    const manager = new MCPClientManager("ReplyMaven", "1.0.0", {
      storage: createStorage(),
    });
    const connection = (manager as unknown as TestMcpManager).createConnection(
      "posthog",
      "https://mcp.posthog.com/mcp?readonly=true&mode=tools",
      { transport: { type: "auto" } },
    );
    const optionalMethodError = new Error(
      'Error POSTing to endpoint: {"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"Method not found"}}',
    );
    connection.connectionState = "connected";
    connection.client = {
      getServerCapabilities() {
        return { tools: {}, resources: {}, prompts: {} };
      },
      getInstructions() {
        return undefined;
      },
      async listTools() {
        return {
          tools: [{ name: "query_events", inputSchema: { type: "object" } }],
        };
      },
      async listResources() {
        throw optionalMethodError;
      },
      async listResourceTemplates() {
        throw optionalMethodError;
      },
      async listPrompts() {
        throw optionalMethodError;
      },
    };

    await expect(manager.discoverIfConnected("posthog")).resolves.toMatchObject({
      success: true,
      state: "ready",
    });
    expect(manager.listTools({ serverId: "posthog" })).toEqual([
      expect.objectContaining({ name: "query_events" }),
    ]);
  });
});
