import { WIDGET_FONTS } from "../../shared/widget-fonts";

// Loadable fonts from the shared registry (excludes the system-font option,
// which has no stylesheet — the helpdesk falls back to its default for it).
const FONT_URLS = new Map(
  WIDGET_FONTS.filter((f) => f.url !== null).map((f) => [f.value, f.url as string]),
);

export function isAllowedFont(family: string): boolean {
  return FONT_URLS.has(family);
}

export function buildFontLink(family: string | null | undefined): string | null {
  if (!family) return null;
  return FONT_URLS.get(family) ?? null;
}
