import { describe, expect, test } from "bun:test";
import {
  handleConversationRuntimeBackfill,
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
        processed: 2,
        complete: true,
        nextCursor: null,
        legacyCount: 2,
        agentCount: 2,
        legacyOnlyCount: 0,
        agentOnlyCount: 0,
        operationalMismatchCount: 0,
        transcriptMismatchCount: 0,
        mismatchCount: 0,
        mismatchedIds: [],
      };
    },
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    request: new Request("https://replymaven.test", { method: "POST" }),
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
    const signedOut = await handleConversationRuntimeVerify(options({
      actor: null,
    }));
    const member = await handleConversationRuntimeVerify(options({
      actor: actor("member"),
    }));
    const wrongAccount = await handleConversationRuntimeVerify(options({
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

  test("returns bounded cursor-in, cursor-out batch results", async () => {
    const backfill = await handleConversationRuntimeBackfill(options({
      request: new Request("https://replymaven.test", {
        method: "POST",
        body: JSON.stringify({ cursor: "conversation-0", limit: 100 }),
      }),
    }));
    const verify = await handleConversationRuntimeVerify(options());
    const badLimit = await handleConversationRuntimeBackfill(options({
      request: new Request("https://replymaven.test", {
        method: "POST",
        body: JSON.stringify({ limit: 500 }),
      }),
    }));
    const badCursor = await handleConversationRuntimeVerify(options({
      request: new Request("https://replymaven.test", {
        method: "POST",
        body: JSON.stringify({ cursor: 42 }),
      }),
    }));

    expect(await backfill.json()).toMatchObject({
      processed: 2,
      complete: false,
      nextCursor: "opaque-cursor",
    });
    expect(await verify.json()).toMatchObject({
      complete: true,
      mismatchCount: 0,
    });
    expect(badLimit.status).toBe(400);
    expect(badCursor.status).toBe(400);
  });
});
