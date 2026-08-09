import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { type ToolRow } from "../../db";
import { encryptHeaders } from "../../services/encryption-service";
import {
  type MavenToolCapability,
  type MavenToolDefinition,
  type MavenTurnContext,
} from "../types";
import {
  buildMavenToolRegistry,
  type SafeToolActivity,
} from "./build-maven-tool-registry";
import { createHttpToolDefinition } from "./http-tool-executor";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createContext(
  channel: MavenTurnContext["channel"],
): MavenTurnContext {
  return {
    channel,
    projectId: "project-1",
    conversationId: "conversation-1",
    actorUserId: "user-1",
    customerId: null,
    ownership: {
      status: "active",
      chatState: null,
    },
  };
}

function createCapability(
  overrides: Partial<MavenToolCapability> = {},
): MavenToolCapability {
  return {
    id: "tool-1",
    projectId: "project-1",
    connectionId: null,
    modelName: "check_order",
    displayName: "Check order",
    source: "http",
    allowedChannels: ["public"],
    access: "read",
    enabled: true,
    schemaFingerprint: "schema-v1",
    ...overrides,
  };
}

function createDefinition(options: {
  capability?: MavenToolCapability;
  execute?: MavenToolDefinition["execute"];
  reauthorize?: MavenToolDefinition["reauthorize"];
} = {}): MavenToolDefinition {
  const capability = options.capability ?? createCapability();
  return {
    capability,
    description: "Looks up an order.",
    inputSchema: z.object({ orderId: z.string() }),
    execute: options.execute ?? (async () => ({ found: true })),
    reauthorize: options.reauthorize ?? (async () => capability),
  };
}

async function executeRegisteredTool(
  definition: MavenToolDefinition,
  context: MavenTurnContext,
  input: Record<string, unknown> = { orderId: "order-1" },
  callbacks: {
    onStart?: (event: SafeToolActivity) => void;
    onFinish?: (event: SafeToolActivity) => void;
    abortSignal?: AbortSignal;
  } = {},
): Promise<unknown> {
  const { abortSignal, ...activityCallbacks } = callbacks;
  const { tools } = buildMavenToolRegistry({
    context,
    definitions: [definition],
    ...activityCallbacks,
  });
  const registered = tools[definition.capability.modelName];
  if (!registered || typeof registered.execute !== "function") {
    throw new Error("Expected an executable registry tool");
  }

  return registered.execute(input, {
    toolCallId: "test-call",
    messages: [],
    abortSignal,
  });
}

