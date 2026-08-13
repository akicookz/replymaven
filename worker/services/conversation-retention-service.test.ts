import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/d1";
import {
  buildClaimExpiredArchivesQuery,
  collectOwnedUploadKeys,
  purgeClaimedConversations,
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
    expect(sql).toContain('returning "id", "project_id", "purge_started_at"');
    expect(params).toEqual(expect.arrayContaining([
      Math.floor(retentionCutoff.getTime() / 1000),
      Math.floor(staleClaimCutoff.getTime() / 1000),
      Math.floor(claimAt.getTime() / 1000),
    ]));
  });

  test("collects conversation-scoped attachment keys", () => {
    expect(collectOwnedUploadKeys("project-1", "conv-1", [
      {
        role: "visitor",
        userId: null,
        imageUrl: "/api/uploads/project-1/chat-images/a.png",
      },
      {
        role: "agent",
        userId: "user-1",
        imageUrl: '["/api/uploads/project-1/conversation-attachments/conv-1/a.png","/api/uploads/project-1/conversation-attachments/conv-1/b.jpg"]',
      },
      {
        role: "visitor",
        userId: null,
        imageUrl: "/api/uploads/project-2/chat-images/not-ours.png",
      },
      {
        role: "agent",
        userId: "user-1",
        imageUrl: "/api/uploads/user-1/not-a-conversation-attachment.png",
      },
      {
        role: "bot",
        userId: null,
        imageUrl: "/api/uploads/project-1/chat-images/not-owned-by-bot.png",
      },
    ])).toEqual([
      "project-1/conversation-attachments/conv-1/a.png",
      "project-1/conversation-attachments/conv-1/b.jpg",
    ]);
  });

  test("does not delete database rows when attachment cleanup fails", async () => {
    let databaseDeleteCalled = false;
    let sidechatCleanupCalled = false;
    const store: ConversationRetentionStore = {
      claimExpired: async () => [],
      listMessageAttachments: async () => [{
        role: "agent",
        userId: "user-1",
        imageUrl: "/api/uploads/project-1/conversation-attachments/conv-1/a.png",
      }],
      isUploadKeyReferencedElsewhere: async () => false,
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
      {
        id: "conv-1",
        projectId: "project-1",
        purgeStartedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      async () => {
        sidechatCleanupCalled = true;
      },
    )).rejects.toThrow("R2 unavailable");
    expect(sidechatCleanupCalled).toBe(false);
    expect(databaseDeleteCalled).toBe(false);
  });

  test("deletes uploads but leaves database rows intact when native cleanup fails", async () => {
    const events: string[] = [];
    const store: ConversationRetentionStore = {
      claimExpired: async () => [],
      listMessageAttachments: async () => [{
        role: "agent",
        userId: "user-1",
        imageUrl: "/api/uploads/project-1/conversation-attachments/conv-1/a.png",
      }],
      isUploadKeyReferencedElsewhere: async () => false,
      deleteClaimedConversation: async () => {
        events.push("database");
        return true;
      },
    };
    const uploads = {
      delete: async () => {
        events.push("r2");
      },
    } as unknown as R2Bucket;

    await expect(purgeOneClaimedConversation(
      store,
      uploads,
      {
        id: "conv-1",
        projectId: "project-1",
        purgeStartedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      async (projectId, conversationId) => {
        events.push(`sidechat:${projectId}:${conversationId}`);
        throw new Error("native cleanup unavailable");
      },
    )).rejects.toThrow("native cleanup unavailable");
    expect(events).toEqual(["r2", "sidechat:project-1:conv-1"]);
  });

  test("counts native cleanup failures and leaves the purge claim for retry", async () => {
    let databaseDeleteCalled = false;
    const claimed = {
      id: "conv-1",
      projectId: "project-1",
      purgeStartedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const store: ConversationRetentionStore = {
      claimExpired: async () => [claimed],
      listMessageAttachments: async () => [],
      isUploadKeyReferencedElsewhere: async () => false,
      deleteClaimedConversation: async () => {
        databaseDeleteCalled = true;
        return true;
      },
    };

    const result = await purgeClaimedConversations(
      store,
      { delete: async () => undefined } as unknown as R2Bucket,
      [claimed],
      async () => {
        throw new Error("native cleanup unavailable");
      },
    );

    expect(result).toEqual({ claimed: 1, deleted: 0, failed: 1 });
    expect(databaseDeleteCalled).toBe(false);
  });

  test("deletes claimed database rows only after all attachment keys", async () => {
    const events: string[] = [];
    const store: ConversationRetentionStore = {
      claimExpired: async () => [],
      listMessageAttachments: async () => [{
        role: "agent",
        userId: "user-1",
        imageUrl: '["/api/uploads/project-1/conversation-attachments/conv-1/a.png","/api/uploads/project-1/conversation-attachments/conv-1/b.png"]',
      }],
      isUploadKeyReferencedElsewhere: async () => false,
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
      {
        id: "conv-1",
        projectId: "project-1",
        purgeStartedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      async (projectId, conversationId) => {
        events.push(`sidechat:${projectId}:${conversationId}`);
      },
    );

    expect(deleted).toBe(true);
    expect(events).toEqual([
      "r2:project-1/conversation-attachments/conv-1/a.png,project-1/conversation-attachments/conv-1/b.png",
      "sidechat:project-1:conv-1",
      "database",
    ]);
  });

  test("keeps an owned attachment when another conversation still references it", async () => {
    const events: string[] = [];
    const store: ConversationRetentionStore = {
      claimExpired: async () => [],
      listMessageAttachments: async () => [{
        role: "agent",
        userId: "user-1",
        imageUrl: "/api/uploads/project-1/conversation-attachments/conv-1/shared.png",
      }],
      isUploadKeyReferencedElsewhere: async (key) =>
        key === "project-1/conversation-attachments/conv-1/shared.png",
      deleteClaimedConversation: async () => {
        events.push("database");
        return true;
      },
    };
    const uploads = {
      delete: async () => {
        events.push("r2");
      },
    } as unknown as R2Bucket;

    const deleted = await purgeOneClaimedConversation(
      store,
      uploads,
      {
        id: "conv-1",
        projectId: "project-1",
        purgeStartedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      async (projectId, conversationId) => {
        events.push(`sidechat:${projectId}:${conversationId}`);
      },
    );

    expect(deleted).toBe(true);
    expect(events).toEqual(["sidechat:project-1:conv-1", "database"]);
  });
});
