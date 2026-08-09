import { describe, expect, test } from "bun:test";
import {
  bulkConversationActionSchema,
  conversationCustomerSchema,
  createToolSchema,
  createCustomerSchema,
  customerListQuerySchema,
  customerIdentityTokenPayloadSchema,
  mergeCustomerSchema,
  signedWidgetIdentifySchema,
  sidechatHistoryQuerySchema,
  sidechatMessageSchema,
  sidechatRetrySchema,
  updateToolSchema,
  updateCustomerSchema,
} from "./validation";
import * as validation from "./validation";

describe("sidechat validation contracts", () => {
  test("trims an explicit private message and accepts an omitted server default", () => {
    expect(sidechatMessageSchema.parse({ content: "  Help with this  " }))
      .toEqual({ content: "Help with this" });
    expect(sidechatMessageSchema.parse({})).toEqual({});
  });

  test("rejects empty, oversized, and untrusted sidechat message fields", () => {
    for (const body of [
      { content: "   " },
      { content: "x".repeat(5_001) },
      { content: "Help", metadata: { customerId: "customer-private" } },
    ]) {
      expect(sidechatMessageSchema.safeParse(body).success).toBe(false);
    }
  });

  test("requires an exact retry message id payload", () => {
    expect(sidechatRetrySchema.parse({ messageId: "  message-1  " }))
      .toEqual({ messageId: "message-1" });
    expect(sidechatRetrySchema.safeParse({ messageId: "" }).success)
      .toBe(false);
    expect(
      sidechatRetrySchema.safeParse({
        messageId: "message-1",
        content: "visitor supplied override",
      }).success,
    ).toBe(false);
  });

  test("bounds sidechat history pagination and validates ISO cursors", () => {
    expect(sidechatHistoryQuerySchema.parse({})).toEqual({ limit: 40 });
    expect(
      sidechatHistoryQuerySchema.parse({
        before: "2026-08-09T12:00:00.000Z",
        limit: "25",
      }),
    ).toEqual({ before: "2026-08-09T12:00:00.000Z", limit: 25 });
    expect(
      sidechatHistoryQuerySchema.safeParse({ before: "not-a-date" }).success,
    ).toBe(false);
    expect(sidechatHistoryQuerySchema.safeParse({ limit: "101" }).success)
      .toBe(false);
  });
});

describe("tool audience validation", () => {
  const validTool = {
    name: "lookup_order",
    displayName: "Look up order",
    description: "Find an order by its reference number.",
    endpoint: "https://api.example.com/orders",
  };

  test("defaults new HTTP tools to public read-only access", () => {
    expect(createToolSchema.parse(validTool)).toMatchObject({
      allowedChannels: ["public"],
      access: "read",
    });
  });

  test("accepts a preset create payload with no headers", () => {
    expect(
      createToolSchema.safeParse({ ...validTool, headers: null }).success,
    ).toBe(true);
  });

  test("rejects empty and duplicate tool audiences", () => {
    expect(() => updateToolSchema.parse({ allowedChannels: [] })).toThrow();
    expect(() =>
      updateToolSchema.parse({ allowedChannels: ["public", "public"] }),
    ).toThrow();
  });

  test.each(["search_knowledge", "request_team_help"])(
    "rejects the reserved internal Maven tool name %s",
    (name) => {
      expect(
        createToolSchema.safeParse({ ...validTool, name }).success,
      ).toBe(false);
    },
  );
});