function createToolRow(overrides: Partial<ToolRow> = {}): ToolRow {
  return {
    id: "http-tool-1",
    projectId: "project-1",
    name: "lookup_account",
    displayName: "Lookup account",
    description: "Looks up an account.",
    endpoint: "https://api.example.com/accounts",
    method: "GET",
    headers: null,
    parameters: JSON.stringify([
      {
        name: "accountId",
        type: "string",
        description: "Account identifier",
        required: true,
      },
    ]),
    responseMapping: null,
    enabled: true,
    timeout: 10_000,
    sortOrder: 0,
    allowedChannels: '["public"]',
    access: "read",
    schemaFingerprint: "legacy-v1",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("buildMavenToolRegistry", () => {
  test("propagates turn cancellation when the SDK tool signal remains live", async () => {
    const turn = new AbortController();
    const sdkTool = new AbortController();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const definition = createDefinition({
      async execute(_input, { abortSignal }) {
        markStarted();
        if (abortSignal?.aborted) return { cancelled: true };
        return new Promise((resolve) => {
          abortSignal?.addEventListener(
            "abort",
            () => resolve({ cancelled: true }),
            { once: true },
          );
        });
      },
    });
    const { tools } = buildMavenToolRegistry({
      context: createContext("public"),
      definitions: [definition],
      abortSignal: turn.signal,
    });
    const registered = tools.check_order;
    if (!registered || typeof registered.execute !== "function") {
      throw new Error("Expected an executable registry tool");
    }

    const execution = registered.execute(
      { orderId: "order-1" },
      {
        toolCallId: "test-call",
        messages: [],
        abortSignal: sdkTool.signal,
      },
    );
    await started;
    turn.abort(new DOMException("Visitor disconnected", "AbortError"));

    expect(
      await Promise.race([
        execution,
        Bun.sleep(50).then(() => ({ timedOut: true })),
      ]),
    ).toEqual({ cancelled: true });
    expect(sdkTool.signal.aborted).toBe(false);
  });

  test.each(["http", "mcp"] as const)(
    "omits a standalone reserved %s definition",
    (source) => {
      const definition = createDefinition({
        capability: createCapability({
          id: `legacy-${source}-request-team-help`,
          modelName: "request_team_help",
          source,
          allowedChannels: ["sidechat"],
        }),
      });

      const registry = buildMavenToolRegistry({
        context: createContext("sidechat"),
        definitions: [definition],
      });

      expect(Object.keys(registry.tools)).toEqual([]);
      expect(registry.capabilities.size).toBe(0);
    },
  );

  test("keeps the public request_team_help internal tool when HTTP collides", async () => {
    const internal = createDefinition({
      capability: createCapability({
        id: "internal-request-team-help",
        modelName: "request_team_help",
        source: "internal",
      }),
      execute: async () => ({ owner: "internal" }),
    });
    const legacyHttp = createDefinition({
      capability: createCapability({
        id: "legacy-http-request-team-help",
        modelName: "request_team_help",
        source: "http",
      }),
      execute: async () => ({ owner: "http" }),
    });
    const registry = buildMavenToolRegistry({
      context: createContext("public"),
      definitions: [internal, legacyHttp],
    });
    const registered = registry.tools.request_team_help;
    if (!registered || typeof registered.execute !== "function") {
      throw new Error("Expected request_team_help to remain executable");
    }

    const result = await registered.execute(
      { orderId: "order-1" },
      { toolCallId: "collision", messages: [] },
    );

    expect(result).toEqual({ owner: "internal" });
    expect(registry.capabilities.get("request_team_help")?.id).toBe(
      "internal-request-team-help",
    );
  });

  test("keeps search_knowledge internal in a sidechat HTTP collision", async () => {
    const internal = createDefinition({
      capability: createCapability({
        id: "internal-search-knowledge",
        modelName: "search_knowledge",
        source: "internal",
        allowedChannels: ["public", "sidechat"],
      }),
      execute: async () => ({ owner: "internal" }),
    });
    const legacyHttp = createDefinition({
      capability: createCapability({
        id: "legacy-http-search-knowledge",
        modelName: "search_knowledge",
        source: "http",
        allowedChannels: ["sidechat"],
      }),
      execute: async () => ({ owner: "http" }),
    });
    const registry = buildMavenToolRegistry({
      context: createContext("sidechat"),
      definitions: [internal, legacyHttp],
    });
    const registered = registry.tools.search_knowledge;
    if (!registered || typeof registered.execute !== "function") {
      throw new Error("Expected search_knowledge to remain executable");
    }

    const result = await registered.execute(
      { orderId: "order-1" },
      { toolCallId: "collision", messages: [] },
    );

    expect(result).toEqual({ owner: "internal" });
    expect(registry.capabilities.get("search_knowledge")?.id).toBe(
      "internal-search-knowledge",
    );
  });

  test("omits a public-only tool from a sidechat registry", () => {
    const definition = createDefinition();

    const registry = buildMavenToolRegistry({
      context: createContext("sidechat"),
      definitions: [definition],
    });

    expect(Object.keys(registry.tools)).toEqual([]);
    expect(registry.capabilities.size).toBe(0);
  });

  test("hard-denies an MCP tool from a public registry despite public metadata", () => {
    const definition = createDefinition({
      capability: createCapability({
        source: "mcp",
        allowedChannels: ["public", "sidechat"],
      }),
    });

    const registry = buildMavenToolRegistry({
      context: createContext("public"),
      definitions: [definition],
    });

    expect(Object.keys(registry.tools)).toEqual([]);
    expect(registry.capabilities.size).toBe(0);
  });

  test("rejects a tool disabled after construction before its side effect", async () => {
    let sideEffectCount = 0;
    const definition = createDefinition({
      execute: async () => {
        sideEffectCount += 1;
        return { ok: true };
      },
      reauthorize: async () => createCapability({ enabled: false }),
    });

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
    );

    expect(result).toEqual({ error: "tool_disabled" });
    expect(sideEffectCount).toBe(0);
  });

  test("rejects a changed authoritative schema fingerprint", async () => {
    let sideEffectCount = 0;
    const definition = createDefinition({
      execute: async () => {
        sideEffectCount += 1;
        return { ok: true };
      },
      reauthorize: async () =>
        createCapability({ schemaFingerprint: "schema-v2" }),
    });

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
    );

    expect(result).toEqual({ error: "tool_schema_changed" });
    expect(sideEffectCount).toBe(0);
  });

  test("rejects an execution-time transition to public MCP before its side effect", async () => {
    let sideEffectCount = 0;
    const definition = createDefinition({
      execute: async () => {
        sideEffectCount += 1;
        return { ok: true };
      },
      reauthorize: async () => createCapability({ source: "mcp" }),
    });

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
    );

    expect(result).toEqual({ error: "channel_not_allowed" });
    expect(sideEffectCount).toBe(0);
  });

  test("rejects an authoritative project change before its side effect", async () => {
    let sideEffectCount = 0;
    const definition = createDefinition({
      execute: async () => {
        sideEffectCount += 1;
        return { ok: true };
      },
      reauthorize: async () => createCapability({ projectId: "project-2" }),
    });

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
    );

    expect(result).toEqual({ error: "project_mismatch" });
    expect(sideEffectCount).toBe(0);
  });

  test("emits lifecycle activity without tool inputs or results", async () => {
    const starts: SafeToolActivity[] = [];
    const finishes: SafeToolActivity[] = [];
    const definition = createDefinition({
      execute: async () => ({ privateResult: "do-not-emit" }),
    });

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { privateInput: "do-not-emit" },
      {
        onStart: (event) => starts.push(event),
        onFinish: (event) => finishes.push(event),
      },
    );

    expect(result).toEqual({ privateResult: "do-not-emit" });
    expect(starts).toEqual([
      {
        toolId: "tool-1",
        displayName: "Check order",
        source: "http",
        status: "started",
        durationMs: 0,
      },
    ]);
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toMatchObject({
      toolId: "tool-1",
      displayName: "Check order",
      source: "http",
      status: "success",
    });
    expect(Object.keys(finishes[0]!).sort()).toEqual([
      "displayName",
      "durationMs",
      "source",
      "status",
      "toolId",
    ]);
    expect(JSON.stringify({ starts, finishes })).not.toContain("do-not-emit");
  });

  test("isolates a throwing finish callback after one successful side effect", async () => {
    let sideEffectCount = 0;
    let finishCount = 0;
    const definition = createDefinition({
      execute: async () => {
        sideEffectCount += 1;
        return { ok: true };
      },
    });

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { orderId: "order-1" },
      {
        onFinish: () => {
          finishCount += 1;
          throw new Error("activity collector unavailable");
        },
      },
    );

    expect(result).toEqual({ ok: true });
    expect(sideEffectCount).toBe(1);
    expect(finishCount).toBe(1);
  });
});

