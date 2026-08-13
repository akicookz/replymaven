import { describe, expect, test } from "bun:test";
import {
  handleConversationRuntimeBackfill,
  handleConversationRuntimeStatus,
  handleConversationRuntimeVerify,
  handleDisableCompatibilityProjection,
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
        agentCutoverAt: null,
        lastVerifiedAt: 100,
        mismatchCount: 0,
        cutoverEligible: true,
        compatibilityProjection: {
          enabled: false,
          pendingOutboxCount: 0,
          lastLegacyRequestAt: null,
          disableEligibleAt: null,
        },
      };
    },
    async disableCompatibilityProjection() {
      return { disabled: true };
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

  test("returns bounded backfill, parity, and cutover status data", async () => {
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
    expect(await status.json()).toMatchObject({ cutoverEligible: true });
  });

  test("requires the project-specific confirmation before disabling rollback", async () => {
    const rejected = await handleDisableCompatibilityProjection({
      ...options(),
      request: new Request("https://replymaven.test", {
        method: "POST",
        body: JSON.stringify({ confirmation: "disable" }),
      }),
    });
    const accepted = await handleDisableCompatibilityProjection({
      ...options(),
      request: new Request("https://replymaven.test", {
        method: "POST",
        body: JSON.stringify({
          confirmation: "disable compatibility projection for project-1",
        }),
      }),
    });

    expect(rejected.status).toBe(400);
    expect(await accepted.json()).toEqual({ disabled: true });
  });
});
