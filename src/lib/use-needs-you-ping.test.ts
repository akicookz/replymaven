import { describe, expect, test } from "bun:test";
import { isFirstPollFor, pingKey, selectFreshItems } from "./use-needs-you-ping";

describe("isFirstPollFor", () => {
  test("null (no prior watermark) is a first poll", () => {
    expect(isFirstPollFor(null)).toBe(true);
  });

  test("stored zero is a first poll", () => {
    expect(isFirstPollFor("0")).toBe(true);
  });

  test("garbage value behaves like no prior watermark", () => {
    expect(isFirstPollFor("not-a-number")).toBe(true);
  });

  test("a real prior watermark is not a first poll", () => {
    expect(isFirstPollFor("1719900000000")).toBe(false);
  });
});

describe("pingKey", () => {
  test("combines id and updatedAt", () => {
    expect(pingKey({ id: "conv1", updatedAt: 123 })).toBe("conv1:123");
  });

  test("distinguishes ids that could collide under naive concatenation", () => {
    // "abc1" + 23 and "abc" + 123 would both be "abc123" without a separator.
    expect(pingKey({ id: "abc1", updatedAt: 23 })).not.toBe(
      pingKey({ id: "abc", updatedAt: 123 }),
    );
  });
});

describe("selectFreshItems", () => {
  const items = [
    { id: "a", updatedAt: 1 },
    { id: "b", updatedAt: 2 },
  ];

  test("returns all items when nothing has been seen", () => {
    expect(selectFreshItems(items, new Set())).toEqual(items);
  });

  test("filters out items already in the seen set", () => {
    const seen = new Set([pingKey(items[0])]);
    expect(selectFreshItems(items, seen)).toEqual([items[1]]);
  });

  test("an item re-entering with a new updatedAt pings again", () => {
    const bumped = { id: "a", updatedAt: 99 };
    const seen = new Set([pingKey(items[0])]);
    expect(selectFreshItems([bumped], seen)).toEqual([bumped]);
  });

  test("returns empty when everything has been seen", () => {
    const seen = new Set(items.map(pingKey));
    expect(selectFreshItems(items, seen)).toEqual([]);
  });
});
