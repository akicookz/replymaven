/**
 * Read a response/request body into memory, aborting once it exceeds `maxBytes`.
 *
 * `await response.arrayBuffer()` buffers the whole body before any size check
 * can run, so a caller-supplied URL or an oversized upload can exhaust the
 * Worker's memory limit and kill the isolate before the check is reached.
 * Content-Length is only a hint: it is absent on chunked bodies and a client
 * can simply lie, so the running total is what actually enforces the cap.
 */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Body exceeds the ${maxBytes} byte limit`);
    this.name = "BodyTooLargeError";
  }
}

export async function readLimitedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  declaredLength?: string | null,
): Promise<Uint8Array> {
  // Cheap rejection when the sender is honest about an oversized body.
  const declared = Number(declaredLength ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError(maxBytes);
  }
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
