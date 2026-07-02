import { describe, expect, test } from "bun:test";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { ChatService } from "./chat-service";
import { type ConversationRow } from "../db";

function makeConversation(overrides: Partial<ConversationRow>): ConversationRow {
  const now = new Date();
  return {
    id: "conv-1",
    projectId: "project-1",
    visitorId: "visitor-1",
    visitorName: null,
    visitorEmail: null,
    status: "active",
    closeReason: null,
    telegramThreadId: null,
    metadata: null,
    chatState: null,
    lastActivityAt: now,
    visitorLastSeenAt: null,
    visitorPresence: "active",
    visitorLastOnlineAt: null,
    snoozedUntil: null,
    priority: "medium",
    assigneeId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Proves the guarded rows never reach a write, not just that they're excluded
// from the returned id list — any DB access throws immediately.
function makeUntouchedDb(): DrizzleD1Database<Record<string, unknown>> {
  return new Proxy(
    {},
    {
      get(): never {
        throw new Error(
          "db should not be touched when no conversations are stale",
        );
      },
    },
  ) as unknown as DrizzleD1Database<Record<string, unknown>>;
}

function makeUpdatingDb(): DrizzleD1Database<Record<string, unknown>> {
  return {
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  } as unknown as DrizzleD1Database<Record<string, unknown>>;
}

function makeSelectDb(
  row: ConversationRow | null,
): DrizzleD1Database<Record<string, unknown>> {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
  } as unknown as DrizzleD1Database<Record<string, unknown>>;
}

describe("ChatService.checkAndCloseStaleForProject", () => {
  const staleThresholdMinutes = 5;
  const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

  test("never auto-closes a waiting_agent conversation, even when stale", async () => {
    const service = new ChatService(makeUntouchedDb());
    const staleWaitingAgent = makeConversation({
      status: "waiting_agent",
      lastActivityAt: staleTimestamp,
    });

    const closedIds = await service.checkAndCloseStaleForProject(
      [staleWaitingAgent],
      staleThresholdMinutes,
    );

    expect(closedIds).toEqual([]);
  });

  test("still auto-closes a stale active conversation", async () => {
    const service = new ChatService(makeUpdatingDb());
    const staleActive = makeConversation({
      id: "conv-active",
      status: "active",
      lastActivityAt: staleTimestamp,
    });

    const closedIds = await service.checkAndCloseStaleForProject(
      [staleActive],
      staleThresholdMinutes,
    );

    expect(closedIds).toEqual(["conv-active"]);
  });

  test("only skips the waiting_agent row in a mixed batch", async () => {
    const service = new ChatService(makeUpdatingDb());
    const staleWaitingAgent = makeConversation({
      id: "conv-waiting",
      status: "waiting_agent",
      lastActivityAt: staleTimestamp,
    });
    const staleActive = makeConversation({
      id: "conv-active",
      status: "active",
      lastActivityAt: staleTimestamp,
    });
    const freshActive = makeConversation({
      id: "conv-fresh",
      status: "active",
      lastActivityAt: new Date(),
    });

    const closedIds = await service.checkAndCloseStaleForProject(
      [staleWaitingAgent, staleActive, freshActive],
      staleThresholdMinutes,
    );

    expect(closedIds).toEqual(["conv-active"]);
  });
});

describe("ChatService.checkAndCloseStale", () => {
  test("never auto-closes a waiting_agent conversation, even when stale", async () => {
    const staleWaitingAgent = makeConversation({
      status: "waiting_agent",
      lastActivityAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const service = new ChatService(makeSelectDb(staleWaitingAgent));

    const result = await service.checkAndCloseStale("conv-1", "project-1", 5);

    expect(result.closed).toBe(false);
    expect(result.conversation?.status).toBe("waiting_agent");
  });
});

// getNeedsReviewSince pushes all filtering into the SQL WHERE/ORDER BY/LIMIT
// clause; there's no in-memory D1 harness in this repo to run real SQL
// against, so this fake mirrors that clause's semantics (status ===
// "waiting_agent" && updatedAt > since, newest first, capped to 20) over an
// in-memory row set, matching this file's stubbed select().from()... style.
function makeNeedsReviewDb(
  allRows: ConversationRow[],
  since: number,
): DrizzleD1Database<Record<string, unknown>> {
  const matching = allRows
    .filter((row) => row.status === "waiting_agent" && row.updatedAt.getTime() > since)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 20);
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => matching,
          }),
        }),
      }),
    }),
  } as unknown as DrizzleD1Database<Record<string, unknown>>;
}

describe("ChatService.getNeedsReviewSince", () => {
  const since = Date.parse("2026-07-01T00:00:00.000Z");

  test("includes a waiting_agent conversation updated after since", async () => {
    const fresh = makeConversation({
      id: "conv-fresh",
      status: "waiting_agent",
      updatedAt: new Date(since + 60_000),
    });
    const service = new ChatService(makeNeedsReviewDb([fresh], since));

    const rows = await service.getNeedsReviewSince("project-1", since);

    expect(rows).toEqual([fresh]);
  });

  test("excludes conversations that are not waiting_agent", async () => {
    const active = makeConversation({
      id: "conv-active",
      status: "active",
      updatedAt: new Date(since + 60_000),
    });
    const service = new ChatService(makeNeedsReviewDb([active], since));

    const rows = await service.getNeedsReviewSince("project-1", since);

    expect(rows).toEqual([]);
  });

  test("excludes waiting_agent conversations updated before since", async () => {
    const stale = makeConversation({
      id: "conv-stale",
      status: "waiting_agent",
      updatedAt: new Date(since - 60_000),
    });
    const service = new ChatService(makeNeedsReviewDb([stale], since));

    const rows = await service.getNeedsReviewSince("project-1", since);

    expect(rows).toEqual([]);
  });

  test("returns only the matching rows from a mixed batch, newest first", async () => {
    const freshWaitingAgent = makeConversation({
      id: "conv-fresh",
      status: "waiting_agent",
      updatedAt: new Date(since + 120_000),
    });
    const staleWaitingAgent = makeConversation({
      id: "conv-stale",
      status: "waiting_agent",
      updatedAt: new Date(since - 60_000),
    });
    const freshActive = makeConversation({
      id: "conv-active",
      status: "active",
      updatedAt: new Date(since + 180_000),
    });
    const olderFreshWaitingAgent = makeConversation({
      id: "conv-fresh-2",
      status: "waiting_agent",
      updatedAt: new Date(since + 60_000),
    });
    const service = new ChatService(
      makeNeedsReviewDb(
        [freshWaitingAgent, staleWaitingAgent, freshActive, olderFreshWaitingAgent],
        since,
      ),
    );

    const rows = await service.getNeedsReviewSince("project-1", since);

    expect(rows.map((r) => r.id)).toEqual(["conv-fresh", "conv-fresh-2"]);
  });
});
