import { expect, test } from "bun:test";
import { persistGuardedAiOutput } from "./persist-guarded-ai-output";

function createCapture(): {
  controller: ReadableStreamDefaultController;
  events: Record<string, unknown>[];
} {
  const events: Record<string, unknown>[] = [];
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
    events,
  };
}

test("protocol v1 releases final text only after guarded persistence", async () => {
  const capture = createCapture();
  const message = await persistGuardedAiOutput({
    controller: capture.controller,
    encoder: new TextEncoder(),
    streamProtocolVersion: 1,
    finalText: "Safe answer",
    persist: async () => ({ id: "message-1" }),
    getConversationStatusAfterFailure: async () => "active",
  });

  expect(message).toEqual({ id: "message-1" });
  expect(capture.events).toEqual([{ finalText: "Safe answer" }]);
});

test("protocol v2 invalidates provisional output when persistence loses ownership", async () => {
  const capture = createCapture();
  const message = await persistGuardedAiOutput({
    controller: capture.controller,
    encoder: new TextEncoder(),
    streamProtocolVersion: 2,
    finalText: "Unsafe partial answer",
    persist: async () => null,
    getConversationStatusAfterFailure: async () => "agent_replied",
  });

  expect(message).toBeNull();
  expect(capture.events).toEqual([
    {
      completed: {
        protocolVersion: 2,
        messageId: null,
        finalText: "",
        conversationStatus: "agent_replied",
      },
    },
  ]);
});
