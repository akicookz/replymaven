export const INTERNAL_TOKENS = [
  "[HANDOFF_REQUESTED]",
  "[RESOLVED]",
  "[INQUIRY_CREATED]",
  "[INQUIRY_UPDATED]",
  "[CONTACT_REQUESTED]",
] as const;

export type InternalToken = (typeof INTERNAL_TOKENS)[number];

export interface TokenPresence {
  cleaned: string;
  tokens: InternalToken[];
}

const LONGEST_TOKEN_LENGTH = INTERNAL_TOKENS.reduce(
  (max, token) => Math.max(max, token.length),
  0,
);

export function stripInternalTokens(text: string): string {
  if (!text) return text;
  let result = text;
  for (const token of INTERNAL_TOKENS) {
    if (result.includes(token)) {
      result = result.split(token).join("");
    }
  }
  return result;
}

export function detectInternalTokens(text: string): TokenPresence {
  if (!text) return { cleaned: text, tokens: [] };
  const tokens: InternalToken[] = [];
  let result = text;
  for (const token of INTERNAL_TOKENS) {
    if (result.includes(token)) {
      tokens.push(token);
      result = result.split(token).join("");
    }
  }
  return { cleaned: result, tokens };
}

export interface StreamingStripState {
  tail: string;
}

export function createStreamingStripState(): StreamingStripState {
  return { tail: "" };
}

export interface StreamingStripResult {
  emit: string;
  tokens: InternalToken[];
}

export function stripInternalTokensStreaming(
  state: StreamingStripState,
  delta: string,
): StreamingStripResult {
  const tokens: InternalToken[] = [];

  if (!delta) {
    return { emit: "", tokens };
  }

  let buffer = state.tail + delta;

  let changed = true;
  while (changed) {
    changed = false;
    for (const token of INTERNAL_TOKENS) {
      const idx = buffer.indexOf(token);
      if (idx !== -1) {
        buffer = buffer.slice(0, idx) + buffer.slice(idx + token.length);
        tokens.push(token);
        changed = true;
      }
    }
  }

  const holdBack = Math.min(buffer.length, LONGEST_TOKEN_LENGTH - 1);
  let suffixStart = buffer.length;
  for (let i = Math.max(0, buffer.length - holdBack); i < buffer.length; i++) {
    const suffix = buffer.slice(i);
    if (
      INTERNAL_TOKENS.some(
        (token) =>
          token.startsWith(suffix) && suffix.length < token.length,
      )
    ) {
      suffixStart = i;
      break;
    }
  }

  const emit = buffer.slice(0, suffixStart);
  state.tail = buffer.slice(suffixStart);

  return { emit, tokens };
}

export function flushStreamingStripState(
  state: StreamingStripState,
): StreamingStripResult {
  const tokens: InternalToken[] = [];
  let buffer = state.tail;
  state.tail = "";

  if (!buffer) return { emit: "", tokens };

  let changed = true;
  while (changed) {
    changed = false;
    for (const token of INTERNAL_TOKENS) {
      const idx = buffer.indexOf(token);
      if (idx !== -1) {
        buffer = buffer.slice(0, idx) + buffer.slice(idx + token.length);
        tokens.push(token);
        changed = true;
      }
    }
  }

  return { emit: buffer, tokens };
}
