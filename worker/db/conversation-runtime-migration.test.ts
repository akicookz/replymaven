import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

describe("conversation runtime migration checkpoint", () => {
  test("persists one cascading checkpoint per project", async () => {
    const database = new Database(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL)");
    const migration = await Bun.file(
      "worker/db/drizzle/0064_conversation_runtime_migration.sql",
    ).text();
    database.exec(migration);
    database.exec("INSERT INTO projects (id) VALUES ('project-1')");
    database.exec(
      `INSERT INTO conversation_runtime_migrations (
        project_id, directory_cursor, mismatch_count
      ) VALUES ('project-1', 'cursor-1', 2)`,
    );

    expect(database.query(
      "SELECT * FROM conversation_runtime_migrations",
    ).get()).toMatchObject({
      project_id: "project-1",
      directory_cursor: "cursor-1",
      mismatch_count: 2,
    });

    database.exec("DELETE FROM projects WHERE id = 'project-1'");
    expect(database.query(
      "SELECT COUNT(*) AS count FROM conversation_runtime_migrations",
    ).get()).toEqual({ count: 0 });
  });

  test("persists resumable verification progress columns", async () => {
    const database = new Database(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL)");
    database.exec("INSERT INTO projects (id) VALUES ('project-1')");
    database.exec(await Bun.file(
      "worker/db/drizzle/0064_conversation_runtime_migration.sql",
    ).text());
    database.exec(
      `INSERT INTO conversation_runtime_migrations (
        project_id, verification_cursor, verification_started_at
      ) VALUES ('project-1', 'cursor-1', 600)`,
    );

    expect(database.query(
      `SELECT verification_cursor, verification_started_at,
         verification_legacy_count, verification_transcript_mismatch_count
       FROM conversation_runtime_migrations WHERE project_id = 'project-1'`,
    ).get()).toEqual({
      verification_cursor: "cursor-1",
      verification_started_at: 600,
      verification_legacy_count: 0,
      verification_transcript_mismatch_count: 0,
    });
  });
});
