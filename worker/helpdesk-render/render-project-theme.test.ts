import { describe, expect, test } from "bun:test";
import { renderProjectTheme, sanitizeFontName } from "./render-project-theme";
import type { WidgetConfigRow } from "../db/schema";

function themeForFont(fontFamily: string): string {
  return renderProjectTheme({ fontFamily } as WidgetConfigRow);
}

describe("sanitizeFontName", () => {
  test("maps stored Lato to Instrument Sans", () => {
    expect(sanitizeFontName("Lato")).toBe("Instrument Sans");
  });

  test("rejects system-ui so help uses the same stack as the widget", () => {
    expect(sanitizeFontName("system-ui")).toBeNull();
  });
});

describe("renderProjectTheme fonts", () => {
  test("system-ui uses one system stack for body and headings", () => {
    const css = themeForFont("system-ui");
    expect(css).toContain("--font-sans: system-ui, sans-serif;");
    expect(css).toContain("--font-heading: system-ui, sans-serif;");
    expect(css).not.toContain('"Inter"');
    expect(css).not.toContain('"Switzer"');
  });

  test("Switzer drives both body and headings", () => {
    const css = themeForFont("Switzer");
    expect(css).toContain('--font-sans: "Switzer", system-ui, sans-serif;');
    expect(css).toContain('--font-heading: "Switzer", system-ui, sans-serif;');
  });
});
