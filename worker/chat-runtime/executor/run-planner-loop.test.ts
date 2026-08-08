import { afterAll, expect, mock, test } from "bun:test";
import { createModelRuntimeState } from "../llm/create-language-model";

async function* createModelStream(): AsyncGenerator<{
  type: "text-delta";
  text: string;
}> {
  yield { type: "text-delta", text: "AI draft" };
}

async function fakeStreamMavenAgent() {
  return { fullStream: createModelStream() } as never;
}

mock.module("../agents/support-agent", () => ({
  streamMavenAgent: fakeStreamMavenAgent,
}));

const { persistGuardedAiOutput, runPlannerLoop } = await import(
  "./run-planner-loop"
);

interface SseCapture {
  controller: ReadableStreamDefaultController;
  payloads: () => Record<string, unknown>[];
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

function createSseCapture(): SseCapture {
  const chunks: Uint8Array[] = [];
  return {
    controller: {
      enqueue(chunk: Uint8Array) {
        chunks.push(chunk);
      },
    } as unknown as ReadableStreamDefaultController,
    payloads: () =>
      chunks.map((chunk) => {
        const frame = new TextDecoder().decode(chunk).trim();
        return JSON.parse(frame.slice("data: ".length)) as Record<
          string,
          unknown
        >;
      }),
  };
}

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function runComposedTurn(
  streamProtocolVersion: 1 | 2,
  capture: SseCapture,
): Promise<string> {
  const result = await runPlannerLoop({
    controller: capture.controller,
    encoder: new TextEncoder(),
    modelRuntime: createModelRuntimeState({
      model: "gpt-5.6-terra",
      openaiApiKey: "test-key",
    }),
    telemetry: { startedAt: 1, routeStartedAt: 1 },
    currentMessage: "Hello",
    conversationHistory: [],
    conversationSummary: null,
    availableTools: [],
    enabledToolRows: [],
    toolService: {} as never,
    chatService: {} as never,
    projectService: {} as never,
    db: {} as never,
    env: {} as never,
    executionCtx: {} as never,
    project: { id: "project-1", name: "Acme" },
    conversation: {
      id: "conversation-1",
      visitorId: "visitor-1",
      visitorName: null,
      visitorEmail: null,
      status: "active",
      metadata: null,
    },
    settings: {
      toneOfVoice: "professional",
      customTonePrompt: null,
      companyContext: null,
      botName: null,
      agentName: null,
      workingHours: null,
      avgResponseTime: null,
    },
    guidelines: [],
    compiledFaqContext: "",
    hasIndexedResources: false,
    visitorInfo: { name: null, email: null },
    turnContext: { kind: "standard", isFirstVisitorTurn: false },
    aiParticipation: "continuous",
    responseOpening: "",
    fastPathDecision: {
      kind: "small_talk",
      reason: "pure_greeting",
      composeKind: "greeting",
    },
    streamProtocolVersion,
    emitStatus: () => {},
    shouldAllowEscalation: () => ({ allowed: true, reason: "test" }),
    closeSafeAiReplayWindow: () => {},
    buildLogContext: () => ({}),
    buildSystemPrompt: () => "system prompt",
  } as never);

  return result.fullResponse;
}

afterAll(() => {
  mock.restore();
});

test("protocol v1 buffers composed AI text until guarded persistence succeeds", async () => {
  const capture = createSseCapture();
  const finalText = await runComposedTurn(1, capture);
  const persistence = createDeferred<{ id: string } | null>();
  const finalize = persistGuardedAiOutput({
    controller: capture.controller,
    encoder: new TextEncoder(),
    streamProtocolVersion: 1,
    finalText,
    persist: () => persistence.promise,
    getConversationStatusAfterFailure: async () => "active",
  });

  await Promise.resolve();
  expect(capture.payloads()).not.toContainEqual(
    expect.objectContaining({ text: expect.any(String) }),
  );
  expect(capture.payloads()).not.toContainEqual(
    expect.objectContaining({ finalText: expect.any(String) }),
  );

  persistence.resolve({ id: "message-1" });
  await finalize;

  expect(capture.payloads()).toContainEqual({ finalText: "AI draft" });
});

test("protocol v2 may stream provisional text but completes empty when guarded persistence fails", async () => {
  const capture = createSseCapture();
  const finalText = await runComposedTurn(2, capture);

  const message = await persistGuardedAiOutput({
    controller: capture.controller,
    encoder: new TextEncoder(),
    streamProtocolVersion: 2,
    finalText,
    persist: async () => null,
    getConversationStatusAfterFailure: async () => "agent_replied",
  });

  expect(message).toBeNull();
  expect(capture.payloads()).toContainEqual({ text: "AI draft" });
  expect(capture.payloads()).toContainEqual({
    completed: {
      protocolVersion: 2,
      messageId: null,
      finalText: "",
      conversationStatus: "agent_replied",
    },
  });
  expect(capture.payloads()).not.toContainEqual(
    expect.objectContaining({ finalText: "AI draft" }),
  );
});
