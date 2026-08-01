import { describe, expect, test } from "bun:test";
import { bulkConversationActionSchema } from "./validation";

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
