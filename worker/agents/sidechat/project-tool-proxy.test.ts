import { describe, expect, mock, test } from "bun:test";
import type { ToolRow } from "../../db";
import type {
  ExecuteProjectToolRequest,
  SidechatToolAuditMetadata,
  SidechatToolDescriptor,
} from "../../../shared/sidechat-agent";
import {
  buildSidechatToolDescriptors,
  executeSidechatProjectTool,
  persistSidechatActionAudit,
  sidechatToolPresentation,
} from "./project-tool-proxy";

function toolRow(overrides: Partial<ToolRow> = {}): ToolRow {
  return {
    id: "tool-1",
    projectId: "project-1",
    name: "lookup_customer",
    displayName: "Look up customer",
    description: "Look up the current customer.",
    endpoint: "https://api.example.com/customers",
    method: "GET",
    headers: "encrypted-secret",
    parameters: JSON.stringify([
      {
        name: "customerId",
        type: "string",
        description: "Customer ID",
        required: true,
      },
    ]),
    responseMapping: null,
    enabled: true,
    timeout: 10_000,
    sortOrder: 0,
    allowedChannels: '["sidechat"]',
    access: "read",
    schemaFingerprint: "legacy-v1",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function executionRequest(
  descriptor: SidechatToolDescriptor,
  overrides: Partial<ExecuteProjectToolRequest> = {},
): ExecuteProjectToolRequest {
  return {
    childName: "sc_conversation-1",
    conversationId: "conversation-1",
    actorUserId: "user-1",
    connectionId: descriptor.connectionId,
    toolName: descriptor.toolName,
    catalogFingerprint: descriptor.catalogFingerprint,
    safety: descriptor.safety ?? (descriptor.access === "read" ? "read" : "write"),
    access: descriptor.access,
    approvalMode: descriptor.access === "write" ? "once" : "none",
    input: { customerId: "never-audit-me" },
    ...overrides,
  };
}

function mcpDescriptor(
  overrides: Partial<SidechatToolDescriptor> = {},
): SidechatToolDescriptor {
  return {
    connectionId: "mcp-example-123",
    toolName: "find_customer",
    exposedName: "tool_mcpexample123_find_customer",
    displayName: "Find customer",
    description: "Find a customer through MCP.",
    inputSchema: { type: "object" },
    catalogFingerprint: "b".repeat(64),
    audience: "sidechat",
    access: "read",
    enabled: true,
    ...overrides,
  };
}

function executionDependencies(overrides: Record<string, unknown> = {}) {
  return {
    isRegisteredSidechat: mock(() => true),
    getConversation: mock(async () => ({ archivedAt: null })),
    canActorAccessProject: mock(async () => true),
    getAuthoritativeHttpTool: mock(async () => toolRow()),
    getAuthoritativeMcpTool: mock(async () => null),
    hasAlwaysAllowGrant: mock(() => false),
    runKnowledgeSearch: mock(async () => ({ found: true, context: "Answer" })),
    runExternalAction: mock(async (action: () => Promise<unknown>) => ({
      executed: true,
      value: await action(),
    })),
    executeHttpTool: mock(async () => ({ success: true, data: { id: "customer-1" } })),
    executeMcpTool: mock(async () => ({ content: [] })),
    writeAudit: mock((metadata: SidechatToolAuditMetadata) => metadata && undefined),
    ...overrides,
  };
}

describe("Sidechat project tool descriptors", () => {
  test("presents knowledge search as Docs · Search", () => {
    expect(sidechatToolPresentation({
      connectionId: "internal:replymaven",
      toolName: "search_knowledge",
      exposedName: "search_knowledge",
      displayName: "Search",
      description: "Search docs",
      inputSchema: { type: "object" },
      catalogFingerprint: "internal-search-knowledge-v1",
      audience: "sidechat",
      access: "read",
      enabled: true,
      source: { kind: "http", name: "Docs", icon: null },
    })).toEqual({
      displayName: "Search",
      source: { kind: "http", name: "Docs", icon: null },
    });
  });

  test("presents a resolved MCP tool with its connection name and icon", () => {
    expect(sidechatToolPresentation({
      connectionId: "mcp-posthog",
      toolName: "query-run",
      exposedName: "query-run",
      displayName: "Execute SQL query",
      description: "Run SQL",
      inputSchema: { type: "object" },
      catalogFingerprint: "a".repeat(64),
      audience: "sidechat",
      access: "read",
      enabled: true,
      source: {
        kind: "mcp",
        name: "PostHog",
        icon: "/integrations/posthog.svg",
      },
    })).toEqual({
      displayName: "Execute SQL query",
      source: {
        kind: "mcp",
        name: "PostHog",
        icon: "/integrations/posthog.svg",
      },
    });
  });

  test("includes knowledge and only safe serializable Sidechat HTTP descriptors", async () => {
    const descriptors = await buildSidechatToolDescriptors("project-1", [
      toolRow(),
      toolRow({
        id: "public-tool",
        name: "public_only",
        allowedChannels: '["public"]',
      }),
      toolRow({
        id: "reserved-tool",
        name: "request_team_help",
      }),
    ]);

    expect(descriptors.map((descriptor) => descriptor.toolName)).toEqual([
      "search_knowledge",
      "lookup_customer",
    ]);
    expect(descriptors[0]).toMatchObject({
      displayName: "Search",
      source: { kind: "http", name: "Docs", icon: null },
    });
    expect(JSON.stringify(descriptors)).not.toContain("api.example.com");
    expect(JSON.stringify(descriptors)).not.toContain("encrypted-secret");
    expect(descriptors[1]).toMatchObject({
      connectionId: "http:tool-1",
      audience: "sidechat",
      access: "read",
      enabled: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
      },
    });
  });

});

describe("Sidechat project tool execution", () => {
  test("executes an enabled MCP read only inside the conversation action lease", async () => {
    const descriptor = mcpDescriptor();
    const executeMcpTool = mock(async () => ({
      content: [{ type: "text", text: "private customer context" }],
    }));
    const runExternalAction = mock(async (action: () => Promise<unknown>) => ({
      executed: true,
      value: await action(),
    }));
    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor, { input: { externalId: "cus_1" } }),
      dependencies: executionDependencies({
        getAuthoritativeMcpTool: mock(async () => descriptor),
        executeMcpTool,
        runExternalAction,
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      safeActivity: "Find customer · Done",
    });
    expect(runExternalAction).toHaveBeenCalledTimes(1);
    expect(executeMcpTool).toHaveBeenCalledWith(
      "mcp-example-123",
      "find_customer",
      { externalId: "cus_1" },
    );
  });

  test("binds MCP authority without treating exposedName as identity", async () => {
    const descriptor = mcpDescriptor({
      exposedName: "presentation-name-can-change",
    });
    const executeMcpTool = mock(async () => ({ content: [] }));

    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor),
      dependencies: executionDependencies({
        getAuthoritativeMcpTool: mock(async () => descriptor),
        executeMcpTool,
      }),
    });

    expect(result.status).toBe("completed");
    expect(executeMcpTool).toHaveBeenCalledTimes(1);
  });

  test("executes approved MCP writes once but rejects unapproved and stale authority", async () => {
    const writeDescriptor = mcpDescriptor({ access: "write" });
    const executeMcpTool = mock(async () => ({ content: [] }));
    const write = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(writeDescriptor, { approvalMode: "once" }),
      dependencies: executionDependencies({
        getAuthoritativeMcpTool: mock(async () => writeDescriptor),
        executeMcpTool,
      }),
    });
    const unapproved = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(writeDescriptor, { approvalMode: "none" }),
      dependencies: executionDependencies({
        getAuthoritativeMcpTool: mock(async () => writeDescriptor),
        executeMcpTool,
      }),
    });
    const stale = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(mcpDescriptor(), {
        catalogFingerprint: "c".repeat(64),
      }),
      dependencies: executionDependencies({
        getAuthoritativeMcpTool: mock(async () => mcpDescriptor()),
        executeMcpTool,
      }),
    });

    expect(write).toMatchObject({ status: "completed" });
    expect(unapproved).toMatchObject({
      status: "denied",
      errorCode: "approval_required",
    });
    expect(stale).toMatchObject({
      status: "denied",
      errorCode: "tool_authority_changed",
    });
    expect(executeMcpTool).toHaveBeenCalledTimes(1);
  });

  test("validates MCP input against the authoritative normalized schema", async () => {
    const descriptor = mcpDescriptor({
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["customer"],
        properties: {
          customer: { $ref: "#/$defs/customer" },
        },
        $defs: {
          customer: {
            type: "object",
            additionalProperties: false,
            required: ["tier"],
            properties: {
              tier: { type: "string", enum: ["pro", "free"] },
            },
          },
        },
      },
    });
    const executeMcpTool = mock(async () => ({ content: [] }));
    const dependencies = executionDependencies({
      getAuthoritativeMcpTool: mock(async () => descriptor),
      executeMcpTool,
    });

    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor, {
        input: {
          customer: {
            tier: "secret-invalid-value",
            extra: true,
          },
        },
      }),
      dependencies,
    });

    expect(result).toMatchObject({
      status: "denied",
      errorCode: "tool_authority_changed",
    });
    expect(executeMcpTool).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret-invalid-value");
  });

  test("requires an exact current grant for always-approved writes", async () => {
    const descriptor = mcpDescriptor({ access: "write", alwaysAllowed: true });
    const executeMcpTool = mock(async () => ({ content: [] }));
    const allowed = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor, { approvalMode: "always" }),
      dependencies: executionDependencies({
        getAuthoritativeMcpTool: mock(async () => descriptor),
        hasAlwaysAllowGrant: mock(() => true),
        executeMcpTool,
      }),
    });
    const stale = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor, { approvalMode: "always" }),
      dependencies: executionDependencies({
        getAuthoritativeMcpTool: mock(async () => ({
          ...descriptor,
          alwaysAllowed: false,
        })),
        hasAlwaysAllowGrant: mock(() => false),
        executeMcpTool,
      }),
    });

    expect(allowed.status).toBe("completed");
    expect(stale).toMatchObject({
      status: "denied",
      errorCode: "approval_grant_changed",
    });
    expect(executeMcpTool).toHaveBeenCalledTimes(1);
  });

  test("reports an accepted-or-timeout write as ambiguous and never retries", async () => {
    const descriptor = mcpDescriptor({ access: "write" });
    const executeMcpTool = mock(async () => ({ error: "mcp_tool_timeout" }));
    const dependencies = executionDependencies({
      getAuthoritativeMcpTool: mock(async () => descriptor),
      executeMcpTool,
    });
    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor, { approvalMode: "once" }),
      dependencies,
    });

    expect(result).toEqual({
      status: "ambiguous",
      safeActivity: "Write result unknown",
      errorCode: "write_result_unknown",
    });
    expect(executeMcpTool).toHaveBeenCalledTimes(1);
    expect(dependencies.writeAudit.mock.calls[0]?.[0]).toMatchObject({
      status: "ambiguous",
      approvalMode: "once",
      errorCode: "write_result_unknown",
    });
  });

  test("reports a failed asked read as a read failure, not an ambiguous write", async () => {
    const descriptor = mcpDescriptor({ safety: "read", access: "write" });
    const executeMcpTool = mock(async () => ({ error: "mcp_tool_timeout" }));
    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor, { approvalMode: "once" }),
      dependencies: executionDependencies({
        getAuthoritativeMcpTool: mock(async () => descriptor),
        executeMcpTool,
      }),
    });

    expect(result).toEqual({
      status: "failed",
      safeActivity: "Tool failed",
      errorCode: "tool_failed",
    });
    expect(executeMcpTool).toHaveBeenCalledTimes(1);
  });

  test("defines a parent-local audit table with metadata columns only", () => {
    const queries: string[] = [];
    const values: unknown[][] = [];
    function sql(
      strings: TemplateStringsArray,
      ...queryValues: Array<string | number | boolean | null>
    ): [] {
      queries.push(strings.join("?"));
      values.push(queryValues);
      return [];
    }
    persistSidechatActionAudit(sql, {
      projectId: "project-1",
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      connectionId: "http:tool-1",
      toolName: "lookup_customer",
      catalogFingerprint: "fingerprint-1",
      access: "read",
      actorUserId: "user-1",
      approvalMode: "none",
      status: "completed",
      startedAt: 10,
      finishedAt: 20,
      durationMs: 10,
      safeActivity: "Completed lookup",
    });

    expect(queries).toHaveLength(2);
    expect(queries.join(" ")).toContain("sidechat_action_audit");
    expect(queries.join(" ")).not.toMatch(/\b(input|output|headers?|token)\b/iu);
    expect(JSON.stringify(values)).not.toContain("private-payload");
  });

  test("rechecks authority, leases the conversation, and writes metadata-only audit", async () => {
    const [descriptor] = (await buildSidechatToolDescriptors("project-1", [toolRow()])).slice(1);
    const dependencies = executionDependencies();
    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor!),
      dependencies,
    });

    expect(result).toEqual({
      status: "completed",
      output: { success: true, data: { id: "customer-1" } },
      safeActivity: "Look up customer · Done",
    });
    expect(dependencies.runExternalAction).toHaveBeenCalledTimes(1);
    expect(dependencies.executeHttpTool).toHaveBeenCalledTimes(1);
    expect(dependencies.writeAudit).toHaveBeenCalledTimes(1);
    const audit = dependencies.writeAudit.mock.calls[0]?.[0];
    expect(audit).toMatchObject({
      projectId: "project-1",
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      connectionId: "http:tool-1",
      toolName: "lookup_customer",
      status: "completed",
      approvalMode: "none",
    });
    expect(JSON.stringify(audit)).not.toContain("never-audit-me");
    expect(JSON.stringify(audit)).not.toContain("customer-1");
  });

  test("executes the fixed knowledge tool without consulting HTTP storage", async () => {
    const descriptor = (await buildSidechatToolDescriptors("project-1", []))[0]!;
    const dependencies = executionDependencies();

    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor, {
        input: { query: "refund policy" },
      }),
      dependencies,
    });

    expect(result).toEqual({
      status: "completed",
      output: { found: true, context: "Answer" },
      safeActivity: "Searched knowledge",
    });
    expect(dependencies.runKnowledgeSearch).toHaveBeenCalledWith({
      query: "refund policy",
    });
    expect(dependencies.getAuthoritativeHttpTool).not.toHaveBeenCalled();
    expect(dependencies.runExternalAction).not.toHaveBeenCalled();
  });

  test.each([
    ["archived", { getConversation: mock(async () => ({ archivedAt: new Date() })) }],
    ["revoked actor", { canActorAccessProject: mock(async () => false) }],
    ["disabled", { getAuthoritativeHttpTool: mock(async () => toolRow({ enabled: false })) }],
    ["reclassified", { getAuthoritativeHttpTool: mock(async () => toolRow({ allowedChannels: '["public"]' })) }],
    ["schema changed", { getAuthoritativeHttpTool: mock(async () => toolRow({ description: "Changed contract" })) }],
  ] as const)("rejects %s authority before dispatch", async (_name, overrides) => {
    const descriptors = await buildSidechatToolDescriptors("project-1", [toolRow()]);
    const descriptor = descriptors[1]!;
    const dependencies = executionDependencies(overrides);

    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor),
      dependencies,
    });

    expect(result.status).toBe("denied");
    expect(dependencies.runExternalAction).not.toHaveBeenCalled();
    expect(dependencies.executeHttpTool).not.toHaveBeenCalled();
  });

  test("reports unapproved writes as approval-required without dispatching them", async () => {
    const writeRow = toolRow({ access: "write" });
    const descriptor = (await buildSidechatToolDescriptors("project-1", [writeRow]))[1]!;
    const dependencies = executionDependencies({
      getAuthoritativeHttpTool: mock(async () => writeRow),
    });

    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor, { approvalMode: "none" }),
      dependencies,
    });

    expect(result).toMatchObject({
      status: "denied",
      errorCode: "approval_required",
    });
    expect(dependencies.runExternalAction).not.toHaveBeenCalled();
    expect(dependencies.executeHttpTool).not.toHaveBeenCalled();
  });

  test("rechecks live policy inside the conversation lease immediately before fetch", async () => {
    const descriptor = (await buildSidechatToolDescriptors(
      "project-1",
      [toolRow()],
    ))[1]!;
    let readCount = 0;
    const dependencies = executionDependencies({
      getAuthoritativeHttpTool: mock(async () => {
        readCount += 1;
        return readCount === 1 ? toolRow() : toolRow({ enabled: false });
      }),
    });

    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor),
      dependencies,
    });

    expect(result).toMatchObject({
      status: "denied",
      errorCode: "tool_authority_changed",
    });
    expect(dependencies.runExternalAction).toHaveBeenCalledTimes(1);
    expect(dependencies.executeHttpTool).not.toHaveBeenCalled();
  });

  test("rejects model inputs that no longer match the authoritative schema", async () => {
    const descriptor = (await buildSidechatToolDescriptors(
      "project-1",
      [toolRow()],
    ))[1]!;
    const dependencies = executionDependencies();

    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor, {
        input: { customerId: 42 },
      }),
      dependencies,
    });

    expect(result).toMatchObject({
      status: "denied",
      errorCode: "tool_authority_changed",
    });
    expect(dependencies.runExternalAction).not.toHaveBeenCalled();
    expect(dependencies.executeHttpTool).not.toHaveBeenCalled();
  });

  test("normalizes dependency failures and still writes a safe audit row", async () => {
    const descriptor = (await buildSidechatToolDescriptors(
      "project-1",
      [toolRow()],
    ))[1]!;
    const dependencies = executionDependencies({
      getConversation: mock(async () => {
        throw new Error("private database detail");
      }),
    });

    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor),
      dependencies,
    });

    expect(result).toEqual({
      status: "failed",
      safeActivity: "Tool failed",
      errorCode: "tool_failed",
    });
    expect(dependencies.writeAudit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(dependencies.writeAudit.mock.calls)).not.toContain(
      "private database detail",
    );
  });

  test("normalizes low-level transport failures without exposing their detail", async () => {
    const descriptor = (await buildSidechatToolDescriptors(
      "project-1",
      [toolRow()],
    ))[1]!;
    const dependencies = executionDependencies({
      executeHttpTool: mock(async () => ({
        error: "provider secret from failed transport",
      })),
    });

    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor),
      dependencies,
    });

    expect(result).toEqual({
      status: "failed",
      safeActivity: "Tool failed",
      errorCode: "tool_failed",
    });
    expect(JSON.stringify(result)).not.toContain("provider secret");
    expect(JSON.stringify(dependencies.writeAudit.mock.calls)).not.toContain(
      "provider secret",
    );
  });
});
