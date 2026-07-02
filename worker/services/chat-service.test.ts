import { describe, expect, test } from "bun:test";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { buildNeedsReviewQuery, ChatService } from "./chat-service";
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

// getNeedsReviewSince has zero JS-side logic — the built SQL IS the behavior.
// So instead of stubbing the builder chain (which would only test the stub),
// build the real query via buildNeedsReviewQuery over a never-executed drizzle
// instance and assert the generated SQL + bound params with .toSQL(). This
// catches operator flips (gt→lt/gte), sort-direction flips (desc→asc), a
// wrong status literal, and a dropped/changed LIMIT.
describe("buildNeedsReviewQuery (getNeedsReviewSince)", () => {
  // Dummy client: query is only built, never executed, so no D1 is touched.
  const db = drizzle({} as never);
  const since = Date.parse("2026-07-01T00:00:00.000Z");

  test("filters to this project's waiting_agent rows updated strictly after since", () => {
    const { sql, params } = buildNeedsReviewQuery(db, "project-1", since).toSQL();

    expect(sql).toContain('"conversations"."project_id" = ?');
    expect(sql).toContain('"conversations"."status" = ?');
    // Strict "> ?" (a flip to <, <=, or >= all break this substring): rows
    // already seen at the watermark must not re-fire the ping on the next poll.
    expect(sql).toContain('"conversations"."updated_at" > ?');
    // updatedAt is a { mode: "timestamp" } column — drizzle binds Dates as
    // unixepoch seconds, so the ms watermark must arrive divided by 1000.
    expect(params).toEqual([
      "project-1",
      "waiting_agent",
      Math.floor(since / 1000),
      20,
    ]);
  });

  test("orders newest first by updatedAt", () => {
    const { sql } = buildNeedsReviewQuery(db, "project-1", since).toSQL();

    expect(sql).toContain('order by "conversations"."updated_at" desc');
  });

  test("caps the result at 20 rows", () => {
    const { sql, params } = buildNeedsReviewQuery(db, "project-1", since).toSQL();

    expect(sql).toMatch(/limit \?$/);
    expect(params[params.length - 1]).toBe(20);
  });
});
