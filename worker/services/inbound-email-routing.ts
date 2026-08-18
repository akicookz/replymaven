const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// Our outbound mail carries a dashboard link for the conversation, and every
// reply quotes it. That is the only routing signal that survives the trip:
// Resend replaces our `Message-ID` with the sending provider's, so the
// `In-Reply-To` that comes back never references an id we issued.
const CONVERSATION_REFERENCE_PATTERNS = [
  new RegExp(`/conversations/(${UUID})`, "i"),
  new RegExp(`[?&]id=(${UUID})`, "i"),
  new RegExp(`ReplyMaven\\s+ref:\\s*(${UUID})`, "i"),
];

// The newest quote sits at the top of a reply, so the first match is the
// conversation being answered even when older threads are nested below.
export function parseConversationReference(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  let best: { index: number; id: string } | null = null;
  for (const pattern of CONVERSATION_REFERENCE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    if (!best || match.index < best.index) {
      best = { index: match.index, id: match[1].toLowerCase() };
    }
  }
  return best?.id ?? null;
}
