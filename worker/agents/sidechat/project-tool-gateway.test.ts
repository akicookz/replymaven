import { describe, expect, mock, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import type {
  ExecuteProjectToolResult,
  SidechatToolDescriptor,
} from "../../../shared/sidechat-agent";
import {
  CALL_PROJECT_TOOL_NAME,
  DESCRIBE_PROJECT_TOOL_NAME,
  SEARCH_PROJECT_TOOLS_NAME,
  buildSidechatGatewayTools,
  decodeSidechatToolRef,
  describeSidechatGatewayTool,
  descriptorMatchesToolBinding,
  encodeSidechatToolRef,
  parseSidechatToolArgumentsJson,
  resolvedGatewayTool,
  searchSidechatGatewayCatalog,
} from "./project-tool-gateway";

function descriptor(
  overrides: Partial<SidechatToolDescriptor> = {},
): SidechatToolDescriptor {
  return {
    connectionId: "mcp-posthog",
    toolName: "query_events",
    exposedName: "tool_mcpposthog_query_events",
    displayName: "Query events",
    description: "Query product events.",
    inputSchema: {
      type: "object",
      required: ["filter"],
      properties: {
        filter: {
          anyOf: [
            {
              type: "object",
              required: ["operator"],
              properties: {
                operator: { type: "integer", enum: [1, 2] },
              },
            },
            {
              type: "object",
              properties: {
                impossible: { type: "string", enum: [] },
              },
            },
          ],
        },
      },
    },
    catalogFingerprint: "a".repeat(64),
    audience: "sidechat",
    safety: "read",
    access: "read",
    enabled: true,
    source: {
      kind: "mcp",
      name: "PostHog",
      icon: "/integrations/posthog.svg",
    },
    ...overrides,
  };
}

describe("Sidechat project tool gateway", () => {
  test("round trips a strict versioned reference without making it authority", () => {
    const tool = descriptor({ access: "write", safety: "destructive" });
    const reference = encodeSidechatToolRef(tool);

    expect(reference.startsWith("sct1.")).toBe(true);
    expect(decodeSidechatToolRef(reference)).toEqual({
      connectionId: tool.connectionId,
      toolName: tool.toolName,
      catalogFingerprint: tool.catalogFingerprint,
      safety: "destructive",
      access: "write",
    });
    expect(decodeSidechatToolRef(`${reference}x`)).toBeNull();
    expect(decodeSidechatToolRef("sct2.invalid")).toBeNull();
    const binding = decodeSidechatToolRef(reference);
    if (!binding) throw new Error("Expected decoded binding");
    expect(descriptorMatchesToolBinding(tool, binding)).toBe(true);
    expect(descriptorMatchesToolBinding({
      ...tool,
      catalogFingerprint: "b".repeat(64),
    }, binding)).toBe(false);
  });

  test("searches a large catalog without returning raw schemas", () => {
    const catalog = Array.from({ length: 330 }, (_, index) =>
      descriptor({
        connectionId: `mcp-${index}`,
        toolName: `tool_${index}`,
        exposedName: `tool_mcp${index}_tool_${index}`,
        displayName: index === 221 ? "Query checkout events" : `Tool ${index}`,
      }),
    );

    const result = searchSidechatGatewayCatalog(catalog, {
      query: "checkout events",
      limit: 5,
      cursor: null,
    });

    expect(result.tools[0]).toMatchObject({
      displayName: "Query checkout events",
      source: { name: "PostHog" },
      access: "read",
    });
    expect(result.tools).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain("inputSchema");
    expect(JSON.stringify(result)).not.toContain("anyOf");
    expect(JSON.stringify(result)).not.toContain('"enum"');
  });

  test("derives a bounded field guide from unions, enums, and local refs", () => {
    const schema: JSONSchema7 = {
      type: "object",
      required: ["customer"],
      properties: {
        customer: { $ref: "#/$defs/customer" },
      },
      $defs: {
        customer: {
          type: "object",
          required: ["tier"],
          properties: {
            tier: { type: "integer", enum: [1, 2] },
            filters: {
              anyOf: [
                { type: "array", items: { type: "string" } },
                { type: "string", enum: [] },
              ],
            },
          },
        },
      },
    };

    const result = describeSidechatGatewayTool(
      descriptor({ inputSchema: schema }),
      { cursor: null, limit: 20 },
    );

    expect(result.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "customer.tier",
        required: true,
        types: ["integer"],
        allowedValues: ["1", "2"],
      }),
      expect.objectContaining({
        path: "customer.filters",
        types: ["array", "string"],
      }),
    ]));
    expect(JSON.stringify(result)).not.toContain("$defs");
    expect(JSON.stringify(result)).not.toContain("anyOf");
  });

  test("exposes only fixed schemas and resolves approval from the selected tool", async () => {
    const read = descriptor();
    const write = descriptor({
      connectionId: "mcp-linear",
      toolName: "create_issue",
      displayName: "Create issue",
      access: "write",
      safety: "write",
      alwaysAllowed: false,
    });
    const resolved = new Map([
      [encodeSidechatToolRef(read), resolvedGatewayTool(read)],
      [encodeSidechatToolRef(write), resolvedGatewayTool(write)],
    ]);
    const execute = mock(async (): Promise<ExecuteProjectToolResult> => ({
      status: "completed",
      output: { ok: true },
      safeActivity: "Done",
    }));
    const activities: unknown[] = [];
    const remembered: Array<{ toolCallId: string; displayName: string }> = [];
    const approvedToolCallIds = new Set<string>();
    const tools = buildSidechatGatewayTools({
      search: mock(async () => ({ tools: [], nextCursor: null })),
      describe: mock(async () => null),
      resolve: mock(async (toolRef: string) => resolved.get(toolRef) ?? null),
      execute,
      stageApproval: mock(async () => true),
      approvedToolCallIds,
      executeKnowledge: mock(async () => ({
        status: "completed",
        output: { found: true },
        safeActivity: "Searched knowledge",
      })),
      emitActivity(part) {
        activities.push(part);
      },
      rememberToolContext(toolCallId, context) {
        remembered.push({
          toolCallId,
          displayName: context.tool.displayName,
        });
      },
    });

    expect(Object.keys(tools).sort()).toEqual([
      CALL_PROJECT_TOOL_NAME,
      DESCRIBE_PROJECT_TOOL_NAME,
      "search_knowledge",
      SEARCH_PROJECT_TOOLS_NAME,
    ].sort());
    expect(JSON.stringify(await tools[CALL_PROJECT_TOOL_NAME]?.inputSchema))
      .not.toContain("query_events");

    const needsApproval = tools[CALL_PROJECT_TOOL_NAME]?.needsApproval;
    if (typeof needsApproval !== "function") {
      throw new Error("Expected dynamic approval resolver");
    }
    await expect(needsApproval({
      toolRef: encodeSidechatToolRef(read),
      argumentsJson: '{"event":"checkout"}',
    }, {
      toolCallId: "read-1",
      messages: [],
      experimental_context: undefined,
    })).resolves.toBe(false);
    await expect(needsApproval({
      toolRef: encodeSidechatToolRef(write),
      argumentsJson: '{"title":"Checkout failed"}',
    }, {
      toolCallId: "write-1",
      messages: [],
      experimental_context: undefined,
    })).resolves.toBe(true);

    const executeTool = tools[CALL_PROJECT_TOOL_NAME]?.execute;
    if (!executeTool) throw new Error("Expected gateway executor");
    await executeTool({
      toolRef: encodeSidechatToolRef(read),
      argumentsJson: '{"event":"checkout"}',
    }, {
      toolCallId: "read-execute",
      messages: [],
      abortSignal: undefined,
    });
    approvedToolCallIds.add("write-execute");
    await executeTool({
      toolRef: encodeSidechatToolRef(write),
      argumentsJson: '{"title":"Checkout failed"}',
    }, {
      toolCallId: "write-execute",
      messages: [],
      abortSignal: undefined,
    });

    expect(execute.mock.calls.map((call) => call[0])).toEqual([
      {
        toolCallId: "read-execute",
        toolRef: encodeSidechatToolRef(read),
        argumentsJson: '{"event":"checkout"}',
        approvalMode: "none",
        approvedOnce: false,
      },
      {
        toolCallId: "write-execute",
        toolRef: encodeSidechatToolRef(write),
        argumentsJson: '{"title":"Checkout failed"}',
        approvalMode: "once",
        approvedOnce: true,
      },
    ]);
    expect(remembered).toEqual(expect.arrayContaining([
      { toolCallId: "read-execute", displayName: "Query events" },
      { toolCallId: "write-execute", displayName: "Create issue" },
    ]));
    expect(activities).toHaveLength(4);
  });

  test("does not downgrade a revoked always grant into allow-once execution", async () => {
    const tool = descriptor({
      access: "write",
      safety: "write",
      alwaysAllowed: true,
    });
    const reference = encodeSidechatToolRef(tool);
    let resolution = 0;
    const execute = mock(async (): Promise<ExecuteProjectToolResult> => ({
      status: "denied",
      safeActivity: "Tool unavailable",
      errorCode: "approval_grant_changed",
    }));
    const tools = buildSidechatGatewayTools({
      search: mock(async () => ({ tools: [], nextCursor: null })),
      describe: mock(async () => null),
      resolve: mock(async () => {
        resolution += 1;
        return resolvedGatewayTool({
          ...tool,
          alwaysAllowed: resolution === 1,
        });
      }),
      execute,
      stageApproval: mock(async () => true),
      approvedToolCallIds: new Set(),
      executeKnowledge: mock(async () => ({
        status: "completed",
        safeActivity: "Searched knowledge",
      })),
      emitActivity() {},
      rememberToolContext() {},
    });
    const gateway = tools[CALL_PROJECT_TOOL_NAME];
    if (typeof gateway?.needsApproval !== "function" || !gateway.execute) {
      throw new Error("Expected gateway approval and execution");
    }
    const input = {
      toolRef: reference,
      argumentsJson: '{"title":"Issue"}',
    };
    const context = {
      toolCallId: "always-call",
      messages: [],
      experimental_context: undefined,
    };

    await expect(gateway.needsApproval(input, context)).resolves.toBe(false);
    await gateway.execute(input, {
      toolCallId: "always-call",
      messages: [],
      abortSignal: undefined,
    });

    expect(execute).toHaveBeenCalledWith({
      toolCallId: "always-call",
      toolRef: reference,
      argumentsJson: '{"title":"Issue"}',
      approvalMode: "always",
      approvedOnce: false,
    });
  });

  test("fails closed when approval-time authority cannot be resolved", async () => {
    const tools = buildSidechatGatewayTools({
      search: mock(async () => ({ tools: [], nextCursor: null })),
      describe: mock(async () => null),
      resolve: mock(async () => {
        throw new Error("private parent failure");
      }),
      execute: mock(async () => ({
        status: "completed",
        safeActivity: "Must not run",
      })),
      stageApproval: mock(async () => false),
      approvedToolCallIds: new Set(),
      executeKnowledge: mock(async () => ({
        status: "completed",
        safeActivity: "Searched knowledge",
      })),
      emitActivity() {},
      rememberToolContext() {},
    });
    const approval = tools[CALL_PROJECT_TOOL_NAME]?.needsApproval;
    if (typeof approval !== "function") {
      throw new Error("Expected gateway approval resolver");
    }

    await expect(approval({
      toolRef: encodeSidechatToolRef(descriptor()),
      argumentsJson: "{}",
    }, {
      toolCallId: "unresolved-call",
      messages: [],
      experimental_context: undefined,
    })).resolves.toBe(true);
  });

  test("stages manual writes and requires native approval evidence to execute", async () => {
    const write = descriptor({
      connectionId: "mcp-linear",
      toolName: "create_issue",
      access: "write",
      safety: "write",
      alwaysAllowed: false,
    });
    const toolRef = encodeSidechatToolRef(write);
    const stageApproval = mock(async () => true);
    const execute = mock(async (): Promise<ExecuteProjectToolResult> => ({
      status: "completed",
      safeActivity: "Done",
    }));
    const options = {
      search: mock(async () => ({ tools: [], nextCursor: null })),
      describe: mock(async () => null),
      resolve: mock(async () => resolvedGatewayTool(write)),
      execute,
      executeKnowledge: mock(async () => ({
        status: "completed" as const,
        safeActivity: "Searched knowledge",
      })),
      emitActivity() {},
      rememberToolContext() {},
      stageApproval,
    };
    const withoutEvidence = buildSidechatGatewayTools({
      ...options,
      approvedToolCallIds: new Set<string>(),
    });
    const input = {
      toolRef,
      argumentsJson: '{"token":"original-secret"}',
    };
    const approvalContext = {
      toolCallId: "write-approval",
      messages: [],
      experimental_context: undefined,
    };
    const approval = withoutEvidence[CALL_PROJECT_TOOL_NAME]?.needsApproval;
    if (typeof approval !== "function") {
      throw new Error("Expected dynamic approval resolver");
    }

    await expect(approval(input, approvalContext)).resolves.toBe(true);
    expect(stageApproval).toHaveBeenCalledWith({
      toolCallId: "write-approval",
      toolRef,
      argumentsJson: '{"token":"original-secret"}',
    });

    const unapprovedExecute = withoutEvidence[CALL_PROJECT_TOOL_NAME]?.execute;
    if (!unapprovedExecute) throw new Error("Expected gateway executor");
    await expect(unapprovedExecute(input, {
      toolCallId: "write-approval",
      messages: [],
      abortSignal: undefined,
    })).resolves.toEqual({ error: "approval_required" });
    expect(execute).not.toHaveBeenCalled();

    const approved = buildSidechatGatewayTools({
      ...options,
      approvedToolCallIds: new Set(["write-approval"]),
    });
    const approvedExecute = approved[CALL_PROJECT_TOOL_NAME]?.execute;
    if (!approvedExecute) throw new Error("Expected gateway executor");
    await approvedExecute({
      toolRef,
      argumentsJson: '{"token":"[redacted]"}',
    }, {
      toolCallId: "write-approval",
      messages: [],
      abortSignal: undefined,
    });
    expect(execute).toHaveBeenCalledWith({
      toolCallId: "write-approval",
      toolRef,
      argumentsJson: '{"token":"[redacted]"}',
      approvalMode: "once",
      approvedOnce: true,
    });
  });

  test("parses only bounded JSON objects at the parent boundary", () => {
    expect(parseSidechatToolArgumentsJson(
      '{"customer":{"email":"customer@example.com"},"ids":[1,2]}',
    )).toEqual({
      customer: { email: "customer@example.com" },
      ids: [1, 2],
    });
    expect(parseSidechatToolArgumentsJson("[]")).toBeNull();
    expect(parseSidechatToolArgumentsJson("{invalid")).toBeNull();
    expect(parseSidechatToolArgumentsJson(JSON.stringify({
      value: "x".repeat(20_001),
    }))).toBeNull();
  });
});
