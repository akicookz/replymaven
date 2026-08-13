import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { CustomerIdentityTokenPayload } from "../../shared/customer-types";
import { schema } from "../db";
import { D1PublicConversationStore } from "../conversations/d1-public-conversation-store";
import {
  CustomerIdentityService,
  normalizeCustomerEmail,
} from "./customer-identity-service";

async function createContinuityTestService(): Promise<{
  service: CustomerIdentityService;
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
    service: new CustomerIdentityService(
      d1,
      new D1PublicConversationStore(d1),
    ),
    sqlite,
  };
}

function signedPayload(
  overrides: Partial<CustomerIdentityTokenPayload> = {},
): CustomerIdentityTokenPayload {
  return {
    v: 1,
    projectId: "project-1",
    externalId: "account-123",
    iat: 1_800_000_000,
    exp: 1_800_000_900,
    ...overrides,
  };
}

describe("CustomerIdentityService visitor continuity", () => {
  test("stores current external id and normalized email directly on the customer", async () => {
    const { service, sqlite } = await createContinuityTestService();

    const result = await service.createCustomer("project-1", {
      name: "Sam",
      email: " Sam@Example.com ",
      externalId: "Account_ABC",
      customFields: { plan: "pro" },
    });

    expect(result.kind).toBe("created");
    expect(
      sqlite
        .query(
          "SELECT external_id, email, first_seen_at, last_seen_at FROM customers",
        )
        .get(),
    ).toEqual({
      external_id: "Account_ABC",
      email: "sam@example.com",
      first_seen_at: null,
      last_seen_at: null,
    });
    expect(
      sqlite.query("SELECT count(*) AS count FROM customer_visitors").get(),
    ).toEqual({ count: 0 });
  });

  test("returns an existing customer and rejects cross-customer field conflicts", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const externalCustomer = await service.createCustomer("project-1", {
      externalId: "account-1",
      customFields: {},
    });
    const emailCustomer = await service.createCustomer("project-1", {
      email: "sam@example.com",
      customFields: {},
    });
    if (
      externalCustomer.kind !== "created" ||
      emailCustomer.kind !== "created"
    ) {
      throw new Error("customer setup failed");
    }

    expect(
      await service.createCustomer("project-1", {
        email: "SAM@example.com",
        customFields: {},
      }),
    ).toEqual({
      kind: "existing_customer",
      customerId: emailCustomer.customer.id,
    });
    expect(
      await service.createCustomer("project-1", {
        externalId: "account-1",
        email: "sam@example.com",
        customFields: {},
      }),
    ).toEqual({
      kind: "conflict",
      customerIds: [externalCustomer.customer.id, emailCustomer.customer.id],
    });
    expect(sqlite.query("SELECT count(*) AS count FROM customers").get()).toEqual({
      count: 2,
    });
  });

  test("recovers a concurrent duplicate create as one created and one existing customer", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const input = {
      externalId: "account-race",
      email: "race@example.com",
      customFields: {},
    };

    const results = await Promise.all([
      service.createCustomer("project-1", input),
      service.createCustomer("project-1", input),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual([
      "created",
      "existing_customer",
    ]);
    expect(sqlite.query("SELECT count(*) AS count FROM customers").get()).toEqual({
      count: 1,
    });
  });

  test("links active, closed, and archived history through one visitor mapping", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const insert = sqlite.query(
      `INSERT INTO conversations
        (id, project_id, visitor_id, status, archived_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run("conversation-active", "project-1", "visitor-1", "active", null);
    insert.run("conversation-closed", "project-1", "visitor-1", "closed", null);
    insert.run(
      "conversation-archived",
      "project-1",
      "visitor-1",
      "closed",
      1_800_000_000,
    );
    insert.run("conversation-other", "project-1", "visitor-2", "active", null);

    const result = await service.promoteConversation(
      "project-1",
      "conversation-active",
      { externalId: "account-1", customFields: {} },
    );

    expect(result.kind).toBe("linked");
    expect(result.kind === "linked" ? result.conversationIds.sort() : []).toEqual([
      "conversation-active",
      "conversation-archived",
      "conversation-closed",
    ]);
    expect(
      sqlite
        .query("SELECT visitor_id, linked_by FROM customer_visitors")
        .all(),
    ).toEqual([{ visitor_id: "visitor-1", linked_by: "dashboard" }]);
    expect(
      sqlite.query("SELECT customer_id FROM conversations WHERE id = ?").get(
        "conversation-other",
      ),
    ).toEqual({ customer_id: null });
  });

  test("recovers simultaneous dashboard promotions onto one customer", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const insert = sqlite.query(
      "INSERT INTO conversations (id, project_id, visitor_id) VALUES (?, ?, ?)",
    );
    insert.run("conversation-race-a", "project-1", "visitor-race-a");
    insert.run("conversation-race-b", "project-1", "visitor-race-b");
    const input = { externalId: "account-promotion-race", customFields: {} };

    const results = await Promise.all([
      service.promoteConversation("project-1", "conversation-race-a", input),
      service.promoteConversation("project-1", "conversation-race-b", input),
    ]);

    expect(results.map((result) => result.kind)).toEqual(["linked", "linked"]);
    expect(sqlite.query("SELECT count(*) AS count FROM customers").get()).toEqual({
      count: 1,
    });
    expect(
      sqlite.query("SELECT count(*) AS count FROM customer_visitors").get(),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .query("SELECT count(DISTINCT customer_id) AS count FROM conversations")
        .get(),
    ).toEqual({ count: 1 });
  });

  test("recovers simultaneous links of one visitor as one link and one conflict", async () => {
    const { service, sqlite } = await createContinuityTestService();
    sqlite
      .query("INSERT INTO conversations (id, project_id, visitor_id) VALUES (?, ?, ?)")
      .run("conversation-link-race", "project-1", "visitor-link-race");
    const first = await service.createCustomer("project-1", {
      externalId: "account-link-a",
      customFields: {},
    });
    const second = await service.createCustomer("project-1", {
      externalId: "account-link-b",
      customFields: {},
    });
    if (first.kind !== "created" || second.kind !== "created") {
      throw new Error("customer setup failed");
    }

    const results = await Promise.all([
      service.linkConversation(
        "project-1",
        "conversation-link-race",
        first.customer.id,
      ),
      service.linkConversation(
        "project-1",
        "conversation-link-race",
        second.customer.id,
      ),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual([
      "conflict",
      "linked",
    ]);
    expect(
      sqlite.query("SELECT count(*) AS count FROM customer_visitors").get(),
    ).toEqual({ count: 1 });
  });

  test("keeps the widest customer activity range across simultaneous visitor links", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const created = await service.createCustomer("project-1", {
      externalId: "account-activity-race",
      customFields: {},
    });
    if (created.kind !== "created") throw new Error("customer setup failed");
    const insert = sqlite.query(
      `INSERT INTO conversations
        (id, project_id, visitor_id, created_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run(
      "conversation-activity-wide",
      "project-1",
      "visitor-activity-wide",
      1_700_000_000,
      1_900_000_000,
    );
    insert.run(
      "conversation-activity-narrow",
      "project-1",
      "visitor-activity-narrow",
      1_800_000_000,
      1_850_000_000,
    );

    await Promise.all([
      service.linkConversation(
        "project-1",
        "conversation-activity-wide",
        created.customer.id,
      ),
      service.linkConversation(
        "project-1",
        "conversation-activity-narrow",
        created.customer.id,
      ),
    ]);

    expect(
      sqlite
        .query(
          "SELECT first_seen_at, last_seen_at FROM customers WHERE id = ?",
        )
        .get(created.customer.id),
    ).toEqual({ first_seen_at: 1_700_000_000, last_seen_at: 1_900_000_000 });
  });

  test("does not promote unsigned conversation contact data", async () => {
    const { service, sqlite } = await createContinuityTestService();
    sqlite
      .query(
        `INSERT INTO conversations
          (id, project_id, visitor_id, visitor_name, visitor_email)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "conversation-1",
        "project-1",
        "visitor-1",
        "Snapshot Sam",
        "claimed@example.com",
      );

    await service.promoteConversation("project-1", "conversation-1", {
      externalId: "account-1",
      customFields: {},
    });

    expect(
      sqlite.query("SELECT name, email FROM customers").get(),
    ).toEqual({ name: null, email: null });
  });

  test("replaces current email without retaining aliases and rejects occupied fields", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const first = await service.createCustomer("project-1", {
      externalId: "account-1",
      email: "old@example.com",
      customFields: {},
    });
    const second = await service.createCustomer("project-1", {
      externalId: "account-2",
      email: "owned@example.com",
      customFields: {},
    });
    if (first.kind !== "created" || second.kind !== "created") {
      throw new Error("customer setup failed");
    }

    const updated = await service.updateCustomer("project-1", first.customer.id, {
      externalId: "account-1-renamed",
      email: "new@example.com",
    });
    const conflict = await service.updateCustomer(
      "project-1",
      first.customer.id,
      { email: "owned@example.com", name: "Must not apply" },
    );

    expect(updated.kind).toBe("updated");
    expect(
      sqlite
        .query("SELECT external_id, email, name FROM customers WHERE id = ?")
        .get(first.customer.id),
    ).toEqual({
      external_id: "account-1-renamed",
      email: "new@example.com",
      name: null,
    });
    expect(conflict).toEqual({
      kind: "conflict",
      customerIds: [first.customer.id, second.customer.id],
    });
  });

  test("recovers a concurrent profile update collision as a conflict without partial fields", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const first = await service.createCustomer("project-1", {
      externalId: "account-race-a",
      customFields: {},
    });
    const second = await service.createCustomer("project-1", {
      externalId: "account-race-b",
      customFields: {},
    });
    if (first.kind !== "created" || second.kind !== "created") {
      throw new Error("customer setup failed");
    }

    const results = await Promise.all([
      service.updateCustomer("project-1", first.customer.id, {
        email: "shared-race@example.com",
        name: "First update",
      }),
      service.updateCustomer("project-1", second.customer.id, {
        email: "shared-race@example.com",
        name: "Second update",
      }),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual([
      "conflict",
      "updated",
    ]);
    const rows = sqlite
      .query("SELECT email, name FROM customers ORDER BY external_id")
      .all();
    expect(rows).toContainEqual({ email: "shared-race@example.com", name: "First update" });
    expect(rows).toContainEqual({ email: null, name: null });
  });

  test("maps two signed devices with one external id to one customer", async () => {
    const { service, sqlite } = await createContinuityTestService();

    const first = await service.identifySignedVisitor(
      "project-1",
      "visitor-device-a",
      signedPayload({ name: "Signed Sam", customFields: { plan: "free" } }),
    );
    const second = await service.identifySignedVisitor(
      "project-1",
      "visitor-device-b",
      signedPayload({
        email: "Signed@Example.com",
        customFields: { seats: 5 },
      }),
    );

    expect(first.kind).toBe("linked");
    expect(second.kind).toBe("linked");
    expect(sqlite.query("SELECT count(*) AS count FROM customers").get()).toEqual({
      count: 1,
    });
    expect(
      sqlite.query("SELECT visitor_id FROM customer_visitors ORDER BY visitor_id").all(),
    ).toEqual([
      { visitor_id: "visitor-device-a" },
      { visitor_id: "visitor-device-b" },
    ]);
    expect(
      (await service.findCustomerByVisitorId("project-1", "visitor-device-a"))
        ?.id,
    ).toBe(
      (await service.findCustomerByVisitorId("project-1", "visitor-device-b"))
        ?.id,
    );
    expect(second.kind === "linked" ? second.customer.customFields : {}).toEqual({
      plan: "free",
      seats: 5,
    });
  });

  test("recovers simultaneous first signed identifies onto one customer", async () => {
    const { service, sqlite } = await createContinuityTestService();

    const results = await Promise.all([
      service.identifySignedVisitor(
        "project-1",
        "visitor-race-a",
        signedPayload({ externalId: "account-signed-race" }),
      ),
      service.identifySignedVisitor(
        "project-1",
        "visitor-race-b",
        signedPayload({ externalId: "account-signed-race" }),
      ),
    ]);

    expect(results.map((result) => result.kind)).toEqual(["linked", "linked"]);
    expect(sqlite.query("SELECT count(*) AS count FROM customers").get()).toEqual({
      count: 1,
    });
    expect(
      sqlite
        .query("SELECT visitor_id FROM customer_visitors ORDER BY visitor_id")
        .all(),
    ).toEqual([
      { visitor_id: "visitor-race-a" },
      { visitor_id: "visitor-race-b" },
    ]);
  });

  test("rejects a signed account switch on an already-mapped visitor", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const first = await service.identifySignedVisitor(
      "project-1",
      "visitor-shared-browser",
      signedPayload({
        externalId: "account-a",
        email: "a@example.com",
        name: "Account A",
      }),
    );
    if (first.kind !== "linked") throw new Error("customer setup failed");
    sqlite
      .query(
        "INSERT INTO conversations (id, project_id, customer_id, visitor_id) VALUES (?, ?, ?, ?)",
      )
      .run(
        "conversation-a",
        "project-1",
        first.customer.id,
        "visitor-shared-browser",
      );

    const switched = await service.identifySignedVisitor(
      "project-1",
      "visitor-shared-browser",
      signedPayload({
        externalId: "account-b",
        email: "b@example.com",
        name: "Account B",
      }),
    );

    expect(switched.kind).toBe("conflict");
    expect(
      sqlite
        .query(
          "SELECT external_id, email, name FROM customers WHERE id = ?",
        )
        .get(first.customer.id),
    ).toEqual({
      external_id: "account-a",
      email: "a@example.com",
      name: "Account A",
    });
    expect(sqlite.query("SELECT count(*) AS count FROM customers").get()).toEqual({
      count: 1,
    });
    expect(
      sqlite.query("SELECT customer_id FROM conversations WHERE id = ?").get(
        "conversation-a",
      ),
    ).toEqual({ customer_id: first.customer.id });
  });

  test("rejects adding an unmatched email to an external-id customer", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const first = await service.identifySignedVisitor(
      "project-1",
      "visitor-shared-browser",
      signedPayload({ externalId: "account-a" }),
    );
    if (first.kind !== "linked") throw new Error("customer setup failed");

    const switched = await service.identifySignedVisitor(
      "project-1",
      "visitor-shared-browser",
      signedPayload({ externalId: undefined, email: "b@example.com" }),
    );

    expect(switched.kind).toBe("conflict");
    expect(
      sqlite
        .query("SELECT external_id, email FROM customers WHERE id = ?")
        .get(first.customer.id),
    ).toEqual({ external_id: "account-a", email: null });
  });

  test("rejects adding an unmatched external id to an email customer", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const first = await service.identifySignedVisitor(
      "project-1",
      "visitor-shared-browser",
      signedPayload({ externalId: undefined, email: "a@example.com" }),
    );
    if (first.kind !== "linked") throw new Error("customer setup failed");

    const switched = await service.identifySignedVisitor(
      "project-1",
      "visitor-shared-browser",
      signedPayload({ externalId: "account-b", email: undefined }),
    );

    expect(switched.kind).toBe("conflict");
    expect(
      sqlite
        .query("SELECT external_id, email FROM customers WHERE id = ?")
        .get(first.customer.id),
    ).toEqual({ external_id: null, email: "a@example.com" });
  });

  test("rejects conflicting signed customer fields before history writes", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const externalCustomer = await service.createCustomer("project-1", {
      externalId: "account-1",
      customFields: {},
    });
    const emailCustomer = await service.createCustomer("project-1", {
      email: "sam@example.com",
      customFields: {},
    });
    if (
      externalCustomer.kind !== "created" ||
      emailCustomer.kind !== "created"
    ) {
      throw new Error("customer setup failed");
    }
    sqlite
      .query(
        "INSERT INTO conversations (id, project_id, visitor_id) VALUES (?, ?, ?)",
      )
      .run("conversation-1", "project-1", "visitor-conflict");

    const result = await service.identifySignedVisitor(
      "project-1",
      "visitor-conflict",
      signedPayload({ externalId: "account-1", email: "sam@example.com" }),
    );

    expect(result).toEqual({
      kind: "conflict",
      customerIds: [externalCustomer.customer.id, emailCustomer.customer.id],
    });
    expect(
      sqlite.query("SELECT customer_id FROM conversations WHERE id = ?").get(
        "conversation-1",
      ),
    ).toEqual({ customer_id: null });
    expect(
      sqlite.query("SELECT count(*) AS count FROM customer_visitors").get(),
    ).toEqual({ count: 0 });
  });

  test("merges visitor mappings and conversation ownership while target fields win", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const target = await service.createCustomer("project-1", {
      name: "Target name",
      externalId: "target-account",
      customFields: { plan: "pro", shared: "target" },
    });
    const source = await service.createCustomer("project-1", {
      email: "source@example.com",
      phone: "+82 10 0000 0000",
      customFields: { region: "apac", shared: "source" },
    });
    if (target.kind !== "created" || source.kind !== "created") {
      throw new Error("customer setup failed");
    }
    sqlite
      .query(
        "INSERT INTO conversations (id, project_id, visitor_id) VALUES (?, ?, ?)",
      )
      .run("source-conversation", "project-1", "source-visitor");
    await service.linkConversation(
      "project-1",
      "source-conversation",
      source.customer.id,
    );

    const result = await service.mergeCustomers(
      "project-1",
      target.customer.id,
      source.customer.id,
    );

    expect(result).toEqual({
      kind: "merged",
      customerId: target.customer.id,
      conversationIds: ["source-conversation"],
    });
    expect(
      sqlite.query("SELECT customer_id FROM customer_visitors").get(),
    ).toEqual({ customer_id: target.customer.id });
    expect(
      sqlite.query("SELECT external_id, email FROM customers").get(),
    ).toEqual({ external_id: "target-account", email: "source@example.com" });
  });

  test("finds, touches, and deletes by exact project visitor mapping", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const created = await service.createCustomer("project-1", {
      externalId: "account-1",
      customFields: {},
    });
    if (created.kind !== "created") throw new Error("customer setup failed");
    sqlite
      .query(
        `INSERT INTO conversations
          (id, project_id, visitor_id, created_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "conversation-1",
        "project-1",
        "visitor-1",
        1_800_000_000,
        1_800_000_100,
      );
    await service.linkConversation(
      "project-1",
      "conversation-1",
      created.customer.id,
    );

    await service.touchVisitorLastSeen(
      "project-1",
      created.customer.id,
      "visitor-1",
      new Date(1_900_000_000_000),
    );

    expect(
      (await service.findCustomerByVisitorId("project-1", "visitor-1"))?.id,
    ).toBe(created.customer.id);
    expect(
      await service.findCustomerByVisitorId("project-2", "visitor-1"),
    ).toBeNull();
    expect(
      sqlite
        .query(
          "SELECT first_seen_at, last_seen_at FROM customers WHERE id = ?",
        )
        .get(created.customer.id),
    ).toEqual({ first_seen_at: 1_800_000_000, last_seen_at: 1_900_000_000 });
    expect(
      await service.deleteCustomer("project-1", created.customer.id),
    ).toEqual({
      customerId: created.customer.id,
      conversationIds: ["conversation-1"],
    });
  });

  test("records first activity when a signed visitor messages after pre-identification", async () => {
    const { service, sqlite } = await createContinuityTestService();
    const identified = await service.identifySignedVisitor(
      "project-1",
      "visitor-preidentified",
      signedPayload({ externalId: "account-preidentified" }),
    );
    if (identified.kind !== "linked") throw new Error("customer setup failed");

    await service.touchVisitorLastSeen(
      "project-1",
      identified.customer.id,
      "visitor-preidentified",
      new Date(1_900_000_000_000),
    );

    expect(
      sqlite
        .query(
          "SELECT first_seen_at, last_seen_at FROM customers WHERE id = ?",
        )
        .get(identified.customer.id),
    ).toEqual({ first_seen_at: 1_900_000_000, last_seen_at: 1_900_000_000 });
  });
});

describe("customer field normalization", () => {
  test("lowercases email while preserving external and visitor ids elsewhere", () => {
    expect(normalizeCustomerEmail("  Sam@Example.COM ")).toBe(
      "sam@example.com",
    );
  });
});
