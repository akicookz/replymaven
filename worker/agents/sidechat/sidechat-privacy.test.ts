import { describe, expect, test } from "bun:test";
import { handleGetProjectMcp } from "../../routes/project-mcp-handlers";

const root = new URL("../../../", import.meta.url);

async function read(path: string): Promise<string> {
  return Bun.file(new URL(path, root)).text();
}

describe("native Sidechat privacy boundary", () => {
  test("does not add private transcript storage to D1", async () => {
    const schema = await read("worker/db/schema.ts");
    expect(schema).not.toMatch(/sidechat_(?:messages|runs|leases|revisions)/u);
    expect(schema).not.toContain("reply_draft");
  });

  test("does not route private Agent events through public realtime or widget code", async () => {
    const [realtime, durableObject, widget] = await Promise.all([
      read("worker/realtime/broadcast.ts"),
      read("worker/durable-objects/conversation-do.ts"),
      read("widget/index.ts"),
    ]);
    for (const source of [realtime, durableObject, widget]) {
      expect(source).not.toContain("MavenChatAgent");
      expect(source).not.toContain("data-reply-draft");
      expect(source).not.toContain("data-safe-activity");
      expect(source).not.toContain("sidechat:status");
    }
  });

  test("does not expose Sidechat through inbound public MCP, Telegram, or email", async () => {
    const [mcp, telegram, email] = await Promise.all([
      read("worker/mcp-server.ts"),
      read("worker/services/telegram-service.ts"),
      read("worker/services/email-service.ts"),
    ]);
    for (const source of [mcp, telegram, email]) {
      expect(source).not.toContain("MavenChatAgent");
      expect(source).not.toContain("data-reply-draft");
      expect(source).not.toContain("data-safe-activity");
    }
  });

  test("keeps native route JSON bounded to safe session and connection views", async () => {
    const sessionRoutes = await read("worker/routes/sidechat-agent-handlers.ts");
    expect(sessionRoutes).not.toContain("getPrivateTranscriptSnapshot");
    expect(sessionRoutes).not.toContain("toolOutput");

    const response = await handleGetProjectMcp({
      actor: {
        userId: "owner-1",
        effectiveUserId: "owner-1",
        role: "owner",
        accessAllProjects: true,
        projectIds: null,
      },
      projectId: "project-1",
      projectService: {
        getProjectById: async () => ({ id: "project-1", userId: "owner-1" }),
      },
      getParent: async () => ({
        listMcpConnections: async () => [{
          id: "mcp-1",
          name: "Private MCP",
          presetKey: null,
          url: "https://mcp.example.test",
          authMode: "bearer",
          state: "ready",
          tools: [],
          bearerToken: "provider-secret",
          headers: { Authorization: "provider-secret" },
          toolOutput: { private: true },
        } as never],
      } as never),
    });
    const body = await response.text();
    expect(body).not.toContain("provider-secret");
    expect(body).not.toContain("toolOutput");
    const parsed = JSON.parse(body) as {
      canManage: boolean;
      presets: unknown[];
      connections: unknown[];
    };
    expect(parsed.canManage).toBe(true);
    expect(parsed.presets.length).toBeGreaterThan(0);
    expect(parsed.connections).toEqual([{
        id: "mcp-1",
        name: "Private MCP",
        presetKey: null,
        url: "https://mcp.example.test",
        authMode: "bearer",
        state: "ready",
        tools: [],
    }]);
  });
});
