export function createWidgetSseResponse(
  start: (
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
  ) => Promise<void>,
): Response {
  const { readable, writable } = new IdentityTransformStream();

  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const proxy: ReadableStreamDefaultController = {
    enqueue(chunk: Uint8Array) {
      writer.write(chunk);
    },
    close() {
      writer.close();
    },
    error(e: unknown) {
      writer.abort(e);
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
      } catch {}
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
