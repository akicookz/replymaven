import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { getTableColumns } from "drizzle-orm/utils";
import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import { conversations, messages } from "./schema";

interface ColumnConfig {
  default: unknown;
  enumValues?: readonly string[];
  name: string;
}

describe("internal sidechat message channel persistence", () => {
  test("defines channel-safe message and conversation coordination fields", () => {
    const messageColumns = getTableColumns(messages) as Record<string, ColumnConfig>;
    const conversationColumns = getTableColumns(conversations) as Record<
      string,
      ColumnConfig
    >;
    const messageIndexes = getTableConfig(messages).indexes;

    expect(messageColumns.channel?.name).toBe("channel");
    expect(messageColumns.channel?.enumValues).toEqual(["public", "sidechat"]);
    expect(messageColumns.channel?.default).toBe("public");
    expect(messageColumns.kind?.name).toBe("kind");
    expect(messageColumns.kind?.enumValues).toEqual([
      "text",
      "reply_draft",
      "approval",
    ]);
    expect(messageColumns.kind?.default).toBe("text");
    expect(messageColumns.metadata?.name).toBe("message_metadata");

    expect(conversationColumns.sidechatStatus?.name).toBe("sidechat_status");
    expect(conversationColumns.sidechatStatus?.enumValues).toEqual([
      "idle",
      "working",
      "waiting_approval",
      "ready",
      "failed",
    ]);
    expect(conversationColumns.sidechatStatus?.default).toBe("idle");
    expect(conversationColumns.sidechatRunId?.name).toBe("sidechat_run_id");
    expect(conversationColumns.sidechatLeaseExpiresAt?.name).toBe(
      "sidechat_lease_expires_at",
    );
    expect(conversationColumns.sidechatUpdatedAt?.name).toBe(
      "sidechat_updated_at",
    );
    expect(conversationColumns.sidechatRevision?.name).toBe(
      "sidechat_revision",
    );
    expect(conversationColumns.sidechatRevision?.default).toBe(0);

    const channelOrderIndex = messageIndexes.find(
      (index) => index.config.name === "idx_messages_conversation_channel_created",
    );
    expect(channelOrderIndex?.config.columns.map((column) => column.name)).toEqual([
      "conversation_id",
      "channel",
      "created_at",
    ]);
  });

  test("migrates legacy transcript rows to the public text channel without a sidechat table", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE conversations (id text PRIMARY KEY NOT NULL)");
    db.exec(
      "CREATE TABLE messages (id text PRIMARY KEY NOT NULL, conversation_id text NOT NULL, content text NOT NULL, created_at integer NOT NULL)",
    );
    db.exec("INSERT INTO conversations (id) VALUES ('conversation-1')");
    db.exec(
      "INSERT INTO messages (id, conversation_id, content, created_at) VALUES ('legacy-message', 'conversation-1', 'Before sidechat', 1)",
    );

    const migrationUrl = new URL(
      "./drizzle/0063_internal_sidechat_channel.sql",
      import.meta.url,
    );
    const migration = await Bun.file(migrationUrl).text();
    db.exec(migration.replaceAll("--> statement-breakpoint", ""));

    expect(
      db.query("SELECT channel, kind FROM messages WHERE id = ?").get("legacy-message"),
    ).toEqual({ channel: "public", kind: "text" });

    db.exec(
      "INSERT INTO messages (id, conversation_id, content, created_at) VALUES ('new-message', 'conversation-1', 'New public message', 2)",
    );
    expect(
      db.query("SELECT channel, kind FROM messages WHERE id = ?").get("new-message"),
    ).toEqual({ channel: "public", kind: "text" });

    db.exec("INSERT INTO conversations (id) VALUES ('conversation-2')");
    expect(
      db.query("SELECT sidechat_status FROM conversations WHERE id = ?").get("conversation-2"),
    ).toEqual({ sidechat_status: "idle" });

    const tableNames = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    expect(tableNames).not.toContain("sidechat_threads");
  });

  test("adds a zero revision to legacy sidechat coordination rows", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE conversations (
      id text PRIMARY KEY NOT NULL,
      sidechat_status text DEFAULT 'idle' NOT NULL,
      sidechat_run_id text,
      sidechat_lease_expires_at integer,
      sidechat_updated_at integer,
      archived_at integer
    )`);
    db.exec(`INSERT INTO conversations (
      id, sidechat_status, sidechat_run_id,
      sidechat_lease_expires_at, sidechat_updated_at
    ) VALUES ('conversation-1', 'working', 'run-1', 10, 1)`);
    db.exec(`INSERT INTO conversations (
      id, sidechat_status, sidechat_run_id,
      sidechat_lease_expires_at, sidechat_updated_at, archived_at
    ) VALUES ('conversation-archived', 'working', 'run-stale', 10, 1, 2)`);

    const migrationUrl = new URL(
      "./drizzle/0064_sidechat_coordination_revision.sql",
      import.meta.url,
    );
    const migration = await Bun.file(migrationUrl).text();
    db.exec(migration.replaceAll("--> statement-breakpoint", ""));

    expect(
      db.query("SELECT sidechat_revision FROM conversations WHERE id = ?")
        .get("conversation-1"),
    ).toEqual({ sidechat_revision: 0 });
    expect(
      db.query(`SELECT sidechat_status, sidechat_run_id,
        sidechat_lease_expires_at, sidechat_revision
        FROM conversations WHERE id = ?`).get("conversation-archived"),
    ).toEqual({
      sidechat_status: "failed",
      sidechat_run_id: null,
      sidechat_lease_expires_at: null,
      sidechat_revision: 1,
    });
  });
});
