import { describe, expect, test } from "bun:test";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../shared/maven-conversation";
import {
  legacyDirectoryRevision,
  legacyEntryToSummary,
  runConversationDirectoryBackfillBatch,
  type ConversationDirectoryBackfillPort,
  type LegacyDirectoryEntry,
} from "./conversation-runtime-backfill";

function conversation(id: string, updatedAt = 100): PublicConversationRecord {
  return {
    id,
    projectId: "project-1",
    customerId: null,
    visitorId: `visitor-${id}`,
    visitorName: id,
    visitorEmail: `${id}@example.com`,
    status: "active",
    closeReason: null,
    telegramThreadId: null,
    metadata: {},
    chatState: {},
    lastActivityAt: updatedAt,
    visitorLastSeenAt: null,
    visitorPresence: "active",
    visitorLastOnlineAt: null,
    snoozedUntil: null,
    archivedAt: null,
    purgeStartedAt: null,
    externalActionStartedAt: null,
    priority: "medium",
    assigneeId: null,
    createdAt: 1,
    updatedAt,
    ownershipRevision: 0,
  };
}

function message(conversationId: string, id: string): PublicMessageRecord {
  return {
    id,
    conversationId,
    author: "bot",
    content: id,
    imageUrls: [],
    sources: [],
    senderName: null,
    senderAvatar: null,
    userId: null,
    systemKind: null,
    createdAt: 2,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
  };
}

function entry(id: string): LegacyDirectoryEntry {
  return {
    conversation: conversation(id),
    messages: [message(id, `message-${id}`)],
  };
}

describe("conversation runtime backfill", () => {
  test("propagates a failed reconcile instead of advancing the cursor", async () => {
    let failReconcile = true;
    const directory = new Map<string, unknown>();
    const port: ConversationDirectoryBackfillPort = {
      readBatch: async (_projectId, cursor) =>
        cursor ? [] : [entry("a"), entry("b")],
      reconcile: async (_projectId, summaries) => {
        if (failReconcile) throw new Error("parent unavailable");
        summaries.forEach((summary) =>
          directory.set(summary.conversationId, summary)
        );
        return { applied: summaries.length, skipped: 0 };
      },
    };

    await expect(runConversationDirectoryBackfillBatch(
      port,
      "project-1",
      { limit: 2 },
    )).rejects.toThrow("parent unavailable");
    expect(directory.size).toBe(0);

    failReconcile = false;
    await expect(runConversationDirectoryBackfillBatch(
      port,
      "project-1",
      { limit: 2 },
    )).resolves.toMatchObject({
      processed: 2,
      complete: false,
      nextCursor: "b",
    });
    await expect(runConversationDirectoryBackfillBatch(
      port,
      "project-1",
      { cursor: "b", limit: 2 },
    )).resolves.toMatchObject({
      processed: 0,
      complete: true,
      nextCursor: null,
    });
    expect(directory.size).toBe(2);
  });

  test("uses a legacy revision epoch below every native child revision", async () => {
    const summary = await legacyEntryToSummary(entry("a"));
    expect(summary).toMatchObject({
      conversationId: "a",
      messageCount: 1,
      botMessageCount: 1,
      lastMessageId: "message-a",
    });
    expect(summary.childRevision).toBeLessThan(0);
    expect(summary.sourceChecksum).toHaveLength(64);
    expect(legacyDirectoryRevision(101)).toBeGreaterThan(
      legacyDirectoryRevision(100),
    );
  });

});
