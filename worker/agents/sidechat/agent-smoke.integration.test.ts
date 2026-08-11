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
});