describe("customer validation contracts", () => {
  test("exports every customer identity schema used by HTTP boundaries", () => {
    const exportedSchemas = validation as Record<string, unknown>;

    expect(exportedSchemas.createCustomerSchema).toBeDefined();
    expect(exportedSchemas.updateCustomerSchema).toBeDefined();
    expect(exportedSchemas.conversationCustomerSchema).toBeDefined();
    expect(exportedSchemas.customerIdentityTokenPayloadSchema).toBeDefined();
    expect(exportedSchemas.customerListQuerySchema).toBeDefined();
    expect(exportedSchemas.mergeCustomerSchema).toBeDefined();
    expect(exportedSchemas.signedWidgetIdentifySchema).toBeDefined();
  });

  test("accepts either email or external id as the stable identity", () => {
    const emailOnly = {
      email: "sam@example.com",
      customFields: { plan: "starter" },
    };
    const externalOnly = {
      externalId: "account_123",
      customFields: {},
    };

    expect(createCustomerSchema.safeParse(emailOnly).success).toBe(true);
    expect(createCustomerSchema.safeParse(externalOnly).success).toBe(true);
  });

  test("rejects customer creation without a stable identity", () => {
    const result = createCustomerSchema.safeParse({
      name: "Sam",
      customFields: {},
    });

    expect(result.success).toBe(false);
  });

  test("rejects nested and array custom-field values", () => {
    const nested = createCustomerSchema.safeParse({
      email: "sam@example.com",
      customFields: { preferences: { language: "en" } },
    });
    const array = createCustomerSchema.safeParse({
      email: "sam@example.com",
      customFields: { products: ["chat", "helpdesk"] },
    });

    expect(nested.success).toBe(false);
    expect(array.success).toBe(false);
  });

  test("enforces custom-field count, key, value, and byte limits", () => {
    const tooManyFields = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`field_${index}`, index]),
    );
    const overByteLimit = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `field_${index}`,
        "x".repeat(500),
      ]),
    );
    const invalidFields = [
      tooManyFields,
      { ["k".repeat(65)]: "value" },
      { note: "x".repeat(501) },
      overByteLimit,
    ];

    for (const customFields of invalidFields) {
      const result = createCustomerSchema.safeParse({
        email: "sam@example.com",
        customFields,
      });
      expect(result.success).toBe(false);
    }
  });

  test("rejects retired AI fields at customer and token boundaries", () => {
    const create = createCustomerSchema.safeParse({
      email: "sam@example.com",
      customFields: { plan: "starter" },
      aiFieldKeys: ["plan"],
    });
    const update = updateCustomerSchema.safeParse({
      customFields: { plan: "starter" },
      aiFieldKeys: ["plan"],
    });
    const token = customerIdentityTokenPayloadSchema.safeParse({
      v: 1,
      projectId: "project_123",
      externalId: "account_123",
      customFields: { plan: "starter" },
      aiFieldKeys: ["plan"],
      iat: 1_800_000_000,
      exp: 1_800_000_900,
    });

    expect(create.success).toBe(false);
    expect(update.success).toBe(false);
    expect(token.success).toBe(false);
  });

  test("allows profile updates without requiring another stable identity", () => {
    const result = updateCustomerSchema.safeParse({
      externalId: "account-2",
      name: "Sam Lee",
      customFields: { plan: "pro" },
    });

    expect(result.success).toBe(true);
  });

  test("accepts only the create and link conversation-customer variants", () => {
    const create = conversationCustomerSchema.safeParse({
      action: "create",
      customer: {
        email: "sam@example.com",
        customFields: {},
      },
    });
    const link = conversationCustomerSchema.safeParse({
      action: "link",
      customerId: "customer_123",
    });
    const invalid = conversationCustomerSchema.safeParse({
      action: "link",
      customer: { email: "sam@example.com" },
    });

    expect(create.success).toBe(true);
    expect(link.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  test("enforces signed token version, stable identity, and lifetime", () => {
    const base = {
      v: 1,
      projectId: "project_123",
      email: "sam@example.com",
      iat: 1_800_000_000,
      exp: 1_800_000_900,
    } as const;
    const invalidPayloads = [
      { ...base, v: 2 },
      { v: 1, projectId: "project_123", iat: base.iat, exp: base.exp },
      { ...base, exp: base.iat },
      { ...base, exp: base.iat + 3_601 },
    ];

    expect(customerIdentityTokenPayloadSchema.safeParse(base).success).toBe(true);
    for (const payload of invalidPayloads) {
      expect(
        customerIdentityTokenPayloadSchema.safeParse(payload).success,
      ).toBe(false);
    }
  });

  test("validates customer list pagination and merge bodies", () => {
    expect(
      customerListQuerySchema.safeParse({
        query: "sam",
        cursor: "opaque-cursor",
        limit: "25",
      }),
    ).toMatchObject({ success: true });
    expect(
      customerListQuerySchema.safeParse({ limit: "101" }).success,
    ).toBe(false);
    expect(
      mergeCustomerSchema.safeParse({ sourceCustomerId: "customer-source" })
        .success,
    ).toBe(true);
    expect(mergeCustomerSchema.safeParse({}).success).toBe(false);
  });

  test("requires a visitor and opaque token for signed widget identification", () => {
    expect(
      signedWidgetIdentifySchema.safeParse({
        visitorId: "visitor-1",
        conversationId: "conversation-1",
        token: "payload.signature",
      }).success,
    ).toBe(true);
    expect(
      signedWidgetIdentifySchema.safeParse({
        visitorId: "visitor-1",
        token: "",
      }).success,
    ).toBe(false);
  });

  test("accepts the base64url expansion of the documented custom-field budget", () => {
    expect(
      signedWidgetIdentifySchema.safeParse({
        visitorId: "visitor-1",
        token: `payload.${"x".repeat(25_000)}`,
      }).success,
    ).toBe(true);
    expect(
      signedWidgetIdentifySchema.safeParse({
        visitorId: "visitor-1",
        token: `payload.${"x".repeat(32_768)}`,
      }).success,
    ).toBe(false);
  });
});

describe("bulkConversationActionSchema", () => {
  test("accepts every supported action contract", () => {
    const payloads = [
      { action: "archive", conversationIds: ["conv-1"] },
      { action: "unarchive", conversationIds: ["conv-1"] },
      { action: "resolve", conversationIds: ["conv-1"] },
      { action: "snooze", conversationIds: ["conv-1"], until: 1_786_000_000_000 },
      { action: "assign", conversationIds: ["conv-1"], assigneeId: null },
      { action: "priority", conversationIds: ["conv-1"], priority: "high" },
      { action: "flag_spam", conversationIds: ["conv-1"] },
    ];

    for (const payload of payloads) {
      expect(bulkConversationActionSchema.safeParse(payload).success).toBe(true);
    }
  });

  test("rejects duplicate, empty, and oversized selections", () => {
    const invalidSelections = [
      [],
      ["conv-1", "conv-1"],
      Array.from({ length: 101 }, (_, index) => `conv-${index}`),
    ];

    for (const conversationIds of invalidSelections) {
      expect(bulkConversationActionSchema.safeParse({
        action: "archive",
        conversationIds,
      }).success).toBe(false);
    }
  });
});
