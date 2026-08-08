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
  } = {},
): Promise<unknown> {
  const { tools } = buildMavenToolRegistry({
    context,
    definitions: [definition],
    ...callbacks,
  });
  const registered = tools[definition.capability.modelName];
  if (!registered || typeof registered.execute !== "function") {
    throw new Error("Expected an executable registry tool");
  }

  return registered.execute(input, {
    toolCallId: "test-call",
    messages: [],
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
});

describe("createHttpToolDefinition", () => {
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
    });

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
});
