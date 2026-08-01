import { describe, expect, test } from "bun:test";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { and } from "drizzle-orm";
import {
  buildBanSweepQuery,
  buildAiResolutionQuery,
  buildHasVisitorMessagesQuery,
  buildConditionalBotMessageQuery,
  buildHumanTakeoverQuery,
  buildVisitorMessageCountQuery,
  buildInboxCountsQuery,
  buildNeedsReviewQuery,
  inboxFilterConditions,
  ChatService,
  type InboxFilter,
} from "./chat-service";
import { conversations, type ConversationRow } from "../db";

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

function makeOwnershipDb(row: ConversationRow): {
  db: DrizzleD1Database<Record<string, unknown>>;
  getUpdateCount: () => number;
} {
  let updateCount = 0;
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [row],
          }),
        }),
      }),
      update: () => {
        updateCount += 1;
        return {
          set: () => ({
            where: () => ({
              returning: async () => [{ status: "agent_replied" }],
            }),
          }),
        };
      },
    } as unknown as DrizzleD1Database<Record<string, unknown>>,
    getUpdateCount: () => updateCount,
  };
}

function makeReopenDb(row: ConversationRow): {
  db: DrizzleD1Database<Record<string, unknown>>;
  getStatusWrite: () => unknown;
} {
  let statusWrite: unknown;
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [row],
          }),
        }),
      }),
      update: () => ({
        set: (values: { status?: unknown }) => {
          statusWrite = values.status;
          return { where: async () => undefined };
        },
      }),
    } as unknown as DrizzleD1Database<Record<string, unknown>>,
    getStatusWrite: () => statusWrite,
  };
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

describe("ChatService ownership transitions", () => {
  test("a delayed team request cannot reopen a closed human-owned conversation", async () => {
    const closedHuman = makeConversation({
      status: "closed",
      closeReason: "resolved",
      chatState: JSON.stringify({
        state: "agent_mode",
        aiParticipation: "human_only",
      }),
    });
    const { db, getUpdateCount } = makeOwnershipDb(closedHuman);
    const service = new ChatService(db);

    const status = await service.transitionChatOwnership(
      closedHuman.id,
      closedHuman.projectId,
      "team_requested",
    );

    expect(status).toBe("closed");
    expect(getUpdateCount()).toBe(0);
  });

  test("reopens a closed human-owned conversation in agent mode", async () => {
    const closedHuman = makeConversation({ status: "closed" });
    const { db, getStatusWrite } = makeReopenDb(closedHuman);
    const service = new ChatService(db);

    await service.reopenConversation(
      closedHuman.id,
      closedHuman.projectId,
      "agent_replied",
    );

    expect(getStatusWrite()).toBe("agent_replied");
  });
});

describe("buildHasVisitorMessagesQuery", () => {
  test("checks the complete conversation instead of a recent-message window", () => {
    const db = drizzle({} as never);
    const { sql, params } = buildHasVisitorMessagesQuery(db, "conv-1").toSQL();

    expect(sql).toContain('"messages"."conversation_id" = ?');
    expect(sql).toContain('"messages"."role" = ?');
    expect(sql).toMatch(/limit \?$/);
    expect(params).toEqual(["conv-1", "visitor", 1]);
  });
});

describe("buildConditionalBotMessageQuery", () => {
  test("inserts bot output only from the exact ownership snapshot", () => {
    const db = drizzle({} as never);
    const { sql, params } = buildConditionalBotMessageQuery(db, {
      id: "bot-1",
      conversationId: "conv-1",
      projectId: "project-1",
      content: "Try reconnecting the integration.",
      sources: null,
      senderName: "Maven",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      expectedStatus: "waiting_agent",
      expectedChatState: '{"ownershipRevision":2}',
    }).toSQL();

    expect(sql).toContain('insert into "messages"');
    expect(sql).toContain('select');
    expect(sql).toContain('"conversations"."status" = ?');
    expect(sql).toContain('"conversations"."chat_state" = ?');
    expect(params).toContain("waiting_agent");
    expect(params).toContain('{"ownershipRevision":2}');
  });
});

