interface WidgetSseResponseOptions {
  onCancel?(reason: unknown): void;
}

export function createWidgetSseResponse(
  start: (
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
  ) => Promise<void>,
  options: WidgetSseResponseOptions = {},
): Response {
  const { readable, writable } = new IdentityTransformStream();

  const writer = writable.getWriter();
  const reader = readable.getReader();
  const encoder = new TextEncoder();

  const proxy: ReadableStreamDefaultController = {
    enqueue(chunk: Uint8Array) {
      void writer.write(chunk).catch(() => {});
    },
    close() {
      void writer.close().catch(() => {});
    },
    error(e: unknown) {
      void writer.abort(e).catch(() => {});
    },
    get desiredSize() {
      return writer.desiredSize;
    },
  } as unknown as ReadableStreamDefaultController;

  (async () => {
    try {
      await start(proxy, encoder);
    } finally {
      try {
        proxy.close();
      } catch {
        // A disconnected reader may already have closed the writer.
      }
    }
  })();

  const responseBody = new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      options.onCancel?.(reason);
      await reader.cancel(reason);
    },
  });

  return new Response(responseBody, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
