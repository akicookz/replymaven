/// <reference types="@cloudflare/vitest-pool-workers/types" />

import {
  simulateReadableStream,
  type LanguageModel,
  type UIMessage,
} from "ai";
import type { SidechatCustomerContext } from "../../../shared/sidechat-agent";

const isBunTest = "Bun" in globalThis;
const nativeTest = isBunTest ? test.skip : test;

function userMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

const emptyUsage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function createTextModel(text: string): LanguageModel {
  return {
    specificationVersion: "v3" as const,
    provider: "test",
    modelId: "native-sidechat-test",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("Unexpected non-streaming generation");
    },
    async doStream() {
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: text },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              usage: emptyUsage,
              finishReason: { unified: "stop", raw: "stop" },
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  } as LanguageModel;
}

function sidechatContext(): SidechatCustomerContext {
  return {
    projectId: "project-1",
    conversationId: "conversation-1",
    conversationStatus: "active",
    archivedAt: null,
    customer: null,
    publicSummary: null,
    recentPublicMessages: [],
  };
}

describe("native MavenChatAgent transcript", () => {
  nativeTest("builds the transient acceptance part from the submitted UI message ID", async () => {
    const { buildTurnAcceptedPart, selectSidechatModelMessages } = await import(
      "./maven-chat-agent"
    );

    expect(buildTurnAcceptedPart("submitted-message-42")).toEqual({
      type: "data-turn-accepted",
      data: { messageId: "submitted-message-42" },
      transient: true,
    });
    const messages = Array.from({ length: 82 }, (_, index) =>
      userMessage(`message-${index}`, String(index)),
    );
    expect(selectSidechatModelMessages(messages)).toHaveLength(80);
    expect(selectSidechatModelMessages(messages)[0]?.id).toBe("message-2");
  });

  nativeTest("emits the accepted submitted message ID before a native model response", async () => {
    const [{ MavenChatAgent }, { signSidechatToken }] = await Promise.all([
      import("./maven-chat-agent"),
      import("./agent-auth"),
    ]);
    const now = Math.floor(Date.now() / 1_000);
    const secret = "native-sidechat-turn-test-secret-32-bytes";
    const token = await signSidechatToken(
      {
        userId: "user-1",
        effectiveUserId: "owner-1",
        projectId: "project-1",
        parentName: "project-1",
        role: "owner",
        iat: now,
        exp: now + 120,
        aud: "replymaven-sidechat",
        v: 1,
        scope: "child",
        conversationId: "conversation-1",
        childName: "sc_conversation-1",
        canSubmit: true,
        canApproveOnce: true,
        canAlwaysAllow: true,
      },
      secret,
    );
    const summaryStatuses: string[] = [];
    let failContext = false;
    const fakeAgent = {
      name: "sc_conversation-1",
      parentPath: [
        { className: "MavenProjectAgent", name: "project-1" },
      ],
      env: {
        SIDECHAT_TOKEN_SECRET: secret,
        AI_MODEL: "test-model",
        GEMINI_API_KEY: "",
        OPENAI_API_KEY: "",
      },
      messages: [userMessage("submitted-message-42", "Help me")],
      createSidechatLanguageModel() {
        return createTextModel("Working draft");
      },
      async parentAgent() {
        return {
          async updateSidechatSummary(
            _conversationId: string,
            status: string,
          ) {
            summaryStatuses.push(status);
            return true;
          },
          async getSidechatContext() {
            if (failContext) throw new Error("private context failed");
            return sidechatContext();
          },
          async getSidechatToolDescriptors() {
            return [];
          },
        };
      },
    };

    const response = await MavenChatAgent.prototype.onChatMessage.call(
      fakeAgent as never,
      async () => undefined,
      {
        requestId: "submitted-message-42",
        body: { token },
      },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"type":"data-turn-accepted"');
    expect(body).toContain('"messageId":"submitted-message-42"');
    expect(body).toContain("Working draft");
    expect(summaryStatuses).toEqual(["working"]);

    failContext = true;
    const failedResponse = await MavenChatAgent.prototype.onChatMessage.call(
      fakeAgent as never,
      async () => undefined,
      {
        requestId: "submitted-message-43",
        body: { token },
      },
    );
    const failedBody = await failedResponse.text();
    expect(failedResponse.status).toBe(200);
    expect(failedBody).toContain('"messageId":"submitted-message-43"');
    expect(failedBody).toContain("The Sidechat response failed.");
    expect(summaryStatuses).toEqual(["working", "working", "failed"]);
  });

  nativeTest(
    "publishes a draft only on completed response and projects terminal status",
    async () => {
      const { MavenChatAgent } = await import("./maven-chat-agent");
      const completedMessage = {
        id: "assistant-complete",
        role: "assistant",
        parts: [
          {
            type: "tool-present_reply_draft",
            toolCallId: "draft-call",
            state: "output-available",
            input: { text: "Completed draft" },
            output: { accepted: true },
          },
        ],
      } as UIMessage;
      const persisted: UIMessage[][] = [];
      const statuses: string[] = [];
      const fakeAgent = {
        name: "sc_conversation-1",
        messages: [completedMessage],
        async persistMessages(messages: UIMessage[]) {
          persisted.push(messages);
        },
        async parentAgent() {
          return {
            async updateSidechatSummary(
              _conversationId: string,
              status: string,
            ) {
              statuses.push(status);
              return true;
            },
          };
        },
      };
      const lifecycle = MavenChatAgent.prototype as unknown as {
        onChatResponse(result: {
          message: UIMessage;
          requestId: string;
          continuation: boolean;
          status: "completed" | "error" | "aborted";
        }): Promise<void>;
      };

      await lifecycle.onChatResponse.call(fakeAgent, {
        message: completedMessage,
        requestId: "request-complete",
        continuation: false,
        status: "completed",
      });
      await lifecycle.onChatResponse.call(fakeAgent, {
        message: completedMessage,
        requestId: "request-aborted",
        continuation: false,
        status: "aborted",
      });

      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.[0]?.parts).toContainEqual({
        type: "data-reply-draft",
        id: "assistant-complete:reply-draft",
        data: { text: "Completed draft", createdAt: expect.any(Number) },
      });
      expect(statuses).toEqual(["ready", "failed"]);
    },
  );

  nativeTest(
    "persists private messages in the native child across a fresh stub",
    async () => {
      const [
        { env },
        { evictAllDurableObjects },
        { MavenChatAgent },
        { getSubAgentByName },
      ] = await Promise.all([
        import("cloudflare:workers"),
        import("cloudflare:test"),
        import("./maven-chat-agent"),
        import("agents"),
      ]);
      const projectId = "transcript-project";
      const conversationId = "conversation-a";
      const childName = `sc_${conversationId}`;
      const parent = env.MAVEN_PROJECT_AGENT.get(
        env.MAVEN_PROJECT_AGENT.idFromName(projectId),
      );
      await parent.registerSidechat(conversationId);

      const firstStub = await getSubAgentByName(
        parent,
        MavenChatAgent,
        childName,
      );
      await firstStub.persistMessages([
        userMessage("private-user-1", "Investigate this privately"),
      ]);

      await evictAllDurableObjects();
      const reloadedParent = env.MAVEN_PROJECT_AGENT.get(
        env.MAVEN_PROJECT_AGENT.idFromName(projectId),
      );
      const freshStub = await getSubAgentByName(
        reloadedParent,
        MavenChatAgent,
        childName,
      );
      await expect(freshStub.getPrivateTranscriptSnapshot()).resolves.toEqual([
        userMessage("private-user-1", "Investigate this privately"),
      ]);
    },
  );

  nativeTest("isolates transcripts between two child facets", async () => {
    const [{ env }, { MavenChatAgent }, { getSubAgentByName }] = await Promise.all([
      import("cloudflare:workers"),
      import("./maven-chat-agent"),
      import("agents"),
    ]);
    const projectId = "isolation-project";
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

    await childA.persistMessages([userMessage("a-1", "Only child A")]);
    await childB.persistMessages([userMessage("b-1", "Only child B")]);

    await expect(childA.getPrivateTranscriptSnapshot()).resolves.toEqual([
      userMessage("a-1", "Only child A"),
    ]);
    await expect(childB.getPrivateTranscriptSnapshot()).resolves.toEqual([
      userMessage("b-1", "Only child B"),
    ]);
  });
});
