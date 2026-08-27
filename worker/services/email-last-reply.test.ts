import { describe, expect, test } from "bun:test";
import type { PublicMessageRecord } from "../../shared/maven-conversation";
import { findLastAgentReply } from "./email-last-reply";

function message(
  overrides: Partial<PublicMessageRecord> & Pick<PublicMessageRecord, "id" | "author">,
): PublicMessageRecord {
  return {
    conversationId: "conv-1",
    content: overrides.content ?? overrides.id,
    imageUrls: [],
    sources: [],
    senderName: null,
    senderAvatar: null,
    userId: null,
    systemKind: null,
    createdAt: 1,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
    ...overrides,
  };
}

describe("findLastAgentReply", () => {
  test("returns the latest agent row", () => {
    expect(findLastAgentReply([
      message({ id: "v1", author: "visitor" }),
      message({ id: "a1", author: "agent" }),
      message({ id: "b1", author: "bot" }),
      message({ id: "a2", author: "agent" }),
    ])?.id).toBe("a2");
  });

  test("ignores bot and visitor rows", () => {
    expect(findLastAgentReply([
      message({ id: "v1", author: "visitor" }),
      message({ id: "b1", author: "bot" }),
    ])).toBeNull();
  });
});
