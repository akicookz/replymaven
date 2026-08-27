import { describe, expect, test } from "bun:test";
import {
  widgetRadiusPreset,
  widgetRadiusStoredPx,
  widgetRadiusTokens,
} from "./widget-radius";

describe("widget radius presets", () => {
  test("maps stored px to Sharp / Rounded / Pill", () => {
    expect(widgetRadiusPreset(0)).toBe("sharp");
    expect(widgetRadiusPreset(12)).toBe("rounded");
    expect(widgetRadiusPreset(16)).toBe("pill");
  });

  test("stores one px per picker value", () => {
    expect(widgetRadiusStoredPx("sharp")).toBe(0);
    expect(widgetRadiusStoredPx("rounded")).toBe(12);
    expect(widgetRadiusStoredPx("pill")).toBe(16);
  });

  test("scales window / card / control by surface size", () => {
    expect(widgetRadiusTokens(0)).toEqual({ window: 0, card: 0, control: 0 });
    expect(widgetRadiusTokens(12)).toEqual({
      window: 16,
      card: 12,
      control: 8,
    });
    expect(widgetRadiusTokens(16)).toEqual({
      window: 20,
      card: 16,
      control: 999,
    });
  });
});
