import { describe, expect, test } from "bun:test";
import {
  helpThemeBootScript,
  resolveHelpThemeIsDark,
  sanitizeHelpThemeDefault,
} from "./help-theme-default";

describe("sanitizeHelpThemeDefault", () => {
  test("keeps the three public values", () => {
    expect(sanitizeHelpThemeDefault("system")).toBe("system");
    expect(sanitizeHelpThemeDefault("light")).toBe("light");
    expect(sanitizeHelpThemeDefault("dark")).toBe("dark");
  });

  test("falls back to system", () => {
    expect(sanitizeHelpThemeDefault(null)).toBe("system");
    expect(sanitizeHelpThemeDefault("sepia")).toBe("system");
  });
});

describe("resolveHelpThemeIsDark", () => {
  test("visitor toggle wins", () => {
    expect(resolveHelpThemeIsDark("dark", "light", false)).toBe(true);
    expect(resolveHelpThemeIsDark("light", "dark", true)).toBe(false);
  });

  test("project default applies when nothing is stored", () => {
    expect(resolveHelpThemeIsDark(null, "dark", false)).toBe(true);
    expect(resolveHelpThemeIsDark(null, "light", true)).toBe(false);
    expect(resolveHelpThemeIsDark(null, "system", true)).toBe(true);
    expect(resolveHelpThemeIsDark(null, "system", false)).toBe(false);
  });
});

describe("helpThemeBootScript", () => {
  test("embeds only a sanitized literal", () => {
    const script = helpThemeBootScript("dark");
    expect(script).toContain('"dark"');
    expect(script).not.toContain("sepia");
  });
});
