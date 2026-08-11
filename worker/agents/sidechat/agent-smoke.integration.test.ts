/// <reference types="@cloudflare/vitest-pool-workers/types" />

const isBunTest = "Bun" in globalThis;
const nativeTest = isBunTest ? test.skip : test;

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
  );

  nativeTest("instantiates the project parent binding", async () => {
    const [{ env }, { runInDurableObject }, { MavenProjectAgent }] =
      await Promise.all([
        import("cloudflare:workers"),
        import("cloudflare:test"),
        import("./maven-project-agent"),
      ]);

    const id = env.MAVEN_PROJECT_AGENT.idFromName("smoke-project");
    const stub = env.MAVEN_PROJECT_AGENT.get(id);
    const className = await runInDurableObject(stub, (instance) =>
      Promise.resolve(instance.constructor.name),
    );
    expect(className).toBe(MavenProjectAgent.name);
  });

  nativeTest("keeps the Worker fetch handler healthy", async () => {
    const { exports } = await import("cloudflare:workers");
    const response = await exports.default.fetch(
      new Request("https://example.test/api/health"),
    );
    expect(response.status).not.toBe(500);
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
