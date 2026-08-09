import { expect, test } from "bun:test";
import { persistGuardedAiOutput } from "./persist-guarded-ai-output";

function createDeferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolvePromise: (value: Value) => void = () => {};
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

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
    abortSignal: undefined,
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
    abortSignal: undefined,
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

test("cancellation during a successful persist suppresses v1 text and callbacks", async () => {
  const capture = createCapture();
  const persisted = createDeferred<{ id: string }>();
  const abortController = new AbortController();
  let callbackMessage: { id: string } | null = null;
  const result = persistGuardedAiOutput({
    controller: capture.controller,
    encoder: new TextEncoder(),
    streamProtocolVersion: 1,
    finalText: "Unsafe answer",
    abortSignal: abortController.signal,
    persist: async () => persisted.promise,
    getConversationStatusAfterFailure: async () => "active",
    onPersisted(message) {
      callbackMessage = message;
    },
  });

  abortController.abort(
    new DOMException("private persistence abort", "AbortError"),
  );
  persisted.resolve({ id: "message-1" });

  await expect(result).rejects.toThrow("The Maven turn was cancelled.");
  expect(callbackMessage).toBeNull();
  expect(capture.events).toEqual([]);
  expect(JSON.stringify(capture.events)).not.toContain(
    "private persistence abort",
  );
});

test("cancellation during the latest-status read suppresses null completion", async () => {
  const capture = createCapture();
  const latestStatus = createDeferred<"agent_replied">();
  const abortController = new AbortController();
  let resolveStatusStarted = () => {};
  const statusStarted = new Promise<void>((resolve) => {
    resolveStatusStarted = resolve;
  });
  const result = persistGuardedAiOutput({
    controller: capture.controller,
    encoder: new TextEncoder(),
    streamProtocolVersion: 2,
    finalText: "Unsafe answer",
    abortSignal: abortController.signal,
    persist: async () => null,
    async getConversationStatusAfterFailure() {
      resolveStatusStarted();
      return latestStatus.promise;
    },
  });

  await statusStarted;
  abortController.abort(
    new DOMException("private status abort", "AbortError"),
  );
  latestStatus.resolve("agent_replied");

  await expect(result).rejects.toThrow("The Maven turn was cancelled.");
  expect(capture.events).toEqual([]);
  expect(JSON.stringify(capture.events)).not.toContain("private status abort");
});
