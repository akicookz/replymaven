import { describe, expect, test } from "bun:test";
import {
  emitCompletedEvent,
  emitSseEvent,
  emitStatusEvent,
} from "./map-agent-events-to-sse";

function createTestStream(): {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  events: Record<string, unknown>[];
} {
  const events: Record<string, unknown>[] = [];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const controller = {
    enqueue(chunk: Uint8Array) {
      const raw = decoder.decode(chunk);
      expect(raw).toMatch(/^data: .+\n\n$/);
      events.push(JSON.parse(raw.slice(6, -2)) as Record<string, unknown>);
    },
  } as unknown as ReadableStreamDefaultController;
  return { controller, encoder, events };
}

describe("SSE protocol envelopes", () => {
  test("writes SSE-formatted JSON payload", () => {
    const { controller, encoder, events } = createTestStream();

    emitSseEvent(controller, encoder, { hello: "world" });

    expect(events).toEqual([{ hello: "world" }]);
  });

  test("wraps status payload in a status envelope", () => {
    const { controller, encoder, events } = createTestStream();

    emitStatusEvent(controller, encoder, {
      phase: "thinking",
      message: "Looking that up...",
    });

    expect(events).toEqual([
      { status: { phase: "thinking", message: "Looking that up..." } },
    ]);
  });

  test("emits one versioned persisted completion envelope", () => {
    const { controller, encoder, events } = createTestStream();
    const completed = {
      protocolVersion: 2 as const,
      messageId: "message-1",
      finalText: "Glad I could help.",
      conversationStatus: "closed" as const,
    };

    emitCompletedEvent(controller, encoder, completed);

    expect(events).toEqual([{ completed }]);
  });
});
