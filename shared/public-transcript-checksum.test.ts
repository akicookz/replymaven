import { describe, expect, test } from "bun:test";
import type { PublicMessageRecord } from "./maven-conversation";
import { publicTranscriptChecksum } from "./public-transcript-checksum";

function message(id: string, createdAt: number): PublicMessageRecord {
  return {
    id,
    conversationId: "conversation-1",
    author: "visitor",
    content: id,
    imageUrls: [],
    sources: [],
    senderName: null,
    senderAvatar: null,
    userId: null,
    systemKind: null,
    createdAt,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
  };
}

describe("public transcript checksum", () => {
  test("is order-stable but changes with persisted transcript content", async () => {
    const first = message("first", 1);
    const second = message("second", 2);
    const checksum = await publicTranscriptChecksum([second, first]);

    expect(await publicTranscriptChecksum([first, second])).toBe(checksum);
    expect(await publicTranscriptChecksum([
      first,
      { ...second, content: "changed" },
    ])).not.toBe(checksum);
  });
});
