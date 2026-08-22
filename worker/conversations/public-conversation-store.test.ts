import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  parseMavenChildName,
  toPublicChildName,
  toSidechatChildName,
} from "../../shared/maven-conversation";
import { parsePublicInboxFilter } from "./public-conversation-store";
import {
  LegacyConversationReader,
  mapD1ConversationRow,
  mapD1MessageRow,
} from "./legacy-conversation-reader";
import { schema, type ConversationRow, type MessageRow } from "../db";

function createD1StoreHarness(): {
  sqlite: Database;
  reader: LegacyConversationReader;
} {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE conversations (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    customer_id text,
    visitor_id text NOT NULL,
    visitor_name text,
    visitor_email text,
    status text DEFAULT 'active' NOT NULL,
    close_reason text,
    telegram_thread_id text,
    metadata text,
    chat_state text,
    last_activity_at integer DEFAULT (unixepoch()) NOT NULL,
    visitor_last_seen_at integer,
    visitor_presence text DEFAULT 'active',
    visitor_last_online_at integer,
    snoozed_until integer,
    archived_at integer,
    purge_started_at integer,
    external_action_started_at integer,
    priority text DEFAULT 'medium' NOT NULL,
    assignee_id text,
    created_at integer DEFAULT (unixepoch()) NOT NULL,
    updated_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE messages (
    id text PRIMARY KEY NOT NULL,
    conversation_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    image_url text,
    sources text,
    sender_name text,
    sender_avatar text,
    user_id text,
    created_at integer DEFAULT (unixepoch()) NOT NULL,
    emailed_at integer,
    delivered_at integer,
    read_at integer
  )`);
  const db = drizzleSqlite(sqlite, { schema });
  return {
    sqlite,
    reader: new LegacyConversationReader(
      db as unknown as DrizzleD1Database<Record<string, unknown>>,
    ),
  };
}

function makeConversationRow(
  overrides: Partial<ConversationRow> = {},
): ConversationRow {
  return {
    id: "conversation-1",
    projectId: "project-1",
    customerId: "customer-1",
    visitorId: "visitor-1",
    visitorName: "Ada",
    visitorEmail: "ada@example.com",
    status: "waiting_agent",
    closeReason: "resolved",
    telegramThreadId: "123",
    metadata: JSON.stringify({ locale: "en", nested: { safe: true } }),
    chatState: JSON.stringify({
      state: "escalating",
      ownershipRevision: 7,
    }),
    lastActivityAt: new Date("2026-08-13T01:02:03.004Z"),
    visitorLastSeenAt: new Date("2026-08-13T01:02:04.005Z"),
    visitorPresence: "background",
    visitorLastOnlineAt: new Date("2026-08-13T01:02:05.006Z"),
    snoozedUntil: new Date("2026-08-14T01:02:03.004Z"),
    archivedAt: new Date("2026-08-15T01:02:03.004Z"),
    purgeStartedAt: new Date("2026-08-16T01:02:03.004Z"),
    externalActionStartedAt: new Date("2026-08-17T01:02:03.004Z"),
    priority: "high",
    assigneeId: "user-1",
    createdAt: new Date("2026-08-01T01:02:03.004Z"),
    updatedAt: new Date("2026-08-18T01:02:03.004Z"),
    ...overrides,
  };
}

function makeMessageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    role: "agent",
    content: "Here are the docs",
    imageUrl: JSON.stringify(["/one.png", "/two.png"]),
    sources: JSON.stringify([
      { title: "Guide", url: "https://example.com/guide", type: "webpage" },
      { title: "FAQ", url: null, type: "faq" },
    ]),
    senderName: "Grace",
    senderAvatar: "/grace.png",
    userId: "user-1",
    createdAt: new Date("2026-08-13T02:03:04.005Z"),
    emailedAt: new Date("2026-08-13T02:04:04.005Z"),
    deliveredAt: new Date("2026-08-13T02:05:04.005Z"),
    readAt: new Date("2026-08-13T02:06:04.005Z"),
    ...overrides,
  };
}

describe("public conversation storage conversion", () => {
  test("preserves every conversation field and normalizes timestamps", () => {
    expect(mapD1ConversationRow(makeConversationRow())).toEqual({
      id: "conversation-1",
      projectId: "project-1",
      customerId: "customer-1",
      visitorId: "visitor-1",
      visitorName: "Ada",
      visitorEmail: "ada@example.com",
      status: "waiting_agent",
      closeReason: "resolved",
      telegramThreadId: "123",
      metadata: { locale: "en", nested: { safe: true } },
      chatState: { state: "escalating", ownershipRevision: 7 },
      lastActivityAt: 1786582923004,
      visitorLastSeenAt: 1786582924005,
      visitorPresence: "background",
      visitorLastOnlineAt: 1786582925006,
      snoozedUntil: 1786669323004,
      archivedAt: 1786755723004,
      purgeStartedAt: 1786842123004,
      externalActionStartedAt: 1786928523004,
      priority: "high",
      assigneeId: "user-1",
      createdAt: 1785546123004,
      updatedAt: 1787014923004,
      ownershipRevision: 7,
    });
  });

  test("falls back safely for malformed JSON and nullable legacy presence", () => {
    const record = mapD1ConversationRow(
      makeConversationRow({
        metadata: "[not-json",
        chatState: "null",
        visitorPresence: null,
        lastActivityAt: null,
        priority: null,
      } as unknown as Partial<ConversationRow>),
    );

    expect(record.metadata).toEqual({});
    expect(record.chatState).toEqual({});
    expect(record.ownershipRevision).toBe(0);
    expect(record.visitorPresence).toBe("active");
    expect(record.lastActivityAt).toBe(record.createdAt);
    expect(record.priority).toBe("medium");
  });

  test("converts images, sources, authorship, and receipt timestamps", () => {
    expect(mapD1MessageRow(makeMessageRow())).toEqual({
      id: "message-1",
      conversationId: "conversation-1",
      author: "agent",
      content: "Here are the docs",
      imageUrls: ["/one.png", "/two.png"],
      sources: [
        { title: "Guide", url: "https://example.com/guide", type: "webpage" },
        { title: "FAQ", url: null, type: "faq" },
      ],
      senderName: "Grace",
      senderAvatar: "/grace.png",
      userId: "user-1",
      systemKind: null,
      createdAt: 1786586584005,
      emailedAt: 1786586644005,
      deliveredAt: 1786586704005,
      readAt: 1786586764005,
    });
  });

  test("extracts a system kind without treating it as a public source", () => {
    const record = mapD1MessageRow(
      makeMessageRow({
        role: "system",
        sources: JSON.stringify({ systemKind: "joined" }),
      }),
    );

    expect(record.author).toBe("system");
    expect(record.systemKind).toBe("joined");
    expect(record.sources).toEqual([]);
  });

  test("drops malformed and structurally invalid source entries", () => {
    expect(
      mapD1MessageRow(
        makeMessageRow({
          imageUrl: "[broken",
          sources: JSON.stringify([
            { title: "Valid", url: null, type: "pdf" },
            { title: 1, url: null, type: "faq" },
            { title: "Wrong type", url: null, type: "video" },
          ]),
        }),
      ),
    ).toMatchObject({
      imageUrls: ["[broken"],
      sources: [{ title: "Valid", url: null, type: "pdf" }],
      systemKind: null,
    });
  });
});

describe("legacy conversation reader", () => {
  test("migration reads preserve ordered system rows", async () => {
    const { sqlite, reader } = createD1StoreHarness();
    sqlite.query(`INSERT INTO conversations (
      id, project_id, visitor_id, status, last_activity_at, priority,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, 'medium', ?, ?)`).run(
      "conversation-1",
      "project-1",
      "visitor-1",
      10,
      10,
      10,
    );
    sqlite.query(`INSERT INTO messages (
      id, conversation_id, role, content, sources, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`).run(
      "a-system",
      "conversation-1",
      "system",
      "Joined",
      JSON.stringify({ systemKind: "joined" }),
      10,
    );
    sqlite.query(`INSERT INTO messages (
      id, conversation_id, role, content, created_at
    ) VALUES (?, ?, ?, ?, ?)`).run(
      "b-visitor",
      "conversation-1",
      "visitor",
      "Hello",
      10,
    );

    expect(await reader.getMigrationMessages("project-1", "conversation-1"))
      .toMatchObject([
        { id: "a-system", author: "system", systemKind: "joined" },
        { id: "b-visitor", author: "visitor" },
      ]);
  });

  test("tenant-scopes conversation and transcript reads", async () => {
    const { sqlite, reader } = createD1StoreHarness();
    sqlite.query(`INSERT INTO conversations (
      id, project_id, visitor_id, status, last_activity_at, priority,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, 'medium', ?, ?)`)
      .run("conversation-secret", "project-2", "visitor-2", 10, 10, 10);
    sqlite.query(`INSERT INTO messages (
      id, conversation_id, role, content, created_at
    ) VALUES (?, ?, 'agent', 'secret', ?)`)
      .run("message-secret", "conversation-secret", 10);

    expect(await reader.get("project-1", "conversation-secret")).toBeNull();
    expect(
      await reader.getMigrationMessages("project-1", "conversation-secret"),
    ).toEqual([]);
    expect(await reader.get("project-2", "conversation-secret"))
      .toMatchObject({ id: "conversation-secret" });
  });
});

describe("Maven child names", () => {
  test("creates and parses isolated public and Sidechat names", () => {
    expect(toPublicChildName("conversation-1")).toBe("pub_conversation-1");
    expect(toSidechatChildName("conversation-1")).toBe("sc_conversation-1");
    expect(parseMavenChildName("pub_conversation-1")).toEqual({
      kind: "public",
      conversationId: "conversation-1",
    });
    expect(parseMavenChildName("sc_conversation-1")).toEqual({
      kind: "sidechat",
      conversationId: "conversation-1",
    });
  });

  test("rejects missing, empty, or unknown child prefixes", () => {
    for (const name of ["", "pub_", "sc_", "conversation-1", "side_conversation-1"]) {
      expect(() => parseMavenChildName(name)).toThrow("Invalid Maven child name");
    }
  });
});

describe("parsePublicInboxFilter", () => {
  test("maps the retired all filter onto inbox", () => {
    expect(parsePublicInboxFilter("all")).toBe("inbox");
    expect(parsePublicInboxFilter("inbox")).toBe("inbox");
    expect(parsePublicInboxFilter("needs-you")).toBe("needs-you");
    expect(parsePublicInboxFilter("nope")).toBeUndefined();
    expect(parsePublicInboxFilter(undefined)).toBeUndefined();
  });
});
