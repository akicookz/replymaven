import type { WidgetConfigRow } from "../db/schema";
import { isAllowedFont } from "./build-font-link";

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
}

// Emits the shared token set for one theme (light or dark) so the help center
// can flip between them via a `.dark` class on <html>.
function palette(o: PaletteOpts): string {
  return `  --brand: ${o.primary};
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
  const fontSans = sanitizeFontName(widgetConfig?.fontFamily) ?? "Inter";
  // Headings use Switzer (our display face) by default to match the marketing
  // docs; a tenant's own font, when set, drives both body and headings.
  const fontHeading = sanitizeFontName(widgetConfig?.fontFamily) ?? "Switzer";

  // Light is the brand default; readers flip to dark via the top-bar toggle
  // (it adds `.dark` on <html>). Radii + fonts are theme-independent.
  return `:root {
${palette({ bg: "#ffffff", fg: "#0a0a0a", primary, code: "#f6f8fa", codeFg: "#1f2328", mutedFg: 35, border: 88 })}
  --radius: ${radius};
  --font-sans: "${fontSans}", system-ui, sans-serif;
  --font-heading: "${fontHeading}", system-ui, sans-serif;
}
.dark {
${palette({ bg: "#08080a", fg: "#f0f0f5", primary, code: "#0d1117", codeFg: "#e6edf3", mutedFg: 45, border: 90 })}
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
  return isAllowedFont(input) ? input : null;
}

function normalizeRadius(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "0.75rem";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}px`;
  }
  const sanitized = sanitizeRadius(String(value));
  return sanitized ?? "0.75rem";
}
