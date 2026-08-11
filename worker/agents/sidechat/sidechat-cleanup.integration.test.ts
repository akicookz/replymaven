/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { UIMessage } from "ai";

const isBunTest = "Bun" in globalThis;
const nativeTest = isBunTest ? test.skip : test;

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

async function withStageTimeout<T>(
  promise: Promise<T>,
  stage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${stage} timed out`)),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function retryAfterDurableObjectReset<T>(
  callback: () => Promise<T>,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("durableObjectReset" in error) ||
      error.durableObjectReset !== true
    ) {
      throw error;
    }
    return await callback();
  }
}

describe("native Sidechat cleanup", () => {
  nativeTest("deletes exactly one child transcript and is idempotent", async () => {
    const [{ env }, { MavenChatAgent }, { getSubAgentByName }] = await Promise.all([
      import("cloudflare:workers"),
      import("./maven-chat-agent"),
      import("agents"),
    ]);
    const projectId = "cleanup-one-project";
    const parent = env.MAVEN_PROJECT_AGENT.get(
      env.MAVEN_PROJECT_AGENT.idFromName(projectId),
    );
    await Promise.all([
      parent.registerSidechat("conversation-a"),
      parent.registerSidechat("conversation-b"),
    ]);
    const [childA, childB] = await Promise.all([
      getSubAgentByName(parent, MavenChatAgent, "sc_conversation-a"),
      getSubAgentByName(parent, MavenChatAgent, "sc_conversation-b"),
    ]);
    await childA.persistMessages([userMessage("a-1", "Delete me")]);
    await childB.persistMessages([userMessage("b-1", "Keep me")]);

    await parent.destroySidechat("conversation-a");
    await parent.destroySidechat("conversation-a");

    await expect(parent.getSidechatRegistration("conversation-a")).resolves.toBeNull();
    await expect(parent.getSidechatRegistration("conversation-b")).resolves.toEqual({
      childName: "sc_conversation-b",
    });
    await expect(childB.getPrivateTranscriptSnapshot()).resolves.toEqual([
      userMessage("b-1", "Keep me"),
    ]);
    const recreated = await parent.registerSidechat("conversation-a");
    expect(recreated.created).toBe(true);
    const freshChildA = await getSubAgentByName(
      parent,
      MavenChatAgent,
      "sc_conversation-a",
    );
    await expect(freshChildA.getPrivateTranscriptSnapshot()).resolves.toEqual([]);
  }, 30_000);

  nativeTest("destroys every child and the project parent through RPC", async () => {
    const [{ env }, { MavenChatAgent }, { getSubAgentByName }] = await Promise.all([
      import("cloudflare:workers"),
      import("./maven-chat-agent"),
      import("agents"),
    ]);
    const projectId = "cleanup-project-data";
    const parent = env.MAVEN_PROJECT_AGENT.get(
      env.MAVEN_PROJECT_AGENT.idFromName(projectId),
    );
    await parent.registerSidechat("conversation-a");
    const child = await getSubAgentByName(
      parent,
      MavenChatAgent,
      "sc_conversation-a",
    );
    await child.persistMessages([userMessage("a-1", "Private")]);

    await expect(
      withStageTimeout(parent.destroyProjectData(), "destroyProjectData RPC"),
    ).resolves.toBeUndefined();

    await expect(
      retryAfterDurableObjectReset(() =>
        env.MAVEN_PROJECT_AGENT.get(
          env.MAVEN_PROJECT_AGENT.idFromName(projectId),
        ).getSidechatRegistration("conversation-a"),
      ),
    ).resolves.toBeNull();
    await expect(
      env.MAVEN_PROJECT_AGENT.get(
        env.MAVEN_PROJECT_AGENT.idFromName(projectId),
      ).getSidechatSummaries(),
    ).resolves.toEqual([]);
  }, 30_000);
});
