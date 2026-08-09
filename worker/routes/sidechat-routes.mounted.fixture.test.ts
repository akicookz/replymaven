import { describe, expect, mock, test } from "bun:test";
import type { MessageRow } from "../db";
import type { AppEnv } from "../types";

const project = { id: "project-1", userId: "owner-1" };
const message: MessageRow = {
  id: "sidechat-1",
  conversationId: "conversation-1",
  role: "agent",
  content: "Private history",
  channel: "sidechat",
  kind: "text",
  metadata: null,
  imageUrl: null,
  sources: null,
  senderName: "Agent",
  senderAvatar: null,
  userId: "owner-1",
  createdAt: new Date("2026-08-09T12:00:00.000Z"),
  emailedAt: null,
  deliveredAt: null,
  readAt: null,
};

const teamContexts = new Map([
  ["owner-1", {
    effectiveUserId: "owner-1",
    activeRole: "owner",
    accessAllProjects: true,
    projectIds: null,
  }],
  ["admin-1", {
    effectiveUserId: "owner-1",
    activeRole: "admin",
    accessAllProjects: true,
    projectIds: null,
  }],
  ["member-1", {
    effectiveUserId: "owner-1",
    activeRole: "member",
    accessAllProjects: false,
    projectIds: ["project-1"],
  }],
  ["outsider-1", {
    effectiveUserId: "outsider-1",
    activeRole: "owner",
    accessAllProjects: true,
    projectIds: null,
  }],
]);

if (process.env.SIDECHAT_MOUNTED_FIXTURE === "1") {
mock.module("cloudflare:email", () => ({
  EmailMessage: class EmailMessage {},
}));
mock.module("cloudflare:workers", () => ({
  DurableObject: class DurableObject {},
  RpcTarget: class RpcTarget {},
  env: {},
  exports: {},
}));

mock.module("../auth", () => ({
  createAuth() {
    return {
      api: {
        async getSession({ headers }: { headers: Headers }) {
          const userId = headers.get("x-test-user");
          if (!userId) return null;
          const now = new Date("2026-08-09T12:00:00.000Z");
          return {
            user: {
              id: userId,
              name: userId,
              email: `${userId}@example.test`,
              emailVerified: true,
              image: null,
              createdAt: now,
              updatedAt: now,
            },
            session: {
              id: `session-${userId}`,
              token: `token-${userId}`,
              userId,
              expiresAt: new Date(now.getTime() + 60_000),
              ipAddress: null,
              userAgent: null,
              createdAt: now,
              updatedAt: now,
            },
          };
        },
      },
      handler() {
        return new Response(null, { status: 404 });
      },
    };
  },
}));

mock.module("../services/project-service", () => ({
  ProjectService: class ProjectService {
    async getProjectById() {
      return project;
    }
  },
}));

mock.module("../services/chat-service", () => ({
  ChatService: class ChatService {
    async getConversationById() {
      return {
        id: "conversation-1",
        projectId: "project-1",
        customerId: null,
        visitorName: "Conversation customer",
        archivedAt: null,
        status: "active",
        chatState: null,
        lastActivityAt: message.createdAt,
        sidechatStatus: "idle",
        sidechatRunId: null,
        sidechatLeaseExpiresAt: null,
      };
    }

    async getRecentSidechatMessages() {
      return { messages: [message], hasMore: false };
    }
  },
}));

mock.module("../services/billing-service", () => ({
  BillingService: class BillingService {
    static getPlanLimits() {
      return null;
    }

    async getSubscriptionByUserId() {
      return null;
    }
  },
}));

const workerModule = await import("../index");

function createEnv(): AppEnv {
  const conversationsCache = {
    async get(key: string) {
      const userId = key.replace("teamctx:", "");
      const context = teamContexts.get(userId);
      return context ? JSON.stringify(context) : null;
    },
    async put() {},
    async delete() {},
  };
  return {
    DB: {},
    CONVERSATIONS_CACHE: conversationsCache,
  } as AppEnv;
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as ExecutionContext;
}

describe("mounted authenticated Sidechat history route", () => {
  test.each([
    ["owner", "owner-1", 200],
    ["admin", "admin-1", 200],
    ["scoped member", "member-1", 200],
    ["unrelated user", "outsider-1", 404],
  ] as const)("applies real session/team authorization for %s", async (
    _label,
    userId,
    expectedStatus,
  ) => {
    const response = await workerModule.default.fetch(
      new Request(
        "https://app.test/api/projects/project-1/conversations/conversation-1/sidechat",
        { headers: { "x-test-user": userId } },
      ),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 200) {
      expect(await response.json()).toMatchObject({
        messages: [{ id: "sidechat-1", content: "Private history" }],
      });
    } else {
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });
});
} else {
  test.skip("mounted Sidechat fixture runs only in its isolated child", () => {});
}
