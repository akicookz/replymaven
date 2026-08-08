import { type WidgetStatusPayload } from "../types";
import { type SourceReference } from "../../services/resource-service";
import {
  createStreamingStripState,
  type InternalToken,
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

export interface WidgetCompletedPayload {
  protocolVersion: 2;
  messageId: string | null;
  finalText: string;
  conversationStatus:
    | "active"
    | "waiting_agent"
    | "agent_replied"
    | "closed";
  sources?: SourceReference[];
}

export type MavenBrowserEvent =
  | { text: string }
  | {
      status: {
        phase: "tool";
        message: "Checking project information";
      };
    };

function readPartType(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const type = (part as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

export async function* mapAgentEventsToSse(
  parts: Iterable<unknown> | AsyncIterable<unknown>,
): AsyncGenerator<MavenBrowserEvent> {
  for await (const part of parts) {
    const type = readPartType(part);
    if (type === "text-delta") {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text) {
        yield { text };
      }
      continue;
    }

    if (type === "tool-call") {
      yield {
        status: {
          phase: "tool",
          message: "Checking project information",
        },
      };
    }
  }
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

export function emitCompletedEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  payload: WidgetCompletedPayload,
): void {
  emitSseEvent(controller, encoder, { completed: payload });
}
