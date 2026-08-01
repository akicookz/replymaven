import { describe, expect, test } from "bun:test";
import { executeBulkConversationAction } from "./bulk-actions";

describe("bulk conversation requests", () => {
  test("runs chunks sequentially and reports partial failures by conversation id", async () => {
    const requestOrder: string[][] = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;

    const result = await executeBulkConversationAction({
      conversationIds: Array.from({ length: 205 }, (_, index) => `conv-${index}`),
      action: { action: "archive" },
      request: async (conversationIds) => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        requestOrder.push(conversationIds);
        await Promise.resolve();
        activeRequests -= 1;
        if (requestOrder.length === 2) throw new Error("temporary failure");
        return { updatedIds: conversationIds, skippedIds: [] };
      },
    });

    expect(maxActiveRequests).toBe(1);
    expect(requestOrder.map((ids) => ids.length)).toEqual([100, 100, 5]);
    expect(result.updatedIds).toHaveLength(105);
    expect(result.failedIds).toEqual(
      Array.from({ length: 100 }, (_, index) => `conv-${index + 100}`),
    );
  });
});
