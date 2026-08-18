export type TelegramChatBinding =
  | { action: "bind"; chatId: string }
  | { action: "skip" };

// The chat a project posts to is learned from the first verified update the
// bot receives, so the owner never has to hand us a token to poll getUpdates
// with. It binds once: a project that already has a chat is never repointed.
export function resolveTelegramChatBinding(input: {
  storedChatId: string | null | undefined;
  trusted: boolean;
  chat?: { id?: number; type?: string } | null;
}): TelegramChatBinding {
  if (input.storedChatId || !input.trusted) return { action: "skip" };
  const id = input.chat?.id;
  if (typeof id !== "number" || !Number.isFinite(id)) return { action: "skip" };
  return { action: "bind", chatId: String(id) };
}
