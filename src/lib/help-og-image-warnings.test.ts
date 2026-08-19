import { describe, expect, test } from "bun:test";
import {
  dimensionOgImageWarnings,
  sizeOgImageWarnings,
  staticOgImageWarnings,
  typeOgImageWarnings,
} from "./help-og-image-warnings";

describe("staticOgImageWarnings", () => {
  test("accepts a normal jpeg URL", () => {
    expect(
      staticOgImageWarnings("https://cdn.example/share.jpg"),
    ).toEqual([]);
  });

  test("flags SVG and data URLs", () => {
    const svg = staticOgImageWarnings("https://cdn.example/mark.svg");
    expect(svg.some((w) => w.includes("SVG"))).toBe(true);
    const data = staticOgImageWarnings(
      "data:image/png;base64,aaaa",
    );
    expect(data.some((w) => w.includes("Data URLs"))).toBe(true);
  });

  test("flags unsupported schemes", () => {
    const warnings = staticOgImageWarnings("ftp://cdn.example/a.png");
    expect(warnings.some((w) => w.includes("https"))).toBe(true);
  });
});

describe("dimensionOgImageWarnings", () => {
  test("flags a small square", () => {
    const warnings = dimensionOgImageWarnings(200, 200);
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("accepts 1200×630", () => {
    expect(dimensionOgImageWarnings(1200, 630)).toEqual([]);
  });
});

describe("size and type warnings", () => {
  test("flags a large file", () => {
    expect(sizeOgImageWarnings(9 * 1024 * 1024).length).toBe(1);
  });

  test("flags svg content type", () => {
    expect(typeOgImageWarnings("image/svg+xml").length).toBe(1);
  });
});
