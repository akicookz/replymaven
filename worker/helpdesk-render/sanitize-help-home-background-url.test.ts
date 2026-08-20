import { describe, expect, test } from "bun:test";
import {
  helpHomeBackgroundImageCss,
  sanitizeHelpHomeBackgroundFit,
  sanitizeHelpHomeBackgroundPosition,
  sanitizeHelpHomeBackgroundUrl,
} from "./sanitize-help-home-background-url";

describe("sanitizeHelpHomeBackgroundUrl", () => {
  test("accepts an upload path", () => {
    expect(
      sanitizeHelpHomeBackgroundUrl("/api/uploads/user-1/grid.png"),
    ).toBe("/api/uploads/user-1/grid.png");
  });

  test("rejects anything that is not an upload path", () => {
    expect(sanitizeHelpHomeBackgroundUrl("https://cdn.example/grid.png")).toBeNull();
    expect(sanitizeHelpHomeBackgroundUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeHelpHomeBackgroundUrl("/api/uploads/../secret.png")).toBeNull();
    expect(sanitizeHelpHomeBackgroundUrl('/api/uploads/foo")')).toBeNull();
    expect(sanitizeHelpHomeBackgroundUrl("")).toBeNull();
    expect(sanitizeHelpHomeBackgroundUrl(null)).toBeNull();
  });
});

describe("sanitizeHelpHomeBackgroundPosition", () => {
  test("accepts X% Y%", () => {
    expect(sanitizeHelpHomeBackgroundPosition("12% 88%")).toBe("12% 88%");
    expect(sanitizeHelpHomeBackgroundPosition("100% 0%")).toBe("100% 0%");
  });

  test("rejects other values", () => {
    expect(sanitizeHelpHomeBackgroundPosition("left top")).toBeNull();
    expect(sanitizeHelpHomeBackgroundPosition("12% 188%")).toBeNull();
    expect(sanitizeHelpHomeBackgroundPosition(null)).toBeNull();
  });
});

describe("sanitizeHelpHomeBackgroundFit", () => {
  test("keeps contain and repeat, defaults to cover", () => {
    expect(sanitizeHelpHomeBackgroundFit("contain")).toBe("contain");
    expect(sanitizeHelpHomeBackgroundFit("repeat")).toBe("repeat");
    expect(sanitizeHelpHomeBackgroundFit("cover")).toBe("cover");
    expect(sanitizeHelpHomeBackgroundFit("zoom")).toBe("cover");
    expect(sanitizeHelpHomeBackgroundFit(null)).toBe("cover");
  });
});

describe("helpHomeBackgroundImageCss", () => {
  test("quotes the url and emits fit tokens", () => {
    expect(
      helpHomeBackgroundImageCss({
        url: "/api/uploads/user-1/grid.png",
        position: "20% 10%",
        fit: "contain",
      }),
    ).toBe(
      '.help-home-bg{--help-home-bg-image:url("/api/uploads/user-1/grid.png");--help-home-bg-position:20% 10%;--help-home-bg-size:contain;--help-home-bg-repeat:no-repeat}',
    );
  });

  test("tiles with auto size", () => {
    expect(
      helpHomeBackgroundImageCss({
        url: "/api/uploads/user-1/grid.png",
        fit: "repeat",
      }),
    ).toContain("--help-home-bg-size:auto");
    expect(
      helpHomeBackgroundImageCss({
        url: "/api/uploads/user-1/grid.png",
        fit: "repeat",
      }),
    ).toContain("--help-home-bg-repeat:repeat");
  });
});
