import { type WidgetStatusPayload } from "../types";
import {
  createStreamingStripState,
  flushStreamingStripState,
  type InternalToken,
  stripInternalTokensStreaming,
  type StreamingStripState,
} from "./internal-tokens";

export interface AgentEventState {
  fullResponse: string;
  hadToolCalls: boolean;
  lastToolOutput: unknown;
  lastToolError: string | null;
  stepCount: number;
  stripState: StreamingStripState;
  detectedInternalTokens: InternalToken[];
}

export function createInitialAgentEventState(): AgentEventState {
  return {
    fullResponse: "",
    hadToolCalls: false,
    lastToolOutput: null,
    lastToolError: null,
    stepCount: 0,
    stripState: createStreamingStripState(),
    detectedInternalTokens: [],
  };
}

export function finalizeAgentEventState(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  state: AgentEventState,
): AgentEventState {
  const flushed = flushStreamingStripState(state.stripState);
  const nextState = { ...state };
  if (flushed.emit) {
    nextState.fullResponse += flushed.emit;
    emitSseEvent(controller, encoder, { text: flushed.emit });
  }
  if (flushed.tokens.length > 0) {
    nextState.detectedInternalTokens = [
      ...state.detectedInternalTokens,
      ...flushed.tokens,
    ];
  }
  return nextState;
}

export function emitSseEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  payload: Record<string, unknown>,
): void {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

export function emitStatusEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  status: WidgetStatusPayload,
): void {
  emitSseEvent(controller, encoder, { status });
}

export function mapAgentStreamPartToSse(options: {
  part: Record<string, unknown> & { type: string };
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  emittedToolCalls: Set<string>;
  toolCallStartTimes: Map<string, number>;
  state: AgentEventState;
}): AgentEventState {
  const { part, controller, encoder, emittedToolCalls, toolCallStartTimes } =
    options;
  const nextState = { ...options.state };

  if (part.type === "text-delta") {
    const delta = String(part.text ?? "");
    const result = stripInternalTokensStreaming(nextState.stripState, delta);
    if (result.emit) {
      nextState.fullResponse += result.emit;
      emitSseEvent(controller, encoder, { text: result.emit });
    }
    if (result.tokens.length > 0) {
      nextState.detectedInternalTokens = [
        ...nextState.detectedInternalTokens,
        ...result.tokens,
      ];
    }
    return nextState;
  }

  if (part.type === "tool-call") {
    nextState.hadToolCalls = true;
    const toolCallId = String(part.toolCallId ?? "");
    if (toolCallId) {
      toolCallStartTimes.set(toolCallId, Date.now());
    }

    const toolName = String(part.toolName ?? "");
    if (toolName && !emittedToolCalls.has(toolName)) {
      emittedToolCalls.add(toolName);
      const toolArgs = part.args ?? part.input ?? {};
      emitSseEvent(controller, encoder, {
        toolCall: {
          name: toolName,
          args: toolArgs,
        },
      });
    }

    return nextState;
  }

  if (part.type === "tool-result") {
    const output = (part.output as Record<string, unknown> | null) ?? null;
    const errorMessage = output?.error ? String(output.error) : null;
    const toolCallId = String(part.toolCallId ?? "");
    const startTime = toolCallId ? toolCallStartTimes.get(toolCallId) : null;
    const duration = startTime ? Date.now() - startTime : null;
    const httpStatus =
      output && typeof output.httpStatus === "number"
        ? output.httpStatus
        : undefined;

    nextState.lastToolOutput = output;
    nextState.lastToolError = errorMessage;

    emitSseEvent(controller, encoder, {
      toolResult: {
        name: String(part.toolName ?? ""),
        success: !errorMessage,
        ...(errorMessage ? { errorMessage } : {}),
        output,
        ...(httpStatus ? { httpStatus } : {}),
        ...(duration != null ? { duration } : {}),
      },
    });

    return nextState;
  }

  if (part.type === "finish-step") {
    nextState.stepCount += 1;
    return nextState;
  }

  return nextState;
}
