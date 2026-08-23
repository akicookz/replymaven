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
  nativeTest("finds only the exact pending native approval scope", async () => {
    const {
      hasPendingSidechatApproval,
      readPendingApprovalScope,
    } = await import("./maven-chat-agent");
    const messages: UIMessage[] = [{
      id: "assistant-approval",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "tool_mcpserver_write_customer",
        toolCallId: "write-call",
        state: "approval-requested",
        input: { hidden: true },
        approval: { id: "approval-1" },
      }],
    }];

    expect(readPendingApprovalScope(
      messages,
      "approval-1",
      "write-call",
    )).toEqual({
      approvalId: "approval-1",
      toolCallId: "write-call",
      exposedName: "tool_mcpserver_write_customer",
    });
    expect(readPendingApprovalScope(
      messages,
      "stale-approval",
      "write-call",
    )).toBeNull();

    const resolvedMessages: UIMessage[] = [
      ...messages,
      {
        id: "assistant-approval-resolved",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "tool_mcpserver_write_customer",
          toolCallId: "write-call",
          state: "approval-responded",
          input: { hidden: true },
          approval: { id: "approval-1", approved: true },
        }],
      },
    ];
    expect(readPendingApprovalScope(
      resolvedMessages,
      "approval-1",
      "write-call",
    )).toBeNull();
    expect(hasPendingSidechatApproval(resolvedMessages)).toBe(false);
  });

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
    const originClears: Array<string | null> = [];
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
          async isSidechatOperational() {
            return true;
          },
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
          async setLastSidechatTurnOrigin(
            _conversationId: string,
            origin: string | null,
          ) {
            originClears.push(origin);
          },
          async executeProjectTool() {
            throw new Error("unexpected tool");
          },
        };
      },
    };

    const response = await MavenChatAgent.prototype.onChatMessage.call(
      fakeAgent as never,
      async () => undefined,
      {
        requestId: "transport-request-42",
        body: { token, submittedMessageId: "submitted-message-42" },
      },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"type":"data-turn-accepted"');
    expect(body).toContain('"messageId":"submitted-message-42"');
    expect(body).not.toContain('"messageId":"transport-request-42"');
    expect(body).toContain("Working draft");
    expect(summaryStatuses).toEqual(["working"]);
    expect(originClears).toEqual([null]);

    failContext = true;
    fakeAgent.messages = [userMessage("submitted-message-43", "Try again")];
    const failedResponse = await MavenChatAgent.prototype.onChatMessage.call(
      fakeAgent as never,
      async () => undefined,
      {
        requestId: "transport-request-43",
        body: { token, submittedMessageId: "submitted-message-43" },
      },
    );
    const failedBody = await failedResponse.text();
    expect(failedResponse.status).toBe(200);
    expect(failedBody).toContain('"messageId":"submitted-message-43"');
    expect(failedBody).toContain("The Sidechat response failed.");
    expect(summaryStatuses).toEqual(["working", "working", "failed"]);

    failContext = false;
    const mismatchedResponse = await MavenChatAgent.prototype.onChatMessage.call(
      fakeAgent as never,
      async () => undefined,
      {
        requestId: "transport-request-44",
        body: { token, submittedMessageId: "not-the-current-user-message" },
      },
    );
    const mismatchedBody = await mismatchedResponse.text();
    expect(mismatchedBody).not.toContain('"type":"data-turn-accepted"');
    expect(originClears).toEqual([null, null, null]);
  });

  nativeTest("keeps last Sidechat origin on a dashboard approval continuation", async () => {
    const [{ MavenChatAgent }, { signSidechatToken }] = await Promise.all([
      import("./maven-chat-agent"),
      import("./agent-auth"),
    ]);
    const now = Math.floor(Date.now() / 1_000);
    const secret = "native-sidechat-continuation-test-secret-32";
    const token = await signSidechatToken({
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
    }, secret);
    const originClears: Array<string | null> = [];
    const fakeAgent = {
      name: "sc_conversation-1",
      parentPath: [{ className: "MavenProjectAgent", name: "project-1" }],
      env: {
        SIDECHAT_TOKEN_SECRET: secret,
        AI_MODEL: "test-model",
        GEMINI_API_KEY: "",
        OPENAI_API_KEY: "",
      },
      messages: [userMessage("approved-message-1", "Continue")],
      createSidechatLanguageModel() {
        return createTextModel("Continued draft");
      },
      async parentAgent() {
        return {
          async isSidechatOperational() {
            return true;
          },
          async updateSidechatSummary() {
            return true;
          },
          async getSidechatContext() {
            return sidechatContext();
          },
          async getSidechatToolDescriptors() {
            return [];
          },
          async setLastSidechatTurnOrigin(
            _conversationId: string,
            origin: string | null,
          ) {
            originClears.push(origin);
          },
          async executeProjectTool() {
            throw new Error("unexpected tool");
          },
        };
      },
    };

    const response = await MavenChatAgent.prototype.onChatMessage.call(
      fakeAgent as never,
      async () => undefined,
      {
        requestId: "continuation-request-1",
        continuation: true,
        body: { token, submittedMessageId: "approved-message-1" },
      },
    );

    expect(response.status).toBe(200);
    expect(originClears).toEqual([]);
  });

  nativeTest("rejects a previously-issued submit token after archive", async () => {
    const [{ MavenChatAgent }, { signSidechatToken }] = await Promise.all([
      import("./maven-chat-agent"),
      import("./agent-auth"),
    ]);
    const now = Math.floor(Date.now() / 1_000);
    const secret = "native-sidechat-archive-test-secret-32-bytes";
    const token = await signSidechatToken({
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
    }, secret);
    let modelCreated = false;
    const fakeAgent = {
      name: "sc_conversation-1",
      parentPath: [{ className: "MavenProjectAgent", name: "project-1" }],
      env: { SIDECHAT_TOKEN_SECRET: secret },
      messages: [userMessage("archived-message", "Do not run")],
      async persistMessages(messages: UIMessage[]) {
        fakeAgent.messages = messages;
      },
      createSidechatLanguageModel() {
        modelCreated = true;
        return createTextModel("Should never run");
      },
      async parentAgent() {
        return {
          async isSidechatOperational() {
            return false;
          },
        };
      },
    };

    const response = await MavenChatAgent.prototype.onChatMessage.call(
      fakeAgent as never,
      async () => undefined,
      {
        requestId: "archived-request",
        body: { token, submittedMessageId: "archived-message" },
      },
    );

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toBe("");
    expect(fakeAgent.messages).toEqual([]);
    expect(modelCreated).toBe(false);
  });

  nativeTest("rejects a server Sidechat turn when the child is not operational", async () => {
    const { MavenChatAgent } = await import("./maven-chat-agent");
    const fakeAgent = {
      name: "sc_conversation-1",
      messages: [],
      async persistMessages() {
        throw new Error("should not persist");
      },
      async parentAgent() {
        return {
          async isSidechatOperational() {
            return false;
          },
        };
      },
    };
    const result = await MavenChatAgent.prototype.submitServerSidechatTurn.call(
      fakeAgent as never,
      { text: "check his billing", actorUserId: "user-1" },
    );
    expect(result).toEqual({ accepted: false });
  });

  nativeTest("persists the server turn before scheduling it", async () => {
    const { MavenChatAgent } = await import("./maven-chat-agent");
    const events: string[] = [];
    const fakeAgent = {
      name: "sc_conversation-1",
      messages: [],
      ctx: {
        waitUntil() {
          events.push("waitUntil");
        },
      },
      async persistMessages(messages: UIMessage[]) {
        events.push("persist");
        fakeAgent.messages = messages;
      },
      async runServerSidechatTurn() {
        return;
      },
      async parentAgent() {
        return {
          async isSidechatOperational() {
            return true;
          },
        };
      },
    };
    const result = await MavenChatAgent.prototype.submitServerSidechatTurn.call(
      fakeAgent as never,
      { text: "check his billing", actorUserId: "user-1" },
    );
    expect(result).toEqual({ accepted: true });
    expect(events).toEqual(["persist", "waitUntil"]);
    expect(fakeAgent.messages[0]?.parts).toEqual([
      { type: "text", text: "check his billing" },
    ]);
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
            async isSidechatOperational() {
              return true;
            },
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
      const pendingApprovalMessage = {
        id: "assistant-pending",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "tool_mcpserver_write_customer",
          toolCallId: "write-call",
          state: "approval-requested",
          input: { hidden: true },
          approval: { id: "approval-1" },
        }],
      } as UIMessage;
      fakeAgent.messages = [pendingApprovalMessage];
      await lifecycle.onChatResponse.call(fakeAgent, {
        message: pendingApprovalMessage,
        requestId: "request-pending",
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
      expect(statuses).toEqual(["ready", "waiting_approval", "failed"]);
    },
  );

  nativeTest("does not publish a completed draft after archive wins the race", async () => {
    const { MavenChatAgent } = await import("./maven-chat-agent");
    const completedMessage = {
      id: "assistant-archived",
      role: "assistant",
      parts: [{
        type: "tool-present_reply_draft",
        toolCallId: "draft-archived",
        state: "output-available",
        input: { text: "Stale draft" },
        output: { accepted: true },
      }],
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
          async isSidechatOperational() {
            return false;
          },
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
      requestId: "archived-complete",
      continuation: false,
      status: "completed",
    });

    expect(persisted).toEqual([]);
    expect(statuses).toEqual([]);
  });

  nativeTest("aborts active work and closes existing connections on archive", async () => {
    const { MavenChatAgent } = await import("./maven-chat-agent");
    const events: string[] = [];
    const fakeAgent = {
      abortAllRequests(reason: string) {
        events.push(`abort:${reason}`);
      },
      getConnections() {
        return [{
          close(code: number, reason: string) {
            events.push(`close:${code}:${reason}`);
          },
        }];
      },
    };

    await MavenChatAgent.prototype.enforceArchive.call(fakeAgent as never);

    expect(events).toEqual([
      "abort:Conversation archived",
      "close:4003:Conversation archived",
    ]);
  });

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
      await expect(freshStub.getPrivateTranscriptSnapshot()).resolves.toMatchObject([
        userMessage("private-user-1", "Investigate this privately"),
      ]);
    },
  );

  nativeTest(
    "recovers an exact pending approval after Durable Object eviction",
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
      const projectId = "approval-recovery-project";
      const conversationId = "conversation-approval";
      const childName = `sc_${conversationId}`;
      const parent = env.MAVEN_PROJECT_AGENT.get(
        env.MAVEN_PROJECT_AGENT.idFromName(projectId),
      );
      await parent.registerSidechat(conversationId);
      const child = await getSubAgentByName(parent, MavenChatAgent, childName);
      await child.persistMessages([{
        id: "assistant-pending",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "tool_mcpserver_write_customer",
          toolCallId: "write-call",
          state: "approval-requested",
          input: { opaque: "native-only" },
          approval: { id: "approval-1" },
        }],
      } as UIMessage]);

      await evictAllDurableObjects();
      const reloadedParent = env.MAVEN_PROJECT_AGENT.get(
        env.MAVEN_PROJECT_AGENT.idFromName(projectId),
      );
      const freshChild = await getSubAgentByName(
        reloadedParent,
        MavenChatAgent,
        childName,
      );
      await expect(freshChild.getPendingApprovalScope(
        "approval-1",
        "write-call",
      )).resolves.toEqual({
        approvalId: "approval-1",
        toolCallId: "write-call",
        exposedName: "tool_mcpserver_write_customer",
      });
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

    await expect(childA.getPrivateTranscriptSnapshot()).resolves.toMatchObject([
      userMessage("a-1", "Only child A"),
    ]);
    await expect(childB.getPrivateTranscriptSnapshot()).resolves.toMatchObject([
      userMessage("b-1", "Only child B"),
    ]);
  });
});
