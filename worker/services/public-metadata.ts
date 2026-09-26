// Public conversation metadata keys the runtime owns. Dashboard metadata
// writes must not drop them.
const RESERVED_PUBLIC_METADATA_KEYS = [
  "agentHandbackInstructions",
  "lastHumanCommandAt",
  "lastSidechatTurnOrigin",
] as const;

export function mergePublicMetadata(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...patch };
}

export function preserveReservedPublicMetadata(
  incoming: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...incoming };
  for (const key of RESERVED_PUBLIC_METADATA_KEYS) {
    if (key in incoming) continue;
    if (key in current) next[key] = current[key];
  }
  return next;
}

export function clearHumanCommandClock(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  if (!("lastHumanCommandAt" in metadata)) return metadata;
  const next = { ...metadata };
  delete next.lastHumanCommandAt;
  return next;
}
