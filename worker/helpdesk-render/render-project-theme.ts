import type { WidgetConfigRow } from "../db/schema";
import { isAllowedFont } from "./build-font-link";

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const COLOR_FN_RE = /^(oklch|rgb|rgba|hsl|hsla)\(\s*[0-9a-zA-Z%.,\-\s/+*]+\s*\)$/i;
const LENGTH_RE = /^\d+(\.\d+)?(px|rem|em|%)$/;

export function renderProjectTheme(widgetConfig: WidgetConfigRow | null): string {
  const primary = sanitizeColor(widgetConfig?.primaryColor) ?? "#2563eb";
  const bg = "#ffffff";
  const fg = "#0a0a0a";
  const radius = normalizeRadius(widgetConfig?.borderRadius);
  const fontSans = sanitizeFontName(widgetConfig?.fontFamily) ?? "Inter";

  return `:root {
  --brand: ${primary};
  --brand-dark: color-mix(in oklch, ${primary}, black 12%);
  --brand-soft: color-mix(in oklch, ${primary}, white 25%);
  --background: ${bg};
  --foreground: ${fg};
  --card: color-mix(in oklch, ${bg}, ${fg} 3%);
  --card-foreground: ${fg};
  --popover: ${bg};
  --popover-foreground: ${fg};
  --primary: ${primary};
  --primary-foreground: #ffffff;
  --secondary: color-mix(in oklch, ${bg}, ${fg} 4%);
  --secondary-foreground: ${fg};
  --muted: color-mix(in oklch, ${bg}, ${fg} 5%);
  --muted-foreground: color-mix(in oklch, ${fg}, transparent 35%);
  --accent: color-mix(in oklch, ${bg}, ${primary} 8%);
  --accent-foreground: ${fg};
  --destructive: oklch(60% 0.2 25);
  --border: color-mix(in oklch, ${fg}, transparent 88%);
  --input: color-mix(in oklch, ${fg}, transparent 88%);
  --ring: ${primary};
  --code: color-mix(in oklch, ${bg}, ${fg} 5%);
  --code-foreground: ${fg};
  --radius: ${radius};
  --font-sans: "${fontSans}", system-ui, sans-serif;
  --font-heading: "${fontSans}", system-ui, sans-serif;
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
