import { describe, expect, test } from "bun:test";
import { isFirstPollFor, pingKey, selectFreshItems } from "./use-needs-you-ping";

describe("isFirstPollFor", () => {
  test("distinguishes an initial poll from a stored watermark", () => {
    expect(isFirstPollFor(null)).toBe(true);
    expect(isFirstPollFor("1719900000000")).toBe(false);
  });
});

describe("selectFreshItems", () => {
  const items = [
    { id: "a", updatedAt: 1 },
    { id: "b", updatedAt: 2 },
  ];

  test("an item re-entering with a new updatedAt does NOT ping again", () => {
    const bumped = { id: "a", updatedAt: 99 };
    const seen = new Set([pingKey(items[0])]);
    expect(selectFreshItems([bumped], seen)).toEqual([]);
  });
});
