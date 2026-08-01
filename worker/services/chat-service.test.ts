import { describe, expect, test } from "bun:test";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import {
  buildAiResolutionQuery,
  buildBanSweepQuery,
  buildConditionalBotMessageQuery,
  buildHumanTakeoverQuery,
  buildInboxCountsQuery,
  buildNeedsReviewQuery,
  ChatService,
  type ConversationRow,
} from "./chat-service";

function makeConversation(overrides: Partial<ConversationRow>): ConversationRow {
  const now = new Date();
  return {
    id: "conv-1", projectId: "project-1", visitorId: "visitor-1",
    visitorName: null, visitorEmail: null, status: "active", closeReason: null,
    telegramThreadId: null, metadata: null, chatState: null, lastActivityAt: now,
    visitorLastSeenAt: null, visitorPresence: "active", visitorLastOnlineAt: null,
    snoozedUntil: null, priority: "medium", assigneeId: null,
    createdAt: now, updatedAt: now, ...overrides,
  };
}

function makeUpdatingDb(): DrizzleD1Database<Record<string, unknown>> {
  const db = { update: () => ({ set: () => ({ where: async () => undefined }) }) };
  return db as unknown as DrizzleD1Database<Record<string, unknown>>;
}

function makeOwnershipDb(row: ConversationRow): {
  db: DrizzleD1Database<Record<string, unknown>>;
  getUpdateCount: () => number;
} {
  let updateCount = 0;
  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
      update: () => {
        updateCount += 1;
        return { set: () => ({ where: () => ({ returning: async () => [{ status: "agent_replied" }] }) }) };
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
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
      update: () => ({ set: (values: { status?: unknown }) => {
        statusWrite = values.status;
        return { where: async () => undefined };
      } }),
    } as unknown as DrizzleD1Database<Record<string, unknown>>,
    getStatusWrite: () => statusWrite,
  };
}

describe("ChatService ownership and atomic writes", () => {
  test("only skips the waiting_agent row in a mixed batch", async () => {
    const service = new ChatService(makeUpdatingDb());
    const stale = new Date(Date.now() - 60 * 60 * 1000);

    const closed = await service.checkAndCloseStaleForProject([
      makeConversation({ id: "waiting", status: "waiting_agent", lastActivityAt: stale }),
      makeConversation({ id: "active", status: "active", lastActivityAt: stale }),
      makeConversation({ id: "fresh", lastActivityAt: new Date() }),
    ], 5);

    expect(closed).toEqual(["active"]);
  });

  test("a delayed team request cannot reopen a closed human-owned conversation", async () => {
    const closedHuman = makeConversation({
      status: "closed",
      closeReason: "resolved",
      chatState: JSON.stringify({ state: "agent_mode", aiParticipation: "human_only" }),
    });
    const { db, getUpdateCount } = makeOwnershipDb(closedHuman);

    const status = await new ChatService(db).transitionChatOwnership(
      closedHuman.id, closedHuman.projectId, "team_requested",
    );

    expect(status).toBe("closed");
    expect(getUpdateCount()).toBe(0);
  });

  test("reopens a closed human-owned conversation in agent mode", async () => {
    const closedHuman = makeConversation({ status: "closed" });
    const { db, getStatusWrite } = makeReopenDb(closedHuman);

    await new ChatService(db).reopenConversation(
      closedHuman.id, closedHuman.projectId, "agent_replied",
    );

    expect(getStatusWrite()).toBe("agent_replied");
  });

  test("inserts bot output only from the exact ownership snapshot", () => {
    const { sql, params } = buildConditionalBotMessageQuery(drizzle({} as never), {
      id: "bot-1", conversationId: "conv-1", projectId: "project-1",
      content: "Try reconnecting.", sources: null, senderName: "Maven",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      expectedStatus: "waiting_agent", expectedChatState: '{"ownershipRevision":2}',
    }).toSQL();

    expect(sql).toContain('"conversations"."status" = ?');
    expect(sql).toContain('"conversations"."chat_state" = ?');
    expect(params).toEqual(expect.arrayContaining(["waiting_agent", '{"ownershipRevision":2}']));
  });

  test("takes ownership and advances the JSON revision in one update", () => {
    const { sql, params } = buildHumanTakeoverQuery(
      drizzle({} as never), "conv-1", "project-1",
    ).toSQL();

    expect(sql).toContain("json_set");
    expect(sql).toContain("$.ownershipRevision");
    expect(params).toEqual(expect.arrayContaining(["agent_replied", "conv-1", "project-1"]));
  });
});

describe("ChatService tenant and AI ownership guards", () => {
  test("scopes needs-review rows and inbox counts to the current project", () => {
    const db = drizzle({} as never);
    const now = new Date("2026-08-01T00:00:00.000Z");
    const needsReview = buildNeedsReviewQuery(
      db, "project-1", Date.parse("2026-07-31T00:00:00.000Z"), now,
    ).toSQL();
    const inboxCounts = buildInboxCountsQuery(db, "project-1", now).toSQL();

    expect(needsReview.sql).toContain('"conversations"."project_id" = ?');
    expect(needsReview.params).toContain("project-1");
    expect(inboxCounts.sql).toContain('"conversations"."project_id" = ?');
    expect(inboxCounts.params).toContain("project-1");
  });

  test("closes only this project's OPEN conversations, as spam, returning ids", () => {
    const { sql, params } = buildBanSweepQuery(
      drizzle({} as never), "project-1", "visitor-1",
    ).toSQL();

    expect(sql).toContain('"conversations"."project_id" = ?');
    expect(sql).toContain('"conversations"."status" <> ?');
    expect(sql).toContain('returning "id"');
    expect(params).toEqual(expect.arrayContaining(["closed", "spam", "project-1", "visitor-1"]));
  });

  test("matches by visitor id OR email when an email is known", () => {
    const { sql, params } = buildBanSweepQuery(
      drizzle({} as never), "project-1", "visitor-1", "spam@example.com",
    ).toSQL();

    expect(sql).toContain('"conversations"."visitor_id" = ? or "conversations"."visitor_email" = ?');
    expect(params).toEqual(expect.arrayContaining(["visitor-1", "spam@example.com"]));
  });

  test("cannot close a conversation after a human has joined", () => {
    const { params } = buildAiResolutionQuery(
      drizzle({} as never), "conv-1", "project-1",
    ).toSQL();

    expect(params).not.toContain("agent_replied");
    expect(params).toContain("bot_resolved");
  });

  test("only resolves currently AI-owned active or waiting conversations", () => {
    const { params } = buildAiResolutionQuery(
      drizzle({} as never), "conv-1", "project-1",
    ).toSQL();

    expect(params).toEqual(expect.arrayContaining(["active", "waiting_agent"]));
  });

  test("uses the ownership snapshot as a compare-and-swap guard", () => {
    const expected = '{"ownershipRevision":2}';
    const resolved = '{"ownershipRevision":3}';
    const { sql, params } = buildAiResolutionQuery(
      drizzle({} as never), "conv-1", "project-1", expected, resolved,
    ).toSQL();

    expect(sql).toContain('"conversations"."chat_state" = ?');
    expect(params).toEqual(expect.arrayContaining([expected, resolved]));
  });
});
