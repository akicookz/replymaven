import { describe, expect, test } from "bun:test";
import { parseSystemKind, systemEventDot } from "./system-events";

describe("parseSystemKind", () => {
  test("parses a review_summary sources payload", () => {
    expect(parseSystemKind(JSON.stringify({ systemKind: "review_summary" }))).toBe(
      "review_summary",
    );
  });

  test("parses other known kinds", () => {
    expect(parseSystemKind(JSON.stringify({ systemKind: "flagged" }))).toBe("flagged");
    expect(parseSystemKind(JSON.stringify({ systemKind: "drafted" }))).toBe("drafted");
  });

  test("returns null for missing sources", () => {
    expect(parseSystemKind(null)).toBeNull();
    expect(parseSystemKind(undefined)).toBeNull();
    expect(parseSystemKind("")).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    expect(parseSystemKind("not json")).toBeNull();
  });

  test("returns null when systemKind key is absent", () => {
    expect(parseSystemKind(JSON.stringify({ other: "x" }))).toBeNull();
  });
});

describe("systemEventDot", () => {
  test("review_summary maps to the orange dot", () => {
    expect(systemEventDot("review_summary")).toBe("bg-dot-orange");
  });

  test("flagged maps to the orange dot", () => {
    expect(systemEventDot("flagged")).toBe("bg-dot-orange");
  });

  test("unknown/null kind falls back to gray", () => {
    expect(systemEventDot(null)).toBe("bg-dot-gray");
  });
});
