import type { WidgetConfigRow } from "../db/schema";
import { resolveWidgetFont } from "../../shared/widget-fonts";

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const COLOR_FN_RE = /^(oklch|rgb|rgba|hsl|hsla)\(\s*[0-9a-zA-Z%.,\-\s/+*]+\s*\)$/i;
const LENGTH_RE = /^\d+(\.\d+)?(px|rem|em|%)$/;

interface PaletteOpts {
  bg: string;
  fg: string;
  primary: string;
  code: string;
  codeFg: string;
  /** % of the foreground made transparent for muted text. */
  mutedFg: number;
  /** % of the foreground made transparent for borders. */
  border: number;
  /** % of white mixed into --brand: tenant primaries are picked for white
   *  backgrounds, so dark mode lifts them for readable link text. Buttons
   *  keep the raw primary via --primary either way. */
  brandLift?: number;
}

// Emits the shared token set for one theme (light or dark) so the help center
// can flip between them via a `.dark` class on <html>.
function palette(o: PaletteOpts): string {
  const brand = o.brandLift
    ? `color-mix(in oklch, ${o.primary}, white ${o.brandLift}%)`
    : o.primary;
  return `  --brand: ${brand};
  --brand-dark: color-mix(in oklch, ${o.primary}, black 12%);
  --brand-soft: color-mix(in oklch, ${o.primary}, white 25%);
  --background: ${o.bg};
  --foreground: ${o.fg};
  --card: color-mix(in oklch, ${o.bg}, ${o.fg} 3%);
  --card-foreground: ${o.fg};
  --popover: ${o.bg};
  --popover-foreground: ${o.fg};
  --primary: ${o.primary};
  --primary-foreground: #ffffff;
  --secondary: color-mix(in oklch, ${o.bg}, ${o.fg} 4%);
  --secondary-foreground: ${o.fg};
  --muted: color-mix(in oklch, ${o.bg}, ${o.fg} 6%);
  --muted-foreground: color-mix(in oklch, ${o.fg}, transparent ${o.mutedFg}%);
  --accent: color-mix(in oklch, ${o.bg}, ${o.primary} 8%);
  --accent-foreground: ${o.fg};
  --destructive: oklch(60% 0.2 25);
  --border: color-mix(in oklch, ${o.fg}, transparent ${o.border}%);
  --input: color-mix(in oklch, ${o.fg}, transparent ${o.border}%);
  --ring: ${o.primary};
  --code: ${o.code};
  --code-foreground: ${o.codeFg};`;
}

export function renderProjectTheme(widgetConfig: WidgetConfigRow | null): string {
  const primary = sanitizeColor(widgetConfig?.primaryColor) ?? "#2563eb";
  const radius = normalizeRadius(widgetConfig?.borderRadius);
  const fontName = sanitizeFontName(widgetConfig?.fontFamily);
  const fontStack = fontName
    ? `"${fontName}", system-ui, sans-serif`
    : "system-ui, sans-serif";

  // Light is the brand default; readers flip to dark via the top-bar toggle
  // (it adds `.dark` on <html>). Radii + fonts are theme-independent.
  // Body and headings use the same widget font. No Inter/Switzer split.
  return `:root {
${palette({ bg: "#ffffff", fg: "#0a0a0a", primary, code: "#f6f8fa", codeFg: "#1f2328", mutedFg: 35, border: 88 })}
  --radius: ${radius};
  --font-sans: ${fontStack};
  --font-heading: ${fontStack};
}
.dark {
${palette({ bg: "#08080a", fg: "#f0f0f5", primary, code: "#0d1117", codeFg: "#e6edf3", mutedFg: 45, border: 90, brandLift: 30 })}
}`;
}

export function sanitizeColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (HEX_RE.test(trimmed)) return trimmed;
  if (COLOR_FN_RE.test(trimmed)) return trimmed;
  return null;
}

export function sanitizeRadius(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  return LENGTH_RE.test(trimmed) ? trimmed : null;
}

export function sanitizeFontName(input: string | null | undefined): string | null {
  if (!input) return null;
  const font = resolveWidgetFont(input);
  if (!font || font.faces.length === 0) return null;
  return font.value;
}

// The widget's borderRadius is tuned for chat bubbles; on the help pages it
// drives --radius, which sizes small controls (buttons, inputs). Clamp it so
// a bubbly widget theme doesn't turn 36px buttons into capsules, while a
// square brand (0) still renders sharp.
const MAX_HELP_RADIUS_PX = 12;

function normalizeRadius(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "0.75rem";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.max(0, Math.min(MAX_HELP_RADIUS_PX, value))}px`;
  }
  const sanitized = sanitizeRadius(String(value));
  return sanitized ?? "0.75rem";
}
