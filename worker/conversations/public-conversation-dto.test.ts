import { describe, expect, test } from "bun:test";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../shared/maven-conversation";
import {
  toLegacyConversationDto,
  toLegacyLastMessagePreviewDto,
  toLegacyMessageDto,
} from "./public-conversation-dto";

describe("public conversation legacy DTOs", () => {
  test("preserves dashboard conversation JSON wire types", () => {
    const dto = toLegacyConversationDto({
      id: "conversation-1",
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      status: "active",
      closeReason: null,
      telegramThreadId: null,
      metadata: { country: "KR" },
      chatState: { state: "ai_active" },
      lastActivityAt: 1_800_000_000_000,
      visitorLastSeenAt: null,
      visitorPresence: "active",
      visitorLastOnlineAt: null,
      snoozedUntil: null,
      archivedAt: null,
      purgeStartedAt: null,
      externalActionStartedAt: null,
      priority: "medium",
      assigneeId: null,
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_001_000,
      ownershipRevision: 4,
    } satisfies PublicConversationRecord);

    expect(JSON.parse(JSON.stringify(dto))).toMatchObject({
      metadata: '{"country":"KR"}',
      chatState: '{"state":"ai_active"}',
      lastActivityAt: "2027-01-15T08:00:00.000Z",
      updatedAt: "2027-01-15T08:00:01.000Z",
    });
  });

  test("preserves message and preview role, JSON, and date fields", () => {
    const message = {
      id: "message-1",
      conversationId: "conversation-1",
      author: "bot",
      content: "Answer",
      imageUrls: ["/api/uploads/one.png", "/api/uploads/two.png"],
      sources: [{ title: "FAQ", url: null, type: "faq" }],
      senderName: "Maven",
      senderAvatar: null,
      userId: null,
      systemKind: null,
      createdAt: 1_800_000_000_000,
      deliveredAt: null,
      readAt: null,
      emailedAt: 1_800_000_001_000,
    } satisfies PublicMessageRecord;

    expect(JSON.parse(JSON.stringify(toLegacyMessageDto(message)))).toMatchObject({
      role: "bot",
      imageUrl: '["/api/uploads/one.png","/api/uploads/two.png"]',
      sources: '[{"title":"FAQ","url":null,"type":"faq"}]',
      createdAt: "2027-01-15T08:00:00.000Z",
      emailedAt: "2027-01-15T08:00:01.000Z",
    });
    expect(
      JSON.parse(
        JSON.stringify(
          toLegacyLastMessagePreviewDto({
            id: message.id,
            author: message.author,
            content: message.content,
            senderName: message.senderName,
            emailedAt: message.emailedAt,
            createdAt: message.createdAt,
          }),
        ),
      ),
    ).toMatchObject({
      role: "bot",
      createdAt: "2027-01-15T08:00:00.000Z",
    });
  });
});
