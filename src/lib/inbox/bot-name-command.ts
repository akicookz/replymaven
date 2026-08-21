function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function looksLikeAgentBotNameCommand(
  text: string,
  botName: string | null | undefined,
): boolean {
  const normalizedBotName = botName?.trim();
  if (!normalizedBotName) return false;
  const mention = new RegExp(
    `^@${escapeRegExp(normalizedBotName)}(?:\\s+|[,:]\\s*|$)`,
    "i",
  );
  return mention.test(text.trim());
}
