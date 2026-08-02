import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { CustomerListItem } from "../../shared/customer-types";
import {
  appendCustomerPage,
  applyConversationCustomerResult,
  createCustomerFromConversation,
  customerFieldsToRows,
  invalidateCustomerProjectQueries,
  serializeCustomerFieldRows,
  shouldOfferCustomerAssignment,
} from "./customers";

function makeCustomer(id: string): CustomerListItem {
  return {
    id,
    externalId: null,
    name: id,
    email: null,
    phone: null,
    customFields: {},
    conversationCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

describe("customer field rows", () => {
  test("converts primitive custom fields to editable typed rows", () => {
    const rows = customerFieldsToRows({
      plan: "pro",
      seats: 5,
      renewed: true,
      cancellationReason: null,
    });

    expect(
      rows.map((row) => ({
        key: row.key,
        type: row.type,
        value: row.value,
      })),
    ).toEqual([
      { key: "plan", type: "string", value: "pro" },
      { key: "seats", type: "number", value: "5" },
      {
        key: "renewed",
        type: "boolean",
        value: true,
      },
      {
        key: "cancellationReason",
        type: "null",
        value: "",
      },
    ]);
  });

  test("rejects duplicate and empty field keys", () => {
    const result = serializeCustomerFieldRows([
      {
        id: "row-1",
        key: "plan",
        type: "string",
        value: "pro",
      },
      {
        id: "row-2",
        key: " plan ",
        type: "number",
        value: "5",
      },
      {
        id: "row-3",
        key: "",
        type: "boolean",
        value: false,
      },
    ]);

    expect(result).toEqual({
      success: false,
      errors: {
        "row-1": "Field keys must be unique",
        "row-2": "Field keys must be unique",
        "row-3": "Field key is required",
      },
    });
  });

  test("serializes typed primitive values without retired AI metadata", () => {
    const result = serializeCustomerFieldRows([
      {
        id: "row-1",
        key: "plan",
        type: "string",
        value: "pro",
      },
      {
        id: "row-2",
        key: "seats",
        type: "number",
        value: "12",
      },
      {
        id: "row-3",
        key: "renewed",
        type: "boolean",
        value: true,
      },
      {
        id: "row-4",
        key: "note",
        type: "null",
        value: "ignored",
      },
    ]);

    expect(result).toEqual({
      success: true,
      customFields: {
        plan: "pro",
        seats: 12,
        renewed: true,
        note: null,
      },
    });
  });
});

describe("customer cursor pages", () => {
  test("appends a cursor page without duplicating customers", () => {
    expect(
      appendCustomerPage(
        [makeCustomer("customer-1"), makeCustomer("customer-2")],
        {
          customers: [makeCustomer("customer-2"), makeCustomer("customer-3")],
          nextCursor: "next-page",
        },
      ).map((customer) => customer.id),
    ).toEqual(["customer-1", "customer-2", "customer-3"]);
  });
});

describe("customer project cache invalidation", () => {
  test("invalidates list and detail queries for only the changed project", async () => {
    const queryClient = new QueryClient();
    const projectOneList = ["customers", "project-1", "list", ""] as const;
    const projectOneDetail = [
      "customers",
      "project-1",
      "detail",
      "customer-1",
    ] as const;
    const projectTwoList = ["customers", "project-2", "list", ""] as const;
    queryClient.setQueryData(projectOneList, { customers: [] });
    queryClient.setQueryData(projectOneDetail, { id: "customer-1" });
    queryClient.setQueryData(projectTwoList, { customers: [] });

    await invalidateCustomerProjectQueries(queryClient, "project-1");

    expect(queryClient.getQueryState(projectOneList)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectOneDetail)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectTwoList)?.isInvalidated).toBe(false);
  });
});

describe("conversation customer cache updates", () => {
  test("offers customer assignment for anonymous archived conversations", () => {
    expect(shouldOfferCustomerAssignment(null, "2026-08-02T00:00:00.000Z")).toBe(
      true,
    );
    expect(shouldOfferCustomerAssignment("customer-1", null)).toBe(false);
  });

  test("links every returned conversation id and leaves unrelated rows unchanged", () => {
    const conversations = [
      { id: "conversation-1", customerId: null, label: "first" },
      { id: "conversation-2", customerId: null, label: "second" },
      { id: "conversation-3", customerId: "customer-old", label: "third" },
    ];
    const customer = {
      ...makeCustomer("customer-1"),
      visitors: [],
      conversations: [],
    };

    const updated = applyConversationCustomerResult(conversations, {
      customer,
      conversationIds: ["conversation-1", "conversation-2"],
    });

    expect(updated).toEqual([
      { id: "conversation-1", customerId: "customer-1", label: "first" },
      { id: "conversation-2", customerId: "customer-1", label: "second" },
      { id: "conversation-3", customerId: "customer-old", label: "third" },
    ]);
    expect(updated[2]).toBe(conversations[2]);
  });

  test("creates and links from the inbox with one atomic promotion request", async () => {
    const originalFetch = globalThis.fetch;
    const customer = {
      ...makeCustomer("customer-1"),
      visitors: [],
      conversations: [],
    };
    let requestedUrl = "";
    let requestedBody: unknown = null;
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      return Response.json({
        customer,
        conversationIds: ["conversation-1", "conversation-2"],
      });
    };

    try {
      const result = await createCustomerFromConversation(
        "project-1",
        "conversation-1",
        {
          externalId: "account-1",
          email: "sam@example.com",
          customFields: {},
        },
      );

      expect(requestedUrl).toBe(
        "/api/projects/project-1/conversations/conversation-1/customer",
      );
      expect(requestedBody).toEqual({
        action: "create",
        customer: {
          externalId: "account-1",
          email: "sam@example.com",
          customFields: {},
        },
      });
      expect(result.conversationIds).toEqual([
        "conversation-1",
        "conversation-2",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
