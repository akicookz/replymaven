import { afterEach, describe, expect, test } from "bun:test";
import { simulateReadableStream, type LanguageModel } from "ai";
import { type ToolRow } from "../../db";
import { type PublicConversationStore } from "../../conversations/public-conversation-store";
import { type ProjectService } from "../../services/project-service";
import { type SourceReference } from "../../services/resource-service";
import { type ToolService } from "../../services/tool-service";
import { type AppEnv } from "../../types";
import { createModelRuntimeState } from "../llm/create-language-model";
import { mapAgentEventsToSse } from "../streaming/map-agent-events-to-sse";
import {
  runMavenTurn,
  type MavenTurnDependencies,
  type PublicMavenTurnContext,
} from "./run-maven-turn";

interface ModelCall {
  prompt?: unknown;
  tools?: unknown;
}

interface SearchRequest {
  ai_search_options: {
    retrieval: {
      filters: { folder: { $gte: string } };
    };
  };
}

interface SearchChunk {
  item: { key: string };
  score: number;
  text: string;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const emptyUsage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: 0,
  },
};

function createToolStep(
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>,
): unknown[] {
  return [
    { type: "stream-start", warnings: [] },
    {
      type: "tool-call",
      toolCallId,
      toolName,
      input: JSON.stringify(input),
      providerMetadata: { privateCallMetadata: "do-not-stream" },
    },
    {
      type: "finish",
      usage: emptyUsage,
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      providerMetadata: { privateFinishMetadata: "do-not-stream" },
    },
  ];
}

function createTextStep(text: string): unknown[] {
  return [
    { type: "stream-start", warnings: [] },
    {
      type: "reasoning-start",
      id: "reasoning-1",
      providerMetadata: { privateReasoningMetadata: "do-not-stream" },
    },
    {
      type: "reasoning-delta",
      id: "reasoning-1",
      delta: "private reasoning",
    },
    { type: "reasoning-end", id: "reasoning-1" },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    {
      type: "finish",
      usage: emptyUsage,
      finishReason: { unified: "stop", raw: "stop" },
    },
  ];
}

function createParallelHttpToolStep(count: number): unknown[] {
  return [
    { type: "stream-start", warnings: [] },
    ...Array.from({ length: count }, (_, index) => ({
      type: "tool-call",
      toolCallId: `http-parallel-${index}`,
      toolName: "lookup_account",
      input: JSON.stringify({ accountId: `account-${index}` }),
    })),
    {
      type: "finish",
      usage: emptyUsage,
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
    },
  ];
}

function createFakeModel(
  steps: Array<unknown[] | Error>,
): { model: LanguageModel; calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  const model = {
    specificationVersion: "v3" as const,
    provider: "test",
    modelId: "maven-turn-test",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("Unexpected non-streaming generation");
    },
    async doStream(options: ModelCall) {
      calls.push(options);
      const step = steps[calls.length - 1];
      if (!step) throw new Error("Unexpected extra model step");
      if (step instanceof Error) throw step;
      return {
        stream: simulateReadableStream({
          chunks: step,
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  } as LanguageModel;
  return { model, calls };
}

function createFailingModel(
  message: string,
): { model: LanguageModel; calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  const model = {
    specificationVersion: "v3" as const,
    provider: "test",
    modelId: "maven-turn-failing-test",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("Unexpected non-streaming generation");
    },
    async doStream(options: ModelCall) {
      calls.push(options);
      throw new Error(message);
    },
  } as LanguageModel;
  return { model, calls };
}

function createErrorThenDelayedToolModel(): {
  model: LanguageModel;
  calls: ModelCall[];
  releaseDelayedTool(): void;
  waitForDelayedTool(): Promise<void>;
  getCancellationCount(): number;
} {
  const calls: ModelCall[] = [];
  let cancellationCount = 0;
  let releaseDelayedTool = () => {};
  let markDelayedToolSettled = () => {};
  const delayedToolGate = new Promise<void>((resolve) => {
    releaseDelayedTool = resolve;
  });
  const delayedToolSettled = new Promise<void>((resolve) => {
    markDelayedToolSettled = resolve;
  });
  const model = {
    specificationVersion: "v3" as const,
    provider: "test",
    modelId: "maven-turn-delayed-tool-test",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("Unexpected non-streaming generation");
    },
    async doStream(options: ModelCall) {
      calls.push(options);
      if (calls.length > 1) {
        throw new Error("Unexpected primary model call after delayed tool");
      }

      let cancelled = false;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({
              type: "error",
              error: new Error("provider stream unavailable"),
            });
            void delayedToolGate.then(() => {
              if (!cancelled) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "delayed-primary-tool",
                  toolName: "lookup_account",
                  input: JSON.stringify({ accountId: "acct-delayed" }),
                });
                controller.enqueue({
                  type: "finish",
                  usage: emptyUsage,
                  finishReason: { unified: "tool-calls", raw: "tool_calls" },
                });
                controller.close();
              }
              markDelayedToolSettled();
            });
          },
          cancel() {
            cancelled = true;
            cancellationCount += 1;
          },
        }),
      };
    },
  } as LanguageModel;

  return {
    model,
    calls,
    releaseDelayedTool,
    waitForDelayedTool: () => delayedToolSettled,
    getCancellationCount: () => cancellationCount,
  };
}

