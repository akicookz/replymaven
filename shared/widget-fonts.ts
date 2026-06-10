// Single source of truth for widget font options. Used by the embed widget
// (widget/index.ts), the dashboard widget settings, and onboarding.

export interface WidgetFontOption {
  value: string;
  label: string;
  /** Stylesheet URL covering weights 400–700; null for the system font. */
  url: string | null;
}

// The widget CSS uses weights 400/500/600/700, so every font must load that
// full range — a missing weight makes the browser synthesize a faux bold or
// substitute a neighboring weight, which renders differently per font.
function googleFont(family: string, weights = "400;500;600;700"): string {
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weights}&display=swap`;
}

export const WIDGET_FONTS: WidgetFontOption[] = [
  { value: "system-ui", label: "System Default", url: null },
  { value: "DM Sans", label: "DM Sans", url: googleFont("DM Sans") },
  { value: "Figtree", label: "Figtree", url: googleFont("Figtree") },
  { value: "Geist", label: "Geist", url: googleFont("Geist") },
  { value: "IBM Plex Sans", label: "IBM Plex Sans", url: googleFont("IBM Plex Sans") },
  { value: "Inter", label: "Inter", url: googleFont("Inter") },
  { value: "JetBrains Mono", label: "JetBrains Mono", url: googleFont("JetBrains Mono") },
  { value: "Karla", label: "Karla", url: googleFont("Karla") },
  // Lato only ships 400/700 — mid weights render at the nearest available.
  { value: "Lato", label: "Lato", url: googleFont("Lato", "400;700") },
  { value: "Lora", label: "Lora", url: googleFont("Lora") },
  { value: "Manrope", label: "Manrope", url: googleFont("Manrope") },
  { value: "Merriweather Sans", label: "Merriweather Sans", url: googleFont("Merriweather Sans") },
  { value: "Montserrat", label: "Montserrat", url: googleFont("Montserrat") },
  { value: "Nunito", label: "Nunito", url: googleFont("Nunito") },
  { value: "Open Sans", label: "Open Sans", url: googleFont("Open Sans") },
  { value: "Outfit", label: "Outfit", url: googleFont("Outfit") },
  { value: "Playfair Display", label: "Playfair Display", url: googleFont("Playfair Display") },
  { value: "Plus Jakarta Sans", label: "Plus Jakarta Sans", url: googleFont("Plus Jakarta Sans") },
  { value: "Poppins", label: "Poppins", url: googleFont("Poppins") },
  { value: "Raleway", label: "Raleway", url: googleFont("Raleway") },
  { value: "Roboto", label: "Roboto", url: googleFont("Roboto") },
  { value: "Rubik", label: "Rubik", url: googleFont("Rubik") },
  // Satoshi (Fontshare) ships 300/400/500/700 — no 600, so semibold text
  // renders at 700. Fontshare uses comma-separated weights.
  {
    value: "Satoshi",
    label: "Satoshi",
    url: "https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap",
  },
  { value: "Sora", label: "Sora", url: googleFont("Sora") },
  { value: "Source Sans 3", label: "Source Sans 3", url: googleFont("Source Sans 3") },
  { value: "Space Grotesk", label: "Space Grotesk", url: googleFont("Space Grotesk") },
  { value: "Work Sans", label: "Work Sans", url: googleFont("Work Sans") },
];
