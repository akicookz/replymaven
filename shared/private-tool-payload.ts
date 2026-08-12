const REDACTED = "[REDACTED]";
const MAX_REDACTION_DEPTH = 24;
const SECRET_KEY = /(?:^|[_-])(?:authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|x[_-]?api[_-]?key|secret|client[_-]?secret|password|passphrase|credential|private[_-]?key)(?:$|[_-])/iu;
const SECRET_STRING_PATTERNS = [
  /\b(?:bearer|basic)\s+[a-z0-9._~+/-]+=*\b/giu,
  /\bsk-[a-z0-9_-]{16,}\b/giu,
  /\boac_[a-z0-9_-]{16,}\b/giu,
  /\beyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/giu,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactPrivateToolText(value: string): string {
  return SECRET_STRING_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, REDACTED),
    value,
  );
}

export function redactPrivateToolPayload(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > MAX_REDACTION_DEPTH) return "[MAX_DEPTH]";
  if (typeof value === "string") return redactPrivateToolText(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === undefined
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactPrivateToolPayload(item, depth + 1));
  }
  if (!isRecord(value)) return String(value);

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = SECRET_KEY.test(key)
      ? REDACTED
      : redactPrivateToolPayload(child, depth + 1);
  }
  return redacted;
}
