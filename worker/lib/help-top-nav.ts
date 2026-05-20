export interface HelpTopNavItem {
  label: string;
  href: string;
  classes?: string | null;
}

const TAILWIND_CLASS_RE = /^[a-zA-Z0-9:/_\-[\]().,%! ]*$/;

export function parseHelpTopNav(
  raw: string | null | undefined,
): HelpTopNavItem[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: HelpTopNavItem[] = [];
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    const label = record.label;
    const href = record.href;
    if (typeof label !== "string" || label.length === 0) continue;
    if (typeof href !== "string" || href.length === 0) continue;
    let classes: string | null = null;
    if (typeof record.classes === "string") {
      const trimmed = record.classes.trim();
      if (trimmed.length > 0 && trimmed.length <= 300 && TAILWIND_CLASS_RE.test(trimmed)) {
        classes = trimmed;
      }
    }
    items.push({ label, href, classes });
    if (items.length === 3) break;
  }
  return items;
}
