import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type {
  MavenConversationSummary,
  MavenConversationListQuery,
} from "../../../shared/sidechat-agent";
import {
  ConversationDirectory,
  type ConversationDirectorySql,
} from "./conversation-directory";

function createDirectory(): ConversationDirectory {
  const database = new Database(":memory:");
  const sql: ConversationDirectorySql = {
    execute<T>(query: string, bindings: Array<string | number | null>): T[] {
      return database.query(query).all(...bindings) as T[];
    },
  };
  return new ConversationDirectory(sql);
}

function makeSummary(
  conversationId: string,
  overrides: Partial<MavenConversationSummary> = {},
): MavenConversationSummary {
  return {
    conversationId,
    publicChildName: `pub_${conversationId}`,
    sidechatChildName: null,
    sidechatStatus: null,
    customerId: null,
    visitorId: `visitor-${conversationId}`,
    visitorName: `Visitor ${conversationId}`,
    visitorEmail: `${conversationId}@example.com`,
    telegramThreadId: null,
    status: "active",
    closeReason: null,
    metadata: {},
    priority: "medium",
    assigneeId: null,
    snoozedUntil: null,
    archivedAt: null,
    purgeStartedAt: null,
    visitorLastSeenAt: null,
    visitorPresence: "active",
    visitorLastOnlineAt: null,
    lastMessageId: null,
    lastMessageAuthor: null,
    lastMessagePreview: null,
    lastActivityAt: 100,
    messageCount: 0,
    botMessageCount: 0,
    childRevision: 1,
    createdAt: 10,
    updatedAt: 100,
    ...overrides,
  };
}

async function insertAll(
  directory: ConversationDirectory,
  summaries: MavenConversationSummary[],
): Promise<void> {
  for (const summary of summaries) {
    await directory.upsertConversationSummary(summary);
  }
}

function ids(
  result: Awaited<ReturnType<ConversationDirectory["listConversations"]>>,
): string[] {
  return result.conversations.map((conversation) => conversation.conversationId);
}

describe("ConversationDirectory", () => {
  test("orders and paginates equal timestamps without duplicates", async () => {
    const directory = createDirectory();
    await insertAll(directory, [
      makeSummary("a", { lastActivityAt: 100 }),
      makeSummary("b", { lastActivityAt: 100 }),
      makeSummary("c", { lastActivityAt: 200 }),
    ]);

    const first = directory.listConversations({
      filter: "all",
      sort: "newest",
      limit: 2,
    });
    const second = directory.listConversations({
      filter: "all",
      sort: "newest",
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    expect(ids(first)).toEqual(["c", "b"]);
    expect(ids(second)).toEqual(["a"]);
    expect(second.nextCursor).toBeNull();
    expect(ids(directory.listConversations({
      filter: "all",
      sort: "oldest",
    }))).toEqual(["a", "b", "c"]);
  });

  test("matches the six inbox filters and counts from the same predicates", async () => {
    const now = 1_000;
    const directory = createDirectory();
    await insertAll(directory, [
      makeSummary("needs", { status: "waiting_agent" }),
      makeSummary("snoozed", { snoozedUntil: now + 1 }),
      makeSummary("resolved", {
        status: "closed",
        closeReason: "resolved",
      }),
      makeSummary("flagged", {
        status: "closed",
        closeReason: "spam",
      }),
      makeSummary("archived", { archivedAt: now - 1 }),
    ]);

    const query = (filter: MavenConversationListQuery["filter"]): string[] =>
      ids(directory.listConversations({ filter, now }));

    expect(query("needs-you")).toEqual(["needs"]);
    expect(query("all").sort()).toEqual(["needs", "resolved"]);
    expect(query("snoozed")).toEqual(["snoozed"]);
    expect(query("resolved")).toEqual(["resolved"]);
    expect(query("archived")).toEqual(["archived"]);
    expect(query("flagged")).toEqual(["flagged"]);
    expect(directory.getInboxCounts(now)).toEqual({
      "needs-you": 1,
      all: 2,
      snoozed: 1,
      resolved: 1,
      archived: 1,
      flagged: 1,
    });
  });

  test("supports ASCII case-insensitive search and priority ordering", async () => {
    const directory = createDirectory();
    await insertAll(directory, [
      makeSummary("low", {
        visitorName: "Ada Lovelace",
        priority: "low",
      }),
      makeSummary("medium", {
        visitorEmail: "Grace@Example.COM",
        priority: "medium",
      }),
      makeSummary("high", { priority: "high" }),
    ]);

    expect(ids(directory.listConversations({
      filter: "all",
      search: "ADA",
    }))).toEqual(["low"]);
    expect(ids(directory.listConversations({
      filter: "all",
      search: "grace@example.com",
    }))).toEqual(["medium"]);
    expect(ids(directory.listConversations({
      filter: "all",
      sort: "priority",
    }))).toEqual(["high", "medium", "low"]);
  });

  test("applies only monotonically newer child revisions", async () => {
    const directory = createDirectory();

    expect(await directory.upsertConversationSummary(
      makeSummary("a", { childRevision: 5, visitorName: "Five" }),
    )).toEqual({ applied: true, revision: 5 });
    expect(await directory.upsertConversationSummary(
      makeSummary("a", { childRevision: 5, visitorName: "Changed five" }),
    )).toEqual({ applied: false, revision: 5 });
    expect(await directory.upsertConversationSummary(
      makeSummary("a", { childRevision: 4, visitorName: "Four" }),
    )).toEqual({ applied: false, revision: 5 });
    expect(await directory.upsertConversationSummary(
      makeSummary("a", { childRevision: 6, visitorName: "Six" }),
    )).toEqual({ applied: true, revision: 6 });

    expect(directory.getConversation("a")?.visitorName).toBe("Six");
  });

  test("stores Sidechat status in the directory without an unbounded Agent state", async () => {
    const directory = createDirectory();
    await directory.upsertConversationSummary(makeSummary("a"));

    expect(directory.updateSidechatSummary(
      "a",
      "sc_a",
      "working",
      123,
    )).toBe(true);
    expect(directory.getSidechatSummaries()).toEqual([
      {
        conversationId: "a",
        childName: "sc_a",
        status: "working",
        updatedAt: 123,
      },
    ]);
    expect(directory.removeSidechat("a")).toBe(true);
    expect(directory.getSidechatSummaries()).toEqual([]);
  });

  test("queries Telegram, metadata, and bot-message aggregates", async () => {
    const directory = createDirectory();
    await insertAll(directory, [
      makeSummary("a", {
        telegramThreadId: "123",
        metadata: { source: "pricing", locale: "en" },
        botMessageCount: 2,
      }),
      makeSummary("b", {
        metadata: { source: "docs" },
        botMessageCount: 8,
      }),
      makeSummary("c", {
        metadata: { source: "pricing" },
        botMessageCount: 4,
      }),
    ]);

    expect(directory.findByTelegramThreadId("123")?.conversationId).toBe("a");
    expect(ids(directory.listConversations({
      filter: "all",
      metadataKey: "source",
      metadataValue: "pricing",
      sort: "botMessages",
    }))).toEqual(["c", "a"]);
  });
});
