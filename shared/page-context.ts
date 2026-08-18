// Page context is host-supplied prompt input. Hosts pass whatever their app
// state holds, so every value is coerced or dropped here rather than making a
// loose value fail the visitor's turn.
export const MAX_PAGE_CONTEXT_ENTRIES = 20;
export const MAX_PAGE_CONTEXT_KEY_LENGTH = 80;
export const MAX_PAGE_CONTEXT_VALUE_LENGTH = 1_000;

function readValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.slice(0, MAX_PAGE_CONTEXT_VALUE_LENGTH);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  return null;
}

export function sanitizePageContext(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const context: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || key.length > MAX_PAGE_CONTEXT_KEY_LENGTH) continue;
    const text = readValue(entry);
    if (text === null) continue;
    context[key] = text;
    if (Object.keys(context).length === MAX_PAGE_CONTEXT_ENTRIES) break;
  }
  return context;
}
