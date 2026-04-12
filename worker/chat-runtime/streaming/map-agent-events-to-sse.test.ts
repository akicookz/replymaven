import { describe, expect, test } from "bun:test";
import {
  createInitialAgentEventState,
  emitSseEvent,
  emitStatusEvent,
  finalizeAgentEventState,
  mapAgentStreamPartToSse,
} from "./map-agent-events-to-sse";

interface EnqueuedChunk {
  type: "text" | "status" | "toolCall" | "toolResult" | "other";
  raw: string;
  payload: Record<string, unknown>;
}

function createTestController(): {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  chunks: EnqueuedChunk[];
} {
  const chunks: EnqueuedChunk[] = [];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const controller = {
    enqueue(chunk: Uint8Array) {
      const raw = decoder.decode(chunk);
      const body = raw.replace(/^data: /, "").replace(/\n\n$/, "");
      const payload = JSON.parse(body) as Record<string, unknown>;
      let type: EnqueuedChunk["type"] = "other";
      if (typeof payload.text === "string") type = "text";
      else if (payload.status) type = "status";
      else if (payload.toolCall) type = "toolCall";
      else if (payload.toolResult) type = "toolResult";
      chunks.push({ type, raw, payload });
    },
    close() {},
    error() {},
  } as unknown as ReadableStreamDefaultController;
  return { controller, encoder, chunks };
}

