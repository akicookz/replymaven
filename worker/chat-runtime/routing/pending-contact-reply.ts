export interface PendingContactReply {
  visitorName: string | null;
  visitorEmail: string | null;
  contactDeclined: boolean;
  remainingFields: Array<"name" | "email">;
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const CONTACT_REFUSAL_PATTERN =
  /\b(?:rather not|do not want|don't want|won't|will not|prefer not|decline|continue without|no[, ]+continue)\b/i;
const SHORT_NAME_PATTERN = /^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2}$/u;
const EXPLICIT_NAME_PREFIX =
  /^\s*(?:my name is|name(?:\s+is)?|i am|i'm)\s*[:,-]?\s*/i;
const CAPITALIZED_NAME_PATTERN =
  /^\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*){0,2}$/u;

function parseExplicitShortName(message: string, email: string | null): string | null {
  const withoutEmail = email ? message.replace(email, "") : message;
  const hasExplicitPrefix = EXPLICIT_NAME_PREFIX.test(withoutEmail);
  const normalized = withoutEmail
    .replace(EXPLICIT_NAME_PREFIX, "")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
    .trim();
  if (!normalized || normalized.length > 80) return null;
  if (!SHORT_NAME_PATTERN.test(normalized)) return null;
  if (!hasExplicitPrefix && !CAPITALIZED_NAME_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function parsePendingContactReply(
  message: string,
  awaitingFields: Array<"name" | "email">,
): PendingContactReply {
  if (CONTACT_REFUSAL_PATTERN.test(message)) {
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
