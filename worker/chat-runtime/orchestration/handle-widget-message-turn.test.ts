import { describe, expect, test } from "bun:test";
import { type SourceReference } from "../../services/resource-service";
import { type MavenStreamPart } from "../types";
import { persistGuardedAiOutput } from "../post-turn/persist-guarded-ai-output";
import {
  handleWidgetMessageTurn,
  streamPublicMavenTurn,
  touchLinkedCustomerAfterVisitorMessage,
  type WidgetMessageTurnRuntime,
} from "./handle-widget-message-turn";

Object.assign(globalThis, { IdentityTransformStream: TransformStream });

interface SseCapture {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  events: Record<string, unknown>[];
}

function createSseCapture(): SseCapture {
  const events: Record<string, unknown>[] = [];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    controller: {
      enqueue(chunk: Uint8Array) {
        const frame = decoder.decode(chunk).trim();
        events.push(
          JSON.parse(frame.slice("data: ".length)) as Record<string, unknown>,
        );
      },
    } as unknown as ReadableStreamDefaultController,
    encoder,
    events,
  };
}

async function* createMavenStream(
  parts: MavenStreamPart[],
): AsyncGenerator<MavenStreamPart> {
  yield* parts;
}

function createSource(title: string): SourceReference {
  return { title, url: `https://example.com/${title}`, type: "webpage" };
}

function createTurnRunner(options: {
  parts: MavenStreamPart[];
  sources?: SourceReference[];
  activityCount?: number;
  error?: Error;
}): {
  calls: unknown[];
  runTurn: (input: unknown) => Promise<{
    fullStream: AsyncIterable<MavenStreamPart>;
    collectedSources: SourceReference[];
    toolActivity: Array<{
      toolId: string;
      displayName: string;
      source: "internal";
      status: "started";
    }>;
  }>;
} {
  const calls: unknown[] = [];
  return {
    calls,
    async runTurn(input) {
      calls.push(input);
      async function* stream(): AsyncGenerator<MavenStreamPart> {
        yield* createMavenStream(options.parts);
        if (options.error) throw options.error;
      }
      return {
        fullStream: stream(),
        collectedSources: options.sources ?? [],
        toolActivity: Array.from(
          { length: options.activityCount ?? 0 },
          (_, index) => ({
            toolId: `tool-${index}`,
            displayName: `Tool ${index}`,
            source: "internal" as const,
            status: "started" as const,
          }),
        ),
      };
    },
  };
}

function createTurnInput(): never {
  return {
    context: {
      channel: "public",
      projectId: "project-1",
      conversationId: "conversation-1",
      actorUserId: null,
      customerId: "customer-1",
      ownership: { status: "active", chatState: null },
    },
    dependencies: {},
    conversationHistory: [],
    currentMessage: "Help me",
  } as never;
}

interface HandlerHarness {
  context: Parameters<typeof handleWidgetMessageTurn>[0];
  runtime: WidgetMessageTurnRuntime;
  runTurnCalls: unknown[];
  resolveCalls: string[];
  botInsertCalls: unknown[];
  setConversation(conversation: Record<string, unknown> | null): void;
}

