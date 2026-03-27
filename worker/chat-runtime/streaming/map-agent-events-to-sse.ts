import { type WidgetStatusPayload } from "../types";

export interface AgentEventState {
  fullResponse: string;
  hadToolCalls: boolean;
  lastToolOutput: unknown;
  lastToolError: string | null;
  stepCount: number;
}

export function createInitialAgentEventState(): AgentEventState {
  return {
    fullResponse: "",
    hadToolCalls: false,
    lastToolOutput: null,
    lastToolError: null,
    stepCount: 0,
  };
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
    nextState.fullResponse += String(part.text ?? "");
    emitSseEvent(controller, encoder, { text: String(part.text ?? "") });
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
