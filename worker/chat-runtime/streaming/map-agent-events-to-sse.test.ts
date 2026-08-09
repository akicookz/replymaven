import { describe, expect, test } from "bun:test";
import {
  emitCompletedEvent,
  emitSseEvent,
  emitStatusEvent,
  mapAgentEventsToSse,
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

describe("Maven browser event mapping", () => {
  test("terminalizes an AI SDK abort after tool activity and partial text", async () => {
    const events: Record<string, unknown>[] = [];
    const parts = [
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "lookup_account",
        input: { accountId: "private-account" },
      },
      { type: "text-delta", id: "text-1", text: "Partial answer" },
      { type: "abort", reason: "private disconnect reason" },
    ];

    async function collectEvents(): Promise<void> {
      for await (const event of mapAgentEventsToSse(parts)) {
        events.push(event);
      }
    }

    await expect(collectEvents()).rejects.toThrow("The Maven turn was cancelled.");
    expect(events).toEqual([
      {
        status: {
          phase: "tool",
          message: "Checking project information",
        },
      },
      { text: "Partial answer" },
    ]);
    expect(JSON.stringify(events)).not.toContain("private disconnect reason");
  });

  test("keeps text and generic tool status while dropping all private payloads", async () => {
    const privateParts = [
      {
        type: "reasoning-delta",
        id: "reasoning-1",
        text: "private chain of thought",
        providerMetadata: { secretReasoningId: "reasoning-secret" },
      },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "lookup_account",
        input: { accountId: "private-account" },
        providerMetadata: { requestId: "provider-secret" },
      },
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "lookup_account",
        output: { balance: 500, token: "private-result" },
      },
      {
        type: "raw",
        rawValue: { unrecognizedSecret: "raw-secret" },
      },
      {
        type: "text-delta",
        id: "text-1",
        text: "Your account is active.",
        providerMetadata: { responseId: "provider-text-secret" },
      },
    ];
    const events: Record<string, unknown>[] = [];

    for await (const event of mapAgentEventsToSse(privateParts)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        status: {
          phase: "tool",
          message: "Checking project information",
        },
      },
      { text: "Your account is active." },
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("private-account");
    expect(serialized).not.toContain("private-result");
    expect(serialized).not.toContain("chain of thought");
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("raw-secret");
  });
});