describe("buildHumanTakeoverQuery", () => {
  test("takes ownership and advances the JSON revision in one update", () => {
    const db = drizzle({} as never);
    const { sql, params } = buildHumanTakeoverQuery(
      db,
      "conv-1",
      "project-1",
      new Date("2026-08-01T00:00:00.000Z"),
    ).toSQL();

    expect(sql).toContain("json_set");
    expect(sql).toContain("$.ownershipRevision");
    expect(sql).toContain('"status" = ?');
    expect(params).toContain("agent_replied");
    expect(params).toContain("conv-1");
    expect(params).toContain("project-1");
  });
});

describe("buildVisitorMessageCountQuery", () => {
  test("counts all visitor turns inside the message-insert batch", () => {
    const db = drizzle({} as never);
    const { sql, params } = buildVisitorMessageCountQuery(db, "conv-1").toSQL();

    expect(sql).toContain("count(");
    expect(sql).toContain('"messages"."conversation_id" = ?');
    expect(sql).toContain('"messages"."role" = ?');
    expect(params).toEqual(["conv-1", "visitor"]);
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
  const now = new Date("2026-07-07T00:00:00.000Z");

  test("filters to this project's waiting_agent rows updated strictly after since", () => {
    const { sql, params } = buildNeedsReviewQuery(db, "project-1", since, now).toSQL();

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
      Math.floor(now.getTime() / 1000),
      20,
    ]);
  });

  test("excludes snoozed conversations so snoozing never fires a ping", () => {
    const { sql } = buildNeedsReviewQuery(db, "project-1", since, now).toSQL();

    // Snoozing bumps updatedAt, so without this guard the watermark query
    // would re-surface the very conversation the user just snoozed.
    expect(sql).toContain(
      '"conversations"."snoozed_until" is null or "conversations"."snoozed_until" <= ?',
    );
  });

  test("orders newest first by updatedAt", () => {
    const { sql } = buildNeedsReviewQuery(db, "project-1", since, now).toSQL();

    expect(sql).toContain('order by "conversations"."updated_at" desc');
  });

  test("caps the result at 20 rows", () => {
    const { sql, params } = buildNeedsReviewQuery(db, "project-1", since, now).toSQL();

    expect(sql).toMatch(/limit \?$/);
    expect(params[params.length - 1]).toBe(20);
  });
});

// Same .toSQL() introspection approach as buildNeedsReviewQuery: the inbox tab
// predicates ARE the behavior, so assert the generated SQL for each tab. The
// invariant under test: snoozed and flagged (spam) conversations live only in
// their own tabs — never in Needs You, All, or Resolved.
describe("inboxFilterConditions", () => {
  const db = drizzle({} as never);
  const now = new Date("2026-07-07T00:00:00.000Z");
  const nowSec = Math.floor(now.getTime() / 1000);
  const build = (filter: InboxFilter) =>
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(...inboxFilterConditions(filter, now)))
      .toSQL();

  const NOT_SNOOZED =
    '"conversations"."snoozed_until" is null or "conversations"."snoozed_until" <= ?';
  const NOT_SPAM =
    '"conversations"."close_reason" is null or "conversations"."close_reason" <> ?';

  test("'all' excludes snoozed and spam-flagged conversations", () => {
    const { sql, params } = build("all");

    expect(sql).toContain(NOT_SNOOZED);
    expect(sql).toContain(NOT_SPAM);
    expect(params).toEqual([nowSec, "spam"]);
  });

  test("'needs-you' is waiting_agent minus snoozed", () => {
    const { sql, params } = build("needs-you");

    expect(sql).toContain('"conversations"."status" = ?');
    expect(sql).toContain(NOT_SNOOZED);
    expect(params).toEqual(["waiting_agent", nowSec]);
  });

  test("'resolved' is closed minus spam-flagged", () => {
    const { sql, params } = build("resolved");

    expect(sql).toContain('"conversations"."status" = ?');
    expect(sql).toContain(NOT_SPAM);
    expect(params).toEqual(["closed", "spam"]);
  });

  test("'snoozed' is exactly snoozed_until in the future", () => {
    const { sql, params } = build("snoozed");

    expect(sql).toContain('"conversations"."snoozed_until" > ?');
    expect(params).toEqual([nowSec]);
  });

  test("'flagged' is exactly close_reason = spam", () => {
    const { sql, params } = build("flagged");

    expect(sql).toContain('"conversations"."close_reason" = ?');
    expect(params).toEqual(["spam"]);
  });
});