describe("createHttpToolDefinition", () => {
  test("recomputes the persisted HTTP contract for stale-call checks", async () => {
    let fetchCount = 0;
    const initial = createToolRow({ schemaFingerprint: "stale-stored-value" });
    const toolService = {
      async getAuthoritativeTool(): Promise<ToolRow | null> {
        return createToolRow({
          schemaFingerprint: "stale-stored-value",
          parameters: JSON.stringify([
            {
              name: "customerId",
              type: "string",
              description: "Customer identifier",
              required: true,
            },
          ]),
        });
      },
      async logExecution() {
        return { id: "execution-1" };
      },
    };
    globalThis.fetch = async () => {
      fetchCount += 1;
      return Response.json({ ok: true });
    };
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: initial,
      toolService,
      encryptionKey: "00".repeat(32),
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit: () => true,
      },
    } as never);

    expect(definition.capability.schemaFingerprint).not.toBe("stale-stored-value");
    expect(
      await executeRegisteredTool(
        definition,
        createContext("public"),
        { accountId: "account-1" },
      ),
    ).toEqual({ error: "tool_schema_changed" });
    expect(fetchCount).toBe(0);
  });

  test("does not register an HTTP tool with a malformed persisted contract", async () => {
    const malformed = createToolRow({ parameters: "{" });
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: malformed,
      toolService: {
        async getAuthoritativeTool() {
          return malformed;
        },
        async logExecution() {
          return { id: "execution-1" };
        },
      },
      encryptionKey: "00".repeat(32),
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches() {
            throw new Error("Malformed tools must not execute");
          },
        },
        acquireRateLimitPermit: () => true,
      },
    } as never);

    const registry = buildMavenToolRegistry({
      context: createContext("public"),
      definitions: [definition],
    });

    expect(registry.tools.lookup_account).toBeUndefined();
  });

  test("rejects a malformed authoritative contract before its side effect", async () => {
    let fetchCount = 0;
    const initial = createToolRow();
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: initial,
      toolService: {
        async getAuthoritativeTool() {
          return createToolRow({ parameters: "{" });
        },
        async logExecution() {
          return { id: "execution-1" };
        },
      },
      encryptionKey: "00".repeat(32),
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit: () => true,
      },
    } as never);
    globalThis.fetch = async () => {
      fetchCount += 1;
      return Response.json({ ok: true });
    };

    expect(
      await executeRegisteredTool(
        definition,
        createContext("public"),
        { accountId: "account-1" },
      ),
    ).toEqual({ error: "tool_unavailable" });
    expect(fetchCount).toBe(0);
  });

  test.each(["takeover", "close"])(
    "does not fetch or audit when public ownership loses a %s race",
    async () => {
      let fetchCount = 0;
      let auditCount = 0;
      const authoritative = createToolRow();
      const toolService = {
        async getAuthoritativeTool(): Promise<ToolRow | null> {
          return { ...authoritative };
        },
        async logExecution() {
          auditCount += 1;
          return { id: "execution-1" };
        },
      };
      globalThis.fetch = async () => {
        fetchCount += 1;
        return Response.json({ ok: true });
      };
      const definition = await createHttpToolDefinition({
        context: createContext("public"),
        tool: authoritative,
        toolService,
        encryptionKey: "00".repeat(32),
        publicExecution: {
          chatService: {
            async runExternalActionIfOwnershipMatches() {
              return { executed: false };
            },
          },
          acquireRateLimitPermit: () => true,
        },
      } as never);

      const result = await executeRegisteredTool(
        definition,
        createContext("public"),
        { accountId: "account-1" },
      );

      expect(result).toEqual({ error: "conversation_ownership_changed" });
      expect(fetchCount).toBe(0);
      expect(auditCount).toBe(0);
    },
  );

  test("checks the HTTP permit after ownership and denies without fetch or audit", async () => {
    const events: string[] = [];
    const authoritative = createToolRow();
    const toolService = {
      async getAuthoritativeTool(): Promise<ToolRow | null> {
        return { ...authoritative };
      },
      async logExecution() {
        events.push("audit");
        return { id: "execution-1" };
      },
    };
    globalThis.fetch = async () => {
      events.push("fetch");
      return Response.json({ ok: true });
    };
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: authoritative,
      toolService,
      encryptionKey: "00".repeat(32),
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            events.push("ownership");
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit() {
          events.push("permit");
          return false;
        },
      },
    } as never);

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
    );

    expect(result).toEqual({ error: "tool_rate_limited" });
    expect(events).toEqual(["ownership", "permit"]);
  });

  test("does not consume an HTTP permit for a blocked endpoint", async () => {
    let permitCount = 0;
    let auditCount = 0;
    const authoritative = createToolRow({
      endpoint: "http://127.0.0.1/private",
    });
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: authoritative,
      toolService: {
        async getAuthoritativeTool() {
          return { ...authoritative };
        },
        async logExecution() {
          auditCount += 1;
          return { id: "execution-1" };
        },
      },
      encryptionKey: "00".repeat(32),
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit() {
          permitCount += 1;
          return true;
        },
      },
    } as never);

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
    );

    expect(result).toEqual({
      error: "This endpoint URL is not allowed for security reasons.",
    });
    expect(permitCount).toBe(0);
    expect(auditCount).toBe(0);
  });

  test("does not consume an HTTP permit when request construction fails", async () => {
    let permitCount = 0;
    let fetchCount = 0;
    let auditCount = 0;
    const authoritative = createToolRow({ headers: "{" });
    globalThis.fetch = async () => {
      fetchCount += 1;
      return Response.json({ ok: true });
    };
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: authoritative,
      toolService: {
        async getAuthoritativeTool() {
          return { ...authoritative };
        },
        async logExecution() {
          auditCount += 1;
          return { id: "execution-1" };
        },
      },
      encryptionKey: "00".repeat(32),
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit() {
          permitCount += 1;
          return true;
        },
      },
    } as never);

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
    );

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(permitCount).toBe(0);
    expect(fetchCount).toBe(0);
    expect(auditCount).toBe(0);
  });

  test("audits one actual HTTP execution and returns its private execution id", async () => {
    const auditRows: Array<Record<string, unknown>> = [];
    const executionIds: string[] = [];
    const authoritative = createToolRow();
    const toolService = {
      async getAuthoritativeTool(): Promise<ToolRow | null> {
        return { ...authoritative };
      },
      async logExecution(data: Record<string, unknown>) {
        auditRows.push(data);
        return { id: "execution-1" };
      },
    };
    globalThis.fetch = async () =>
      Response.json({ account: { id: "account-1" } }, { status: 201 });
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: authoritative,
      toolService,
      encryptionKey: "00".repeat(32),
      collectExecutionId(id: string) {
        executionIds.push(id);
      },
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit: () => true,
      },
    } as never);

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
    );

    expect(result).toMatchObject({ success: true, httpStatus: 201 });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      toolId: "http-tool-1",
      conversationId: "conversation-1",
      input: { accountId: "account-1" },
      status: "success",
      httpStatus: 201,
      errorMessage: null,
    });
    expect(auditRows[0]?.duration).toBeNumber();
    expect(executionIds).toEqual(["execution-1"]);
  });

  test("does not retry or misreport a completed HTTP side effect when audit logging fails", async () => {
    let fetchCount = 0;
    const authoritative = createToolRow();
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: authoritative,
      toolService: {
        async getAuthoritativeTool() {
          return { ...authoritative };
        },
        async logExecution() {
          throw new Error("audit unavailable");
        },
      },
      encryptionKey: "00".repeat(32),
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit: () => true,
      },
    } as never);
    globalThis.fetch = async () => {
      fetchCount += 1;
      return Response.json({ ok: true });
    };

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
    );

    expect(result).toMatchObject({ success: true, httpStatus: 200 });
    expect(fetchCount).toBe(1);
  });

  test("does not fetch or audit an already-aborted caller as a timeout", async () => {
    let fetchCount = 0;
    let permitCount = 0;
    const auditRows: Array<Record<string, unknown>> = [];
    const authoritative = createToolRow({ timeout: 30_000 });
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: authoritative,
      toolService: {
        async getAuthoritativeTool() {
          return { ...authoritative };
        },
        async logExecution(data: Record<string, unknown>) {
          auditRows.push(data);
          return { id: "execution-aborted" };
        },
      },
      encryptionKey: "00".repeat(32),
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit() {
          permitCount += 1;
          return true;
        },
      },
    } as never);
    globalThis.fetch = async () => {
      fetchCount += 1;
      throw new DOMException("Aborted", "AbortError");
    };
    const caller = new AbortController();
    caller.abort(new DOMException("Visitor disconnected", "AbortError"));

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
      { abortSignal: caller.signal },
    );

    expect(result).toEqual({ error: "Tool execution cancelled by caller" });
    expect(fetchCount).toBe(0);
    expect(permitCount).toBe(0);
    expect(auditRows).toHaveLength(0);
  });

  test("audits one mid-flight caller cancellation as an error, not a timeout", async () => {
    const auditRows: Array<Record<string, unknown>> = [];
    const authoritative = createToolRow({ timeout: 30_000 });
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: authoritative,
      toolService: {
        async getAuthoritativeTool() {
          return { ...authoritative };
        },
        async logExecution(data: Record<string, unknown>) {
          auditRows.push(data);
          return { id: "execution-cancelled" };
        },
      },
      encryptionKey: "00".repeat(32),
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit: () => true,
      },
    } as never);
    let markFetchStarted = () => {};
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    let fetchCount = 0;
    globalThis.fetch = async (_input, init) => {
      fetchCount += 1;
      markFetchStarted();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    };
    const caller = new AbortController();

    const execution = executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
      { abortSignal: caller.signal },
    );
    await fetchStarted;
    caller.abort(new DOMException("Visitor disconnected", "AbortError"));
    const result = await execution;

    expect(result).toEqual({ error: "Tool execution cancelled by caller" });
    expect(fetchCount).toBe(1);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      status: "error",
      httpStatus: null,
      errorMessage: "Tool execution cancelled by caller",
      output: { error: "Tool execution cancelled by caller" },
    });
    expect(JSON.stringify(auditRows[0])).not.toContain("timed out");
    expect(JSON.stringify(auditRows[0])).not.toContain("30000ms");
  });

  test("retains executor timeout auditing for the executor timer", async () => {
    const auditRows: Array<Record<string, unknown>> = [];
    const authoritative = createToolRow({ timeout: 1 });
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: authoritative,
      toolService: {
        async getAuthoritativeTool() {
          return { ...authoritative };
        },
        async logExecution(data: Record<string, unknown>) {
          auditRows.push(data);
          return { id: "execution-timeout" };
        },
      },
      encryptionKey: "00".repeat(32),
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit: () => true,
      },
    } as never);
    globalThis.fetch = async (_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    };

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
    );

    expect(result).toEqual({ error: "Tool execution timed out after 1ms" });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      status: "timeout",
      httpStatus: null,
      errorMessage: "Tool execution timed out after 1ms",
    });
  });

  test("does not constrain a sidechat HTTP execution with public ownership", async () => {
    let fetchCount = 0;
    const authoritative = createToolRow({
      allowedChannels: '["sidechat"]',
    });
    const toolService = {
      async getAuthoritativeTool(): Promise<ToolRow | null> {
        return { ...authoritative };
      },
      async logExecution() {
        return { id: "execution-sidechat" };
      },
    };
    globalThis.fetch = async () => {
      fetchCount += 1;
      return Response.json({ ok: true });
    };
    const options = {
      context: createContext("sidechat"),
      tool: authoritative,
      toolService,
      encryptionKey: "00".repeat(32),
    };
    Object.defineProperty(options, "publicExecution", {
      get() {
        throw new Error("sidechat read public ownership fence");
      },
    });
    const definition = await createHttpToolDefinition(options as never);

    const result = await executeRegisteredTool(
      definition,
      createContext("sidechat"),
      { accountId: "account-1" },
    );

    expect(result).toMatchObject({ success: true });
    expect(fetchCount).toBe(1);
  });

  test("reloads authority and decrypts headers only for an authorized execution", async () => {
    const encryptionKey = "00".repeat(32);
    const encryptedHeaders = await encryptHeaders(
      { Authorization: "Bearer private-token" },
      encryptionKey,
    );
    let authoritative = createToolRow({ headers: encryptedHeaders });
    let receivedAuthorization: string | null = null;
    const toolService = {
      async getAuthoritativeTool(
        projectId: string,
        toolId: string,
      ): Promise<ToolRow | null> {
        if (
          projectId !== authoritative.projectId ||
          toolId !== authoritative.id
        ) {
          return null;
        }
        return { ...authoritative };
      },
    };
    globalThis.fetch = async (_input, init) => {
      receivedAuthorization = new Headers(init?.headers).get("Authorization");
      return Response.json({ account: { id: "account-1" } });
    };
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: authoritative,
      toolService,
      encryptionKey,
      publicExecution: {
        chatService: {
          async runExternalActionIfOwnershipMatches(
            _conversationId: string,
            _projectId: string,
            _ownership: unknown,
            action: () => Promise<unknown>,
          ) {
            return { executed: true, value: await action() };
          },
        },
        acquireRateLimitPermit: () => true,
      },
    } as never);

    const firstResult = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
    );
    authoritative = { ...authoritative, enabled: false };
    const disabledResult = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-2" },
    );

    expect(firstResult).toMatchObject({
      success: true,
      httpStatus: 200,
      data: { account: { id: "account-1" } },
    });
    expect(receivedAuthorization).toBe("Bearer private-token");
    expect(disabledResult).toEqual({ error: "tool_disabled" });
  });

  test("fails closed before decrypting malformed headers for a disallowed channel", async () => {
    let encryptionKeyRead = false;
    const authoritative = createToolRow({
      headers: btoa("x".repeat(28)),
      allowedChannels: '["sidechat"]',
    });
    const toolService = {
      async getAuthoritativeTool(): Promise<ToolRow | null> {
        return { ...authoritative };
      },
    };
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: createToolRow(),
      toolService,
      get encryptionKey() {
        encryptionKeyRead = true;
        return "not-a-valid-key";
      },
    });

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
    );

    expect(result).toEqual({ error: "channel_not_allowed" });
    expect(encryptionKeyRead).toBe(false);
  });

  test("does not fetch when authorized header decryption fails", async () => {
    let fetchCount = 0;
    const authoritative = createToolRow({
      headers: btoa("x".repeat(28)),
    });
    const toolService = {
      async getAuthoritativeTool(): Promise<ToolRow | null> {
        return { ...authoritative };
      },
    };
    globalThis.fetch = async () => {
      fetchCount += 1;
      return Response.json({ ok: true });
    };
    const definition = await createHttpToolDefinition({
      context: createContext("public"),
      tool: authoritative,
      toolService,
      encryptionKey: "00".repeat(32),
    });

    const result = await executeRegisteredTool(
      definition,
      createContext("public"),
      { accountId: "account-1" },
    );

    expect(result).toEqual({ error: "tool_unavailable" });
    expect(fetchCount).toBe(0);
  });
});
