import { describe, expect, test } from "bun:test";
import {
  MAX_PAGE_CONTEXT_ENTRIES,
  MAX_PAGE_CONTEXT_KEY_LENGTH,
  MAX_PAGE_CONTEXT_VALUE_LENGTH,
  sanitizePageContext,
} from "./page-context";

describe("page context sanitizer", () => {
  test("keeps strings and converts the primitives hosts actually pass", () => {
    expect(sanitizePageContext({
      page: "Home",
      sites: 8,
      ratio: 1.5,
      trial: true,
      dismissed: false,
    })).toEqual({
      page: "Home",
      sites: "8",
      ratio: "1.5",
      trial: "true",
      dismissed: "false",
    });
  });

  test("drops values that carry no readable text", () => {
    expect(sanitizePageContext({
      keep: "yes",
      nothing: null,
      missing: undefined,
      nested: { a: 1 },
      list: [1, 2],
      broken: Number.NaN,
      endless: Number.POSITIVE_INFINITY,
      fn: () => "no",
    })).toEqual({ keep: "yes" });
  });

  test("drops unusable keys and truncates long values", () => {
    const context = sanitizePageContext({
      "": "empty key",
      ["k".repeat(MAX_PAGE_CONTEXT_KEY_LENGTH + 1)]: "long key",
      ["k".repeat(MAX_PAGE_CONTEXT_KEY_LENGTH)]: "exact key",
      long: "v".repeat(MAX_PAGE_CONTEXT_VALUE_LENGTH + 50),
    });
    expect(Object.keys(context)).toEqual([
      "k".repeat(MAX_PAGE_CONTEXT_KEY_LENGTH),
      "long",
    ]);
    expect(context.long).toHaveLength(MAX_PAGE_CONTEXT_VALUE_LENGTH);
  });

  test("caps the entry count and ignores non-object input", () => {
    const many = Object.fromEntries(
      Array.from(
        { length: MAX_PAGE_CONTEXT_ENTRIES + 10 },
        (_, index) => [`key-${index}`, String(index)],
      ),
    );
    const capped = sanitizePageContext(many);
    expect(Object.keys(capped)).toHaveLength(MAX_PAGE_CONTEXT_ENTRIES);
    expect(capped["key-0"]).toBe("0");
    expect(capped[`key-${MAX_PAGE_CONTEXT_ENTRIES}`]).toBeUndefined();

    for (const value of [null, undefined, "home", 4, [1, 2], () => ({})]) {
      expect(sanitizePageContext(value)).toEqual({});
    }
  });

  test("is idempotent, so a sanitized context always passes again", () => {
    const once = sanitizePageContext({
      page: "Home",
      sites: 8,
      long: "v".repeat(MAX_PAGE_CONTEXT_VALUE_LENGTH + 50),
    });
    expect(sanitizePageContext(once)).toEqual(once);
  });
});
