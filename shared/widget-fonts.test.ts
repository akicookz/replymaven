import { describe, expect, test } from "bun:test";
import {
  WIDGET_FONTS,
  fontFaceCss,
  isCatalogFont,
  resolveWidgetFont,
} from "./widget-fonts";

function coversWeight(font: NonNullable<ReturnType<typeof resolveWidgetFont>>, weight: number): boolean {
  return font.faces.some((face) => {
    if (typeof face.weight === "number") return face.weight === weight;
    return face.weight[0] <= weight && weight <= face.weight[1];
  });
}

describe("widget font catalog", () => {
  test("picker has Instrument Sans and no Lato", () => {
    const values = WIDGET_FONTS.map((font) => font.value);
    expect(values).toContain("Instrument Sans");
    expect(values).not.toContain("Lato");
  });

  test("Lato alias resolves to Instrument Sans", () => {
    expect(resolveWidgetFont("Lato")?.value).toBe("Instrument Sans");
    expect(isCatalogFont("Lato")).toBe(true);
  });

  test("system-ui has no faces and is not a catalog file font", () => {
    const font = resolveWidgetFont("system-ui");
    expect(font?.faces).toEqual([]);
    expect(isCatalogFont("system-ui")).toBe(false);
  });

  test("every picker font except system-ui covers 400 and 600", () => {
    for (const font of WIDGET_FONTS) {
      if (font.faces.length === 0) continue;
      expect(coversWeight(font, 400)).toBe(true);
      expect(coversWeight(font, 600)).toBe(true);
    }
  });

  test("Satoshi interpolates 600 from a variable face, not a 700 file", () => {
    const satoshi = resolveWidgetFont("Satoshi");
    expect(satoshi).not.toBeNull();
    expect(satoshi!.faces).toHaveLength(1);
    expect(satoshi!.faces[0]?.weight).toEqual([300, 900]);
  });

  test("Poppins ships a static 600 cut", () => {
    const poppins = resolveWidgetFont("Poppins");
    expect(poppins?.faces.some((face) => face.weight === 600)).toBe(true);
  });

  test("fontFaceCss emits a 400 700 range for Inter", () => {
    const inter = resolveWidgetFont("Inter");
    expect(inter).not.toBeNull();
    const css = fontFaceCss(inter!);
    expect(css).toContain('font-family:"Inter"');
    expect(css).toContain("font-weight:400 700");
    expect(css).toContain("format(\"woff2\")");
  });

  test("Switzer is a picker font with a variable face", () => {
    const switzer = resolveWidgetFont("Switzer");
    expect(switzer).not.toBeNull();
    expect(switzer!.faces).toHaveLength(1);
    expect(switzer!.faces[0]?.weight).toEqual([100, 900]);
    expect(isCatalogFont("Switzer")).toBe(true);
  });
});