function createHandlerHarness(options?: {
  status?: string;
  chatState?: string | null;
  closeReason?: string | null;
  content?: string;
  streamParts?: MavenStreamPart[];
  abortSignal?: AbortSignal;
  teamRequestedDuringTurn?: boolean;
}): HandlerHarness {
  let conversation: Record<string, unknown> | null = {
    id: "conversation-1",
    visitorId: "visitor-1",
    customerId: null,
    visitorName: null,
    visitorEmail: null,
    status: options?.status ?? "active",
    chatState: options?.chatState ?? null,
    closeReason: options?.closeReason ?? null,
    telegramThreadId: null,
    metadata: null,
  };
  const runTurnCalls: unknown[] = [];
  const resolveCalls: string[] = [];
  const botInsertCalls: unknown[] = [];
  const chatService = {
    async getOperationalConversationById() {
      return conversation;
    },
    async reopenConversation() {
      return null;
    },
    async getRecentMessages() {
      return { messages: [], hasMore: false };
    },
    async addBotMessageIfOwnershipMatches(...args: unknown[]) {
      botInsertCalls.push(args);
      return null;
    },
    async resolveConversationByAi() {
      resolveCalls.push("resolve");
      conversation = {
        ...conversation,
        status: "agent_replied",
        chatState: JSON.stringify({
          state: "agent_mode",
          aiParticipation: "human_only",
          ownershipRevision: 1,
        }),
      };
      return false;
    },
    async saveChatState() {},
    async runExternalActionIfOperational() {
      return { executed: false, value: null };
    },
  };
  const runtime = {
    createBillingService() {
      return {
        async getSubscriptionByUserId() {
          return { id: "subscription-1" };
        },
        isSubscriptionActive() {
          return true;
        },
        async checkMessageLimit() {
          return { allowed: true };
        },
        async incrementMessageUsage() {},
      };
    },
    createChatService() {
      return chatService;
    },
    createCustomerIdentityService() {
      return { async touchVisitorLastSeen() {} };
    },
    createGuidelineService() {
      return { async getEnabledByProject() { return []; } };
    },
    createProjectService() {
      return {
        async getSettings() {
          return {
            toneOfVoice: "professional",
            customTonePrompt: null,
            companyContext: null,
            botName: "Maven",
            agentName: null,
            workingHours: null,
            avgResponseTime: null,
            telegramBotToken: null,
            telegramChatId: null,
          };
        },
      };
    },
    createTelegramService() {
      return {};
    },
    createToolService() {
      return {
        async getEnabledToolsForChannel() {
          return [];
        },
        async linkExecutionsToMessage() {},
      };
    },
    async runMavenTurn(input: unknown) {
      runTurnCalls.push(input);
      if (options?.teamRequestedDuringTurn && conversation) {
        conversation = {
          ...conversation,
          status: "waiting_agent",
          chatState: JSON.stringify({
            state: "escalating",
            aiParticipation: "assist_until_agent",
            ownershipRevision: 1,
          }),
        };
        const turnInput = input as {
          dependencies: {
            publicToolDependencies?: { onTeamRequested(): void };
          };
        };
        turnInput.dependencies.publicToolDependencies?.onTeamRequested();
      }
      return {
        fullStream: createMavenStream(
          options?.streamParts ?? [{ type: "text-delta", text: "Answer" }],
        ),
        collectedSources: [],
        toolActivity: [],
      };
    },
  } as unknown as WidgetMessageTurnRuntime;
  const context = {
    db: {},
    env: {
      AI_MODEL: "gpt-primary",
      GEMINI_API_KEY: null,
      OPENAI_API_KEY: "test-key",
      ENCRYPTION_KEY: "test-key",
      UPLOADS: {},
      BETTER_AUTH_URL: "https://app.test",
      INTERNAL_BROADCAST_SECRET: "test-secret",
      CONVERSATION_DO: {
        idFromName(name: string) {
          return name;
        },
        get() {
          return { async fetch() { return new Response(null, { status: 204 }); } };
        },
      },
    },
    executionCtx: { waitUntil() {} },
    routeStartedAt: Date.now(),
    streamProtocolVersion: 2,
    checkRateLimit: () => true,
    project: { id: "project-1", userId: "user-1", name: "Acme" },
    conversationId: "conversation-1",
    visitorMessageAlreadySaved: true,
    payload: { content: options?.content ?? "Help me" },
    abortSignal: options?.abortSignal,
  } as unknown as Parameters<typeof handleWidgetMessageTurn>[0];

  return {
    context,
    runtime,
    runTurnCalls,
    resolveCalls,
    botInsertCalls,
    setConversation(next) {
      conversation = next;
    },
  };
}

