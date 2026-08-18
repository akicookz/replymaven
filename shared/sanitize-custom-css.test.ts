import { describe, expect, test } from "bun:test";
import {
  findCustomCssViolation,
  sanitizeCustomCss,
} from "./sanitize-custom-css";

describe("findCustomCssViolation", () => {
  test("allows a class rule", () => {
    expect(
      findCustomCssViolation(".help-index-title { font-weight: 800; }"),
    ).toBeNull();
  });

  test("rejects @import", () => {
    expect(
      findCustomCssViolation('@import url("https://evil.example/x.css");'),
    ).toBe("CSS cannot use @import");
  });

  test("rejects url()", () => {
    expect(
      findCustomCssViolation(
        ".rm-header { background: url(https://evil.example/x.png); }",
      ),
    ).toBe("CSS cannot use url()");
  });
});

describe("sanitizeCustomCss", () => {
  test("returns trimmed CSS for a safe rule", () => {
    expect(sanitizeCustomCss("  .rm-header { font-weight: 700; }  ")).toBe(
      ".rm-header { font-weight: 700; }",
    );
  });

  test("returns null for @import", () => {
    expect(sanitizeCustomCss("@import url('https://evil.example');")).toBeNull();
  });
});