function createContext(): PublicMavenTurnContext {
  return {
    channel: "public",
    projectId: "project-1",
    conversationId: "conversation-1",
    actorUserId: null,
    customerId: "customer-1",
    ownership: {
      status: "active",
      chatState: null,
    },
  };
}

function createToolRow(): ToolRow {
  return {
    id: "http-tool-1",
    projectId: "project-1",
    name: "lookup_account",
    displayName: "Lookup account",
    description: "Looks up a support account.",
    endpoint: "https://api.example.test/accounts",
    method: "GET",
    headers: null,
    parameters: JSON.stringify([
      {
        name: "accountId",
        type: "string",
        description: "Account identifier",
        required: true,
      },
    ]),
    responseMapping: null,
    enabled: true,
    timeout: 10_000,
    sortOrder: 0,
    allowedChannels: '["public"]',
    access: "read",
    schemaFingerprint: "legacy-v1",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function createSourceResolvingDb(
  sources: SourceReference[],
): MavenTurnDependencies["db"] {
  let selectCount = 0;
  const rows = sources.map((source, index) => ({
    id: `resource-${index}`,
    r2Key: `project-1/article-${index}.md`,
    resourceId: `resource-${index}`,
    pageTitle: source.title,
    type: source.type,
    title: source.title,
    url: source.url,
  }));

  function createQuery(result: unknown[]): {
    from(): ReturnType<typeof createQuery>;
    leftJoin(): ReturnType<typeof createQuery>;
    where(): ReturnType<typeof createQuery>;
    limit(): Promise<unknown[]>;
    then<TResult1 = unknown[], TResult2 = never>(
      onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2>;
  } {
    return {
      from() {
        return createQuery(result);
      },
      leftJoin() {
        return createQuery(result);
      },
      where() {
        return createQuery(result);
      },
      async limit() {
        return result;
      },
      then(onfulfilled, onrejected) {
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
  }

  return {
    select() {
      selectCount += 1;
      return createQuery(
        selectCount === 1
          ? [{ slug: null, helpCustomUrl: null }]
          : rows,
      );
    },
  } as MavenTurnDependencies["db"];
}

function createSearchBinding(searches: SearchChunk[][]): AppEnv["AI"] {
  let searchCount = 0;
  return {
    aiSearch() {
      return {
        get() {
          return {
            async search(request: SearchRequest) {
              expect(request.ai_search_options.retrieval.filters.folder.$gte).toBe(
                "project-1/",
              );
              const chunks = searches[searchCount] ?? [];
              searchCount += 1;
              return { success: true, result: { chunks } };
            },
          };
        },
      };
    },
  } as unknown as AppEnv["AI"];
}

function createDependencies(options: {
  model: LanguageModel;
  calls: ModelCall[];
  searches?: SearchChunk[][];
  sources?: SourceReference[];
  httpTool?: ToolRow | null;
  httpPermitCalls?: string[];
  auditRows?: Array<Record<string, unknown>>;
}): MavenTurnDependencies {
  const httpTool = options.httpTool === undefined ? createToolRow() : options.httpTool;
  const modelRuntime = createModelRuntimeState({
    model: "test-model",
    geminiApiKey: null,
    openaiApiKey: null,
  });
  const toolService = {
    async getEnabledToolsForChannel() {
      return httpTool ? [httpTool] : [];
    },
    async getAuthoritativeTool() {
      return httpTool;
    },
    async logExecution(data: Record<string, unknown>) {
      options.auditRows?.push(data);
      return { id: `execution-${(options.auditRows?.length ?? 1)}` };
    },
  } as unknown as ToolService;

  return {
    db: createSourceResolvingDb(options.sources ?? []),
    env: {
      AI: createSearchBinding(options.searches ?? []),
      UPLOADS: {} as R2Bucket,
      ENCRYPTION_KEY: "00".repeat(32),
      BETTER_AUTH_URL: "https://replymaven.test",
      RESEND_API_KEY: "",
    } as AppEnv,
    modelRuntime,
    createModel: () => options.model,
    toolService,
    projectName: "Acme",
    settings: {
      toneOfVoice: "professional",
      customTonePrompt: null,
      companyContext: "Acme support context",
      botName: "Maven",
      agentName: "an engineer",
      workingHours: null,
      avgResponseTime: null,
    },
    promptOptions: {
      aiParticipation: "continuous",
      visitorInfo: { name: "Alice", email: "alice@example.com" },
    },
    publicToolDependencies: {
      executionCtx: {} as ExecutionContext,
      chatService: {
        async acquireExternalAction(input) {
          return {
            ...input,
            leaseId: "lease-1",
            ownershipRevision: 0,
            acquiredAt: Date.now(),
          };
        },
        async releaseExternalAction() {},
      } as PublicConversationStore,
      projectService: {} as ProjectService,
      acquireHttpRateLimitPermit() {
        options.httpPermitCalls?.push("permit");
        return true;
      },
      onTeamRequested() {},
      broadcast() {},
    },
  };
}

describe("runMavenTurn", () => {
  test("consumes fallback text when the primary provider fails during initial stream execution", async () => {
    const primary = createFailingModel("provider unavailable");
    const fallback = createFakeModel([createTextStep("Fallback answer.")]);
    const dependencies = createDependencies({
      model: primary.model,
      calls: primary.calls,
      httpTool: null,
    });
    dependencies.modelRuntime = createModelRuntimeState({
      model: "gpt-primary",
      geminiApiKey: "gemini-key",
      openaiApiKey: "openai-key",
    });
    dependencies.createModel = (config) =>
      config.model === "gpt-primary" ? primary.model : fallback.model;

    const turn = await runMavenTurn({
      context: createContext(),
      dependencies,
      conversationHistory: [],
      currentMessage: "Please help.",
    });
    const browserEvents: Record<string, unknown>[] = [];
    let streamError: unknown;
    try {
      for await (const event of mapAgentEventsToSse(turn.fullStream)) {
        browserEvents.push(event);
      }
    } catch (error) {
      streamError = error;
    }

    expect(streamError).toBeUndefined();
    expect(browserEvents).toEqual([{ text: "Fallback answer." }]);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
    expect(dependencies.modelRuntime.activeConfig.model).toBe(
      "gemini-3-flash-preview",
    );
    expect(dependencies.modelRuntime.hasUsedFallback).toBe(true);
    expect(dependencies.modelRuntime.modelCallsByStage).toEqual({
      maven_turn: 2,
    });
  });

  test("treats a pre-commit SDK error part as a fallback-eligible failure", async () => {
    const primary = createFakeModel([
      [
        { type: "stream-start", warnings: [] },
        { type: "error", error: new Error("provider stream unavailable") },
      ],
    ]);
    const fallback = createFakeModel([createTextStep("Fallback from error part.")]);
    const dependencies = createDependencies({
      model: primary.model,
      calls: primary.calls,
      httpTool: null,
    });
    dependencies.modelRuntime = createModelRuntimeState({
      model: "gpt-primary",
      geminiApiKey: "gemini-key",
      openaiApiKey: "openai-key",
    });
    dependencies.createModel = (config) =>
      config.model === "gpt-primary" ? primary.model : fallback.model;

    const turn = await runMavenTurn({
      context: createContext(),
      dependencies,
      conversationHistory: [],
      currentMessage: "Please help.",
    });
    const browserEvents: Record<string, unknown>[] = [];
    for await (const event of mapAgentEventsToSse(turn.fullStream)) {
      browserEvents.push(event);
    }

    expect(browserEvents).toEqual([{ text: "Fallback from error part." }]);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
    expect(dependencies.modelRuntime.hasUsedFallback).toBe(true);
    expect(dependencies.modelRuntime.modelCallsByStage).toEqual({
      maven_turn: 2,
    });
  });

  test("cancels a failed primary provider before fallback can race a delayed tool", async () => {
    const primary = createErrorThenDelayedToolModel();
    const fallback = createFakeModel([createTextStep("Safe fallback answer.")]);
    const dependencies = createDependencies({
      model: primary.model,
      calls: primary.calls,
    });
    dependencies.modelRuntime = createModelRuntimeState({
      model: "gpt-primary",
      geminiApiKey: "gemini-key",
      openaiApiKey: "openai-key",
    });
    dependencies.createModel = (config) =>
      config.model === "gpt-primary" ? primary.model : fallback.model;
    let primaryToolExecutions = 0;
    globalThis.fetch = async () => {
      primaryToolExecutions += 1;
      return Response.json({ privateResult: "active" });
    };

    const turn = await runMavenTurn({
      context: createContext(),
      dependencies,
      conversationHistory: [],
      currentMessage: "Check my account.",
    });
    primary.releaseDelayedTool();
    const browserEvents: Record<string, unknown>[] = [];
    for await (const event of mapAgentEventsToSse(turn.fullStream)) {
      browserEvents.push(event);
    }
    await primary.waitForDelayedTool();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(browserEvents).toEqual([{ text: "Safe fallback answer." }]);
    expect(primaryToolExecutions).toBe(0);
    expect(primary.getCancellationCount()).toBe(1);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
    expect(dependencies.modelRuntime.hasUsedFallback).toBe(true);
  });

  test("does not retry after visible primary text has started", async () => {
    const primary = createFakeModel([
      [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Primary text." },
        { type: "error", error: new Error("provider stream unavailable") },
      ],
    ]);
    const fallback = createFakeModel([createTextStep("Fallback answer.")]);
    const dependencies = createDependencies({
      model: primary.model,
      calls: primary.calls,
      httpTool: null,
    });
    dependencies.modelRuntime = createModelRuntimeState({
      model: "gpt-primary",
      geminiApiKey: "gemini-key",
      openaiApiKey: "openai-key",
    });
    dependencies.createModel = (config) =>
      config.model === "gpt-primary" ? primary.model : fallback.model;

    const turn = await runMavenTurn({
      context: createContext(),
      dependencies,
      conversationHistory: [],
      currentMessage: "Please help.",
    });
    const browserEvents: Record<string, unknown>[] = [];
    let streamError: unknown;
    try {
      for await (const event of mapAgentEventsToSse(turn.fullStream)) {
        browserEvents.push(event);
      }
    } catch (error) {
      streamError = error;
    }

    expect(browserEvents).toEqual([{ text: "Primary text." }]);
    expect(streamError).toBeInstanceOf(Error);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0);
    expect(dependencies.modelRuntime.hasUsedFallback).toBe(false);
    expect(dependencies.modelRuntime.modelCallsByStage).toEqual({
      maven_turn: 1,
    });
  });

  test("does not retry after a primary tool has executed", async () => {
    const primary = createFakeModel([
      createToolStep("lookup_account", "http-primary", {
        accountId: "acct-primary",
      }),
      new Error("provider unavailable after tool execution"),
    ]);
    const fallback = createFakeModel([createTextStep("Fallback answer.")]);
    const dependencies = createDependencies({
      model: primary.model,
      calls: primary.calls,
    });
    dependencies.modelRuntime = createModelRuntimeState({
      model: "gpt-primary",
      geminiApiKey: "gemini-key",
      openaiApiKey: "openai-key",
    });
    dependencies.createModel = (config) =>
      config.model === "gpt-primary" ? primary.model : fallback.model;
    let toolExecutions = 0;
    globalThis.fetch = async () => {
      toolExecutions += 1;
      return Response.json({ privateResult: "active" });
    };

    const turn = await runMavenTurn({
      context: createContext(),
      dependencies,
      conversationHistory: [],
      currentMessage: "Check my account.",
    });
    let streamError: unknown;
    try {
      for await (const part of turn.fullStream) {
        void part;
      }
    } catch (error) {
      streamError = error;
    }

    expect(streamError).toBeInstanceOf(Error);
    expect((streamError as Error).message).toBe("The response stream failed.");
    expect((streamError as Error).message).not.toContain("provider unavailable");
    expect(toolExecutions).toBe(1);
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(0);
    expect(dependencies.modelRuntime.hasUsedFallback).toBe(false);
    expect(dependencies.modelRuntime.modelCallsByStage).toEqual({
      maven_turn: 1,
    });
  });

  test("sanitizes an initial prime failure after a tool onStart commitment", async () => {
    const primary = createFakeModel([createTextStep("Unused primary answer.")]);
    const fallback = createFakeModel([createTextStep("Fallback answer.")]);
    const dependencies = createDependencies({
      model: primary.model,
      calls: primary.calls,
    });
    dependencies.modelRuntime = createModelRuntimeState({
      model: "gpt-primary",
      geminiApiKey: "gemini-key",
      openaiApiKey: "openai-key",
    });
    dependencies.createModel = (config) =>
      config.model === "gpt-primary" ? primary.model : fallback.model;
    let toolExecutions = 0;
    globalThis.fetch = async () => {
      toolExecutions += 1;
      return Response.json({ privateResult: "active" });
    };
    dependencies.streamAgent = async (_modelDependencies, options) => {
      const httpTool = options.tools.lookup_account;
      if (!httpTool || typeof httpTool.execute !== "function") {
        throw new Error("Expected lookup_account tool");
      }
      await httpTool.execute(
        { accountId: "acct-prime" },
        { toolCallId: "http-prime", messages: [] },
      );
      return {
        fullStream: {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw new Error("provider secret during initial priming");
              },
            };
          },
        },
      };
    };

    let streamError: unknown;
    try {
      await runMavenTurn({
        context: createContext(),
        dependencies,
        conversationHistory: [],
        currentMessage: "Check my account.",
      });
    } catch (error) {
      streamError = error;
    }

    expect(streamError).toBeInstanceOf(Error);
    expect((streamError as Error).message).toBe("The response stream failed.");
    expect((streamError as Error).message).not.toContain("provider secret");
    expect(toolExecutions).toBe(1);
    expect(fallback.calls).toHaveLength(0);
    expect(dependencies.modelRuntime.hasUsedFallback).toBe(false);
  });

  test("returns only the public turn surface", async () => {
    const fake = createFakeModel([createTextStep("Public answer.")]);
    const dependencies = createDependencies({
      model: fake.model,
      calls: fake.calls,
      httpTool: null,
    });

    const turn = await runMavenTurn({
      context: createContext(),
      dependencies,
      conversationHistory: [],
      currentMessage: "Please help.",
    });
    for await (const part of turn.fullStream) {
      void part;
    }

    const publicTools = JSON.stringify(fake.calls[0]?.tools);
    expect(publicTools).toContain("request_team_help");
    expect(publicTools).toContain("search_knowledge");
    expect("artifact" in turn).toBe(false);
  });

  test("searches repeatedly, calls HTTP, and composes final text in one agent loop", async () => {
    const auditRows: Array<Record<string, unknown>> = [];
    const permitCalls: string[] = [];
    const sources: SourceReference[] = Array.from({ length: 6 }, (_, index) => ({
      title: `Article ${index}`,
      url: `https://example.com/article-${index}`,
      type: "webpage" as const,
    }));
    const chunks = sources.map((source, index) => ({
      item: { key: `project-1/article-${index}.md` },
      score: 0.9 - index * 0.01,
      text: `${source.title} says the account can be checked.`,
    }));
    const fake = createFakeModel([
      createToolStep("search_knowledge", "search-1", { query: "account access" }),
      createToolStep("search_knowledge", "search-2", { query: "account status" }),
      createToolStep("search_knowledge", "search-3", { query: "account policy" }),
      createToolStep("lookup_account", "http-1", { accountId: "acct-private" }),
      createTextStep("The account is active."),
    ]);
    const dependencies = createDependencies({
      model: fake.model,
      calls: fake.calls,
      sources,
      searches: [chunks.slice(0, 3), chunks.slice(2, 6), chunks.slice(5, 6)],
      auditRows,
      httpPermitCalls: permitCalls,
    });
    globalThis.fetch = async () => {
      return Response.json({ privateHttpResult: "active" });
    };

    const turn = await runMavenTurn({
      context: createContext(),
      dependencies,
      conversationHistory: [],
      currentMessage: "Is my account active?",
    });
    const browserEvents: Record<string, unknown>[] = [];
    for await (const event of mapAgentEventsToSse(turn.fullStream)) {
      browserEvents.push(event);
    }

    expect(fake.calls).toHaveLength(5);
    expect(dependencies.modelRuntime.modelCallsByStage).toEqual({
      maven_turn: 1,
    });
    const loopTranscript = JSON.stringify(fake.calls.slice(1));
    expect(loopTranscript).toContain("account access");
    expect(loopTranscript).toContain("Article 0");
    expect(loopTranscript).toContain("acct-private");
    expect(loopTranscript).toContain("privateHttpResult");
    expect(turn.collectedSources.map((source) => source.title)).toEqual([
      "Article 0",
      "Article 1",
      "Article 2",
      "Article 3",
      "Article 4",
    ]);
    expect(turn.toolActivity.length).toBeLessThanOrEqual(32);
    expect(permitCalls).toEqual(["permit"]);
    expect(auditRows).toHaveLength(1);
    expect(turn.httpExecutionIds).toEqual(["execution-1"]);
    expect(turn.toolActivity.every((activity) => {
      const keys = Object.keys(activity).sort();
      return keys.join(",") === "displayName,durationMs,source,status,toolId";
    })).toBe(true);
    expect(browserEvents.at(-1)).toEqual({ text: "The account is active." });
    const serializedEvents = JSON.stringify(browserEvents);
    expect(serializedEvents).not.toContain("acct-private");
    expect(serializedEvents).not.toContain("privateHttpResult");
    expect(serializedEvents).not.toContain("private reasoning");
    expect(serializedEvents).not.toContain("privateCallMetadata");
  });

  test("asks an ordinary final-text question without an ask_user tool", async () => {
    const permitCalls: string[] = [];
    const fake = createFakeModel([
      createTextStep("What account ID should I check?"),
    ]);
    const dependencies = createDependencies({
      model: fake.model,
      calls: fake.calls,
      httpTool: null,
      httpPermitCalls: permitCalls,
    });

    const turn = await runMavenTurn({
      context: createContext(),
      dependencies,
      conversationHistory: [],
      currentMessage: "Please check my account.",
    });
    const browserEvents: Record<string, unknown>[] = [];
    for await (const event of mapAgentEventsToSse(turn.fullStream)) {
      browserEvents.push(event);
    }

    expect(browserEvents).toEqual([{ text: "What account ID should I check?" }]);
    expect(JSON.stringify(fake.calls[0]?.tools)).not.toContain("ask_user");
    expect(permitCalls).toEqual([]);
  });

  test("bounds safe activity when one model step calls many tools", async () => {
    const fake = createFakeModel([
      createParallelHttpToolStep(20),
      createTextStep("All checks finished."),
    ]);
    const dependencies = createDependencies({
      model: fake.model,
      calls: fake.calls,
    });
    globalThis.fetch = async () => Response.json({ privateResult: "active" });

    const turn = await runMavenTurn({
      context: createContext(),
      dependencies,
      conversationHistory: [],
      currentMessage: "Check these accounts.",
    });
    for await (const part of turn.fullStream) {
      void part;
    }

    expect(turn.toolActivity).toHaveLength(32);
    expect(turn.toolActivity.every((activity) => {
      return Object.keys(activity).sort().join(",") ===
        "displayName,durationMs,source,status,toolId";
    })).toBe(true);
    expect(JSON.stringify(turn.toolActivity)).not.toContain("account-");
    expect(JSON.stringify(turn.toolActivity)).not.toContain("privateResult");
  });
});
