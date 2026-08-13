/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../../../shared/maven-conversation";

const isBunTest = "Bun" in globalThis;
const nativeTest = isBunTest ? test.skip : test;

function conversation(
  projectId: string,
  conversationId: string,
  visitorId = "visitor-operations",
): PublicConversationRecord {
  return {
    id: conversationId,
    projectId,
    customerId: null,
    visitorId,
    visitorName: "Ada",
    visitorEmail: "ada@example.com",
    status: "active",
    closeReason: null,
    telegramThreadId: null,
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
  };
}

function humanMessage(
  conversationId: string,
  id = "telegram:100:200",
): PublicMessageRecord {
  return {
    id,
    conversationId,
    author: "agent",
    content: "A human reply",
    imageUrls: [],
    sources: [],
    senderName: "Grace",
    senderAvatar: null,
    userId: null,
    systemKind: null,
    createdAt: 200,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
  };
}

async function createChild(
  projectId: string,
  conversationId: string,
  messages: PublicMessageRecord[] = [],
): Promise<{
  child: import("../maven-chat-agent").MavenChatAgent;
  parent: DurableObjectStub;
}> {
  const [{ env }, { getSubAgentByName }, { MavenChatAgent }] =
    await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("../maven-chat-agent"),
    ]);
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
    conversation: conversation(projectId, conversationId),
    messages,
    checksum: `checksum-${conversationId}`,
  });
  return { child, parent };
}

describe("native public conversation operations", () => {
  nativeTest("deduplicates repeated external human replies without a second revision", async () => {
    const projectId = "public-operations-human";
    const conversationId = "conversation-human";
    const { child } = await createChild(projectId, conversationId);
    const message = humanMessage(conversationId);

    await expect(child.appendHumanMessage(message)).resolves.toMatchObject(message);
    await expect(child.appendHumanMessage(message)).resolves.toMatchObject(message);

    await expect(child.getPublicSnapshot()).resolves.toMatchObject({
      revision: 1,
      messages: [{ id: message.id, author: "agent" }],
      conversation: { status: "agent_replied", ownershipRevision: 1 },
    });
  });

  nativeTest("keeps repeated actions idempotent", async () => {
    const projectId = "public-operations-action";
    const conversationId = "conversation-action";
    const { child } = await createChild(projectId, conversationId);

    await child.applyConversationAction({
      action: "priority",
      priority: "high",
    });
    await child.applyConversationAction({
      action: "priority",
      priority: "high",
    });

    await expect(child.getPublicSnapshot()).resolves.toMatchObject({
      revision: 1,
      conversation: { priority: "high" },
    });
  });

  nativeTest("applies out-of-order delivery receipts monotonically", async () => {
    const projectId = "public-operations-delivery";
    const conversationId = "conversation-delivery";
    const message = humanMessage(conversationId, "human-delivery");
    const { child } = await createChild(projectId, conversationId, [message]);

    await expect(child.markDelivery({
      projectId,
      conversationId,
      upToMessageId: message.id,
      kind: "read",
    })).resolves.toEqual([message.id]);
    await expect(child.markDelivery({
      projectId,
      conversationId,
      upToMessageId: message.id,
      kind: "delivered",
    })).resolves.toEqual([]);

    const snapshot = await child.getPublicSnapshot();
    expect(snapshot.revision).toBe(1);
    expect(snapshot.messages[0]?.deliveredAt).toBeTypeOf("number");
    expect(snapshot.messages[0]?.readAt).toBeTypeOf("number");
  });

  nativeTest("keeps deletion idempotent and lets archive win an external lease", async () => {
    const projectId = "public-operations-archive";
    const conversationId = "conversation-archive";
    const message = humanMessage(conversationId, "human-delete");
    const { child } = await createChild(projectId, conversationId, [message]);

    await expect(child.deleteHumanMessage(message.id)).resolves.toMatchObject({
      deleted: true,
      message: { id: message.id },
    });
    await expect(child.deleteHumanMessage(message.id)).resolves.toEqual({
      deleted: false,
      reason: "not_found",
    });
    const lease = await child.acquireExternalAction({
      projectId,
      conversationId,
      now: 300,
    });
    expect(lease).not.toBeNull();
    await child.applyConversationAction({ action: "archive" });
    if (lease) await child.releaseExternalAction(lease);

    await expect(child.getPublicSnapshot()).resolves.toMatchObject({
      revision: 3,
      messages: [],
      conversation: { archivedAt: expect.any(Number) },
    });
  });

  nativeTest("closes every matching open visitor conversation through the parent", async () => {
    const projectId = "public-operations-spam";
    const first = await createChild(projectId, "conversation-spam-a");
    const second = await createChild(projectId, "conversation-spam-b");
    await createChild(projectId, "conversation-other");

    const closedIds = await first.parent.closePublicConversationsAsSpam({
      visitorId: "visitor-operations",
      visitorEmail: "ada@example.com",
    });
    expect(closedIds.sort()).toEqual([
      "conversation-spam-a",
      "conversation-spam-b",
      "conversation-other",
    ].sort());

    await expect(first.child.getPublicSnapshot()).resolves.toMatchObject({
      revision: 1,
      conversation: { status: "closed", closeReason: "spam" },
    });
    await expect(second.child.getPublicSnapshot()).resolves.toMatchObject({
      revision: 1,
      conversation: { status: "closed", closeReason: "spam" },
    });
  });
});
