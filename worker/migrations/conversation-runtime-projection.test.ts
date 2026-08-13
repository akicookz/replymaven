import { describe, expect, test } from "bun:test";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../shared/maven-conversation";
import { projectPublicConversationSnapshot } from "./conversation-runtime-projection";

describe("conversation runtime compatibility projection", () => {
  test("writes the conversation and a replacement transcript in one D1 batch", async () => {
    const bound: unknown[][] = [];
    const database = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            bound.push([query, ...values]);
            return { query, values };
          },
        };
      },
      async batch(statements: unknown[]) {
        expect(statements).toHaveLength(3);
        return [];
      },
    } as unknown as D1Database;
    const conversation = {
      id: "conversation-1",
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: null,
      visitorEmail: null,
      status: "active",
      closeReason: null,
      telegramThreadId: null,
      metadata: {},
      chatState: {},
      lastActivityAt: 2_000,
      visitorLastSeenAt: null,
      visitorPresence: "active",
      visitorLastOnlineAt: null,
      snoozedUntil: null,
      archivedAt: null,
      purgeStartedAt: null,
      externalActionStartedAt: null,
      priority: "medium",
      assigneeId: null,
      createdAt: 1_000,
      updatedAt: 2_000,
      ownershipRevision: 0,
    } satisfies PublicConversationRecord;
    const message = {
      id: "message-1",
      conversationId: conversation.id,
      author: "visitor",
      content: "hello",
      imageUrls: [],
      sources: [],
      senderName: null,
      senderAvatar: null,
      userId: null,
      systemKind: null,
      createdAt: 2_000,
      deliveredAt: null,
      readAt: null,
      emailedAt: null,
    } satisfies PublicMessageRecord;

    await projectPublicConversationSnapshot(database, conversation, [message]);

    expect(String(bound[0]?.[0])).toContain("ON CONFLICT(id) DO UPDATE");
    expect(String(bound[1]?.[0])).toContain("DELETE FROM messages");
    expect(String(bound[2]?.[0])).toContain("INSERT INTO messages");
  });
});
