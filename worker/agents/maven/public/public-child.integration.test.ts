/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { UIMessage } from "ai";
import { MessageType } from "@cloudflare/ai-chat/types";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../../../shared/maven-conversation";

const isBunTest = "Bun" in globalThis;
const nativeTest = isBunTest ? test.skip : test;

function loadMigrationSources(): Record<string, string> {
  return import.meta.glob<string>("../../../db/drizzle/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  });
}

async function preparePublicTurnDatabase(
  db: D1Database,
  projectId: string,
): Promise<void> {
  const { applyD1Migrations } = await import("cloudflare:test");
  const migrationSources = loadMigrationSources();
  await applyD1Migrations(
    db,
    Object.entries(migrationSources)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, source]) => ({
        name,
        queries: source.split("--> statement-breakpoint")
          .map((query) => query.trim())
          .filter(Boolean),
      })),
    "public_child_test_migrations",
  );
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO users (
      id, name, email, email_verified, created_at, updated_at
    ) VALUES (?, ?, ?, 1, unixepoch(), unixepoch())`).bind(
      "public-turn-owner",
      "Public Turn Owner",
      "public-turn-owner@example.com",
    ),
    db.prepare(`INSERT OR IGNORE INTO projects (
      id, user_id, name, slug, onboarded, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, unixepoch(), unixepoch())`).bind(
      projectId,
      "public-turn-owner",
      "Public Turn Project",
      projectId,
    ),
    db.prepare(`INSERT OR IGNORE INTO subscriptions (
      id, user_id, stripe_customer_id, plan, interval, status,
      current_period_start, current_period_end, cancel_at_period_end,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'starter', 'monthly', 'active', ?, ?, 0,
      unixepoch(), unixepoch())`).bind(
      "public-turn-subscription",
      "public-turn-owner",
      "cus_public_turn",
      Math.floor(Date.now() / 1_000) - 60,
      Math.floor(Date.now() / 1_000) + 2_592_000,
    ),
  ]);
}

function conversation(
  conversationId: string,
): PublicConversationRecord {
  return {
    id: conversationId,
    projectId: "public-child-project",
    customerId: "customer-1",
    visitorId: "visitor-1",
    visitorName: "Ada",
    visitorEmail: "ada@example.com",
    status: "active",
    closeReason: null,
    telegramThreadId: "telegram-1",
    metadata: { locale: "en", privateKey: "not-in-agent-state" },
    chatState: { aiParticipation: "continuous" },
    lastActivityAt: 100,
    visitorLastSeenAt: 90,
    visitorPresence: "active",
    visitorLastOnlineAt: 90,
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

function publicMessage(
  id: string,
  author: PublicMessageRecord["author"],
  content = id,
): PublicMessageRecord {
  return {
    id,
    conversationId: "conversation-a",
    author,
    content,
    imageUrls: author === "visitor" ? ["https://example.com/image.png"] : [],
    sources: author === "bot"
      ? [{
          title: "Docs",
          url: "https://example.com/docs",
          type: "webpage",
        }]
      : [],
    senderName: author === "agent" ? "Grace" : null,
    senderAvatar: null,
    userId: author === "agent" ? "user-1" : null,
    systemKind: author === "system" ? "joined" : null,
    createdAt: 100,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
  };
}

function privateMessage(id: string): UIMessage {
  return {
    id,
    role: "user",
    metadata: { mustDisappear: true },
    parts: [{ type: "text", text: id }],
  };
}

describe("native public MavenChatAgent child", () => {
  nativeTest("isolates public and Sidechat children under one Agent class", async () => {
    const [
      { env },
      { getSubAgentByName },
      { MavenChatAgent },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("../maven-chat-agent"),
    ]);
    const projectId = "public-child-project";
    const conversationId = "conversation-a";
    const parent = env.MAVEN_PROJECT_AGENT.get(
      env.MAVEN_PROJECT_AGENT.idFromName(projectId),
    );
    await parent.registerPublicConversation(conversationId);
    await parent.registerSidechat(conversationId);
    const publicChild = await getSubAgentByName(
      parent,
      MavenChatAgent,
      `pub_${conversationId}`,
    );
    const sidechatChild = await getSubAgentByName(
      parent,
      MavenChatAgent,
      `sc_${conversationId}`,
    );

    await expect(publicChild.importLegacyPublicConversation({
      conversation: conversation(conversationId),
      messages: [
        publicMessage("visitor-1", "visitor", "Hello"),
        publicMessage("bot-1", "bot", "Hi"),
      ],
      checksum: "checksum-a",
    })).resolves.toEqual({ status: "imported", revision: 0 });
    await sidechatChild.persistMessages([privateMessage("private-1")]);

    await expect(publicChild.getPublicSnapshot()).resolves.toMatchObject({
      conversation: { id: conversationId, projectId },
      messages: [
        { id: "visitor-1", author: "visitor", content: "Hello" },
        { id: "bot-1", author: "bot", content: "Hi" },
      ],
      revision: 0,
    });
    await expect(parent.getConversationSummary(conversationId)).resolves
      .toMatchObject({
        conversationId,
        publicChildName: `pub_${conversationId}`,
        sidechatChildName: `sc_${conversationId}`,
        visitorName: "Ada",
        messageCount: 2,
        childRevision: 0,
      });
    await expect(sidechatChild.getPrivateTranscriptSnapshot()).resolves.toEqual([
      {
        id: "private-1",
        role: "user",
        parts: [{ type: "text", text: "private-1" }],
      },
    ]);
  }, 30_000);

  nativeTest("imports once and rejects import after an Agent-native write", async () => {
    const [
      { env },
      { getSubAgentByName },
      { MavenChatAgent },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("../maven-chat-agent"),
    ]);
    const projectId = "public-child-project";
    const conversationId = "conversation-import-once";
    const parent = env.MAVEN_PROJECT_AGENT.get(
      env.MAVEN_PROJECT_AGENT.idFromName(projectId),
    );
    await parent.registerPublicConversation(conversationId);
    const child = await getSubAgentByName(
      parent,
      MavenChatAgent,
      `pub_${conversationId}`,
    );
    const record = conversation(conversationId);
    const messages = [{
      ...publicMessage("visitor-1", "visitor"),
      conversationId,
    }];

    await expect(child.importLegacyPublicConversation({
      conversation: record,
      messages,
      checksum: "checksum-once",
    })).resolves.toEqual({ status: "imported", revision: 0 });
    await expect(child.importLegacyPublicConversation({
      conversation: record,
      messages,
      checksum: "checksum-once",
    })).resolves.toEqual({ status: "noop", revision: 0 });
    await child.appendSystemMessage({
      id: "system-native",
      conversationId,
      author: "system",
      content: "A native write",
      imageUrls: [],
      sources: [],
      senderName: null,
      senderAvatar: null,
      userId: null,
      systemKind: "joined",
      createdAt: 200,
      deliveredAt: null,
      readAt: null,
      emailedAt: null,
    });
    await expect(child.importLegacyPublicConversation({
      conversation: record,
      messages,
      checksum: "checksum-once",
    })).resolves.toEqual({ status: "conflict", revision: 1 });
    await expect(child.getPublicMessages()).resolves.toHaveLength(2);
  });

  nativeTest("does not cap persisted public history at the Sidechat limit", async () => {
    const [
      { env },
      { getSubAgentByName },
      { MavenChatAgent },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("../maven-chat-agent"),
    ]);
    const projectId = "public-child-project";
    const conversationId = "conversation-long";
    const parent = env.MAVEN_PROJECT_AGENT.get(
      env.MAVEN_PROJECT_AGENT.idFromName(projectId),
    );
    await parent.registerPublicConversation(conversationId);
    const child = await getSubAgentByName(
      parent,
      MavenChatAgent,
      `pub_${conversationId}`,
    );
    const messages = Array.from({ length: 205 }, (_, index) => ({
      ...publicMessage(`visitor-${index}`, "visitor", String(index)),
      conversationId,
      imageUrls: [],
    }));

    await child.importLegacyPublicConversation({
      conversation: conversation(conversationId),
      messages,
      checksum: "checksum-long",
    });

    await expect(child.getPublicMessages()).resolves.toHaveLength(205);
  });

  nativeTest("publishes only the safe public child state projection", async () => {
    const [
      { env },
      { getSubAgentByName },
      { MavenChatAgent },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("../maven-chat-agent"),
    ]);
    const projectId = "public-child-project";
    const conversationId = "conversation-safe-state";
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
      conversation: conversation(conversationId),
      messages: [],
      checksum: "checksum-safe",
    });

    await expect(child.getPublicChildState()).resolves.toEqual({
      status: "active",
      visitorPresence: "active",
      visitorLastOnlineAt: 90,
      archived: false,
      revision: 0,
    });
  });

  nativeTest("serializes a team request and its idempotent review summary", async () => {
    const [
      { env },
      { getSubAgentByName },
      { MavenChatAgent },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("../maven-chat-agent"),
    ]);
    const projectId = "public-child-project";
    const conversationId = "conversation-team-request";
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
      conversation: conversation(conversationId),
      messages: [],
      checksum: "checksum-team-request",
    });

    await expect(child.claimTeamRequest({
      projectId,
      conversationId,
      summary: "Visitor needs account help.",
    })).resolves.toEqual({ status: "claimed" });
    const claimed = await child.getPublicSnapshot();
    const acceptanceToken = claimed.conversation.metadata
      .mavenTeamRequestAcceptanceToken;
    expect(typeof acceptanceToken).toBe("string");
    if (typeof acceptanceToken !== "string") {
      throw new Error("Expected a team-request acceptance token");
    }
    const acceptance = await child.getTeamRequestAcceptance(
      projectId,
      conversationId,
      acceptanceToken,
    );
    expect(acceptance).toMatchObject({
      summary: "Visitor needs account help.",
      summaryPending: true,
      notificationState: "pending",
    });
    const [firstSummary, secondSummary] = await Promise.all([
      child.addTeamRequestSummary(projectId, conversationId, acceptanceToken),
      child.addTeamRequestSummary(projectId, conversationId, acceptanceToken),
    ]);
    expect(firstSummary?.id ?? secondSummary?.id).toBe(
      acceptance?.summaryMessageId,
    );
    await expect(child.completeTeamRequestSummary({
      projectId,
      conversationId,
      acceptanceToken,
    })).resolves.toBe(true);
    await expect(child.getPublicMessages()).resolves.toHaveLength(1);
  });

  nativeTest("replaces and cancels native auto-close schedules", async () => {
    const [
      { env },
      { getSubAgentByName },
      { MavenChatAgent },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("../maven-chat-agent"),
    ]);
    const projectId = "public-child-project";
    const conversationId = "conversation-auto-close";
    const parent = env.MAVEN_PROJECT_AGENT.get(
      env.MAVEN_PROJECT_AGENT.idFromName(projectId),
    );
    await parent.registerPublicConversation(conversationId);
    const child = await getSubAgentByName(
      parent,
      MavenChatAgent,
      `pub_${conversationId}`,
    );
    const record = conversation(conversationId);
    record.lastActivityAt = Date.now();
    record.updatedAt = record.lastActivityAt;
    await child.importLegacyPublicConversation({
      conversation: record,
      messages: [],
      checksum: "checksum-auto-close",
    });

    await child.reconcilePublicAutoClose(5);
    await child.reconcilePublicAutoClose(10);
    await expect(child.listSchedules({
      callback: "autoClosePublicConversation",
    })).resolves.toHaveLength(1);
    const before = await child.getPublicSnapshot();
    await child.autoClosePublicConversation({
      lastActivityAt: record.lastActivityAt - 1,
      autoCloseMinutes: 10,
    });
    await expect(child.getPublicSnapshot()).resolves.toMatchObject({
      conversation: { status: "active" },
      revision: before.revision,
    });
    await child.reconcilePublicAutoClose(null);
    await expect(child.listSchedules({
      callback: "autoClosePublicConversation",
    })).resolves.toHaveLength(0);
  });

  nativeTest("persists a human reply in the same ownership mutation", async () => {
    const [
      { env },
      { getSubAgentByName },
      { MavenChatAgent },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("../maven-chat-agent"),
    ]);
    const projectId = "public-child-project";
    const conversationId = "conversation-human-takeover";
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
      conversation: conversation(conversationId),
      messages: [],
      checksum: "checksum-human-takeover",
    });
    const human = {
      ...publicMessage("human-1", "agent", "I can help from here."),
      conversationId,
      createdAt: Date.now(),
    };

    await expect(child.appendHumanMessage(human)).resolves.toMatchObject({
      id: "human-1",
      author: "agent",
    });
    await expect(child.getPublicSnapshot()).resolves.toMatchObject({
      conversation: {
        status: "agent_replied",
        closeReason: null,
        chatState: {
          state: "agent_mode",
          aiParticipation: "human_only",
          ownershipRevision: 1,
        },
        ownershipRevision: 1,
      },
      messages: [{ id: "human-1", author: "agent" }],
      revision: 1,
    });
  });

  nativeTest("accepts an exact visitor WebSocket and blocks destructive SDK frames", async () => {
    const [
      { env, exports },
      { getSubAgentByName },
      { MavenChatAgent },
      { signPublicChatToken },
      { toPublicUiMessage },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("agents"),
      import("../maven-chat-agent"),
      import("./public-agent-auth"),
      import("./public-message"),
    ]);
    const projectId = "public-websocket-project";
    const conversationId = "public-websocket-conversation";
    const visitorId = "public-websocket-visitor";
    await preparePublicTurnDatabase(env.DB, projectId);
    const parent = env.MAVEN_PROJECT_AGENT.get(
      env.MAVEN_PROJECT_AGENT.idFromName(projectId),
    );
    await parent.registerPublicConversation(conversationId);
    const child = await getSubAgentByName(
      parent,
      MavenChatAgent,
      `pub_${conversationId}`,
    );
    const record = conversation(conversationId);
    record.projectId = projectId;
    record.visitorId = visitorId;
    const importedMessage = {
      ...publicMessage("public-ws-bot-1", "bot", "Welcome"),
      conversationId,
    };
    await child.importLegacyPublicConversation({
      conversation: record,
      messages: [importedMessage],
      checksum: "public-websocket-checksum",
    });
    const issuedAt = Math.floor(Date.now() / 1_000);
    const token = await signPublicChatToken({
      v: 1,
      aud: "replymaven-public-chat",
      scope: "child",
      actor: "visitor",
      projectId,
      parentName: projectId,
      conversationId,
      childName: `pub_${conversationId}`,
      visitorId,
      canSubmitVisitor: true,
      canRead: true,
      iat: issuedAt,
      exp: issuedAt + 120,
    }, env.SIDECHAT_TOKEN_SECRET);
    const response = await exports.default.fetch(new Request(
      `https://example.test/agents/maven-project-agent/${projectId}/sub/maven-chat-agent/pub_${conversationId}?token=${token}`,
      { headers: { Upgrade: "websocket" } },
    ));
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (!socket) throw new Error("Expected a WebSocket");
    socket.accept();

    const responseFrame = new Promise<MessageEvent>((resolve) => {
      socket.addEventListener("message", function handleMessage(event) {
        if (typeof event.data !== "string") return;
        const parsed = JSON.parse(event.data) as Record<string, unknown>;
        if (
          parsed.type === MessageType.CF_AGENT_USE_CHAT_RESPONSE &&
          parsed.id === "public-request-1" &&
          parsed.done === true
        ) {
          socket.removeEventListener("message", handleMessage);
          resolve(event);
        }
      });
    });
    socket.send(JSON.stringify({
      type: MessageType.CF_AGENT_USE_CHAT_REQUEST,
      id: "public-request-1",
      init: {
        method: "POST",
        body: JSON.stringify({
          messages: [
            toPublicUiMessage(importedMessage, projectId),
            {
              id: "public-ws-visitor-1",
              role: "user",
              parts: [{ type: "text", text: "Tell me a joke" }],
            },
          ],
        }),
      },
    }));
    await responseFrame;
    await expect(child.getPublicMessages()).resolves.toMatchObject([
      { id: "public-ws-bot-1", author: "bot" },
      { id: "public-ws-visitor-1", author: "visitor" },
      { author: "bot" },
    ]);
    await expect.poll(async () => {
      const row = await env.DB.prepare(
        "SELECT count(*) AS count FROM message_usage_credits",
      ).first<{ count: number }>();
      return row?.count ?? 0;
    }).toBe(1);
    await expect(env.DB.prepare(
      "SELECT count(*) AS count FROM messages",
    ).first<{ count: number }>()).resolves.toEqual({ count: 0 });

    const closed = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener("close", resolve, { once: true });
    });
    socket.send(JSON.stringify({ type: MessageType.CF_AGENT_CHAT_CLEAR }));
    await closed;
    await expect(child.getPublicMessages()).resolves.toHaveLength(3);
  }, 30_000);
});
