import { fontFaceCss, resolveWidgetFont } from "../../shared/widget-fonts";

/** Private family name, so the widget's own @font-face for the same font cannot take over page text. */
export function helpFontFamily(fontName: string): string {
  return `rm-help ${fontName}`;
}

// Preloaded + optional: brand font from the first paint, or the fallback for that page; never a late swap.
export function buildFontFaceCss(family: string | null | undefined): string | null {
  const font = resolveWidgetFont(family);
  if (!font || font.faces.length === 0) return null;
  return fontFaceCss(font, {
    display: "optional",
    family: helpFontFamily(font.value),
  });
}

export function buildFontPreloadUrls(family: string | null | undefined): string[] {
  const font = resolveWidgetFont(family);
  return font ? font.faces.map((face) => face.src) : [];
}
