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
  test("is the conversation id — one ping per conversation per session", () => {
    expect(pingKey({ id: "conv1" })).toBe("conv1");
  });

  test("ignores updatedAt so later activity cannot re-ping", () => {
    expect(pingKey({ id: "conv1", updatedAt: 123 })).toBe(
      pingKey({ id: "conv1", updatedAt: 999 }),
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

  test("an item re-entering with a new updatedAt does NOT ping again", () => {
    const bumped = { id: "a", updatedAt: 99 };
    const seen = new Set([pingKey(items[0])]);
    expect(selectFreshItems([bumped], seen)).toEqual([]);
  });

  test("returns empty when everything has been seen", () => {
    const seen = new Set(items.map(pingKey));
    expect(selectFreshItems(items, seen)).toEqual([]);
  });
});
