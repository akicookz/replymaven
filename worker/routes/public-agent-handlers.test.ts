import { describe, expect, test } from "bun:test";
import type { PublicConversationRecord } from "../../shared/maven-conversation";
import {
  handleCreateDashboardPublicAgentSession,
  handleCreateWidgetPublicAgentSession,
} from "./public-agent-handlers";

const secret = "public-agent-route-test-secret-32-bytes";
const now = 1_786_294_800;

function conversation(
  overrides: Partial<PublicConversationRecord> = {},
): PublicConversationRecord {
  return {
    id: "conversation-1",
    projectId: "project-1",
    customerId: null,
    visitorId: "visitor-1",
    visitorName: null,
    visitorEmail: null,
    status: "active",
    closeReason: null,
    telegramThreadId: null,
    metadata: {},
    chatState: {},
    lastActivityAt: 100,
    visitorLastSeenAt: null,
    visitorPresence: "active",
    visitorLastOnlineAt: null,
    snoozedUntil: null,
    archivedAt: null,
    purgeStartedAt: null,
    externalActionStartedAt: null,
    priority: "medium",
    assigneeId: null,
    createdAt: 50,
    updatedAt: 100,
    ownershipRevision: 0,
    ...overrides,
  };
}

function dependencies(options: {
  record?: PublicConversationRecord | null;
  banned?: boolean;
} = {}) {
  const ensured: string[] = [];
  return {
    ensured,
    projectService: {
      async getProjectBySlugPublic(slug: string) {
        return slug === "project-slug"
          ? { id: "project-1", userId: "owner-1" }
          : null;
      },
      async getProjectById(id: string) {
        return id === "project-1"
          ? { id: "project-1", userId: "owner-1" }
          : null;
      },
    },
    conversationStore: {
      async get(projectId: string, conversationId: string) {
        if (projectId !== "project-1" || conversationId !== "conversation-1") {
          return null;
        }
        return options.record === undefined ? conversation() : options.record;
      },
    },
    banService: {
      async isVisitorBanned() {
        return options.banned ? { id: "ban-1" } : null;
      },
    },
    async ensurePublicConversation(record: PublicConversationRecord) {
      ensured.push(record.id);
      return { childName: `pub_${record.id}` as const };
    },
  };
}

describe("public Agent session handlers", () => {
  test("creates a visitor session for the exact slug, conversation, and visitor", async () => {
    const deps = dependencies();
    const response = await handleCreateWidgetPublicAgentSession({
      request: new Request(
        "https://api.replymaven.test/api/widget/project-slug/conversations/conversation-1/agent-session",
        { method: "POST" },
      ),
      projectSlug: "project-slug",
      conversationId: "conversation-1",
      visitorId: "visitor-1",
      secret,
      now,
      ...deps,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      host: "https://api.replymaven.test",
      parentAgent: "MavenProjectAgent",
      parentName: "project-1",
      childAgent: "MavenChatAgent",
      childName: "pub_conversation-1",
      expiresAt: now + 120,
    });
    expect(deps.ensured).toEqual(["conversation-1"]);
  });

  test("hides wrong visitors and rejects archived or banned visitors", async () => {
    const base = {
      request: new Request("https://api.test/session", { method: "POST" }),
      projectSlug: "project-slug",
      conversationId: "conversation-1",
      secret,
      now,
    };
    expect((await handleCreateWidgetPublicAgentSession({
      ...base,
      visitorId: "visitor-2",
      ...dependencies(),
    })).status).toBe(404);
    expect((await handleCreateWidgetPublicAgentSession({
      ...base,
      visitorId: "visitor-1",
      ...dependencies({ record: conversation({ archivedAt: 200 }) }),
    })).status).toBe(409);
    expect((await handleCreateWidgetPublicAgentSession({
      ...base,
      visitorId: "visitor-1",
      ...dependencies({ banned: true }),
    })).status).toBe(403);
  });

  test("rejects visitor identifiers that cannot be represented in Agent claims", async () => {
    const invalidVisitorId = "visitor id with spaces";
    const deps = dependencies({
      record: conversation({ visitorId: invalidVisitorId }),
    });
    const response = await handleCreateWidgetPublicAgentSession({
      request: new Request("https://api.test/session", { method: "POST" }),
      projectSlug: "project-slug",
      conversationId: "conversation-1",
      visitorId: invalidVisitorId,
      secret,
      now,
      ...deps,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_visitor_id" });
    expect(deps.ensured).toEqual([]);
  });

  test("creates read-only dashboard claims only for an authorized project actor", async () => {
    const deps = dependencies({ record: conversation({ archivedAt: 200 }) });
    const response = await handleCreateDashboardPublicAgentSession({
      request: new Request("https://app.replymaven.test/session", {
        method: "POST",
      }),
      actor: {
        userId: "user-1",
        effectiveUserId: "owner-1",
        role: "owner",
        accessAllProjects: true,
        projectIds: null,
      },
      projectId: "project-1",
      conversationId: "conversation-1",
      secret,
      now,
      ...deps,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      host: "https://app.replymaven.test",
      childName: "pub_conversation-1",
    });

    const denied = await handleCreateDashboardPublicAgentSession({
      request: new Request("https://app.test/session", { method: "POST" }),
      actor: null,
      projectId: "project-1",
      conversationId: "conversation-1",
      secret,
      now,
      ...dependencies(),
    });
    expect(denied.status).toBe(401);
  });
});
