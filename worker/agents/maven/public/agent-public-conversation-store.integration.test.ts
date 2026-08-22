/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { drizzle } from "drizzle-orm/d1";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../../../shared/maven-conversation";

const isBunTest = "Bun" in globalThis;
const nativeTest = isBunTest ? test.skip : test;

function conversation(): PublicConversationRecord {
  return {
    id: "adapter-conversation-1",
    projectId: "adapter-project-1",
    customerId: null,
    visitorId: "adapter-visitor-1",
    visitorName: "Legacy visitor",
    visitorEmail: null,
    status: "active",
    closeReason: null,
    telegramThreadId: null,
    metadata: { imported: true },
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
  };
}

function message(): PublicMessageRecord {
  return {
    id: "adapter-message-1",
    conversationId: "adapter-conversation-1",
    author: "visitor",
    content: "Imported once",
    imageUrls: [],
    sources: [],
    senderName: null,
    senderAvatar: null,
    userId: null,
    systemKind: null,
    createdAt: 100,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
  };
}

describe("native AgentPublicConversationStore", () => {
  nativeTest("lazily imports a transcript after directory-only backfill", async () => {
    const [
      { env },
      { getAgentByName },
      { AgentPublicConversationStore },
      { legacyEntryToSummary },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("../../../conversations/agent-public-conversation-store"),
      import("../../../migrations/conversation-runtime-backfill"),
    ]);
    const legacyRecord = {
      ...conversation(),
      id: "adapter-backfilled-conversation",
      projectId: "adapter-backfilled-project",
      visitorId: "adapter-backfilled-visitor",
    };
    const legacyMessages = [{
      ...message(),
      id: "adapter-backfilled-message",
      conversationId: legacyRecord.id,
    }, {
      ...message(),
      id: "adapter-backfilled-system-message",
      conversationId: legacyRecord.id,
      author: "system" as const,
      content: "Joined",
      systemKind: "joined",
    }];
    const parent = await getAgentByName(
      env.MAVEN_PROJECT_AGENT,
      legacyRecord.projectId,
    );
    await parent.reconcileDirectory([
      await legacyEntryToSummary({
        conversation: legacyRecord,
        messages: legacyMessages,
      }),
    ]);
    const store = new AgentPublicConversationStore({
      db: drizzle(env.DB),
      env,
      legacy: {
        async get(projectId: string, conversationId: string) {
          return projectId === legacyRecord.projectId &&
              conversationId === legacyRecord.id
            ? legacyRecord
            : null;
        },
        async getMigrationMessages() {
          return legacyMessages;
        },
      },
    });

    await expect(store.get(legacyRecord.projectId, legacyRecord.id)).resolves
      .toMatchObject({ id: legacyRecord.id });
    await expect(store.getMessages(legacyRecord.projectId, legacyRecord.id))
      .resolves.toMatchObject(legacyMessages);
    await expect(parent.getConversationSummary(legacyRecord.id)).resolves
      .toMatchObject({ childRevision: 0 });
  }, 30_000);

  nativeTest("imports legacy data once, then keeps Agent-native state authoritative", async () => {
    const [
      { env },
      { AgentPublicConversationStore },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("../../../conversations/agent-public-conversation-store"),
    ]);
    const legacyRecord = conversation();
    const legacyMessages = [message()];
    const legacy = {
      async get(projectId: string, conversationId: string) {
        return projectId === legacyRecord.projectId &&
            conversationId === legacyRecord.id
          ? structuredClone(legacyRecord)
          : null;
      },
      async getMigrationMessages(projectId: string, conversationId: string) {
        return projectId === legacyRecord.projectId &&
            conversationId === legacyRecord.id
          ? structuredClone(legacyMessages)
          : [];
      },
    };
    const store = new AgentPublicConversationStore({
      db: drizzle(env.DB),
      env,
      legacy,
    });

    await expect(store.get(legacyRecord.projectId, legacyRecord.id)).resolves
      .toMatchObject({ visitorName: "Legacy visitor" });
    await expect(store.getMessages(legacyRecord.projectId, legacyRecord.id))
      .resolves.toMatchObject(legacyMessages);
    await store.updateContact({
      projectId: legacyRecord.projectId,
      conversationId: legacyRecord.id,
      visitorName: "Agent visitor",
    });
    legacyRecord.visitorName = "Stale legacy visitor";

    await expect(store.get(legacyRecord.projectId, legacyRecord.id)).resolves
      .toMatchObject({ visitorName: "Agent visitor" });
    await expect(store.getMessages(legacyRecord.projectId, legacyRecord.id))
      .resolves.toHaveLength(1);
    await expect(store.list({ projectId: legacyRecord.projectId })).resolves
      .toMatchObject({
        conversations: [{
          id: legacyRecord.id,
          visitorName: "Agent visitor",
        }],
      });
    await expect(store.getDashboardConversationPage(
      legacyRecord.projectId,
      { filter: "inbox", limit: 25 },
    )).resolves.toMatchObject({
      conversations: [{
        conversation: {
          id: legacyRecord.id,
          visitorName: "Agent visitor",
        },
        lastMessage: {
          id: "adapter-message-1",
          content: "Imported once",
          createdAt: 100,
        },
      }],
      counts: { inbox: 1 },
      nextCursor: null,
    });
  }, 30_000);
});
