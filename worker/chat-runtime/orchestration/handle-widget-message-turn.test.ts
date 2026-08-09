import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type SourceReference } from "../../services/resource-service";
import {
  type MavenStreamPart,
  type MavenToolCapability,
} from "../types";
import { persistGuardedAiOutput } from "../post-turn/persist-guarded-ai-output";
import { MavenTurnCancelled } from "../streaming/maven-turn-cancelled";
import { buildMavenToolRegistry } from "../tools/build-maven-tool-registry";
import {
  createRequestTeamHelpTool,
  type RequestTeamHelpResult,
} from "../tools/internal/request-team-help";
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

function createPersistedBotMessage(content: string): Record<string, unknown> {
  return {
    id: "bot-message-1",
    conversationId: "conversation-1",
    role: "bot",
    content,
    imageUrl: null,
    sources: null,
    senderName: "Maven",
    senderAvatar: null,
    createdAt: new Date(0),
  };
}

function createTurnRunner(options: {
  parts: MavenStreamPart[];
  sources?: SourceReference[];
  activityCount?: number;
  error?: Error;
  afterParts?: () => void;
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
        options.afterParts?.();
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
  checkRateLimitCalls: unknown[][];
  linkCalls: unknown[][];
  usageIncrementCalls: unknown[][];
  broadcastFetchCalls: Request[];
  waitUntilCalls: Promise<unknown>[];
  pendingContactUpdates: unknown[][];
  saveChatStateCalls: unknown[][];
  getConversation(): Record<string, unknown> | null;
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
  enabledHttpTool?: boolean;
  allowToolRateLimit?: boolean;
  botInsertSucceeds?: boolean;
  httpExecutionIds?: string[];
  visitorName?: string | null;
  visitorEmail?: string | null;
  executeTeamHelpDuringTurn?: boolean;
  pendingContactUpdateLosesToHuman?: boolean;
  contactAccepted?: boolean;
  turnKind?: "standard" | "contact_support";
  avgResponseTime?: string | null;
  streamFactory?: (input: unknown) => AsyncIterable<MavenStreamPart>;
  resolveSucceeds?: boolean;
  streamProtocolVersion?: 1 | 2;
  botInsert?: (
    args: unknown[],
  ) => Promise<Record<string, unknown> | null>;
}): HandlerHarness {
  let conversation: Record<string, unknown> | null = {
    id: "conversation-1",
    visitorId: "visitor-1",
    customerId: null,
    visitorName: options?.visitorName ?? null,
    visitorEmail: options?.visitorEmail ?? null,
    status: options?.status ?? "active",
    chatState: options?.chatState ?? null,
    closeReason: options?.closeReason ?? null,
    telegramThreadId: null,
    metadata: null,
  };
  const runTurnCalls: unknown[] = [];
  const resolveCalls: string[] = [];
  const botInsertCalls: unknown[] = [];
  const checkRateLimitCalls: unknown[][] = [];
  const linkCalls: unknown[][] = [];
  const usageIncrementCalls: unknown[][] = [];
  const broadcastFetchCalls: Request[] = [];
  const waitUntilCalls: Promise<unknown>[] = [];
  const pendingContactUpdates: unknown[][] = [];
  const saveChatStateCalls: unknown[][] = [];
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
      if (options?.botInsert) return options.botInsert(args);
      if (!options?.botInsertSucceeds) return null;
      const message = args[0] as { content: string; sources?: string | null };
      return {
        ...createPersistedBotMessage(message.content),
        sources: message.sources ?? null,
      };
    },
    async resolveConversationByAi() {
      resolveCalls.push("resolve");
      if (options?.resolveSucceeds) {
        conversation = {
          ...conversation,
          status: "closed",
        };
        return true;
      }
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
    async saveChatState(...args: unknown[]) {
      saveChatStateCalls.push(args);
      if (conversation) {
        conversation = {
          ...conversation,
          chatState: JSON.stringify(args[2]),
        };
      }
    },
    async updatePendingTeamRequestContact(...args: unknown[]) {
      pendingContactUpdates.push(args);
      if (!conversation) return null;
      if (options?.pendingContactUpdateLosesToHuman) {
        conversation = {
          ...conversation,
          status: "agent_replied",
          chatState: JSON.stringify({
            state: "agent_mode",
            aiParticipation: "human_only",
            ownershipRevision: 2,
            awaitingContactFields: ["name", "email"],
          }),
        };
        return null;
      }
      const ownership = args[2] as { status: string; chatState: string | null };
      if (
        conversation.status !== ownership.status ||
        conversation.chatState !== ownership.chatState
      ) {
        return null;
      }
      const update = args[3] as {
        visitorName?: string;
        visitorEmail?: string;
        awaitingContactFields: Array<"name" | "email">;
        contactDeclined?: boolean;
      };
      const currentState = conversation.chatState
        ? JSON.parse(conversation.chatState as string) as Record<string, unknown>
        : {};
      conversation = {
        ...conversation,
        ...(update.visitorName ? { visitorName: update.visitorName } : {}),
        ...(update.visitorEmail ? { visitorEmail: update.visitorEmail } : {}),
        chatState: JSON.stringify({
          ...currentState,
          awaitingContactFields: update.awaitingContactFields,
          contactDeclined: currentState.contactDeclined ?? false,
          ...(update.contactDeclined === undefined
            ? {}
            : { contactDeclined: update.contactDeclined }),
        }),
      };
      return { ...conversation };
    },
    async claimNewTeamRequest() {
      if (!conversation) return { status: "unavailable" as const };
      const state = conversation.chatState
        ? JSON.parse(conversation.chatState as string) as Record<string, unknown>
        : {};
      const requiredFields: Array<"name" | "email"> = [];
      if (!conversation.visitorName) requiredFields.push("name");
      if (!conversation.visitorEmail) requiredFields.push("email");
      if (requiredFields.length > 0 && state.contactDeclined !== true) {
        return { status: "contact_required" as const, requiredFields };
      }
      conversation = {
        ...conversation,
        status: "waiting_agent",
        chatState: JSON.stringify({
          ...state,
          state: "escalating",
          aiParticipation: "assist_until_agent",
          ownershipRevision:
            typeof state.ownershipRevision === "number"
              ? state.ownershipRevision + 1
              : 1,
        }),
      };
      return { status: "claimed" as const };
    },
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
        async incrementMessageUsage(...args: unknown[]) {
          usageIncrementCalls.push(args);
        },
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
        async getProjectById() {
          return { id: "project-1", name: "Acme" };
        },
        async getSettings() {
          return {
            toneOfVoice: "professional",
            customTonePrompt: null,
            companyContext: null,
            botName: "Maven",
            agentName: null,
            workingHours: null,
            avgResponseTime: options?.avgResponseTime ?? null,
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
          return options?.enabledHttpTool ? [{ id: "http-tool-1" }] : [];
        },
        async linkExecutionsToMessage(...args: unknown[]) {
          linkCalls.push(args);
        },
      };
    },
    async runMavenTurn(input: unknown) {
      runTurnCalls.push(input);
      if (options?.executeTeamHelpDuringTurn) {
        const turnInput = input as {
          context: Parameters<typeof createRequestTeamHelpTool>[0]["context"];
          dependencies: {
            publicToolDependencies: NonNullable<
              Parameters<typeof createRequestTeamHelpTool>[0]
            >;
          };
        };
        const publicDependencies = turnInput.dependencies.publicToolDependencies;
        const definition = createRequestTeamHelpTool({
          context: turnInput.context,
          chatService: publicDependencies.chatService,
          projectService: publicDependencies.projectService,
          telegramService: publicDependencies.telegramService,
          env: { BETTER_AUTH_URL: "https://app.test" },
          executionCtx: publicDependencies.executionCtx,
          onTeamRequested: publicDependencies.onTeamRequested,
          broadcast: publicDependencies.broadcast,
        });
        const registered = buildMavenToolRegistry({
          context: turnInput.context,
          definitions: [definition],
        }).tools.request_team_help;
        if (!registered || typeof registered.execute !== "function") {
          throw new Error("Expected request_team_help tool");
        }
        const result = await registered.execute(
          { summary: "Visitor needs account help." },
          { toolCallId: "team-help", messages: [] },
        ) as RequestTeamHelpResult;
        const text = result.status === "contact_required"
          ? "What name and email should I include?"
          : result.visitorMessage;
        return {
          fullStream: createMavenStream([
            {
              type: "tool-call",
              toolCallId: "team-help",
              toolName: "request_team_help",
              input: { summary: "Visitor needs account help." },
            },
            { type: "text-delta", text },
          ]),
          collectedSources: [],
          toolActivity: [],
          httpExecutionIds: [],
        };
      }
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
        fullStream: options?.streamFactory?.(input) ?? createMavenStream(
          options?.streamParts ?? [{ type: "text-delta", text: "Answer" }],
        ),
        collectedSources: [],
        toolActivity: options?.httpExecutionIds?.length
          ? [{
              toolId: "http-tool-1",
              displayName: "HTTP tool",
              source: "http",
              status: "success",
              durationMs: 1,
            }]
          : [],
        httpExecutionIds: options?.httpExecutionIds ?? [],
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
          return {
            async fetch(request: Request) {
              broadcastFetchCalls.push(request);
              return new Response(null, { status: 204 });
            },
          };
        },
      },
    },
    executionCtx: {
      waitUntil(promise: Promise<unknown>) {
        waitUntilCalls.push(promise);
      },
    },
    routeStartedAt: Date.now(),
    streamProtocolVersion: options?.streamProtocolVersion ?? 2,
    checkRateLimit(...args: unknown[]) {
      checkRateLimitCalls.push(args);
      return options?.allowToolRateLimit ?? true;
    },
    project: { id: "project-1", userId: "user-1", name: "Acme" },
    conversationId: "conversation-1",
    visitorMessageAlreadySaved: true,
    payload: { content: options?.content ?? "Help me" },
    abortSignal: options?.abortSignal,
    turnKind: options?.turnKind,
    ...(options?.contactAccepted
      ? {
          contactAccepted: {
            conversationId: "conversation-1",
            visitorMessageId: "visitor-message-1",
            conversationStatus: "waiting_agent",
            aiWillRespond: true,
            visitorName: null,
            visitorEmail: null,
            assistantName: "Maven",
            fallbackMessage: "Initial fallback",
          },
        }
      : {}),
  } as unknown as Parameters<typeof handleWidgetMessageTurn>[0];

  return {
    context,
    runtime,
    runTurnCalls,
    resolveCalls,
    botInsertCalls,
    checkRateLimitCalls,
    linkCalls,
    usageIncrementCalls,
    broadcastFetchCalls,
    waitUntilCalls,
    pendingContactUpdates,
    saveChatStateCalls,
    getConversation() {
      return conversation ? { ...conversation } : null;
    },
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
    const turnSignal = (
      harness.runTurnCalls[0] as {
        dependencies: { abortSignal?: AbortSignal };
      }
    ).dependencies.abortSignal;
    expect(turnSignal).toBeDefined();
    expect(turnSignal).not.toBe(abortController.signal);
    expect(turnSignal?.aborted).toBe(false);

    const reason = new DOMException("Visitor disconnected", "AbortError");
    abortController.abort(reason);
    expect(turnSignal?.aborted).toBe(true);
    expect(turnSignal?.reason).toBe(reason);
  });

  test("aborts the pre-SSE contact timing request before Maven starts", async () => {
    const inboundAbortController = new AbortController();
    const harness = createHandlerHarness({
      abortSignal: inboundAbortController.signal,
      turnKind: "contact_support",
      avgResponseTime: "2-4 hours",
    });
    const originalFetch = globalThis.fetch;
    let providerSignal: AbortSignal | undefined;
    let rejectProvider: ((reason: unknown) => void) | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init);
      providerSignal = request.signal;
      resolveStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        rejectProvider = reject;
        request.signal.addEventListener(
          "abort",
          () => reject(new DOMException("cancelled", "AbortError")),
          { once: true },
        );
      });
    }) as typeof fetch;

    const pending = handleWidgetMessageTurn(harness.context, harness.runtime);
    await started;
    inboundAbortController.abort(
      new DOMException("visitor disconnected", "AbortError"),
    );
    const providerWasAborted = providerSignal?.aborted === true;
    if (!providerWasAborted) {
      rejectProvider?.(new Error("test cleanup"));
    }
    const result = await pending.then(
      (response) => response,
      (error: unknown) => error,
    );
    globalThis.fetch = originalFetch;

    expect(providerWasAborted).toBe(true);
    expect(result).toBeInstanceOf(MavenTurnCancelled);
    expect(harness.runTurnCalls).toHaveLength(0);
  });

  test("does not consume the HTTP execution limit for a text-only Maven turn", async () => {
    const harness = createHandlerHarness({
      enabledHttpTool: true,
      allowToolRateLimit: false,
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    await response.text();

    expect(harness.runTurnCalls).toHaveLength(1);
    expect(harness.checkRateLimitCalls).toHaveLength(0);
  });

  test("does not consume the HTTP execution limit for a scope-blocked turn", async () => {
    const harness = createHandlerHarness({
      content: "Write a poem about the moon",
      enabledHttpTool: true,
      allowToolRateLimit: false,
      botInsertSucceeds: true,
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    const body = await response.text();

    expect(harness.runTurnCalls).toHaveLength(0);
    expect(harness.checkRateLimitCalls).toHaveLength(0);
    expect(body).toContain("unrelated general-purpose requests");
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

  test("a post-tool provider error emits only a sanitized error frame", async () => {
    const harness = createHandlerHarness({
      streamParts: [
        {
          type: "tool-call",
          toolCallId: "http-1",
          toolName: "lookup_account",
          input: { accountId: "private-account" },
        },
        { type: "text-delta", text: "Partial answer" },
        {
          type: "error",
          error: new Error("provider secret failure"),
        },
      ],
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    const body = await response.text();

    expect(harness.runTurnCalls).toHaveLength(1);
    expect(harness.botInsertCalls).toHaveLength(0);
    expect(body).toContain('"error":"The response stream failed."');
    expect(body).not.toContain("provider secret failure");
    expect(body).not.toContain('"completed"');
  });

  test("a committed stream failure cannot become a contact fallback success", async () => {
    const harness = createHandlerHarness({
      contactAccepted: true,
      botInsertSucceeds: true,
      streamParts: [
        {
          type: "tool-call",
          toolCallId: "http-1",
          toolName: "lookup_account",
          input: { accountId: "private-account" },
        },
        {
          type: "error",
          error: new Error("provider secret failure"),
        },
      ],
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    const body = await response.text();

    expect(harness.botInsertCalls).toHaveLength(0);
    expect(body).toContain('"error":"The response stream failed."');
    expect(body).not.toContain('"completed"');
  });

  test("response cancellation terminalizes an SDK abort before persistence and post-turn effects", async () => {
    let resolveToolStarted = () => {};
    const toolStarted = new Promise<void>((resolve) => {
      resolveToolStarted = resolve;
    });
    let resolveStreamClosed = () => {};
    const streamClosed = new Promise<void>((resolve) => {
      resolveStreamClosed = resolve;
    });
    const sdkToolController = new AbortController();
    let turnSignal: AbortSignal | undefined;
    const harness = createHandlerHarness({
      contactAccepted: true,
      botInsertSucceeds: true,
      httpExecutionIds: ["execution-1"],
      resolveSucceeds: true,
      streamFactory(input) {
        const turnInput = input as {
          context: Parameters<typeof buildMavenToolRegistry>[0]["context"];
          dependencies: { abortSignal?: AbortSignal };
        };
        turnSignal = turnInput.dependencies.abortSignal;
        const capability: MavenToolCapability = {
          id: "http-tool-1",
          projectId: "project-1",
          connectionId: null,
          modelName: "lookup_account",
          displayName: "Look up account",
          source: "http",
          allowedChannels: ["public"],
          access: "read",
          enabled: true,
          schemaFingerprint: "schema-v1",
        };
        const registered = buildMavenToolRegistry({
          context: turnInput.context,
          abortSignal: turnSignal,
          definitions: [
            {
              capability,
              description: "Look up a customer account.",
              inputSchema: z.object({ accountId: z.string() }),
              async reauthorize() {
                return capability;
              },
              async execute(_toolInput, { abortSignal }) {
                resolveToolStarted();
                if (!abortSignal?.aborted) {
                  await new Promise<void>((resolve) => {
                    abortSignal?.addEventListener("abort", () => resolve(), {
                      once: true,
                    });
                  });
                }
                return { cancelled: true };
              },
            },
          ],
        }).tools.lookup_account;
        if (!registered || typeof registered.execute !== "function") {
          throw new Error("Expected an executable HTTP registry tool");
        }
        async function* stream(): AsyncGenerator<MavenStreamPart> {
          try {
            yield {
              type: "tool-call",
              toolCallId: "http-1",
              toolName: "lookup_account",
              input: { accountId: "private-account" },
            };
            const execution = registered.execute(
              { accountId: "private-account" },
              {
                toolCallId: "http-1",
                messages: [],
                abortSignal: sdkToolController.signal,
              },
            );
            yield {
              type: "text-delta",
              text: "Partial answer [RESOLVED]",
            };
            await execution;
            yield {
              type: "abort",
              reason: "private disconnect reason",
            };
          } finally {
            resolveStreamClosed();
          }
        }
        return stream();
      },
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let browserFrames = "";
    let resolveActivityReceived = () => {};
    const activityReceived = new Promise<void>((resolve) => {
      resolveActivityReceived = resolve;
    });
    let resolvePartialReceived = () => {};
    const partialReceived = new Promise<void>((resolve) => {
      resolvePartialReceived = resolve;
    });
    const readLoop = (async () => {
      while (true) {
        const next = await reader?.read();
        if (!next || next.done) return;
        browserFrames += decoder.decode(next.value, { stream: true });
        if (browserFrames.includes("Checking project information")) {
          resolveActivityReceived();
        }
        if (browserFrames.includes("Partial answer")) {
          resolvePartialReceived();
        }
      }
    })();

    await Promise.all([toolStarted, activityReceived, partialReceived]);
    const cancelReason = new DOMException("Visitor disconnected", "AbortError");
    await reader?.cancel(cancelReason);
    await Promise.all([readLoop, streamClosed]);
    await Bun.sleep(0);
    await Promise.all(harness.waitUntilCalls);

    expect(turnSignal?.aborted).toBe(true);
    expect(turnSignal?.reason).toBe(cancelReason);
    expect(sdkToolController.signal.aborted).toBe(false);
    expect(harness.botInsertCalls).toHaveLength(0);
    expect(harness.resolveCalls).toHaveLength(0);
    expect(harness.linkCalls).toHaveLength(0);
    expect(harness.usageIncrementCalls).toHaveLength(0);
    expect(harness.broadcastFetchCalls).toHaveLength(0);
    expect(browserFrames).not.toContain("private disconnect reason");
  });

  test("cancellation while ordinary v1 persistence is pending emits no final text", async () => {
    const abortController = new AbortController();
    let resolvePersistStarted = () => {};
    const persistStarted = new Promise<void>((resolve) => {
      resolvePersistStarted = resolve;
    });
    let releasePersist: (
      message: Record<string, unknown> | null,
    ) => void = () => {};
    const persistResult = new Promise<Record<string, unknown> | null>(
      (resolve) => {
        releasePersist = resolve;
      },
    );
    const harness = createHandlerHarness({
      abortSignal: abortController.signal,
      streamProtocolVersion: 1,
      httpExecutionIds: ["execution-1"],
      async botInsert() {
        resolvePersistStarted();
        return persistResult;
      },
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    const bodyResult = response.text();
    await persistStarted;
    abortController.abort(
      new DOMException("private ordinary persist abort", "AbortError"),
    );
    releasePersist(createPersistedBotMessage("Answer"));
    const body = await bodyResult;
    await Promise.all(harness.waitUntilCalls);

    expect(harness.botInsertCalls).toHaveLength(1);
    expect(body).not.toContain('"finalText"');
    expect(body).not.toContain('"done"');
    expect(body).not.toContain('"completed"');
    expect(body).not.toContain("private ordinary persist abort");
    expect(harness.resolveCalls).toHaveLength(0);
    expect(harness.linkCalls).toHaveLength(0);
    expect(harness.usageIncrementCalls).toHaveLength(0);
    expect(harness.broadcastFetchCalls).toHaveLength(0);
  });

  test("cancellation while immediate null persistence is pending emits no completion", async () => {
    const abortController = new AbortController();
    let resolvePersistStarted = () => {};
    const persistStarted = new Promise<void>((resolve) => {
      resolvePersistStarted = resolve;
    });
    let releasePersist: (
      message: Record<string, unknown> | null,
    ) => void = () => {};
    const persistResult = new Promise<Record<string, unknown> | null>(
      (resolve) => {
        releasePersist = resolve;
      },
    );
    const harness = createHandlerHarness({
      abortSignal: abortController.signal,
      content: "Write a poem about the moon",
      async botInsert() {
        resolvePersistStarted();
        return persistResult;
      },
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    const bodyResult = response.text();
    await persistStarted;
    abortController.abort(
      new DOMException("private immediate persist abort", "AbortError"),
    );
    releasePersist(null);
    const body = await bodyResult;
    await Promise.all(harness.waitUntilCalls);

    expect(harness.runTurnCalls).toHaveLength(0);
    expect(harness.botInsertCalls).toHaveLength(1);
    expect(body).not.toContain('"completed"');
    expect(body).not.toContain('"done"');
    expect(body).not.toContain('"error"');
    expect(body).not.toContain("private immediate persist abort");
    expect(harness.usageIncrementCalls).toHaveLength(0);
    expect(harness.broadcastFetchCalls).toHaveLength(0);
  });

  test("cancellation while contact-fallback null persistence is pending emits no terminal frame", async () => {
    const abortController = new AbortController();
    let resolvePersistStarted = () => {};
    const persistStarted = new Promise<void>((resolve) => {
      resolvePersistStarted = resolve;
    });
    let releasePersist: (
      message: Record<string, unknown> | null,
    ) => void = () => {};
    const persistResult = new Promise<Record<string, unknown> | null>(
      (resolve) => {
        releasePersist = resolve;
      },
    );
    const harness = createHandlerHarness({
      abortSignal: abortController.signal,
      contactAccepted: true,
      streamFactory() {
        async function* fail(): AsyncGenerator<MavenStreamPart> {
          yield* createMavenStream([]);
          throw new Error("ordinary model failure");
        }
        return fail();
      },
      async botInsert() {
        resolvePersistStarted();
        return persistResult;
      },
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    const bodyResult = response.text();
    await persistStarted;
    abortController.abort(
      new DOMException("private contact persist abort", "AbortError"),
    );
    releasePersist(null);
    const body = await bodyResult;
    await Promise.all(harness.waitUntilCalls);

    expect(harness.botInsertCalls).toHaveLength(1);
    expect(body).not.toContain('"completed"');
    expect(body).not.toContain('"done"');
    expect(body).not.toContain('"error"');
    expect(body).not.toContain("Initial fallback");
    expect(body).not.toContain("private contact persist abort");
    expect(harness.resolveCalls).toHaveLength(0);
    expect(harness.linkCalls).toHaveLength(0);
    expect(harness.usageIncrementCalls).toHaveLength(0);
    expect(harness.broadcastFetchCalls).toHaveLength(0);
  });

  test("tracks exact HTTP execution linkage through waitUntil", async () => {
    const harness = createHandlerHarness({
      botInsertSucceeds: true,
      httpExecutionIds: ["execution-1"],
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    await response.text();
    await Promise.all(harness.waitUntilCalls);

    expect(harness.linkCalls).toEqual([
      [["execution-1"], "conversation-1", "bot-message-1"],
    ]);
  });

  test("resumes a pending team request from explicit contact on the next visitor turn", async () => {
    const harness = createHandlerHarness({
      botInsertSucceeds: true,
      executeTeamHelpDuringTurn: true,
    });

    const firstResponse = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    await firstResponse.text();
    await Promise.all(harness.waitUntilCalls.splice(0));

    const afterQuestion = harness.getConversation();
    expect(afterQuestion?.status).toBe("active");
    expect(JSON.parse(afterQuestion?.chatState as string)).toMatchObject({
      awaitingContactFields: ["name", "email"],
      contactDeclined: false,
    });

    (harness.context.payload as { content: string }).content =
      "Alice, alice@example.com";
    const secondResponse = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );
    await secondResponse.text();
    await Promise.all(harness.waitUntilCalls.splice(0));

    const afterResume = harness.getConversation();
    expect(afterResume).toMatchObject({
      status: "waiting_agent",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
    });
    expect(JSON.parse(afterResume?.chatState as string)).toMatchObject({
      awaitingContactFields: [],
      contactDeclined: false,
      aiParticipation: "assist_until_agent",
    });
    expect(harness.runTurnCalls).toHaveLength(2);
    expect(harness.saveChatStateCalls).toHaveLength(0);
  });

  test("keeps only the omitted contact field pending on the second turn", async () => {
    const harness = createHandlerHarness({
      botInsertSucceeds: true,
      executeTeamHelpDuringTurn: true,
    });
    await (await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    )).text();
    await Promise.all(harness.waitUntilCalls.splice(0));

    (harness.context.payload as { content: string }).content =
      "alice@example.com";
    await (await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    )).text();
    await Promise.all(harness.waitUntilCalls.splice(0));

    const afterPartial = harness.getConversation();
    expect(afterPartial).toMatchObject({
      status: "active",
      visitorName: null,
      visitorEmail: "alice@example.com",
    });
    expect(JSON.parse(afterPartial?.chatState as string)).toMatchObject({
      awaitingContactFields: ["name"],
      contactDeclined: false,
    });
    expect(harness.saveChatStateCalls).toHaveLength(0);
  });

  test("an explicit contact refusal resumes the pending team request", async () => {
    const harness = createHandlerHarness({
      botInsertSucceeds: true,
      executeTeamHelpDuringTurn: true,
    });
    await (await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    )).text();
    await Promise.all(harness.waitUntilCalls.splice(0));

    (harness.context.payload as { content: string }).content =
      "I'd rather not share that.";
    await (await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    )).text();
    await Promise.all(harness.waitUntilCalls.splice(0));

    const afterRefusal = harness.getConversation();
    expect(afterRefusal?.status).toBe("waiting_agent");
    expect(JSON.parse(afterRefusal?.chatState as string)).toMatchObject({
      awaitingContactFields: [],
      contactDeclined: true,
      aiParticipation: "assist_until_agent",
    });
    expect(harness.saveChatStateCalls).toHaveLength(0);
  });

  test("a takeover winning pending-contact CAS prevents a stale Maven turn", async () => {
    const harness = createHandlerHarness({
      content: "Alice, alice@example.com",
      chatState: JSON.stringify({
        state: "clarifying",
        aiParticipation: "continuous",
        ownershipRevision: 1,
        awaitingContactFields: ["name", "email"],
        contactDeclined: false,
      }),
      pendingContactUpdateLosesToHuman: true,
    });

    const response = await handleWidgetMessageTurn(
      harness.context,
      harness.runtime,
    );

    expect(await response.json()).toEqual({ ok: true, agentMode: true });
    expect(harness.runTurnCalls).toHaveLength(0);
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
      abortSignal: undefined,
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

  test("does not complete an opening-only response after an AI SDK abort", async () => {
    const runner = createTurnRunner({
      parts: [{ type: "abort", reason: "private disconnect reason" }],
    });
    const capture = createSseCapture();

    await expect(
      streamPublicMavenTurn({
        runTurn: runner.runTurn as never,
        turnInput: createTurnInput(),
        controller: capture.controller,
        encoder: capture.encoder,
        streamProtocolVersion: 2,
        responseOpening: "Thanks — I saved your details. ",
      }),
    ).rejects.toThrow("The Maven turn was cancelled.");

    expect(capture.events).toEqual([
      { text: "Thanks — I saved your details. " },
    ]);
    expect(JSON.stringify(capture.events)).not.toContain(
      "private disconnect reason",
    );
  });

  test("terminalizes when the authoritative signal aborts at completion", async () => {
    const turnAbortController = new AbortController();
    const runner = createTurnRunner({
      parts: [{ type: "text-delta", text: "Partial answer" }],
      afterParts() {
        turnAbortController.abort(
          new DOMException("Visitor disconnected", "AbortError"),
        );
      },
    });
    const capture = createSseCapture();
    const turnInput = {
      ...createTurnInput(),
      dependencies: { abortSignal: turnAbortController.signal },
    } as never;

    await expect(
      streamPublicMavenTurn({
        runTurn: runner.runTurn as never,
        turnInput,
        controller: capture.controller,
        encoder: capture.encoder,
        streamProtocolVersion: 2,
        responseOpening: "",
      }),
    ).rejects.toThrow("The Maven turn was cancelled.");

    expect(capture.events).toEqual([{ text: "Partial answer" }]);
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
