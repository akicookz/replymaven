export interface BotNameDecision {
  ownership: "human" | "ai"
  instructions: "set" | "clear" | "keep"
  speak: "now" | "silent"
  effect: "none" | "close" | "ban"
  reason: string | null
}

const OWNERSHIP = new Set(["human", "ai"]);
const INSTRUCTIONS = new Set(["set", "clear", "keep"]);
const SPEAK = new Set(["now", "silent"]);
const EFFECT = new Set(["none", "close", "ban"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readEnum(
  value: unknown,
  allowed: Set<string>,
): string | null {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

export function parseBotNameDecision(value: unknown): BotNameDecision | null {
  if (!isRecord(value)) return null;
  const ownership = readEnum(value.ownership, OWNERSHIP);
  const instructions = readEnum(value.instructions, INSTRUCTIONS);
  const speak = readEnum(value.speak, SPEAK);
  const effect = readEnum(value.effect, EFFECT);
  if (!ownership || !instructions || !speak || !effect) return null;
  const reason = typeof value.reason === "string" && value.reason.trim()
    ? value.reason.trim()
    : null;
  return {
    ownership: ownership as BotNameDecision["ownership"],
    instructions: instructions as BotNameDecision["instructions"],
    speak: speak as BotNameDecision["speak"],
    effect: effect as BotNameDecision["effect"],
    reason,
  };
}

export function resolveBanReason(
  reason: string | null,
  rawAgentText: string,
): string {
  return reason && reason.trim() ? reason.trim() : rawAgentText;
}

export interface BotNameConfirmInput {
  effect: "none" | "close" | "ban"
  reason?: string
  handedToAi?: boolean
  storedInstructions?: boolean
  spoke?: boolean
}

export function confirmBotNameDecision(input: BotNameConfirmInput): string {
  if (input.effect === "close") return "Conversation closed.";
  if (input.effect === "ban") {
    return input.reason
      ? `Visitor banned and conversation closed. Reason: ${input.reason}`
      : "Visitor banned and conversation closed.";
  }
  if (input.spoke) return "Bot responded.";
  if (input.handedToAi) return "Bot resumed.";
  if (input.storedInstructions) return "Instructions saved.";
  return "Bot stayed quiet.";
}

export function mergePublicMetadata(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...patch };
}

const RESERVED_PUBLIC_METADATA_KEYS = [
  "agentHandbackInstructions",
  "lastHumanCommandAt",
  "lastTelegramCommandId",
  "lastTelegramCommandConfirm",
] as const;

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

export function readTelegramCommandClaim(
  metadata: Record<string, unknown>,
  commandId: string,
): string | null {
  if (metadata.lastTelegramCommandId !== commandId) return null;
  return typeof metadata.lastTelegramCommandConfirm === "string" &&
      metadata.lastTelegramCommandConfirm
    ? metadata.lastTelegramCommandConfirm
    : "Already applied.";
}

export function telegramCommandClaimPatch(
  commandId: string,
  confirmation: string,
): Record<string, unknown> {
  return {
    lastTelegramCommandId: commandId,
    lastTelegramCommandConfirm: confirmation,
  };
}
