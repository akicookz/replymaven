import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { schema } from "../db";
import { LegacyConversationStoreFixture } from "../conversations/legacy-conversation-store-fixture";
import {
  buildCustomerByIdQuery,
  buildCustomerListQuery,
  CustomerService,
  decodeCustomerCursor,
  encodeCustomerCursor,
  mapCustomerListItem,
} from "./customer-service";

async function createCustomerTestService(): Promise<{
  service: CustomerService;
  sqlite: Database;
}> {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("CREATE TABLE projects (id text PRIMARY KEY NOT NULL)");
  sqlite.exec(
    `CREATE TABLE conversations (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
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
    )`,
  );
  sqlite.exec("CREATE TABLE project_settings (id text PRIMARY KEY NOT NULL)");
  const migrationUrl = new URL(
    "../db/drizzle/0061_customer_continuity.sql",
    import.meta.url,
  );
  const migration = await Bun.file(migrationUrl).text();
  sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
  sqlite.exec("INSERT INTO projects (id) VALUES ('project-1'), ('project-2')");
  const db = drizzleSqlite(sqlite, { schema });
  interface RunnableQuery {
    run(): unknown;
  }
  const runTransaction = sqlite.transaction((queries: RunnableQuery[]) =>
    queries.map((query) => query.run()),
  );
  const d1CompatibleDb = Object.assign(db, {
    async batch(queries: RunnableQuery[]) {
      return runTransaction(queries);
    },
  });
  const d1 = d1CompatibleDb as unknown as DrizzleD1Database<Record<string, unknown>>;
  return {
    service: new CustomerService(d1, new LegacyConversationStoreFixture(d1).asStore()),
    sqlite,
  };
}

describe("CustomerService profiles and visitors", () => {
  test("creates, lists, and updates direct profile fields within one project", async () => {
    const { service } = await createCustomerTestService();
    const created = await service.insertCustomerProfile("project-1", {
      externalId: "account-1",
      name: "Sam",
      email: "sam@example.com",
      phone: null,
      customFields: { plan: "pro", seats: 4, active: true },
    });

    expect(
      await service.updateCustomerProfile("project-2", created.id, {
        name: "Wrong tenant",
      }),
    ).toBeNull();
    const updated = await service.updateCustomerProfile(
      "project-1",
      created.id,
      { externalId: "account-2", name: "Sam Lee" },
    );
    const listed = await service.listCustomers("project-1", {
      query: "account-2",
      limit: 25,
    });

    expect(updated?.externalId).toBe("account-2");
    expect(updated?.name).toBe("Sam Lee");
    expect(listed.customers.map((customer) => customer.id)).toEqual([
      created.id,
    ]);
  });

  test("returns connected visitors and every linked conversation in detail", async () => {
    const { service, sqlite } = await createCustomerTestService();
    const created = await service.insertCustomerProfile("project-1", {
      externalId: "account-1",
      email: "sam@example.com",
      customFields: {},
    });
    sqlite
      .query(
        `INSERT INTO customer_visitors
          (id, project_id, customer_id, visitor_id, linked_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "visitor-link-1",
        "project-1",
        created.id,
        "visitor-1",
        "dashboard",
        1_800_000_000,
      );
    const insertConversation = sqlite.query(
      `INSERT INTO conversations
        (id, project_id, customer_id, visitor_id, status, archived_at, last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertConversation.run(
      "conversation-new",
      "project-1",
      created.id,
      "visitor-1",
      "active",
      null,
      1_800_000_200,
      1_800_000_100,
      1_800_000_200,
    );
    insertConversation.run(
      "conversation-archived",
      "project-1",
      created.id,
      "visitor-1",
      "closed",
      1_800_000_150,
      1_800_000_150,
      1_800_000_000,
      1_800_000_150,
    );

    const detail = await service.getCustomerDetail("project-1", created.id);

    expect(detail?.externalId).toBe("account-1");
    expect(detail?.visitors).toEqual([
      {
        id: "visitor-link-1",
        visitorId: "visitor-1",
        linkedBy: "dashboard",
        createdAt: "2027-01-15T08:00:00.000Z",
      },
    ]);
    expect(detail?.conversations.map((conversation) => conversation.id)).toEqual([
      "conversation-new",
      "conversation-archived",
    ]);
  });

  test("deletes a customer and bumps every unlinked conversation update time", async () => {
    const { service, sqlite } = await createCustomerTestService();
    const created = await service.insertCustomerProfile("project-1", {
      externalId: "account-1",
      customFields: {},
    });
    sqlite
      .query(
        "INSERT INTO conversations (id, project_id, customer_id, visitor_id, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("conversation-1", "project-1", created.id, "visitor-1", 1);

    const result = await service.deleteCustomer("project-1", created.id);
    const conversation = sqlite
      .query("SELECT customer_id, updated_at FROM conversations WHERE id = ?")
      .get("conversation-1") as {
      customer_id: string | null;
      updated_at: number;
    };

    expect(result).toEqual({
      customerId: created.id,
      conversationIds: ["conversation-1"],
    });
    expect(conversation.customer_id).toBeNull();
    expect(conversation.updated_at).toBeGreaterThan(1);
  });
});

describe("customer query contracts", () => {
  test("uses a stable opaque updated-at and id cursor", () => {
    const cursor = { updatedAt: 1_800_000_000_000, id: "customer-1" };
    const encoded =
      "eyJ1cGRhdGVkQXQiOjE4MDAwMDAwMDAwMDAsImlkIjoiY3VzdG9tZXItMSJ9";

    expect(encodeCustomerCursor(cursor)).toBe(encoded);
    expect(decodeCustomerCursor(encoded)).toEqual(cursor);
    expect(decodeCustomerCursor("not-a-cursor")).toBeNull();
  });

  test("scopes customer and visitor search queries to the project", () => {
    const detailQuery = buildCustomerByIdQuery(
      drizzle({} as never),
      "project-1",
      "customer-1",
    ).toSQL();
    const listQuery = buildCustomerListQuery(drizzle({} as never), "project-1", {
      query: "  ACCOUNT  ",
      limit: 25,
    }).toSQL();

    expect(detailQuery.sql).toContain('"customers"."project_id" = ?');
    expect(listQuery.sql).toContain('"customers"."external_id"');
    expect(listQuery.sql).toContain('"customer_visitors"."visitor_id"');
    expect(listQuery.params).toEqual(
      expect.arrayContaining(["project-1", "%account%", 26]),
    );
  });

  test("maps direct customer fields and malformed custom fields", () => {
    const createdAt = new Date("2026-08-01T10:00:00.000Z");
    const updatedAt = new Date("2026-08-01T11:00:00.000Z");
    const item = mapCustomerListItem({
      customer: {
        id: "customer-1",
        projectId: "project-1",
        externalId: "account-1",
        name: "Sam",
        email: "sam@example.com",
        phone: null,
        customFields: "not-json",
        firstSeenAt: null,
        lastSeenAt: updatedAt,
        createdAt,
        updatedAt,
      },
      conversationCount: 3,
    });

    expect(item).toEqual({
      id: "customer-1",
      externalId: "account-1",
      name: "Sam",
      email: "sam@example.com",
      phone: null,
      customFields: {},
      conversationCount: 3,
      firstSeenAt: null,
      lastSeenAt: "2026-08-01T11:00:00.000Z",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T11:00:00.000Z",
    });
  });
});
