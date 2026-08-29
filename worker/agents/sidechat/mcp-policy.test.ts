import { describe, expect, test } from "bun:test";
import {
  classifyMcpToolAccess,
  fingerprintMcpTool,
  normalizeMcpCatalog,
  normalizeMcpToolResult,
  toMcpExposedName,
  validateMcpServerUrl,
} from "./mcp-policy";

describe("Sidechat MCP URL policy", () => {
  test("accepts arbitrary public HTTPS endpoints", () => {
    expect(validateMcpServerUrl("https://mcp.example.com/custom")).toBe(
      "https://mcp.example.com/custom",
    );
  });

  test.each([
    "http://mcp.example.com/mcp",
    "file:///tmp/server",
    "stdio://posthog",
    "https://localhost/mcp",
    "https://127.0.0.1/mcp",
    "https://10.0.0.1/mcp",
    "https://172.20.0.1/mcp",
    "https://192.168.1.1/mcp",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/mcp",
    "https://[::1]/mcp",
    "https://[fc00::1]/mcp",
    "https://[fe80::1]/mcp",
    "https://[::ffff:10.0.0.1]/mcp",
  ])("rejects unsafe MCP target %s", (url) => {
    expect(() => validateMcpServerUrl(url)).toThrow("public HTTPS");
  });
});

describe("Sidechat MCP tool policy", () => {
  test("bounds raw tool results before they enter the private model loop", () => {
    const small = { content: [{ type: "text", text: "customer context" }] };
    expect(normalizeMcpToolResult(small)).toBe(small);
    expect(
      normalizeMcpToolResult({ content: [{ text: "x".repeat(110_000) }] }),
    ).toEqual({ error: "mcp_tool_output_too_large" });
  });

  test.each([
    [{ readOnlyHint: true, destructiveHint: false }, "read"],
    [{ readOnlyHint: false, destructiveHint: false }, "write"],
    [{ destructiveHint: true }, "write"],
    [{}, "write"],
    [undefined, "write"],
    [{ readOnlyHint: true, destructiveHint: true }, "write"],
  ] as const)("classifies annotations %p as %s", (annotations, expected) => {
    expect(classifyMcpToolAccess(annotations)).toBe(expected);
  });

  test("creates stable namespaced names and rejects internal collisions", () => {
    expect(toMcpExposedName("mcp-example-123", "find_customer")).toBe(
      "tool_mcpexample123_find_customer",
    );
    expect(() =>
      toMcpExposedName("mcp-example-123", "request_team_help"),
    ).toThrow("reserved");
    expect(() =>
      toMcpExposedName("mcp-example-123", "present_reply_draft"),
    ).toThrow("reserved");
  });

  test("fingerprints the semantic catalog independent of object key order", async () => {
    const first = await fingerprintMcpTool({
      name: "find_customer",
      description: "Find a customer",
      inputSchema: {
        type: "object",
        properties: { email: { type: "string" }, limit: { type: "number" } },
      },
      annotations: { readOnlyHint: true },
    });
    const second = await fingerprintMcpTool({
      annotations: { readOnlyHint: true },
      inputSchema: {
        properties: { limit: { type: "number" }, email: { type: "string" } },
        type: "object",
      },
      description: "Find a customer",
      name: "find_customer",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("defaults discovered tools to ask and preserves exact configured policy", async () => {
    const tools = [
      {
        serverId: "mcp-example-123",
        name: "find_customer",
        title: "Find customer",
        description: "Find a customer safely",
        inputSchema: {
          type: "object" as const,
          properties: { email: { type: "string" } },
        },
        annotations: { readOnlyHint: true },
      },
      {
        serverId: "mcp-example-123",
        name: "update_customer",
        description: "Update a customer",
        inputSchema: { type: "object" as const },
      },
    ];
    const first = await normalizeMcpCatalog("mcp-example-123", tools, []);
    const configured = first.map((tool) =>
      tool.toolName === "find_customer"
        ? { ...tool, enabled: true, access: "read" as const }
        : { ...tool, enabled: false },
    );
    const second = await normalizeMcpCatalog(
      "mcp-example-123",
      tools,
      configured,
    );

    expect(first).toEqual([
      expect.objectContaining({
        toolName: "find_customer",
        exposedName: "tool_mcpexample123_find_customer",
        displayName: "Find customer",
        safety: "read",
        access: "write",
        enabled: true,
      }),
      expect.objectContaining({
        toolName: "update_customer",
        safety: "write",
        access: "write",
        enabled: true,
      }),
    ]);
    expect(second[0]).toMatchObject({ enabled: true, access: "read" });
    expect(second[1]).toMatchObject({ enabled: false, access: "write" });
    expect(second[0]?.inputSchema).toEqual({
      type: "object",
      properties: { email: { type: "string" } },
    });
  });

  test("defaults tools to ask even when their safety is forced read-only", async () => {
    const discovered = [{
      serverId: "mcp-posthog",
      name: "query_events",
      description: "Query PostHog events",
      inputSchema: { type: "object" as const },
    }];
    const [tool] = await normalizeMcpCatalog(
      "mcp-posthog",
      discovered,
      [],
      { forceReadOnly: true },
    );

    expect(tool).toMatchObject({
      safety: "read",
      access: "write",
      enabled: true,
    });

    const [refreshed] = await normalizeMcpCatalog(
      "mcp-posthog",
      discovered,
      [{ ...tool!, enabled: true, access: "read" }],
      { forceReadOnly: true },
    );
    expect(refreshed).toMatchObject({
      safety: "read",
      access: "read",
      enabled: true,
    });
  });

  test("preserves destructive annotations as a separate safety class", async () => {
    const tools = await normalizeMcpCatalog(
      "mcp-example-123",
      [
        {
          serverId: "mcp-example-123",
          name: "create_customer",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: false, destructiveHint: false },
        },
        {
          serverId: "mcp-example-123",
          name: "delete_customer",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
      ],
      [],
    );

    expect(tools.map((tool) => [tool.toolName, tool.safety])).toEqual([
      ["create_customer", "write"],
      ["delete_customer", "destructive"],
    ]);
  });

  test("resets changed authority to ask and skips reserved or oversized server declarations", async () => {
    const original = await normalizeMcpCatalog(
      "mcp-example-123",
      [
        {
          serverId: "mcp-example-123",
          name: "find_customer",
          description: "Find a customer",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true },
        },
      ],
      [],
    );
    const configured = [{ ...original[0]!, enabled: true }];
    const refreshed = await normalizeMcpCatalog(
      "mcp-example-123",
      [
        {
          serverId: "mcp-example-123",
          name: "find_customer",
          description: "Find a customer",
          inputSchema: { type: "object", required: ["externalId"] },
          annotations: { readOnlyHint: true },
        },
        {
          serverId: "mcp-example-123",
          name: "present_reply_draft",
          inputSchema: { type: "object" },
        },
        {
          serverId: "mcp-example-123",
          name: "oversized",
          inputSchema: {
            type: "object",
            description: "x".repeat(110_000),
          },
        },
        {
          serverId: "mcp-example-123",
          name: "external_ref",
          inputSchema: {
            $ref: "https://schemas.example.com/customer.json",
          },
        },
        {
          serverId: "mcp-example-123",
          name: "unsupported_draft",
          inputSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        },
      ],
      configured,
    );

    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      toolName: "find_customer",
      enabled: true,
      access: "write",
    });
  });
});
