import { describe, expect, test } from "bun:test";
import {
  authorizeCapability,
  fingerprintJsonSchema,
  parseAllowedChannels,
} from "./tool-capability";
import {
  type MavenToolCapability,
  type MavenTurnContext,
} from "../types";

function createContext(channel: MavenTurnContext["channel"]): MavenTurnContext {
  return {
    channel,
    projectId: "project-1",
    conversationId: "conversation-1",
    actorUserId: "user-1",
    customerId: "customer-1",
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

describe("authorizeCapability", () => {
  test("allows a public capability only for public turns", () => {
    const publicOnly = createCapability();

    expect(authorizeCapability(createContext("public"), publicOnly)).toEqual({
      ok: true,
    });
    expect(authorizeCapability(createContext("sidechat"), publicOnly)).toEqual({
      ok: false,
      code: "channel_not_allowed",
    });
  });

  test("allows a sidechat capability only for sidechat turns", () => {
    const sidechatOnly = createCapability({ allowedChannels: ["sidechat"] });

    expect(authorizeCapability(createContext("sidechat"), sidechatOnly)).toEqual({
      ok: true,
    });
    expect(authorizeCapability(createContext("public"), sidechatOnly)).toEqual({
      ok: false,
      code: "channel_not_allowed",
    });
  });

  test("rejects disabled capabilities", () => {
    const disabled = createCapability({ enabled: false });

    expect(authorizeCapability(createContext("public"), disabled)).toEqual({
      ok: false,
      code: "tool_disabled",
    });
  });

  test("rejects capabilities from another project", () => {
    const anotherProject = createCapability({ projectId: "project-2" });

    expect(authorizeCapability(createContext("public"), anotherProject)).toEqual({
      ok: false,
      code: "project_mismatch",
    });
  });

  test("denies MCP capabilities from public turns regardless of their audience", () => {
    const mcpCapability = createCapability({
      source: "mcp",
      allowedChannels: ["public", "sidechat"],
    });

    expect(authorizeCapability(createContext("public"), mcpCapability)).toEqual({
      ok: false,
      code: "channel_not_allowed",
    });
  });
});

describe("fingerprintJsonSchema", () => {
  test("produces the same SHA-256 fingerprint for equivalent schemas", async () => {
    const first = await fingerprintJsonSchema({
      type: "object",
      properties: {
        orderId: { type: "string" },
        includeHistory: { type: "boolean" },
      },
      required: ["orderId"],
    });
    const equivalent = await fingerprintJsonSchema({
      required: ["orderId"],
      properties: {
        includeHistory: { type: "boolean" },
        orderId: { type: "string" },
      },
      type: "object",
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(equivalent).toBe(first);
  });

  test("changes the fingerprint when a schema changes", async () => {
    const original = await fingerprintJsonSchema({
      type: "object",
      properties: { orderId: { type: "string" } },
    });
    const changed = await fingerprintJsonSchema({
      type: "object",
      properties: { orderId: { type: "number" } },
    });

    expect(changed).not.toBe(original);
  });

  test("preserves a parsed __proto__ schema key in the fingerprint", async () => {
    const empty = await fingerprintJsonSchema({});
    const schema = JSON.parse('{"__proto__":{"type":"string"}}') as unknown;

    expect(await fingerprintJsonSchema(schema)).not.toBe(empty);
  });
});

test("parseAllowedChannels fails closed for malformed or unknown values", () => {
  expect(parseAllowedChannels('["public", "sidechat"]')).toEqual([
    "public",
    "sidechat",
  ]);
  expect(parseAllowedChannels('{"channel":"public"}')).toEqual([]);
  expect(parseAllowedChannels('["internal"]')).toEqual([]);
});
