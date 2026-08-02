import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

describe("customer continuity migration", () => {
  test("deleting a customer unlinks retained conversations", async () => {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("CREATE TABLE projects (id text PRIMARY KEY NOT NULL)");
    db.exec(
      "CREATE TABLE conversations (id text PRIMARY KEY NOT NULL, project_id text NOT NULL, last_activity_at integer NOT NULL)",
    );
    db.exec("CREATE TABLE project_settings (id text PRIMARY KEY NOT NULL)");

    const migrationUrl = new URL(
      "./drizzle/0061_customer_continuity.sql",
      import.meta.url,
    );
    const migration = await Bun.file(migrationUrl).text();
    db.exec(migration.replaceAll("--> statement-breakpoint", ""));

    const tableRows = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tableRows.map((row) => row.name);

    expect(names).toContain("customers");
    expect(names).toContain("customer_visitors");
    expect(names).not.toContain("customer_identities");
    expect(names).not.toContain("customer_interactions");
    expect(names).not.toContain("customer_memory");

    db.exec("INSERT INTO projects (id) VALUES ('project-1')");
    db.exec(
      "INSERT INTO customers (id, project_id, external_id) VALUES ('customer-1', 'project-1', 'account-1')",
    );
    db.exec(
      "INSERT INTO customer_visitors (id, project_id, customer_id, visitor_id, linked_by) VALUES ('link-1', 'project-1', 'customer-1', 'visitor-1', 'dashboard')",
    );
    db.exec(
      "INSERT INTO conversations (id, project_id, customer_id, last_activity_at) VALUES ('conversation-1', 'project-1', 'customer-1', 1)",
    );

    expect(() => {
      db.exec("DELETE FROM customers WHERE id = 'customer-1'");
    }).not.toThrow();
    expect(
      db
        .query("SELECT customer_id FROM conversations WHERE id = ?")
        .get("conversation-1"),
    ).toEqual({ customer_id: null });
  });
});
