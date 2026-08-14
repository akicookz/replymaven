import { describe, expect, test } from "bun:test";
import {
  handleConversationRuntimeBackfill,
  handleConversationRuntimeStatus,
  handleConversationRuntimeVerify,
  type ConversationRuntimeAdminActor,
  type ConversationRuntimeAdminService,
} from "./conversation-runtime-admin";

function actor(
  role: ConversationRuntimeAdminActor["role"] = "owner",
): ConversationRuntimeAdminActor {
  return { userId: "user-1", effectiveUserId: "owner-1", role };
}

function service(): ConversationRuntimeAdminService {
  return {
    async backfillProject() {
      return {
        processed: 2,
        applied: 2,
        skipped: 0,
        complete: false,
        nextCursor: "opaque-cursor",
      };
    },
    async verifyProject() {
      return {
        legacyCount: 2,
        agentCount: 2,
        legacyOnlyCount: 0,
        agentOnlyCount: 0,
        operationalMismatchCount: 0,
        transcriptMismatchCount: 0,
        mismatchCount: 0,
        verifiedAt: 100,
      };
    },
    async getStatus() {
      return {
        projectId: "project-1",
        directoryCursor: "opaque-cursor",
        directoryCompleteAt: 100,
        lastVerifiedAt: 100,
        mismatchCount: 0,
        backfillComplete: true,
        verified: true,
      };
    },
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    actor: actor(),
    projectId: "project-1",
    projectService: {
      async getProjectById() {
        return { id: "project-1", userId: "owner-1" };
      },
    },
    runtimeService: service(),
    ...overrides,
  };
}

describe("conversation runtime admin handlers", () => {
  test("requires an owner or admin in the exact project account", async () => {
    const signedOut = await handleConversationRuntimeStatus(options({
      actor: null,
    }));
    const member = await handleConversationRuntimeStatus(options({
      actor: actor("member"),
    }));
    const wrongAccount = await handleConversationRuntimeStatus(options({
      actor: actor("admin"),
      projectService: {
        async getProjectById() {
          return { id: "project-1", userId: "someone-else" };
        },
      },
    }));

    expect(signedOut.status).toBe(401);
    expect(member.status).toBe(403);
    expect(wrongAccount.status).toBe(404);
  });

  test("returns bounded backfill, parity, and status data", async () => {
    const backfill = await handleConversationRuntimeBackfill({
      ...options(),
      request: new Request("https://replymaven.test", {
        method: "POST",
        body: JSON.stringify({ limit: 100 }),
      }),
    });
    const verify = await handleConversationRuntimeVerify(options());
    const status = await handleConversationRuntimeStatus(options());

    expect(await backfill.json()).toMatchObject({
      processed: 2,
      nextCursor: "opaque-cursor",
    });
    expect(await verify.json()).toMatchObject({ mismatchCount: 0 });
    expect(await status.json()).toMatchObject({
      backfillComplete: true,
      verified: true,
    });
  });
});