describe("widget handler Maven gates", () => {
  test.each([
    ["archived", null],
    [
      "closed",
      {
        status: "closed",
        chatState: null,
        closeReason: null,
      },
    ],
    [
      "human-owned",
      {
        status: "agent_replied",
        chatState: JSON.stringify({
          state: "agent_mode",
          aiParticipation: "human_only",
          ownershipRevision: 1,
        }),
        closeReason: null,
      },
    ],
  ])("calls no Maven turn for a %s conversation", async (_label, state) => {
    const harness = createHandlerHarness(state ?? undefined);
    if (!state) harness.setConversation(null);

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    await response.text();

    expect(harness.runTurnCalls).toHaveLength(0);
  });

  test("calls no Maven turn when the deterministic scope gate rejects", async () => {
    const harness = createHandlerHarness({
      content: "Write a poem about the moon",
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    await response.text();

    expect(harness.runTurnCalls).toHaveLength(0);
  });

  test("calls one Maven turn for an allowed public message", async () => {
    const abortController = new AbortController();
    const harness = createHandlerHarness({
      abortSignal: abortController.signal,
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    await response.text();

    expect(harness.runTurnCalls).toHaveLength(1);
    expect(
      (
        harness.runTurnCalls[0] as {
          dependencies: { abortSignal?: AbortSignal };
        }
      ).dependencies.abortSignal,
    ).toBe(abortController.signal);
  });

  test("a takeover winning RESOLVED close prevents bot persistence", async () => {
    const harness = createHandlerHarness({
      streamParts: [{ type: "text-delta", text: "Goodbye [RESOLVED]" }],
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    const body = await response.text();

    expect(harness.runTurnCalls).toHaveLength(1);
    expect(harness.resolveCalls).toEqual(["resolve"]);
    expect(harness.botInsertCalls).toHaveLength(0);
    expect(body).not.toContain("[RESOLVED]");
    expect(body).toContain('"finalText":""');
    expect(body).toContain('"conversationStatus":"agent_replied"');
  });

  test("request_team_help followed by RESOLVED does not close the handoff", async () => {
    const harness = createHandlerHarness({
      streamParts: [
        { type: "text-delta", text: "I shared this with the team. [RESOLVED]" },
      ],
      teamRequestedDuringTurn: true,
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    const body = await response.text();

    expect(harness.runTurnCalls).toHaveLength(1);
    expect(harness.resolveCalls).toHaveLength(0);
    expect(body).not.toContain("[RESOLVED]");
    expect(body).toContain('"conversationStatus":"waiting_agent"');
  });
});

describe("public Maven stream cutover", () => {
  test("uses one unified turn for an ordinary greeting", async () => {
    const runner = createTurnRunner({
      parts: [{ type: "text-delta", text: "Hi! How can I help?" }],
    });
    const capture = createSseCapture();

    const result = await streamPublicMavenTurn({
      runTurn: runner.runTurn as never,
      turnInput: createTurnInput(),
      controller: capture.controller,
      encoder: capture.encoder,
      streamProtocolVersion: 2,
      responseOpening: "",
    });

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toEqual(createTurnInput());
    expect(result.fullResponse).toBe("Hi! How can I help?");
    expect(capture.events).toEqual([{ text: "Hi! How can I help?" }]);
  });

  test("keeps final knowledge sources while exposing only safe tool status", async () => {
    const sources = [createSource("FAQ"), createSource("Guide")];
    const runner = createTurnRunner({
      parts: [
        {
          type: "tool-call",
          toolCallId: "knowledge-1",
          toolName: "search_knowledge",
          input: { query: "private customer question" },
        },
        {
          type: "tool-result",
          toolCallId: "knowledge-1",
          toolName: "search_knowledge",
          output: { secretChunk: "private evidence" },
        },
        { type: "text-delta", text: "The FAQ says you can reset it." },
      ],
      sources,
      activityCount: 2,
    });
    const capture = createSseCapture();

    const result = await streamPublicMavenTurn({
      runTurn: runner.runTurn as never,
      turnInput: createTurnInput(),
      controller: capture.controller,
      encoder: capture.encoder,
      streamProtocolVersion: 2,
      responseOpening: "",
    });

    expect(result.sources).toEqual(sources);
    expect(result.hadToolCalls).toBe(true);
    expect(capture.events).toEqual([
      {
        status: {
          phase: "tool",
          message: "Checking project information",
        },
      },
      { text: "The FAQ says you can reset it." },
    ]);
    expect(JSON.stringify(capture.events)).not.toContain("private");
  });

  test("streams an HTTP lookup followed by final text without a compose call", async () => {
    const runner = createTurnRunner({
      parts: [
        {
          type: "tool-call",
          toolCallId: "http-1",
          toolName: "lookup_order",
          input: { orderId: "secret-order" },
        },
        {
          type: "tool-result",
          toolCallId: "http-1",
          toolName: "lookup_order",
          output: { status: "shipped", token: "secret-result" },
        },
        { type: "text-delta", text: "Your order has shipped." },
      ],
      activityCount: 2,
    });
    const capture = createSseCapture();

    const result = await streamPublicMavenTurn({
      runTurn: runner.runTurn as never,
      turnInput: createTurnInput(),
      controller: capture.controller,
      encoder: capture.encoder,
      streamProtocolVersion: 2,
      responseOpening: "",
    });

    expect(runner.calls).toHaveLength(1);
    expect(result.fullResponse).toBe("Your order has shipped.");
    expect(JSON.stringify(capture.events)).not.toContain("secret-order");
    expect(JSON.stringify(capture.events)).not.toContain("secret-result");
  });

  test("returns a missing-information question as ordinary final text", async () => {
    const runner = createTurnRunner({
      parts: [{ type: "text-delta", text: "Which order number should I check?" }],
    });
    const capture = createSseCapture();

    const result = await streamPublicMavenTurn({
      runTurn: runner.runTurn as never,
      turnInput: createTurnInput(),
      controller: capture.controller,
      encoder: capture.encoder,
      streamProtocolVersion: 2,
      responseOpening: "",
    });

    expect(result.fullResponse).toBe("Which order number should I check?");
    expect(result.hadToolCalls).toBe(false);
    expect(runner.calls).toHaveLength(1);
  });

  test.each([
    ["saved contact", "I've shared this with our team."],
    ["contact required", "What name and email should I include?"],
  ])("does not duplicate request_team_help processing for %s", async (_label, text) => {
    const runner = createTurnRunner({
      parts: [
        {
          type: "tool-call",
          toolCallId: "handoff-1",
          toolName: "request_team_help",
          input: { summary: "private issue summary" },
        },
        {
          type: "tool-result",
          toolCallId: "handoff-1",
          toolName: "request_team_help",
          output: { status: "private durable result" },
        },
        { type: "text-delta", text },
      ],
      activityCount: 2,
    });
    const capture = createSseCapture();

    const result = await streamPublicMavenTurn({
      runTurn: runner.runTurn as never,
      turnInput: createTurnInput(),
      controller: capture.controller,
      encoder: capture.encoder,
      streamProtocolVersion: 2,
      responseOpening: "",
    });

    expect(result.fullResponse).toBe(text);
    expect(runner.calls).toHaveLength(1);
    expect(JSON.stringify(capture.events)).not.toContain("durable result");
  });

  test("strips a split resolved token before browser emission", async () => {
    const runner = createTurnRunner({
      parts: [
        { type: "text-delta", text: "Glad I could help. [RES" },
        { type: "text-delta", text: "OLVED]" },
      ],
    });
    const capture = createSseCapture();

    const result = await streamPublicMavenTurn({
      runTurn: runner.runTurn as never,
      turnInput: createTurnInput(),
      controller: capture.controller,
      encoder: capture.encoder,
      streamProtocolVersion: 2,
      responseOpening: "",
    });

    expect(result.fullResponse).toBe("Glad I could help. ");
    expect(result.detectedInternalTokens).toEqual(["[RESOLVED]"]);
    expect(JSON.stringify(capture.events)).not.toContain("RESOLVED");
  });

  test("does not turn a partial stream failure into a successful result", async () => {
    const runner = createTurnRunner({
      parts: [{ type: "text-delta", text: "Partial answer" }],
      error: new Error("stream failed"),
    });
    const capture = createSseCapture();

    await expect(
      streamPublicMavenTurn({
        runTurn: runner.runTurn as never,
        turnInput: createTurnInput(),
        controller: capture.controller,
        encoder: capture.encoder,
        streamProtocolVersion: 2,
        responseOpening: "",
      }),
    ).rejects.toThrow("stream failed");

    expect(runner.calls).toHaveLength(1);
    expect(capture.events).not.toContainEqual(
      expect.objectContaining({ completed: expect.anything() }),
    );
  });

  test("invalidates completed text when human takeover wins persistence", async () => {
    const runner = createTurnRunner({
      parts: [{ type: "text-delta", text: "Maven answer" }],
      sources: [createSource("Private guide")],
    });
    const capture = createSseCapture();
    const streamed = await streamPublicMavenTurn({
      runTurn: runner.runTurn as never,
      turnInput: createTurnInput(),
      controller: capture.controller,
      encoder: capture.encoder,
      streamProtocolVersion: 2,
      responseOpening: "",
    });

    const persisted = await persistGuardedAiOutput({
      controller: capture.controller,
      encoder: capture.encoder,
      streamProtocolVersion: 2,
      finalText: streamed.fullResponse,
      persist: async () => null,
      getConversationStatusAfterFailure: async () => "agent_replied",
    });

    expect(persisted).toBeNull();
    expect(capture.events.at(-1)).toEqual({
      completed: {
        protocolVersion: 2,
        messageId: null,
        finalText: "",
        conversationStatus: "agent_replied",
      },
    });
    expect(capture.events).not.toContainEqual(
      expect.objectContaining({
        completed: expect.objectContaining({ finalText: "Maven answer" }),
      }),
    );
  });

  test("preserves deterministic contact-support opening around the unified loop", async () => {
    const runner = createTurnRunner({
      parts: [{ type: "text-delta", text: "How else can I help?" }],
    });
    const capture = createSseCapture();

    const result = await streamPublicMavenTurn({
      runTurn: runner.runTurn as never,
      turnInput: createTurnInput(),
      controller: capture.controller,
      encoder: capture.encoder,
      streamProtocolVersion: 2,
      responseOpening: "Thanks — I saved your details. ",
    });

    expect(result.fullResponse).toBe(
      "Thanks — I saved your details. How else can I help?",
    );
    expect(capture.events).toEqual([
      { text: "Thanks — I saved your details. " },
      { text: "How else can I help?" },
    ]);
  });
});

describe("touchLinkedCustomerAfterVisitorMessage", () => {
  test("touches linked visitor activity and absorbs service failures", async () => {
    const calls: unknown[][] = [];
    const errors: unknown[] = [];
    const occurredAt = new Date("2026-08-02T12:00:00.000Z");

    await touchLinkedCustomerAfterVisitorMessage({
      projectId: "project-1",
      customerId: "customer-1",
      visitorId: "visitor-1",
      occurredAt,
      identityService: {
        async touchVisitorLastSeen(...args: unknown[]) {
          calls.push(args);
          throw new Error("temporary D1 failure");
        },
      },
      logFailure(error) {
        errors.push(error);
      },
    });

    expect(calls).toEqual([
      ["project-1", "customer-1", "visitor-1", occurredAt],
    ]);
    expect(errors).toHaveLength(1);
  });

  test("does nothing for an anonymous conversation", async () => {
    let touched = false;

    await touchLinkedCustomerAfterVisitorMessage({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      occurredAt: new Date(),
      identityService: {
        async touchVisitorLastSeen() {
          touched = true;
        },
      },
      logFailure() {},
    });

    expect(touched).toBe(false);
  });

  test("publishes the linked customer after a successful activity touch", async () => {
    const published: string[] = [];

    await touchLinkedCustomerAfterVisitorMessage({
      projectId: "project-1",
      customerId: "customer-1",
      visitorId: "visitor-1",
      occurredAt: new Date("2026-08-02T12:00:00.000Z"),
      identityService: {
        async touchVisitorLastSeen() {},
      },
      logFailure() {},
      onTouched(customerId) {
        published.push(customerId);
      },
    });

    expect(published).toEqual(["customer-1"]);
  });

  test("uses an inbound email message timestamp before publishing its customer", async () => {
    const touches: unknown[][] = [];
    const published: string[] = [];
    const occurredAt = new Date("2026-08-02T13:45:00.000Z");

    await touchLinkedCustomerAfterVisitorMessage({
      projectId: "project-email",
      customerId: "customer-email",
      visitorId: "visitor-email",
      occurredAt,
      identityService: {
        async touchVisitorLastSeen(...args: unknown[]) {
          touches.push(args);
        },
      },
      logFailure() {},
      onTouched(customerId) {
        published.push(customerId);
      },
    });

    expect(touches).toEqual([
      ["project-email", "customer-email", "visitor-email", occurredAt],
    ]);
    expect(published).toEqual(["customer-email"]);
  });
});
