import { describe, expect, test } from "bun:test";
import type { CustomerDetail } from "../../shared/customer-types";
import {
  handleConversationCustomer,
  handleCreateCustomer,
  handleDeleteCustomer,
  handleGetCustomer,
  handleListCustomers,
  handleMergeCustomers,
  handleSignedWidgetIdentify,
  handleUpdateCustomer,
  serializeProjectSettings,
} from "./customer-handlers";

function makeCustomer(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: "customer-1",
    externalId: "account-1",
    name: "Sam",
    email: "sam@example.com",
    phone: null,
    customFields: {},
    conversationCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    visitors: [],
    conversations: [],
    ...overrides,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("customer handlers", () => {
  test("lists a page and creates a trusted dashboard customer", async () => {
    const customer = makeCustomer();
    const customerChanges: string[][] = [];
    const listResponse = await handleListCustomers({
      projectId: "project-1",
      query: { query: "sam", limit: "25" },
      customerService: {
        async listCustomers(projectId, options) {
          expect(projectId).toBe("project-1");
          expect(options).toEqual({ query: "sam", cursor: undefined, limit: 25 });
          return { customers: [customer], nextCursor: null };
        },
      },
    });
    const createResponse = await handleCreateCustomer({
      projectId: "project-1",
      body: { email: "sam@example.com" },
      identityService: {
        async createCustomer() {
          return { kind: "created", customer };
        },
      },
      onCustomersChanged(ids) {
        customerChanges.push(ids);
      },
    });

    expect(await readJson(listResponse)).toEqual({
      customers: [customer],
      nextCursor: null,
    });
    expect(createResponse.status).toBe(201);
    expect(await readJson(createResponse)).toEqual(customer);
    expect(customerChanges).toEqual([["customer-1"]]);
  });

  test("returns validation, duplicate, and identity conflict responses", async () => {
    const invalid = await handleCreateCustomer({
      projectId: "project-1",
      body: { name: "No stable identity" },
      identityService: {
        async createCustomer() {
          throw new Error("must not be called");
        },
      },
    });
    const duplicate = await handleCreateCustomer({
      projectId: "project-1",
      body: { email: "sam@example.com" },
      identityService: {
        async createCustomer() {
          return { kind: "existing_customer", customerId: "customer-1" };
        },
      },
    });
    const conflict = await handleCreateCustomer({
      projectId: "project-1",
      body: { email: "sam@example.com", externalId: "account-1" },
      identityService: {
        async createCustomer() {
          return {
            kind: "conflict",
            customerIds: ["customer-1", "customer-2"],
          };
        },
      },
    });

    expect(invalid.status).toBe(400);
    expect(duplicate.status).toBe(409);
    expect(await readJson(duplicate)).toEqual({
      error: "customer_exists",
      customerId: "customer-1",
    });
    expect(conflict.status).toBe(409);
    expect(await readJson(conflict)).toEqual({
      error: "identity_conflict",
      customerIds: ["customer-1", "customer-2"],
    });
  });

  test("maps project-safe reads and typed updates", async () => {
    const customer = makeCustomer({ name: "New name" });
    const customerChanges: string[][] = [];
    const getResponse = await handleGetCustomer({
      projectId: "project-1",
      customerId: "customer-1",
      customerService: {
        async getCustomerDetail() {
          return customer;
        },
      },
    });
    const updateResponse = await handleUpdateCustomer({
      projectId: "project-1",
      customerId: "customer-1",
      body: { name: "New name" },
      identityService: {
        async updateCustomer() {
          return { kind: "updated", customer };
        },
      },
      onCustomersChanged(ids) {
        customerChanges.push(ids);
      },
    });
    const missing = await handleUpdateCustomer({
      projectId: "project-2",
      customerId: "customer-1",
      body: { name: "Wrong project" },
      identityService: {
        async updateCustomer() {
          return { kind: "not_found" };
        },
      },
    });

    expect(await readJson(getResponse)).toEqual(customer);
    expect(await readJson(updateResponse)).toEqual(customer);
    expect(missing.status).toBe(404);
    expect(customerChanges).toEqual([["customer-1"]]);
  });

  test("returns update conflicts without logging side effects", async () => {
    const logged: string[] = [];
    const response = await handleUpdateCustomer({
      projectId: "project-1",
      customerId: "customer-1",
      body: { email: "owned@example.com" },
      identityService: {
        async updateCustomer() {
          return {
            kind: "conflict",
            customerIds: ["customer-1", "customer-2"],
          };
        },
      },
      logOperation(event) {
        logged.push(event);
      },
    });

    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({
      error: "identity_conflict",
      customerIds: ["customer-1", "customer-2"],
    });
    expect(logged).toEqual([]);
  });

  test("returns identity-only merge and conversation-link responses", async () => {
    const customer = makeCustomer();
    const changed: string[][] = [];
    const customerChanges: string[][] = [];
    const merged = await handleMergeCustomers({
      projectId: "project-1",
      targetCustomerId: "customer-1",
      body: { sourceCustomerId: "customer-2" },
      identityService: {
        async mergeCustomers() {
          return {
            kind: "merged",
            customerId: "customer-1",
            conversationIds: ["conversation-1"],
          };
        },
      },
      onConversationsChanged(ids) {
        changed.push(ids);
      },
      onCustomersChanged(ids) {
        customerChanges.push(ids);
      },
    });
    const linked = await handleConversationCustomer({
      projectId: "project-1",
      conversationId: "conversation-1",
      body: { action: "link", customerId: "customer-1" },
      identityService: {
        async promoteConversation() {
          throw new Error("wrong branch");
        },
        async linkConversation() {
          return {
            kind: "linked",
            customer,
            conversationIds: ["conversation-1", "conversation-2"],
          };
        },
      },
      onConversationsChanged(ids) {
        changed.push(ids);
      },
      onCustomersChanged(ids) {
        customerChanges.push(ids);
      },
    });

    expect(await readJson(merged)).toEqual({
      customerId: "customer-1",
      conversationIds: ["conversation-1"],
    });
    expect(await readJson(linked)).toEqual({
      customer,
      conversationIds: ["conversation-1", "conversation-2"],
    });
    expect(changed).toEqual([
      ["conversation-1"],
      ["conversation-1", "conversation-2"],
    ]);
    expect(customerChanges).toEqual([
      ["customer-1", "customer-2"],
      ["customer-1"],
    ]);
  });

  test("unlinks conversations when deleting a customer", async () => {
    const changed: string[][] = [];
    const customerChanges: string[][] = [];
    const response = await handleDeleteCustomer({
      projectId: "project-1",
      customerId: "customer-1",
      identityService: {
        async deleteCustomer() {
          return {
            customerId: "customer-1",
            conversationIds: ["conversation-1"],
          };
        },
      },
      onConversationsChanged(ids) {
        changed.push(ids);
      },
      onCustomersChanged(ids) {
        customerChanges.push(ids);
      },
    });

    expect(await readJson(response)).toEqual({
      customerId: "customer-1",
      conversationIds: ["conversation-1"],
    });
    expect(changed).toEqual([["conversation-1"]]);
    expect(customerChanges).toEqual([["customer-1"]]);
  });
});

describe("signed widget identify handler", () => {
  test("verifies the token, validates conversation ownership, and returns acknowledgment only", async () => {
    const customer = makeCustomer();
    const changed: string[][] = [];
    const customerChanges: string[][] = [];
    const response = await handleSignedWidgetIdentify({
      projectId: "project-1",
      body: {
        visitorId: "visitor-1",
        conversationId: "conversation-1",
        token: "payload.signature",
      },
      encryptedSecret: "encrypted-secret",
      encryptionKey: "encryption-key",
      nowSeconds: 1_800_000_100,
      async verifyToken() {
        return {
          v: 1,
          projectId: "project-1",
          externalId: "account-1",
          iat: 1_800_000_000,
          exp: 1_800_000_900,
        };
      },
      async getConversation() {
        return { visitorId: "visitor-1" };
      },
      identityService: {
        async identifySignedVisitor() {
          return {
            kind: "linked",
            customer,
            conversationIds: [],
          };
        },
      },
      onConversationsChanged(ids) {
        changed.push(ids);
      },
      onCustomersChanged(ids) {
        customerChanges.push(ids);
      },
    });

    expect(await readJson(response)).toEqual({ identified: true });
    expect(changed).toEqual([]);
    expect(customerChanges).toEqual([["customer-1"]]);
  });

  test("rejects invalid tokens, mismatched conversations, and identity conflicts", async () => {
    const base = {
      projectId: "project-1",
      encryptedSecret: "encrypted-secret",
      encryptionKey: "encryption-key",
      nowSeconds: 1_800_000_100,
      async getConversation() {
        return { visitorId: "visitor-other" };
      },
      identityService: {
        async identifySignedVisitor() {
          return {
            kind: "conflict" as const,
            customerIds: ["customer-1", "customer-2"] as [string, string],
          };
        },
      },
    };
    const invalid = await handleSignedWidgetIdentify({
      ...base,
      body: { visitorId: "visitor-1", token: "bad-token" },
      async verifyToken() {
        throw new Error("invalid");
      },
    });
    const mismatched = await handleSignedWidgetIdentify({
      ...base,
      body: {
        visitorId: "visitor-1",
        conversationId: "conversation-1",
        token: "payload.signature",
      },
      async verifyToken() {
        return {
          v: 1 as const,
          projectId: "project-1",
          externalId: "account-1",
          iat: 1_800_000_000,
          exp: 1_800_000_900,
        };
      },
    });
    const conflict = await handleSignedWidgetIdentify({
      ...base,
      body: { visitorId: "visitor-1", token: "payload.signature" },
      async verifyToken() {
        return {
          v: 1 as const,
          projectId: "project-1",
          externalId: "account-1",
          iat: 1_800_000_000,
          exp: 1_800_000_900,
        };
      },
    });

    expect(invalid.status).toBe(401);
    expect(mismatched.status).toBe(404);
    expect(conflict.status).toBe(409);
  });
});

describe("project settings serialization", () => {
  test("never exposes the encrypted identity secret", () => {
    expect(
      serializeProjectSettings({
        id: "settings-1",
        customerIdentitySecret: "encrypted-secret",
      }),
    ).toEqual({
      id: "settings-1",
      customerIdentitySecretConfigured: true,
    });
  });
});
