import { describe, expect, test } from "bun:test";
import { shouldReloadForChunkError } from "./chunk-reload";

function makeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    read: (key: string) => data.get(key) ?? null,
    write: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("shouldReloadForChunkError", () => {
  test("reloads on first failure and records the timestamp", () => {
    const store = makeStore();
    expect(
      shouldReloadForChunkError({ now: 1000, read: store.read, write: store.write }),
    ).toBe(true);
    expect(store.data.get("rm:chunk-reload-at")).toBe("1000");
  });

  test("does not reload again within the guard window (loop protection)", () => {
    const store = makeStore();
    shouldReloadForChunkError({ now: 1000, read: store.read, write: store.write });
    expect(
      shouldReloadForChunkError({ now: 5000, read: store.read, write: store.write }),
    ).toBe(false);
  });

  test("reloads again once the guard window has elapsed (later deploy)", () => {
    const store = makeStore();
    shouldReloadForChunkError({ now: 1000, read: store.read, write: store.write });
    expect(
      shouldReloadForChunkError({
        now: 1000 + 10_000,
        read: store.read,
        write: store.write,
      }),
    ).toBe(true);
  });

  test("treats a missing/garbage stored value as no prior reload", () => {
    const store = makeStore({ "rm:chunk-reload-at": "not-a-number" });
    expect(
      shouldReloadForChunkError({ now: 2000, read: store.read, write: store.write }),
    ).toBe(true);
    expect(store.data.get("rm:chunk-reload-at")).toBe("2000");
  });
});
