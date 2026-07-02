// Structural type: any message-like shape works (ConversationTurnMessage,
// raw rows, dashboard messages) — only these three fields are read.
export interface TranscriptMessage {
  role: string;
  content: string;
  createdAt?: string;
}

// Gaps at or under this threshold are conversational flow, not signal — they
// render nothing. Only longer pauses get a divider line.
export const TRANSCRIPT_GAP_THRESHOLD_MS = 15 * 60 * 1000;

export function toMessageTimestampMs(
  value: string | undefined,
): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Coarse, human-shaped duration label ("25 minutes", "3 hours", "2 days").
// Models reason better over these than raw ISO stamps, and coarse labels
// don't get parroted back to visitors.
export function formatGapLabel(gapMs: number): string {
  const mins = Math.max(1, Math.round(gapMs / 60_000));
  if (mins < 60) return mins === 1 ? "1 minute" : `${mins} minutes`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "1 day" : `${days} days`;
  const weeks = Math.round(days / 7);
  return weeks === 1 ? "1 week" : `${weeks} weeks`;
}

export function formatCurrentTime(nowMs: number): string {
  const d = new Date(nowMs);
  const weekday = d.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  return `${weekday}, ${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export interface FormatTranscriptOptions {
  /** When set, a trailing note marks how much later the CURRENT (not shown)
   *  message arrived after the transcript's last message. Pass it for prompts
   *  that show "Latest visitor message" separately from the transcript. */
  nowMs?: number;
  gapThresholdMs?: number;
}

// Renders "role: content" transcript lines, inserting "[N later]" divider
// lines only where a meaningful time gap exists. Messages without timestamps
// render exactly as before — no annotations, fully backward compatible.
export function formatTranscript(
  messages: TranscriptMessage[],
  options?: FormatTranscriptOptions,
): string {
  const threshold = options?.gapThresholdMs ?? TRANSCRIPT_GAP_THRESHOLD_MS;
  const lines: string[] = [];
  let prevMs: number | null = null;

  for (const message of messages) {
    const ms = toMessageTimestampMs(message.createdAt);
    if (ms != null && prevMs != null && ms - prevMs > threshold) {
      lines.push(`[${formatGapLabel(ms - prevMs)} later]`);
    }
    lines.push(`${message.role}: ${message.content}`);
    if (ms != null) prevMs = ms;
  }

  if (
    options?.nowMs != null &&
    prevMs != null &&
    options.nowMs - prevMs > threshold
  ) {
    lines.push(
      `[current message sent ${formatGapLabel(options.nowMs - prevMs)} later]`,
    );
  }

  return lines.join("\n");
}
