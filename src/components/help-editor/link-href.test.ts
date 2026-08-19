import { describe, expect, test } from "bun:test";
import { linkLabelFromHref, normalizeLinkHref } from "./link-href";

describe("normalizeLinkHref", () => {
  test("accepts https and fills in a missing scheme", () => {
    expect(normalizeLinkHref("https://example.com/docs")).toBe(
      "https://example.com/docs",
    );
    expect(normalizeLinkHref("example.com")).toBe("https://example.com/");
  });

  test("rejects empty, javascript, and incomplete values", () => {
    expect(normalizeLinkHref("")).toBeNull();
    expect(normalizeLinkHref("https://")).toBeNull();
    expect(normalizeLinkHref("javascript:alert(1)")).toBeNull();
  });
});

describe("linkLabelFromHref", () => {
  test("uses the hostname without www", () => {
    expect(linkLabelFromHref("https://www.example.com/path")).toBe("example.com");
  });
});
