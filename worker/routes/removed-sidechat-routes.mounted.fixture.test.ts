import { describe, expect, mock, test } from "bun:test";
import type { AppEnv } from "../types";

if (process.env.REMOVED_SIDECHAT_ROUTES_FIXTURE === "1") {
  mock.module("cloudflare:email", () => ({
    EmailMessage: class EmailMessage {},
  }));
  mock.module("cloudflare:workers", () => ({
    DurableObject: class DurableObject {},
    RpcTarget: class RpcTarget {},
    WorkerEntrypoint: class WorkerEntrypoint {},
    env: {},
    exports: {},
  }));

  mock.module("../auth", () => ({
    createAuth() {
      return {
        api: {
          async getSession() {
            const now = new Date("2026-08-10T00:00:00.000Z");
            return {
              user: {
                id: "owner-1",
                name: "Owner",
                email: "owner@example.test",
                emailVerified: true,
                image: null,
                createdAt: now,
                updatedAt: now,
              },
              session: {
                id: "session-owner-1",
                token: "token-owner-1",
                userId: "owner-1",
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
        return { id: "project-1", userId: "owner-1" };
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
    return {
      DB: {},
      CONVERSATIONS_CACHE: {
        async get() {
          return JSON.stringify({
            effectiveUserId: "owner-1",
            activeRole: "owner",
            accessAllProjects: true,
            projectIds: null,
          });
        },
        async put() {},
        async delete() {},
      },
    } as AppEnv;
  }

  function createExecutionContext(): ExecutionContext {
    return {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as ExecutionContext;
  }

  describe("retired custom Sidechat routes", () => {
    test.each([
      ["GET", "/api/projects/project-1/conversations/conversation-1/sidechat"],
      ["POST", "/api/projects/project-1/conversations/conversation-1/sidechat/messages"],
      ["POST", "/api/projects/project-1/conversations/conversation-1/sidechat/retry"],
    ] as const)("returns 404 for %s %s", async (method, path) => {
      const response = await workerModule.default.fetch(
        new Request(`https://app.test${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: method === "POST" ? "{}" : undefined,
        }),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(404);
    });
  });
} else {
  test.skip("removed route fixture runs only in its isolated child", () => {});
}
