import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { schema } from "../db";
import { ToolService } from "./tool-service";

function createToolServiceHarness(): { service: ToolService; sqlite: Database } {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE projects (id text PRIMARY KEY NOT NULL);
    CREATE TABLE tools (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      name text NOT NULL,
      display_name text NOT NULL,
      description text NOT NULL,
      endpoint text NOT NULL,
      method text NOT NULL DEFAULT 'POST',
      headers text,
      parameters text NOT NULL DEFAULT '[]',
      response_mapping text,
      enabled integer NOT NULL DEFAULT 1,
      timeout integer NOT NULL DEFAULT 10000,
      sort_order integer NOT NULL DEFAULT 0,
      allowed_channels text NOT NULL DEFAULT '["public"]',
      access text NOT NULL DEFAULT 'read',
      schema_fingerprint text NOT NULL DEFAULT 'legacy-v1',
      created_at integer NOT NULL DEFAULT (unixepoch()),
      updated_at integer NOT NULL DEFAULT (unixepoch())
    );
    INSERT INTO projects (id) VALUES ('project-1'), ('project-2');
    INSERT INTO tools (id, project_id, name, display_name, description, endpoint, enabled, sort_order, allowed_channels)
      VALUES
        ('public-tool', 'project-1', 'public_tool', 'Public tool', 'Public', 'https://example.com/public', 1, 1, '["public"]'),
        ('sidechat-tool', 'project-1', 'sidechat_tool', 'Sidechat tool', 'Sidechat', 'https://example.com/sidechat', 1, 2, '["sidechat"]'),
        ('shared-tool', 'project-1', 'shared_tool', 'Shared tool', 'Shared', 'https://example.com/shared', 1, 3, '["public","sidechat"]'),
        ('disabled-tool', 'project-1', 'disabled_tool', 'Disabled tool', 'Disabled', 'https://example.com/disabled', 0, 4, '["public"]'),
        ('malformed-tool', 'project-1', 'malformed_tool', 'Malformed tool', 'Malformed', 'https://example.com/malformed', 1, 5, 'not-json'),
        ('legacy-search-collision', 'project-1', 'search_knowledge', 'Legacy search collision', 'Collision', 'https://example.com/search', 1, 6, '["public","sidechat"]'),
        ('legacy-team-collision', 'project-1', 'request_team_help', 'Legacy team collision', 'Collision', 'https://example.com/team', 1, 7, '["public"]'),
        ('invalid-contract', 'project-1', 'bad name', 'Invalid contract', '', 'https://example.com/invalid', 1, 8, '["sidechat"]'),
        ('other-project-tool', 'project-2', 'other_tool', 'Other tool', 'Other', 'https://example.com/other', 1, 1, '["public"]');
    CREATE TABLE tool_executions (
      id text PRIMARY KEY NOT NULL,
      tool_id text NOT NULL,
      conversation_id text,
      message_id text,
      input text,
      output text,
      status text NOT NULL,
      http_status integer,
      duration integer,
      error_message text,
      created_at integer NOT NULL DEFAULT (unixepoch())
    );
  `);
  const db = drizzleSqlite(sqlite, { schema });

  return {
    service: new ToolService(
      db as unknown as DrizzleD1Database<Record<string, unknown>>,
    ),
    sqlite,
  };
}

function createToolService(): ToolService {
  return createToolServiceHarness().service;
}

describe("ToolService Maven audience policy", () => {
  test("returns only enabled tools authorized for the requested channel", async () => {
    const service = createToolService();

    const publicTools = await service.getEnabledToolsForChannel(
      "project-1",
      "public",
    );
    const sidechatTools = await service.getEnabledToolsForChannel(
      "project-1",
      "sidechat",
    );

    expect(publicTools.map((tool) => tool.id)).toEqual([
      "public-tool",
      "shared-tool",
    ]);
    expect(sidechatTools.map((tool) => tool.id)).toEqual([
      "sidechat-tool",
      "shared-tool",
    ]);
  });

  test("fails closed for malformed persisted audiences", async () => {
    const service = createToolService();

    const tools = await service.getEnabledToolsForChannel("project-1", "public");

    expect(tools.map((tool) => tool.id)).not.toContain("malformed-tool");
  });

  test("fails closed for malformed persisted model contracts", async () => {
    const service = createToolService();

    const tools = await service.getEnabledToolsForChannel(
      "project-1",
      "sidechat",
    );

    expect(tools.map((tool) => tool.id)).not.toContain("invalid-contract");
  });

  test("omits legacy rows that collide with internal Maven tools", async () => {
    const service = createToolService();

    const publicTools = await service.getEnabledToolsForChannel(
      "project-1",
      "public",
    );
    const sidechatTools = await service.getEnabledToolsForChannel(
      "project-1",
      "sidechat",
    );

    expect(publicTools.map((tool) => tool.id)).not.toContain(
      "legacy-search-collision",
    );
    expect(publicTools.map((tool) => tool.id)).not.toContain(
      "legacy-team-collision",
    );
    expect(sidechatTools.map((tool) => tool.id)).not.toContain(
      "legacy-search-collision",
    );
  });

  test("retrieves an authoritative tool only from its project", async () => {
    const service = createToolService();

    expect(
      await service.getAuthoritativeTool("project-1", "public-tool"),
    ).toMatchObject({ id: "public-tool", allowedChannels: '["public"]' });
    expect(
      await service.getAuthoritativeTool("project-2", "public-tool"),
    ).toBeNull();
  });

  test("updates every authoritative policy field", async () => {
    const service = createToolService();

    const updated = await service.updateTool("public-tool", "project-1", {
      allowedChannels: ["sidechat"],
      access: "write",
      schemaFingerprint: "schema-v2",
    });

    expect(updated).toMatchObject({
      allowedChannels: '["sidechat"]',
      access: "write",
      schemaFingerprint: "schema-v2",
    });
  });

  test("serializes validated audiences immediately before creating a tool", async () => {
    const service = createToolService();

    const created = await service.createTool({
      projectId: "project-1",
      name: "created_sidechat_tool",
      displayName: "Created sidechat tool",
      description: "Created with a typed audience.",
      endpoint: "https://example.com/created-sidechat",
      allowedChannels: ["sidechat"],
    });

    expect(created.allowedChannels).toBe('["sidechat"]');
  });

  test("rejects unvalidated audience values before writing tools", async () => {
    const service = createToolService();

    await expect(
      service.createTool({
        projectId: "project-1",
        name: "invalid_created_tool",
        displayName: "Invalid created tool",
        description: "Must not persist an unvalidated audience.",
        endpoint: "https://example.com/invalid-created",
        allowedChannels: "not-json" as never,
      }),
    ).rejects.toThrow();
    await expect(
      service.updateTool("public-tool", "project-1", {
        allowedChannels: "not-json" as never,
      }),
    ).rejects.toThrow();
    expect(
      await service.getAuthoritativeTool("project-1", "public-tool"),
    ).toMatchObject({ allowedChannels: '["public"]' });
  });

  test("rejects reserved names at the service boundary", async () => {
    const service = createToolService();

    await expect(
      service.createTool({
        projectId: "project-1",
        name: "request_team_help",
        displayName: "Collision",
        description: "Must not shadow an internal tool.",
        endpoint: "https://example.com/collision",
      }),
    ).rejects.toThrow("reserved");
  });

  test("links only this turn's execution ids to the persisted bot message", async () => {
    const { service, sqlite } = createToolServiceHarness();
    const first = await service.logExecution({
      toolId: "public-tool",
      conversationId: "conversation-1",
      input: { orderId: "order-1" },
      output: { ok: true },
      status: "success",
      httpStatus: 200,
      duration: 12,
    });
    const interrupted = await service.logExecution({
      toolId: "public-tool",
      conversationId: "conversation-1",
      input: { orderId: "order-old" },
      output: { ok: true },
      status: "success",
      httpStatus: 200,
      duration: 9,
    });
    const linkExactExecutions = service.linkExecutionsToMessage.bind(
      service,
    ) as unknown as (
      executionIds: string[],
      conversationId: string,
      messageId: string,
    ) => Promise<void>;

    await linkExactExecutions(
      [first.id],
      "conversation-1",
      "message-1",
    );

    const rows = sqlite
      .query("SELECT id, message_id FROM tool_executions ORDER BY id")
      .all() as Array<{ id: string; message_id: string | null }>;
    expect(rows.find((row) => row.id === first.id)?.message_id).toBe(
      "message-1",
    );
    expect(rows.find((row) => row.id === interrupted.id)?.message_id).toBeNull();
  });
});
