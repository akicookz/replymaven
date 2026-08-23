import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schema } from "./db";
import { registerSidechatTools } from "./mcp-sidechat-tools";
import type { McpRequestContext } from "./mcp-tool-helpers";
import type { McpOAuthScope } from "./services/mcp-oauth-service";
import type { StartSidechatTurnResult } from "./services/start-sidechat-turn";
import type { SidechatStatusView } from "./services/sidechat-status";

type ToolResult = { content: Array<{ type: string; text: string }> };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

function createTestDb(): DrizzleD1Database<Record<string, unknown>> {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(`CREATE TABLE projects (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    domain text,
    onboarded integer DEFAULT 0 NOT NULL,
    created_at integer DEFAULT (unixepoch()) NOT NULL,
    updated_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  sqlite.exec(
    "INSERT INTO projects (id, user_id, name, slug) VALUES " +
      "('project-1', 'owner-1', 'Acme', 'acme')",
  );
  return drizzleSqlite(sqlite, { schema }) as unknown as DrizzleD1Database<
    Record<string, unknown>
  >;
}

function createHarness(options?: {
  scopes?: McpOAuthScope[];
  operational?: boolean;
  startResult?: StartSidechatTurnResult;
  status?: SidechatStatusView | null;
}) {
  const starts: Array<Record<string, unknown>> = [];
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _def: unknown, handler: ToolHandler) {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  const context = {
    db: createTestDb(),
    conversationStore: {
      async getOperational() {
        return options?.operational === false
          ? null
          : {
              id: "conv-1",
              visitorId: "visitor-1",
              visitorEmail: null,
              metadata: {},
            };
      },
    },
    env: {},
    userId: "owner-1",
    userName: "Owner",
    effectiveUserId: "owner-1",
    activeRole: "owner",
    activeAccessAllProjects: true,
    activeProjectIds: null,
    scopes: options?.scopes ?? ["conversations:reply"],
  } as unknown as McpRequestContext;

  registerSidechatTools(server, context, {
    async startSidechatTurn(input) {
      starts.push(input);
      return options?.startResult ?? {
        accepted: true,
        status: "working",
      };
    },
    async getSidechatStatus() {
      return options?.status ?? {
        status: "ready",
        hasDraft: true,
        waitingApproval: false,
      };
    },
  });

  return { tools, starts };
}

async function call(
  tools: Map<string, ToolHandler>,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const handler = tools.get(name);
  if (!handler) throw new Error(`Tool not registered: ${name}`);
  const result = await handler({ confirm: true, ...input });
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe("MCP Sidechat tools", () => {
  test("registers ask_maven and get_sidechat_status", () => {
    const { tools } = createHarness();
    expect([...tools.keys()].sort()).toEqual([
      "ask_maven",
      "get_sidechat_status",
    ]);
  });

  test("ask_maven requires conversations:reply and starts a turn", async () => {
    const denied = createHarness({ scopes: ["projects:read"] });
    await expect(call(denied.tools, "ask_maven", {
      projectId: "project-1",
      conversationId: "conv-1",
      text: "check his billing",
    })).rejects.toThrow("missing required scope: conversations:reply");

    const { tools, starts } = createHarness();
    await expect(call(tools, "ask_maven", {
      projectId: "project-1",
      conversationId: "conv-1",
      text: "check his billing",
    })).resolves.toEqual({
      ok: true,
      accepted: true,
      status: "working",
      confirmation: "Maven is looking into that.",
    });
    expect(starts).toEqual([{
      projectId: "project-1",
      conversationId: "conv-1",
      text: "check his billing",
      actorUserId: "owner-1",
      origin: "mcp",
      env: {},
    }]);
  });

  test("ask_maven confirms busy without starting a second turn", async () => {
    const { tools } = createHarness({
      startResult: { accepted: false, reason: "busy" },
    });
    await expect(call(tools, "ask_maven", {
      projectId: "project-1",
      conversationId: "conv-1",
      text: "check his billing",
    })).resolves.toEqual({
      ok: true,
      accepted: false,
      confirmation: "Maven is already working on this.",
    });
  });

  test("get_sidechat_status returns status flags and no transcript", async () => {
    const { tools } = createHarness({
      status: {
        status: "waiting_approval",
        hasDraft: false,
        waitingApproval: true,
      },
    });
    const body = await call(tools, "get_sidechat_status", {
      projectId: "project-1",
      conversationId: "conv-1",
    });
    expect(body).toEqual({
      status: "waiting_approval",
      hasDraft: false,
      waitingApproval: true,
    });
    expect(JSON.stringify(body)).not.toContain("present_reply_draft");
    expect(JSON.stringify(body)).not.toContain("data-reply-draft");
  });
});
