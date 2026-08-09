import { afterEach, expect, test } from "bun:test";
import { createWidgetSseResponse } from "./create-widget-sse-response";

const originalIdentityTransformStream = globalThis.IdentityTransformStream;

afterEach(() => {
  Object.defineProperty(globalThis, "IdentityTransformStream", {
    configurable: true,
    writable: true,
    value: originalIdentityTransformStream,
  });
});

test("cancelling the browser response aborts the owning turn", async () => {
  Object.defineProperty(globalThis, "IdentityTransformStream", {
    configurable: true,
    writable: true,
    value: TransformStream,
  });
  let resolveStart: (() => void) | undefined;
  const startFinished = new Promise<void>((resolve) => {
    resolveStart = resolve;
  });
  const cancelReasons: unknown[] = [];
  const response = createWidgetSseResponse(
    async (controller, encoder) => {
      controller.enqueue(encoder.encode("data: {\"status\":\"ready\"}\n\n"));
      await startFinished;
    },
    {
      onCancel(reason) {
        cancelReasons.push(reason);
        resolveStart?.();
      },
    },
  );
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  await reader?.read();

  const reason = new DOMException("Visitor disconnected", "AbortError");
  await reader?.cancel(reason);

  expect(cancelReasons).toEqual([reason]);
});