// The counts query embeds the SAME inboxFilterConditions builders inside its
// SUM(CASE …) buckets, so this suite pins that a badge can never disagree
// with its tab's list — the drift this whole fix exists to prevent.
describe("buildInboxCountsQuery (getInboxCounts)", () => {
  const db = drizzle({} as never);
  const now = new Date("2026-07-07T00:00:00.000Z");
  const nowSec = Math.floor(now.getTime() / 1000);

  test("each bucket embeds its tab's exact predicate", () => {
    const { sql } = buildInboxCountsQuery(db, "project-1", now).toSQL();

    for (const filter of [
      "needs-you",
      "all",
      "snoozed",
      "resolved",
      "flagged",
    ] as const) {
      const conditionSql = db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(...inboxFilterConditions(filter, now)))
        .toSQL()
        .sql.split(" where ")[1];
      expect(conditionSql).toBeTruthy();
      expect(sql).toContain(
        `sum(case when ${conditionSql} then 1 else 0 end)`,
      );
    }
  });

  test("binds the expected params: tab predicates in order, then project id", () => {
    const { params } = buildInboxCountsQuery(db, "project-1", now).toSQL();

    expect(params).toEqual([
      // needs-you: status + snooze cutoff
      "waiting_agent",
      nowSec,
      // all: snooze cutoff + spam
      nowSec,
      "spam",
      // snoozed: cutoff
      nowSec,
      // resolved: status + spam
      "closed",
      "spam",
      // flagged: spam
      "spam",
      // where: project scope
      "project-1",
    ]);
  });
});

describe("buildBanSweepQuery (closeOpenConversationsAsSpam)", () => {
  const db = drizzle({} as never);

  test("closes only this project's OPEN conversations, as spam, returning ids", () => {
    const { sql, params } = buildBanSweepQuery(db, "project-1", "visitor-1").toSQL();

    expect(sql).toContain('update "conversations" set');
    expect(sql).toContain('"conversations"."project_id" = ?');
    // Already-closed rows keep their original closeReason (e.g. "resolved").
    expect(sql).toContain('"conversations"."status" <> ?');
    expect(sql).toContain('returning "id"');
    expect(params).toEqual(
      expect.arrayContaining(["closed", "spam", "project-1", "visitor-1"]),
    );
  });

  test("matches by visitor id only when no email is known", () => {
    const { sql } = buildBanSweepQuery(db, "project-1", "visitor-1").toSQL();

    expect(sql).toContain('"conversations"."visitor_id" = ?');
    expect(sql).not.toContain('"conversations"."visitor_email"');
  });

  test("matches by visitor id OR email when an email is known", () => {
    const { sql, params } = buildBanSweepQuery(
      db,
      "project-1",
      "visitor-1",
      "spam@example.com",
    ).toSQL();

    expect(sql).toContain(
      '"conversations"."visitor_id" = ? or "conversations"."visitor_email" = ?',
    );
    expect(params).toEqual(
      expect.arrayContaining(["visitor-1", "spam@example.com"]),
    );
  });
});

describe("buildAiResolutionQuery", () => {
  const db = drizzle({} as never);

  test("cannot close a conversation after a human has joined", () => {
    const { sql, params } = buildAiResolutionQuery(
      db,
      "conv-1",
      "project-1",
    ).toSQL();

    expect(sql).toContain('"conversations"."status" in (?, ?)');
    expect(params).not.toContain("agent_replied");
    expect(params).toContain("bot_resolved");
  });

  test("only resolves currently AI-owned active or waiting conversations", () => {
    const { sql, params } = buildAiResolutionQuery(
      db,
      "conv-1",
      "project-1",
    ).toSQL();

    expect(sql).toContain('"conversations"."status" in (?, ?)');
    expect(params).toEqual(expect.arrayContaining(["active", "waiting_agent"]));
  });

  test("uses the ownership snapshot as a compare-and-swap guard", () => {
    const expectedChatState = JSON.stringify({
      state: "escalating",
      aiParticipation: "assist_until_agent",
    });
    const resolvedChatState = JSON.stringify({
      state: "active",
      aiParticipation: "continuous",
    });
    const { sql, params } = buildAiResolutionQuery(
      db,
      "conv-1",
      "project-1",
      expectedChatState,
      resolvedChatState,
    ).toSQL();

    expect(sql).toContain('"conversations"."chat_state" = ?');
    expect(params).toContain(expectedChatState);
    expect(params).toContain(resolvedChatState);
  });
});
