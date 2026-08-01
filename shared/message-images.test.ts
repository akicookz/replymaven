import { describe, expect, test } from "bun:test";
import { parseMessageImageUrls, serializeMessageImageUrls } from "./message-images";

describe("parseMessageImageUrls", () => {
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
});

describe("serializeMessageImageUrls", () => {
  test("stores a single URL as a plain string (legacy-compatible)", () => {
    expect(serializeMessageImageUrls(["/a.png"])).toBe("/a.png");
  });

  test("stores multiple URLs as a JSON array string", () => {
    expect(serializeMessageImageUrls(["/a.png", "/b.jpg"])).toBe(
      '["/a.png","/b.jpg"]',
    );
  });
});
