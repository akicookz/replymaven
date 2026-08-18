import { fontFaceCss, resolveWidgetFont } from "../../shared/widget-fonts";

export function buildFontFaceCss(family: string | null | undefined): string | null {
  const font = resolveWidgetFont(family);
  if (!font || font.faces.length === 0) return null;
  return fontFaceCss(font);
}
