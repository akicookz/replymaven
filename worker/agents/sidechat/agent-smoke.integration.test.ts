/// <reference types="@cloudflare/vitest-pool-workers/types" />

const isBunTest = "Bun" in globalThis;
const nativeTest = isBunTest ? test.skip : test;

async function seedOperationalConversation(
  database: D1Database,
  projectId: string,
  conversationId: string,
): Promise<void> {
  await database.exec("CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, customer_id TEXT, visitor_id TEXT NOT NULL, visitor_name TEXT, visitor_email TEXT, status TEXT NOT NULL, close_reason TEXT, telegram_thread_id TEXT, metadata TEXT, chat_state TEXT, last_activity_at INTEGER, visitor_last_seen_at INTEGER, visitor_presence TEXT, visitor_last_online_at INTEGER, snoozed_until INTEGER, archived_at INTEGER, purge_started_at INTEGER, external_action_started_at INTEGER, priority TEXT, assignee_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);");
  await database.prepare(`
    INSERT OR REPLACE INTO conversations (
      id, project_id, visitor_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', unixepoch(), unixepoch())
  `).bind(conversationId, projectId, `visitor-${conversationId}`).run();
}

describe("native Sidechat Agent registration", () => {
  nativeTest(
    "exposes only the project parent binding and both Agent classes",
    async () => {
      const [{ env }, workerModule] = await Promise.all([
        import("cloudflare:workers"),
        import("../../index"),
      ]);
      const { MavenChatAgent, MavenProjectAgent } = workerModule;

      expect(env.MAVEN_PROJECT_AGENT).toBeDefined();
      expect("MAVEN_CHAT_AGENT" in env).toBe(false);
      expect(MavenChatAgent.name).toBe("MavenChatAgent");
      expect(MavenProjectAgent.name).toBe("MavenProjectAgent");
    },
    30_000,
  );

  nativeTest("instantiates the project parent binding", async () => {
      const [{ env }, { runInDurableObject }, { MavenProjectAgent }] =
      await Promise.all([
        import("cloudflare:workers"),
        import("cloudflare:test"),
        import("../maven/maven-project-agent"),
      ]);

    const id = env.MAVEN_PROJECT_AGENT.idFromName("smoke-project");
    const stub = env.MAVEN_PROJECT_AGENT.get(id);
    const className = await runInDurableObject(stub, (instance) =>
      Promise.resolve(instance.constructor.name),
    );
    expect(className).toBe(MavenProjectAgent.name);
  });

  nativeTest(
    "identifies ReplyMaven to OAuth providers and returns to the project tools page",
    async () => {
      const [{ env }, { runInDurableObject }] = await Promise.all([
        import("cloudflare:workers"),
        import("cloudflare:test"),
      ]);
      const projectId = "3b6a334e-6d35-4b5d-8ce3-d7cbe676cc31";
      const stub = env.MAVEN_PROJECT_AGENT.get(
        env.MAVEN_PROJECT_AGENT.idFromName(projectId),
      );
      const result = await runInDurableObject(stub, async (instance) => {
        const provider = instance.createMcpOAuthProvider(
          "https://app.test/api/sidechat/mcp/oauth/project",
        );
        const response = instance.handleOAuthCallbackResponse(
          { serverId: "attio", authSuccess: true },
          new Request(
            `https://app.test/api/sidechat/mcp/oauth/${projectId}?code=safe`,
          ),
        );
        return {
          clientName: provider.clientMetadata.client_name,
          redirect: response.headers.get("location"),
        };
      });

      expect(result).toEqual({
        clientName: "ReplyMaven",
        redirect:
          `https://app.test/app/projects/${projectId}/quick-actions?tab=tools`,
      });
    },
  );

  nativeTest("keeps the Worker fetch handler healthy", async () => {
    const { exports } = await import("cloudflare:workers");
    const response = await exports.default.fetch(
      new Request("https://example.test/api/health"),
    );
    expect(response.status).not.toBe(500);
  });

  nativeTest("persists the conversation directory in parent Agent SQLite", async () => {
    const { env } = await import("cloudflare:workers");
    const projectId = "directory-project";
    const conversationId = "conversation-directory-1";
    const parent = env.MAVEN_PROJECT_AGENT.get(
      env.MAVEN_PROJECT_AGENT.idFromName(projectId),
    );
    const summary = {
      conversationId,
      publicChildName: `pub_${conversationId}` as const,
      sidechatChildName: null,
      sidechatStatus: null,
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Ada",
      visitorEmail: "ADA@example.com",
      telegramThreadId: "telegram-1",
      status: "waiting_agent" as const,
      closeReason: null,
      metadata: { source: "docs" },
      priority: "high" as const,
      assigneeId: null,
      snoozedUntil: null,
      archivedAt: null,
      purgeStartedAt: null,
      visitorLastSeenAt: null,
      visitorPresence: "active" as const,
      visitorLastOnlineAt: null,
      lastMessageId: "message-1",
      lastMessageAuthor: "visitor" as const,
      lastMessagePreview: "Need help",
      lastMessageSenderName: "Ada",
      lastMessageEmailedAt: null,
      lastMessageCreatedAt: 100,
      lastActivityAt: 100,
      messageCount: 1,
      botMessageCount: 0,
      childRevision: 1,
      createdAt: 50,
      updatedAt: 100,
    };

    await expect(parent.upsertConversationSummary(summary)).resolves.toEqual({
      applied: true,
      revision: 1,
    });
    await expect(parent.listConversations({
      filter: "needs-you",
      search: "ada@example.com",
    })).resolves.toEqual({
      conversations: [summary],
      nextCursor: null,
    });
    await expect(parent.getDashboardConversationPage({
      filter: "needs-you",
      search: "ada@example.com",
      now: 200,
    })).resolves.toEqual({
      conversations: [summary],
      counts: {
        "needs-you": 1,
        all: 1,
        snoozed: 0,
        resolved: 0,
        archived: 0,
        flagged: 0,
      },
      nextCursor: null,
    });
    await expect(parent.getInboxCounts(200)).resolves.toMatchObject({
      "needs-you": 1,
      all: 1,
    });
    await expect(
      parent.findConversationByTelegramThreadId("telegram-1"),
    ).resolves.toEqual(summary);
  });

  nativeTest("routes Agent requests before the SPA and requires a token", async () => {
    const { exports } = await import("cloudflare:workers");
    const response = await exports.default.fetch(
      new Request(
        "https://example.test/agents/maven-project-agent/routing-project",
      ),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  nativeTest("rejects a guessed child without registering or waking it", async () => {
    const [{ env, exports }, { signSidechatToken }] = await Promise.all([
      import("cloudflare:workers"),
      import("./agent-auth"),
    ]);
    const parentName = "registry-project";
    const conversationId = "guessed-conversation";
    const childName = `sc_${conversationId}`;
    const issuedAt = Math.floor(Date.now() / 1_000);
    const token = await signSidechatToken(
      {
        userId: "user-1",
        effectiveUserId: "owner-1",
        projectId: parentName,
        parentName,
        role: "owner",
        iat: issuedAt,
        exp: issuedAt + 120,
        aud: "replymaven-sidechat",
        v: 1,
        scope: "child",
        conversationId,
        childName,
        canSubmit: true,
        canApproveOnce: true,
        canAlwaysAllow: true,
      },
      (env as unknown as { SIDECHAT_TOKEN_SECRET: string })
        .SIDECHAT_TOKEN_SECRET,
    );
    const parent = env.MAVEN_PROJECT_AGENT.get(
      env.MAVEN_PROJECT_AGENT.idFromName(parentName),
    );

    await expect(
      parent.getSidechatRegistration(conversationId),
    ).resolves.toBeNull();
    const response = await exports.default.fetch(
      new Request(
        `https://example.test/agents/maven-project-agent/${parentName}/sub/maven-chat-agent/${childName}?token=${token}`,
      ),
    );

    expect(response.status).toBe(404);
    await expect(
      parent.getSidechatRegistration(conversationId),
    ).resolves.toBeNull();
  });

  nativeTest("forwards an authenticated WebSocket to a registered child", async () => {
    const [{ env, exports }, { signSidechatToken }] = await Promise.all([
      import("cloudflare:workers"),
      import("./agent-auth"),
    ]);
    const parentName = "websocket-project";
    const conversationId = "conversation-1";
    const childName = `sc_${conversationId}`;
    const parent = env.MAVEN_PROJECT_AGENT.get(
      env.MAVEN_PROJECT_AGENT.idFromName(parentName),
    );
    await seedOperationalConversation(env.DB, parentName, conversationId);
    await parent.registerSidechat(conversationId);
    const issuedAt = Math.floor(Date.now() / 1_000);
    const token = await signSidechatToken(
      {
        userId: "user-1",
        effectiveUserId: "owner-1",
        projectId: parentName,
        parentName,
        role: "owner",
        iat: issuedAt,
        exp: issuedAt + 120,
        aud: "replymaven-sidechat",
        v: 1,
        scope: "child",
        conversationId,
        childName,
        canSubmit: true,
        canApproveOnce: true,
        canAlwaysAllow: true,
      },
      (env as unknown as { SIDECHAT_TOKEN_SECRET: string })
        .SIDECHAT_TOKEN_SECRET,
    );
    const response = await exports.default.fetch(
      new Request(
        `https://example.test/agents/maven-project-agent/${parentName}/sub/maven-chat-agent/${childName}?token=${token}`,
        { headers: { Upgrade: "websocket" } },
      ),
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).not.toBeNull();
    response.webSocket?.accept();
    response.webSocket?.close(1000, "test complete");
  });
});