describe("map-agent-events-to-sse", () => {
  describe("createInitialAgentEventState", () => {
    test("returns a fresh empty state with strip state and token list", () => {
      const state = createInitialAgentEventState();
      expect(state.fullResponse).toBe("");
      expect(state.hadToolCalls).toBe(false);
      expect(state.lastToolOutput).toBeNull();
      expect(state.lastToolError).toBeNull();
      expect(state.stepCount).toBe(0);
      expect(state.stripState).toBeDefined();
      expect(state.stripState.tail).toBe("");
      expect(state.detectedInternalTokens).toEqual([]);
    });
  });

  describe("emitSseEvent", () => {
    test("writes SSE-formatted JSON payload", () => {
      const { controller, encoder, chunks } = createTestController();
      emitSseEvent(controller, encoder, { hello: "world" });
      expect(chunks).toHaveLength(1);
      expect(chunks[0].raw).toBe('data: {"hello":"world"}\n\n');
      expect(chunks[0].payload).toEqual({ hello: "world" });
    });
  });

  describe("emitStatusEvent", () => {
    test("wraps status payload in a status envelope", () => {
      const { controller, encoder, chunks } = createTestController();
      emitStatusEvent(controller, encoder, {
        phase: "thinking",
        message: "Looking that up...",
      });
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("status");
      expect(chunks[0].payload).toEqual({
        status: { phase: "thinking", message: "Looking that up..." },
      });
    });
  });

  describe("mapAgentStreamPartToSse", () => {
    test("emits plain text deltas unchanged", () => {
      const { controller, encoder, chunks } = createTestController();
      const state = createInitialAgentEventState();
      const next = mapAgentStreamPartToSse({
        part: { type: "text-delta", text: "Hello" },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });
      expect(next.fullResponse).toBe("Hello");
      expect(chunks).toHaveLength(1);
      expect(chunks[0].payload).toEqual({ text: "Hello" });
      expect(next.detectedInternalTokens).toEqual([]);
    });

    test("strips a complete internal token within a single delta", () => {
      const { controller, encoder, chunks } = createTestController();
      const state = createInitialAgentEventState();
      const next = mapAgentStreamPartToSse({
        part: { type: "text-delta", text: "Done [RESOLVED] bye" },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });
      expect(next.fullResponse).toBe("Done  bye");
      expect(next.detectedInternalTokens).toEqual(["[RESOLVED]"]);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].payload).toEqual({ text: "Done  bye" });
    });

    test("withholds partial token suffix across consecutive deltas", () => {
      const { controller, encoder, chunks } = createTestController();
      let state = createInitialAgentEventState();

      state = mapAgentStreamPartToSse({
        part: { type: "text-delta", text: "Got it [HAN" },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });
      expect(state.fullResponse).toBe("Got it ");
      expect(state.detectedInternalTokens).toEqual([]);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].payload).toEqual({ text: "Got it " });

      state = mapAgentStreamPartToSse({
        part: { type: "text-delta", text: "DOFF_REQUESTED] bye" },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });
      expect(state.fullResponse).toBe("Got it  bye");
      expect(state.detectedInternalTokens).toEqual(["[HANDOFF_REQUESTED]"]);
      expect(chunks).toHaveLength(2);
      expect(chunks[1].payload).toEqual({ text: " bye" });
    });

    test("coerces non-string text values safely", () => {
      const { controller, encoder, chunks } = createTestController();
      const state = createInitialAgentEventState();
      const next = mapAgentStreamPartToSse({
        part: { type: "text-delta", text: undefined },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });
      expect(next.fullResponse).toBe("");
      expect(chunks).toHaveLength(0);
    });

    test("emits a tool-call event once per tool name and sets hadToolCalls", () => {
      const { controller, encoder, chunks } = createTestController();
      const emittedToolCalls = new Set<string>();
      const toolCallStartTimes = new Map<string, number>();
      let state = createInitialAgentEventState();

      state = mapAgentStreamPartToSse({
        part: {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "search_docs",
          args: { query: "pricing" },
        },
        controller,
        encoder,
        emittedToolCalls,
        toolCallStartTimes,
        state,
      });
      expect(state.hadToolCalls).toBe(true);
      expect(toolCallStartTimes.has("call-1")).toBe(true);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("toolCall");
      expect(chunks[0].payload).toEqual({
        toolCall: { name: "search_docs", args: { query: "pricing" } },
      });

      state = mapAgentStreamPartToSse({
        part: {
          type: "tool-call",
          toolCallId: "call-2",
          toolName: "search_docs",
          args: { query: "refunds" },
        },
        controller,
        encoder,
        emittedToolCalls,
        toolCallStartTimes,
        state,
      });
      expect(chunks).toHaveLength(1);
    });

    test("prefers part.args over part.input, falling back to empty object", () => {
      const { controller, encoder, chunks } = createTestController();
      let state = createInitialAgentEventState();
      const emittedToolCalls = new Set<string>();

      state = mapAgentStreamPartToSse({
        part: {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "tool_args",
          args: { a: 1 },
          input: { b: 2 },
        },
        controller,
        encoder,
        emittedToolCalls,
        toolCallStartTimes: new Map(),
        state,
      });
      expect(chunks[0].payload).toEqual({
        toolCall: { name: "tool_args", args: { a: 1 } },
      });

      state = mapAgentStreamPartToSse({
        part: {
          type: "tool-call",
          toolCallId: "call-2",
          toolName: "tool_input_only",
          input: { only: "input" },
        },
        controller,
        encoder,
        emittedToolCalls,
        toolCallStartTimes: new Map(),
        state,
      });
      expect(chunks[1].payload).toEqual({
        toolCall: { name: "tool_input_only", args: { only: "input" } },
      });

      state = mapAgentStreamPartToSse({
        part: {
          type: "tool-call",
          toolCallId: "call-3",
          toolName: "tool_no_args",
        },
        controller,
        encoder,
        emittedToolCalls,
        toolCallStartTimes: new Map(),
        state,
      });
      expect(chunks[2].payload).toEqual({
        toolCall: { name: "tool_no_args", args: {} },
      });
    });

    test("emits a successful tool-result with duration and http status", () => {
      const { controller, encoder, chunks } = createTestController();
      const toolCallStartTimes = new Map<string, number>([
        ["call-1", Date.now() - 25],
      ]);
      let state = createInitialAgentEventState();

      state = mapAgentStreamPartToSse({
        part: {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "search_docs",
          output: { hits: 3, httpStatus: 200 },
        },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes,
        state,
      });

      expect(state.lastToolError).toBeNull();
      expect(state.lastToolOutput).toEqual({ hits: 3, httpStatus: 200 });
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("toolResult");
      const toolResult = chunks[0].payload.toolResult as Record<
        string,
        unknown
      >;
      expect(toolResult.name).toBe("search_docs");
      expect(toolResult.success).toBe(true);
      expect(toolResult.output).toEqual({ hits: 3, httpStatus: 200 });
      expect(toolResult.httpStatus).toBe(200);
      expect(typeof toolResult.duration).toBe("number");
      expect(toolResult.duration).toBeGreaterThanOrEqual(0);
      expect("errorMessage" in toolResult).toBe(false);
    });

    test("emits a failed tool-result with errorMessage and updates lastToolError", () => {
      const { controller, encoder, chunks } = createTestController();
      let state = createInitialAgentEventState();

      state = mapAgentStreamPartToSse({
        part: {
          type: "tool-result",
          toolCallId: "call-err",
          toolName: "search_docs",
          output: { error: "timeout" },
        },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });

      expect(state.lastToolError).toBe("timeout");
      expect(state.lastToolOutput).toEqual({ error: "timeout" });
      const toolResult = chunks[0].payload.toolResult as Record<
        string,
        unknown
      >;
      expect(toolResult.success).toBe(false);
      expect(toolResult.errorMessage).toBe("timeout");
    });

    test("handles null tool-result output without crashing", () => {
      const { controller, encoder, chunks } = createTestController();
      let state = createInitialAgentEventState();

      state = mapAgentStreamPartToSse({
        part: {
          type: "tool-result",
          toolCallId: "call-null",
          toolName: "search_docs",
          output: null,
        },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });

      expect(state.lastToolError).toBeNull();
      expect(state.lastToolOutput).toBeNull();
      const toolResult = chunks[0].payload.toolResult as Record<
        string,
        unknown
      >;
      expect(toolResult.success).toBe(true);
      expect(toolResult.output).toBeNull();
    });

    test("finish-step increments stepCount and emits no SSE chunks", () => {
      const { controller, encoder, chunks } = createTestController();
      let state = createInitialAgentEventState();

      state = mapAgentStreamPartToSse({
        part: { type: "finish-step", finishReason: "stop" },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });
      expect(state.stepCount).toBe(1);

      state = mapAgentStreamPartToSse({
        part: { type: "finish-step", finishReason: "tool-calls" },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });
      expect(state.stepCount).toBe(2);
      expect(chunks).toHaveLength(0);
    });

    test("unknown part types are a no-op", () => {
      const { controller, encoder, chunks } = createTestController();
      const state = createInitialAgentEventState();
      const next = mapAgentStreamPartToSse({
        part: { type: "something-else" },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });
      expect(next).toEqual(state);
      expect(chunks).toHaveLength(0);
    });
  });

  describe("finalizeAgentEventState", () => {
    test("flushes a withheld bracket tail as plain text when not a token", () => {
      const { controller, encoder, chunks } = createTestController();
      let state = createInitialAgentEventState();

      state = mapAgentStreamPartToSse({
        part: { type: "text-delta", text: "Price is $5 [" },
        controller,
        encoder,
        emittedToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        state,
      });
      expect(state.stripState.tail).toBe("[");

      const finalized = finalizeAgentEventState(controller, encoder, state);
      expect(finalized.fullResponse).toBe("Price is $5 [");
      expect(state.stripState.tail).toBe("");
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.payload).toEqual({ text: "[" });
    });

    test("flushes a completed token stuck in tail without emitting text", () => {
      const { controller, encoder, chunks } = createTestController();
      const state = createInitialAgentEventState();
      state.stripState.tail = "[RESOLVED]";

      const finalized = finalizeAgentEventState(controller, encoder, state);
      expect(finalized.fullResponse).toBe("");
      expect(finalized.detectedInternalTokens).toEqual(["[RESOLVED]"]);
      expect(chunks).toHaveLength(0);
    });

    test("is a no-op on a clean state", () => {
      const { controller, encoder, chunks } = createTestController();
      const state = createInitialAgentEventState();
      const finalized = finalizeAgentEventState(controller, encoder, state);
      expect(finalized.fullResponse).toBe("");
      expect(finalized.detectedInternalTokens).toEqual([]);
      expect(chunks).toHaveLength(0);
    });
  });
});
