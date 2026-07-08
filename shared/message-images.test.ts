import { describe, expect, test } from "bun:test";
import {
  parseMessageImageUrls,
  serializeMessageImageUrls,
  shouldShowMessageContent,
} from "./message-images";

describe("shouldShowMessageContent", () => {
  test("hides empty and placeholder content", () => {
    expect(shouldShowMessageContent("")).toBe(false);
    expect(shouldShowMessageContent(null)).toBe(false);
    expect(shouldShowMessageContent(undefined)).toBe(false);
    expect(shouldShowMessageContent("Sent an image")).toBe(false);
    expect(shouldShowMessageContent("Sent images")).toBe(false);
  });

  test("shows real text", () => {
    expect(shouldShowMessageContent("Here you go")).toBe(true);
    expect(shouldShowMessageContent("Sent an image yesterday")).toBe(true);
  });
});

describe("parseMessageImageUrls", () => {
  test("returns empty for null/undefined/blank", () => {
    expect(parseMessageImageUrls(null)).toEqual([]);
    expect(parseMessageImageUrls(undefined)).toEqual([]);
    expect(parseMessageImageUrls("")).toEqual([]);
    expect(parseMessageImageUrls("   ")).toEqual([]);
  });

  test("wraps a legacy plain URL in an array", () => {
    expect(parseMessageImageUrls("/api/uploads/u1/a.png")).toEqual([
      "/api/uploads/u1/a.png",
    ]);
  });

  test("parses a JSON array of URLs", () => {
    expect(
      parseMessageImageUrls('["/api/uploads/u1/a.png","/api/uploads/u1/b.jpg"]'),
    ).toEqual(["/api/uploads/u1/a.png", "/api/uploads/u1/b.jpg"]);
  });

  test("drops non-string and empty entries from a JSON array", () => {
    expect(parseMessageImageUrls('["/a.png", 3, null, ""]')).toEqual(["/a.png"]);
  });

  test("treats malformed JSON starting with [ as a plain URL", () => {
    expect(parseMessageImageUrls("[not-json")).toEqual(["[not-json"]);
  });
});

describe("serializeMessageImageUrls", () => {
  test("returns null for an empty list", () => {
    expect(serializeMessageImageUrls([])).toBeNull();
    expect(serializeMessageImageUrls(["  "])).toBeNull();
  });

  test("stores a single URL as a plain string (legacy-compatible)", () => {
    expect(serializeMessageImageUrls(["/a.png"])).toBe("/a.png");
  });

  test("stores multiple URLs as a JSON array string", () => {
    expect(serializeMessageImageUrls(["/a.png", "/b.jpg"])).toBe(
      '["/a.png","/b.jpg"]',
    );
  });

  test("round-trips through parse", () => {
    for (const urls of [["/a.png"], ["/a.png", "/b.jpg", "/c.webp"]]) {
      expect(parseMessageImageUrls(serializeMessageImageUrls(urls))).toEqual(
        urls,
      );
    }
  });
});
