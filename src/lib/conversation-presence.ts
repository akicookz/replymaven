export type PresenceValue = string | number | Date | null | undefined;
export type VisitorPresenceState = "online" | "background" | "offline";

const VISITOR_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function toPresenceTimestamp(value: PresenceValue): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function getVisitorPresenceState(options: {
  visitorLastSeenAt: PresenceValue;
  visitorPresence: string | null | undefined;
  nowMs?: number;
}): VisitorPresenceState {
  const lastSeenAt = toPresenceTimestamp(options.visitorLastSeenAt);
  if (!lastSeenAt) return "offline";

  const nowMs = options.nowMs ?? Date.now();
  if (nowMs - lastSeenAt >= VISITOR_ONLINE_WINDOW_MS) {
    return "offline";
  }

  return options.visitorPresence === "background" ? "background" : "online";
}

export function getConversationActivityTimestamp(options: {
  visitorLastSeenAt: PresenceValue;
  updatedAt: PresenceValue;
}): number | null {
  const visitorLastSeenAt = toPresenceTimestamp(options.visitorLastSeenAt);
  const updatedAt = toPresenceTimestamp(options.updatedAt);

  if (visitorLastSeenAt == null) return updatedAt;
  if (updatedAt == null) return visitorLastSeenAt;
  return Math.max(visitorLastSeenAt, updatedAt);
}
