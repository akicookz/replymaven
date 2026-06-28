export type SystemEventKind = "flagged" | "joined" | "snoozed" | "snooze_ended" | "drafted";
export function parseSystemKind(sources?: string | null): SystemEventKind | null {
  if (!sources) return null;
  try { return (JSON.parse(sources).systemKind as SystemEventKind) ?? null; } catch { return null; }
}
export function systemEventDot(kind: SystemEventKind | null): string {
  switch (kind) {
    case "flagged": return "bg-dot-orange";
    case "joined": return "bg-dot-blue";
    case "snooze_ended": return "bg-dot-green";
    case "drafted": return "bg-dot-blue";
    case "snoozed": default: return "bg-dot-gray";
  }
}
