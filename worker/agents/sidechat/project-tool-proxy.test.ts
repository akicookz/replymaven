import { describe, expect, mock, test } from "bun:test";
import type { ToolRow } from "../../db";
import type {
  ExecuteProjectToolRequest,
  SidechatToolAuditMetadata,
  SidechatToolDescriptor,
} from "../../../shared/sidechat-agent";
import {
  buildSidechatDynamicTools,
  buildSidechatToolDescriptors,
  executeSidechatProjectTool,
  persistSidechatActionAudit,
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
    access: descriptor.access,
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

  test("builds dynamic child tools that execute only through the parent proxy", async () => {
    const descriptors = await buildSidechatToolDescriptors("project-1", [toolRow()]);
    const execute = mock(async () => ({
      status: "completed" as const,
      output: { found: true },
      safeActivity: "Look up customer · Done",
    }));
    const activities: unknown[] = [];
    const tools = buildSidechatDynamicTools({
      descriptors,
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      actorUserId: "user-1",
      execute,
      emitActivity(part) {
        activities.push(part);
      },
    });

    expect(Object.keys(tools)).toEqual(["search_knowledge", "lookup_customer"]);
    expect(tools.request_team_help).toBeUndefined();
    const output = await tools.lookup_customer?.execute?.(
      { customerId: "customer-1" },
      {
        toolCallId: "call-1",
        messages: [],
        abortSignal: undefined,
      },
    );
    expect(output).toEqual({ found: true });
    expect(execute).toHaveBeenCalledWith({
      childName: "sc_conversation-1",
      conversationId: "conversation-1",
      actorUserId: "user-1",
      connectionId: "http:tool-1",
      toolName: "lookup_customer",
      catalogFingerprint: descriptors[1]?.catalogFingerprint,
      access: "read",
      input: { customerId: "customer-1" },
    });
    expect(activities).toEqual([
      {
        type: "data-safe-activity",
        data: { label: "Look up customer", status: "started" },
        transient: true,
      },
      {
        type: "data-safe-activity",
        data: { label: "Look up customer · Done", status: "success" },
        transient: true,
      },
    ]);
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

  test("does not execute MCP writes or stale catalog authority", async () => {
    const writeDescriptor = mcpDescriptor({ access: "write" });
    const executeMcpTool = mock(async () => ({ content: [] }));
    const write = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(writeDescriptor),
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

    expect(write).toMatchObject({
      status: "unavailable",
      errorCode: "approval_required",
    });
    expect(stale).toMatchObject({
      status: "denied",
      errorCode: "tool_authority_changed",
    });
    expect(executeMcpTool).not.toHaveBeenCalled();
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

  test("reports writes as approval-required without dispatching them", async () => {
    const writeRow = toolRow({ access: "write" });
    const descriptor = (await buildSidechatToolDescriptors("project-1", [writeRow]))[1]!;
    const dependencies = executionDependencies({
      getAuthoritativeHttpTool: mock(async () => writeRow),
    });

    const result = await executeSidechatProjectTool({
      projectId: "project-1",
      request: executionRequest(descriptor),
      dependencies,
    });

    expect(result).toMatchObject({
      status: "unavailable",
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
