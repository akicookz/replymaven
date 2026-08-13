import { describe, expect, test } from "bun:test";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../shared/maven-conversation";
import {
  compareConversationRuntimeIds,
  isCompatibilityProjectionDisableEligible,
  legacyDirectoryRevision,
  legacyEntryToSummary,
  runConversationDirectoryBackfillBatch,
  type ConversationDirectoryBackfillPort,
  type ConversationRuntimeCheckpoint,
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

function checkpoint(
  overrides: Partial<ConversationRuntimeCheckpoint> = {},
): ConversationRuntimeCheckpoint {
  return {
    projectId: "project-1",
    directoryCursor: null,
    directoryCompleteAt: null,
    agentCutoverAt: null,
    lastVerifiedAt: null,
    mismatchCount: 0,
    ...overrides,
  };
}

describe("conversation runtime backfill", () => {
  test("persists its cursor only after the parent confirms a batch", async () => {
    let saved: ConversationRuntimeCheckpoint = checkpoint();
    let failReconcile = true;
    const directory = new Map<string, unknown>();
    const port: ConversationDirectoryBackfillPort = {
      loadCheckpoint: async () => saved,
      readBatch: async (_projectId, cursor) =>
        cursor ? [] : [entry("a"), entry("b")],
      reconcile: async (_projectId, summaries) => {
        if (failReconcile) throw new Error("parent unavailable");
        summaries.forEach((summary) =>
          directory.set(summary.conversationId, summary)
        );
        return { applied: summaries.length, skipped: 0 };
      },
      saveProgress: async (input) => {
        saved = checkpoint({
          directoryCursor: input.directoryCursor,
          directoryCompleteAt: input.complete ? input.now : null,
        });
      },
    };

    await expect(runConversationDirectoryBackfillBatch(
      port,
      "project-1",
      { limit: 2, now: 500 },
    )).rejects.toThrow("parent unavailable");
    expect(saved.directoryCursor).toBeNull();

    failReconcile = false;
    await expect(runConversationDirectoryBackfillBatch(
      port,
      "project-1",
      { limit: 2, now: 500 },
    )).resolves.toMatchObject({
      processed: 2,
      complete: false,
      nextCursor: "b",
    });
    await expect(runConversationDirectoryBackfillBatch(
      port,
      "project-1",
      { limit: 2, now: 600 },
    )).resolves.toMatchObject({ processed: 0, complete: true });
    expect(saved).toMatchObject({
      directoryCursor: "b",
      directoryCompleteAt: 600,
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

  test("reports directory ids present on only one side", () => {
    expect(compareConversationRuntimeIds(
      ["shared", "legacy-only"],
      ["shared", "agent-only"],
    )).toEqual({
      legacyOnlyIds: ["legacy-only"],
      agentOnlyIds: ["agent-only"],
    });
  });

  test("requires a fresh clean parity check after seven quiet days", () => {
    const day = 24 * 60 * 60 * 1_000;
    const cutoverAt = 1_000;
    const quietPeriodEndsAt = cutoverAt + (7 * day);
    const cleanGate = {
      agentCutoverAt: cutoverAt,
      lastVerifiedAt: quietPeriodEndsAt,
      mismatchCount: 0,
      pendingOutboxCount: 0,
      lastLegacyRequestAt: null,
    };

    expect(isCompatibilityProjectionDisableEligible(
      cleanGate,
      quietPeriodEndsAt,
    )).toBe(true);
    expect(isCompatibilityProjectionDisableEligible({
      ...cleanGate,
      lastVerifiedAt: quietPeriodEndsAt - 1,
    }, quietPeriodEndsAt)).toBe(false);
    expect(isCompatibilityProjectionDisableEligible({
      ...cleanGate,
      lastLegacyRequestAt: cutoverAt + day,
    }, quietPeriodEndsAt)).toBe(false);
    expect(isCompatibilityProjectionDisableEligible({
      ...cleanGate,
      pendingOutboxCount: 1,
    }, quietPeriodEndsAt)).toBe(false);
  });
});
