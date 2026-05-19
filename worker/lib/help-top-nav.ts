export interface HelpTopNavItem {
  label: string;
  href: string;
  style: "link" | "button";
}

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
    const style = record.style;
    if (typeof label !== "string" || label.length === 0) continue;
    if (typeof href !== "string" || href.length === 0) continue;
    if (style !== "link" && style !== "button") continue;
    items.push({ label, href, style });
    if (items.length === 3) break;
  }
  return items;
}
