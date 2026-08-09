export interface PendingContactReply {
  visitorName: string | null;
  visitorEmail: string | null;
  contactDeclined: boolean;
  remainingFields: Array<"name" | "email">;
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SHORT_NAME_PATTERN = /^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2}$/u;
const EXPLICIT_NAME_PREFIX =
  /^\s*(?:my name is|name(?:\s+is)?)\s*[:,-]?\s*/i;
const BARE_NAME_PATTERN = /^\p{Lu}[\p{L}'’-]*$/u;
const CONTACT_REFUSAL_PATTERNS = [
  /\b(?:i(?:'d| would)|we(?:'d| would))?\s*(?:rather|prefer)\s+not\s+(?:to\s+)?(?:share|provide|give)\s+(?:(?:my|our|any)\s+)?(?:contact(?:\s+(?:details?|information))?|details?|information|email(?:\s+address)?|name|that)\b/i,
  /\b(?:i|we)\s+(?:do not|don't|won't|will not)\s+(?:want\s+to\s+)?(?:share|provide|give)\s+(?:(?:my|our|any)\s+)?(?:contact(?:\s+(?:details?|information))?|details?|information|email(?:\s+address)?|name|that)\b/i,
  /\b(?:no[, ]+)?(?:please\s+)?(?:continue|proceed)\s+without\s+(?:(?:my|our)\s+)?(?:contact(?:\s+(?:details?|information))?|details?|information|email(?:\s+address)?|name)\b/i,
  /\b(?:i|we)\s+decline\s+(?:to\s+)?(?:share|provide|give)\s+(?:(?:my|our|any)\s+)?(?:contact(?:\s+(?:details?|information))?|details?|information|email(?:\s+address)?|name)\b/i,
];

function isExplicitContactRefusal(message: string): boolean {
  return CONTACT_REFUSAL_PATTERNS.some((pattern) => pattern.test(message));
}

function parseExplicitShortName(message: string, email: string | null): string | null {
  const withoutEmail = email ? message.replace(email, "") : message;
  const hasExplicitPrefix = EXPLICIT_NAME_PREFIX.test(withoutEmail);
  const normalized = withoutEmail
    .replace(EXPLICIT_NAME_PREFIX, "")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
    .trim();
  if (!normalized || normalized.length > 80) return null;
  if (!SHORT_NAME_PATTERN.test(normalized)) return null;
  if (!hasExplicitPrefix && !BARE_NAME_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function parsePendingContactReply(
  message: string,
  awaitingFields: Array<"name" | "email">,
): PendingContactReply {
  if (isExplicitContactRefusal(message)) {
    return {
      visitorName: null,
      visitorEmail: null,
      contactDeclined: true,
      remainingFields: [],
    };
  }

  const email = awaitingFields.includes("email")
    ? message.match(EMAIL_PATTERN)?.[0]?.toLowerCase() ?? null
    : null;
  const name = awaitingFields.includes("name")
    ? parseExplicitShortName(message, email)
    : null;
  return {
    visitorName: name,
    visitorEmail: email,
    contactDeclined: false,
    remainingFields: awaitingFields.filter((field) => {
      return field === "name" ? !name : !email;
    }),
  };
}
