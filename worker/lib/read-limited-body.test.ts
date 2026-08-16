import { describe, expect, test } from "bun:test";
import { BodyTooLargeError, readLimitedBody } from "./read-limited-body";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Never ends. Stands in for a source that would buffer until the isolate dies. */
function endlessStream(): { stream: ReadableStream<Uint8Array>; pulls: () => number } {
  let pulls = 0;
  return {
    stream: new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    }),
    pulls: () => pulls,
  };
}

describe("readLimitedBody", () => {
  test("reads a body under the cap and preserves the bytes", async () => {
    const out = await readLimitedBody(
      streamOf([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]),
      100,
    );
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  test("returns empty for a null body", async () => {
    expect((await readLimitedBody(null, 100)).byteLength).toBe(0);
  });

  test("rejects on an honest oversized Content-Length without reading", async () => {
    const { stream, pulls } = endlessStream();
    await expect(readLimitedBody(stream, 10, "999999")).rejects.toThrow(
      BodyTooLargeError,
    );
    // ReadableStream primes its queue with one pull on construction, so 1 is
    // the floor here. The point is that nothing is consumed past that.
    expect(pulls()).toBeLessThanOrEqual(1);
  });

  test("rejects a body that exceeds the cap despite a lying Content-Length", async () => {
    await expect(
      readLimitedBody(
        streamOf([new Uint8Array(8), new Uint8Array(8)]),
        10,
        "4",
      ),
    ).rejects.toThrow(BodyTooLargeError);
  });

  test("stops pulling an endless stream instead of buffering it", async () => {
    const { stream, pulls } = endlessStream();
    await expect(readLimitedBody(stream, 4096)).rejects.toThrow(
      BodyTooLargeError,
    );
    // 1KB chunks against a 4KB cap: a handful of pulls, not unbounded.
    expect(pulls()).toBeLessThan(10);
  });

  test("accepts a body exactly at the cap", async () => {
    const out = await readLimitedBody(streamOf([new Uint8Array(10)]), 10);
    expect(out.byteLength).toBe(10);
  });

  test("ignores a missing or unparseable Content-Length", async () => {
    const out = await readLimitedBody(streamOf([new Uint8Array(3)]), 10, null);
    expect(out.byteLength).toBe(3);
    const out2 = await readLimitedBody(
      streamOf([new Uint8Array(3)]),
      10,
      "not-a-number",
    );
    expect(out2.byteLength).toBe(3);
  });
});
