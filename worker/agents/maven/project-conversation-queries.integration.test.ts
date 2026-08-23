/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../../shared/maven-conversation";

const isBunTest = "Bun" in globalThis;
const nativeTest = isBunTest ? test.skip : test;
const RETENTION_MS = 60 * 24 * 60 * 60 * 1_000;

function conversation(
  projectId: string,
  conversationId: string,
  overrides: Partial<PublicConversationRecord> = {},
): PublicConversationRecord {
  return {
    id: conversationId,
    projectId,
    customerId: null,
    visitorId: `visitor-${conversationId}`,
    visitorName: conversationId,
    visitorEmail: `${conversationId}@example.com`,
    status: "active",
    closeReason: null,
    telegramThreadId: null,
    channelThreads: {},
    metadata: {},
    chatState: { aiParticipation: "continuous" },
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

function message(
  conversationId: string,
  id: string,
  author: PublicMessageRecord["author"],
  createdAt: number,
  imageUrls: string[] = [],
): PublicMessageRecord {
  return {
    id,
    conversationId,
    author,
    content: id,
    imageUrls,
    sources: [],
    senderName: author === "agent" ? "Grace" : null,
    senderAvatar: null,
    userId: author === "agent" ? "agent-1" : null,
    systemKind: null,
    createdAt,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
  };
}

// Purge deletes the legacy compatibility rows before the authoritative child.
async function ensureCompatibilitySchema(): Promise<void> {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS conversations (
        id text PRIMARY KEY NOT NULL,
        project_id text NOT NULL,
        archived_at integer
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS tool_executions (
        id text PRIMARY KEY NOT NULL,
        conversation_id text
      )`,
    ),
  ]);
}

async function createConversation(
  projectId: string,
  conversationId: string,
  record: PublicConversationRecord,
  messages: PublicMessageRecord[],
) {
  const [{ env }, { getSubAgentByName }, { MavenChatAgent }] =
    await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("./maven-chat-agent"),
    ]);
  await ensureCompatibilitySchema();
  const parent = env.MAVEN_PROJECT_AGENT.get(
    env.MAVEN_PROJECT_AGENT.idFromName(projectId),
  );
  await parent.registerPublicConversation(conversationId);
  const child = await getSubAgentByName(
    parent,
    MavenChatAgent,
    `pub_${conversationId}`,
  );
  await child.importLegacyPublicConversation({
    conversation: record,
    messages,
    checksum: `checksum-${conversationId}`,
  });
  return { child, parent };
}

describe("project conversation queries", () => {
  nativeTest("answers customer, visitor, analytics, usage, and reconciliation queries from parent SQL", async () => {
    const projectId = "project-query-rpcs";
    const first = await createConversation(
      projectId,
      "conversation-a",
      conversation(projectId, "conversation-a", {
        customerId: "customer-1",
        visitorId: "visitor-shared",
        metadata: { source: "pricing", locale: "en" },
        createdAt: 1_000,
        updatedAt: 2_000,
        lastActivityAt: 2_000,
      }),
      [
        message("conversation-a", "visitor-a", "visitor", 1_100),
        message("conversation-a", "bot-a", "bot", 1_200),
      ],
    );
    await createConversation(
      projectId,
      "conversation-b",
      conversation(projectId, "conversation-b", {
        customerId: "customer-1",
        visitorId: "visitor-shared",
        status: "closed",
        metadata: { source: "docs" },
        createdAt: 3_000,
        updatedAt: 4_000,
        lastActivityAt: 4_000,
      }),
      [message("conversation-b", "bot-b", "bot", 3_100)],
    );
    await createConversation(
      projectId,
      "conversation-c",
      conversation(projectId, "conversation-c", {
        customerId: "customer-2",
        metadata: { source: "pricing" },
        createdAt: 5_000,
        updatedAt: 6_000,
        lastActivityAt: 6_000,
      }),
      [],
    );

    await expect(first.parent.listByCustomer("customer-1")).resolves
      .toSatisfy((rows: Array<{ conversationId: string }>) =>
        rows.map((row) => row.conversationId).sort().join(",") ===
          "conversation-a,conversation-b"
      );
    await expect(first.parent.listByVisitor("visitor-shared")).resolves
      .toHaveLength(2);
    await expect(first.parent.getConversationCountsByCustomer([
      "customer-1",
      "customer-2",
      "customer-missing",
    ])).resolves.toEqual([
      { customerId: "customer-1", count: 2 },
      { customerId: "customer-2", count: 1 },
      { customerId: "customer-missing", count: 0 },
    ]);
    await expect(first.parent.getProjectStats(0)).resolves.toMatchObject({
      totalConversations: 3,
      activeConversations: 2,
      totalMessages: 3,
      recentConversations: [
        { conversationId: "conversation-c" },
        { conversationId: "conversation-b" },
        { conversationId: "conversation-a" },
      ],
    });
    await expect(first.parent.getUsageLog({
      periodStart: 0,
      periodEnd: 10_000,
      limit: 10,
      offset: 0,
      sortBy: "botMessages",
      sortOrder: "desc",
      metadataKey: "source",
      metadataValue: "pricing",
    })).resolves.toMatchObject({
      total: 2,
      summaries: [
        { conversationId: "conversation-a", botMessageCount: 1 },
        { conversationId: "conversation-c", botMessageCount: 0 },
      ],
      metadataKeys: ["locale", "source"],
    });
    await expect(first.parent.reconcileDirectory([
      {
        ...(await first.parent.getConversationSummary("conversation-a")),
        conversationId: "conversation-a",
        childRevision: 0,
      },
    ])).resolves.toEqual({ applied: 0, skipped: 1 });
  });

  nativeTest("builds Sidechat public context from the sibling public child", async () => {
    const projectId = "project-sidechat-public-context";
    const conversationId = "conversation-context";
    const messages = Array.from({ length: 45 }, (_, index) =>
      message(
        conversationId,
        `message-${String(index).padStart(2, "0")}`,
        index % 2 === 0 ? "visitor" : "bot",
        1_000 + index,
      )
    );
    const { parent } = await createConversation(
      projectId,
      conversationId,
      conversation(projectId, conversationId),
      messages,
    );
    const registration = await parent.registerSidechat(conversationId);

    await expect(parent.getSidechatContext(
      registration.childName,
      conversationId,
    )).resolves.toMatchObject({
      projectId,
      conversationId,
      conversationStatus: "active",
      recentPublicMessages: [
        { id: "message-05" },
        ...messages.slice(6).map((entry) => ({ id: entry.id })),
      ],
    });
  });

  nativeTest("retries and deduplicates project-owned customer mutations", async () => {
    const projectId = "project-customer-mutations";
    const conversationId = "conversation-customer";
    const { child, parent } = await createConversation(
      projectId,
      conversationId,
      conversation(projectId, conversationId),
      [],
    );
    const mutation = {
      mutationId: "mutation-1",
      updates: [{
        conversationId,
        customerId: "customer-1",
        visitorName: "Ada",
        visitorEmail: "ada@example.com",
      }],
    };

    const first = await parent.applyPublicCustomerMutation(mutation);
    const firstSnapshot = await child.getPublicSnapshot();
    const repeated = await parent.applyPublicCustomerMutation(mutation);
    const repeatedSnapshot = await child.getPublicSnapshot();

    expect(first).toEqual({ status: "completed", updatedIds: [conversationId] });
    expect(repeated).toEqual(first);
    expect(repeatedSnapshot.revision).toBe(firstSnapshot.revision);
    expect(repeatedSnapshot.conversation).toMatchObject({
      customerId: "customer-1",
      visitorName: "Ada",
      visitorEmail: "ada@example.com",
    });

    await expect(parent.applyPublicCustomerMutation({
      mutationId: "mutation-pending",
      updates: [{
        conversationId: "conversation-late",
        customerId: "customer-2",
      }],
    })).resolves.toEqual({ status: "pending", updatedIds: [] });
    await expect(parent.listSchedules({
      callback: "retryPublicCustomerMutation",
    })).resolves.toHaveLength(1);
  });

  nativeTest("schedules archive retention, cancels on unarchive, and purges both children plus scoped R2", async () => {
    const { env } = await import("cloudflare:workers");
    const projectId = "project-retention-schedule";
    const conversationId = "conversation-retention";
    const key = `${projectId}/conversation-attachments/${conversationId}/image.png`;
    const { child, parent } = await createConversation(
      projectId,
      conversationId,
      conversation(projectId, conversationId),
      [message(
        conversationId,
        "attachment-message",
        "visitor",
        100,
        [`https://replymaven.test/api/uploads/${key}`],
      )],
    );
    await parent.registerSidechat(conversationId);
    await env.UPLOADS.put(key, "image");

    await child.applyConversationAction({ action: "archive" });
    const firstArchive = await parent.getConversationSummary(conversationId);
    expect(firstArchive?.retentionScheduleId).toBeTypeOf("string");
    await expect(parent.listSchedules({
      callback: "purgeConversation",
    })).resolves.toHaveLength(1);

    await child.applyConversationAction({ action: "unarchive" });
    await expect(parent.listSchedules({
      callback: "purgeConversation",
    })).resolves.toHaveLength(0);
    await expect(parent.getConversationSummary(conversationId)).resolves
      .toMatchObject({ retentionScheduleId: null });

    await child.applyConversationAction({ action: "archive" });
    const archived = await parent.getConversationSummary(conversationId);
    if (!archived?.archivedAt) throw new Error("Expected archived summary");
    await parent.purgeConversation({
      conversationId,
      archivedAt: archived.archivedAt,
      now: archived.archivedAt + RETENTION_MS,
    });

    await expect(env.UPLOADS.get(key)).resolves.toBeNull();
    await expect(parent.getConversationSummary(conversationId)).resolves.toBeNull();
    await expect(parent.getConversationChildPresence(conversationId)).resolves
      .toEqual({ public: false, sidechat: false });
  });
});
