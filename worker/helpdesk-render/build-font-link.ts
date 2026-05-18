export const FONT_ALLOWLIST: Record<string, string> = {
  Inter: "Inter:wght@400;500;600;700",
  Manrope: "Manrope:wght@400;500;600;700",
  "Plus Jakarta Sans": "Plus+Jakarta+Sans:wght@400;500;600;700",
  "DM Sans": "DM+Sans:wght@400;500;600;700",
  Geist: "Geist:wght@400;500;600;700",
  Satoshi: "Satoshi:wght@400;500;600;700",
  Outfit: "Outfit:wght@400;500;600;700",
  "Work Sans": "Work+Sans:wght@400;500;600;700",
  "IBM Plex Sans": "IBM+Plex+Sans:wght@400;500;600;700",
  Lora: "Lora:wght@400;500;600;700",
  "Playfair Display": "Playfair+Display:wght@400;500;600;700",
  "Source Sans 3": "Source+Sans+3:wght@400;500;600;700",
  Nunito: "Nunito:wght@400;500;600;700",
  Poppins: "Poppins:wght@400;500;600;700",
};

export function buildFontLink(family: string | null | undefined): string | null {
  if (!family) return null;
  if (!Object.hasOwn(FONT_ALLOWLIST, family)) return null;
  return `https://fonts.googleapis.com/css2?family=${FONT_ALLOWLIST[family]}&display=swap`;
}
