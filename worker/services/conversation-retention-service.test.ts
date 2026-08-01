import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/d1";
import {
  buildClaimExpiredArchivesQuery,
  collectUploadKeys,
  purgeOneClaimedConversation,
  type ConversationRetentionStore,
} from "./conversation-retention-service";

describe("archived conversation retention", () => {
  test("claims only expired archives whose prior purge lease is available", () => {
    const db = drizzle({} as never);
    const retentionCutoff = new Date("2026-06-02T00:00:00.000Z");
    const staleClaimCutoff = new Date("2026-07-31T23:00:00.000Z");
    const claimAt = new Date("2026-08-01T00:00:00.000Z");
    const { sql, params } = buildClaimExpiredArchivesQuery(
      db,
      ["expired-1", "expired-2"],
      retentionCutoff,
      staleClaimCutoff,
      claimAt,
    ).toSQL();

    expect(sql).toContain('"conversations"."archived_at" <= ?');
    expect(sql).toContain('"conversations"."purge_started_at" is null');
    expect(sql).toContain('"conversations"."purge_started_at" <= ?');
    expect(sql).toContain('returning "id", "purge_started_at"');
    expect(params).toEqual(expect.arrayContaining([
      Math.floor(retentionCutoff.getTime() / 1000),
      Math.floor(staleClaimCutoff.getTime() / 1000),
      Math.floor(claimAt.getTime() / 1000),
    ]));
  });

  test("collects unique local R2 keys and ignores non-upload URLs", () => {
    expect(collectUploadKeys([
      "/api/uploads/user-1/a.png",
      '["/api/uploads/user-1/a.png","/api/uploads/user-1/b.jpg"]',
      "https://example.com/not-ours.png",
      "data:image/png;base64,abc",
      "/api/uploads/../unsafe.png",
      null,
    ])).toEqual(["user-1/a.png", "user-1/b.jpg"]);
  });

  test("does not delete database rows when attachment cleanup fails", async () => {
    let databaseDeleteCalled = false;
    const store: ConversationRetentionStore = {
      claimExpired: async () => [],
      listMessageImageUrls: async () => ["/api/uploads/user-1/a.png"],
      deleteClaimedConversation: async () => {
        databaseDeleteCalled = true;
        return true;
      },
    };
    const uploads = {
      delete: async () => {
        throw new Error("R2 unavailable");
      },
    } as unknown as R2Bucket;

    await expect(purgeOneClaimedConversation(
      store,
      uploads,
      { id: "conv-1", purgeStartedAt: new Date("2026-08-01T00:00:00.000Z") },
    )).rejects.toThrow("R2 unavailable");
    expect(databaseDeleteCalled).toBe(false);
  });

  test("deletes claimed database rows only after all attachment keys", async () => {
    const events: string[] = [];
    const store: ConversationRetentionStore = {
      claimExpired: async () => [],
      listMessageImageUrls: async () => [
        '["/api/uploads/user-1/a.png","/api/uploads/user-1/b.png"]',
      ],
      deleteClaimedConversation: async () => {
        events.push("database");
        return true;
      },
    };
    const uploads = {
      delete: async (keys: string | string[]) => {
        events.push(`r2:${Array.isArray(keys) ? keys.join(",") : keys}`);
      },
    } as unknown as R2Bucket;

    const deleted = await purgeOneClaimedConversation(
      store,
      uploads,
      { id: "conv-1", purgeStartedAt: new Date("2026-08-01T00:00:00.000Z") },
    );

    expect(deleted).toBe(true);
    expect(events).toEqual(["r2:user-1/a.png,user-1/b.png", "database"]);
  });
});
