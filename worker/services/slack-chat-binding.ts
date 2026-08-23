export type SlackChannelBinding =
  | { action: "bind"; channelId: string }
  | { action: "skip" };

export function resolveSlackChannelBinding(input: {
  storedChannelId: string | null | undefined;
  trusted: boolean;
  channelId?: string | null;
}): SlackChannelBinding {
  if (input.storedChannelId || !input.trusted) return { action: "skip" };
  const channelId = input.channelId?.trim();
  if (!channelId) return { action: "skip" };
  return { action: "bind", channelId };
}
