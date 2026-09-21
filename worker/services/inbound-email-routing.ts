const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EMAIL_DOMAIN = "updates.replymaven.com";
const PLUS_ADDRESS = new RegExp(
  `^([^@+]+)\\+c(${UUID})@${EMAIL_DOMAIN.replace(/\./g, "\\.")}$`,
  "i",
);
const SLUG_ADDRESS = new RegExp(
  `^([^@+]+)@${EMAIL_DOMAIN.replace(/\./g, "\\.")}$`,
  "i",
);
const ADDRESS_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const HEADER_ORIGIN_KEYS = [
  "to",
  "cc",
  "delivered-to",
  "x-forwarded-to",
  "x-original-to",
  "resent-to",
] as const;

const CONVERSATION_REFERENCE_PATTERNS = [
  new RegExp(`/conversations/(${UUID})`, "i"),
  new RegExp(`[?&]id=(${UUID})`, "i"),
  new RegExp(`ReplyMaven\\s+ref:\\s*(${UUID})`, "i"),
];

const REPLYMAVEN_REF_PATTERN = new RegExp(
  `ReplyMaven\\s+ref:\\s*(${UUID})`,
  "i",
);

export const OPEN_INBOUND_THREAD_MS = 7 * 24 * 60 * 60 * 1000;

export interface InboundEnvelopeRecipient {
  raw: string;
  slug: string;
  conversationId: string | null;
}

export interface InboundEmailAttachmentRef {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
}

export interface InboundEmailEvent {
  emailId: string;
  senderEmail: string;
  senderName: string | null;
  envelopeRecipient: InboundEnvelopeRecipient;
  originatingAddress: string | null;
  subject: string | null;
  rfcMessageId: string | null;
  text: string;
  headers: Record<string, string>;
  attachments: InboundEmailAttachmentRef[];
}

export type ConversationResolveVia =
  | "in-reply-to"
  | "plus-address"
  | "body-ref"
  | "recent-open";

export type ConversationResolveDecision =
  | { kind: "found"; via: ConversationResolveVia }
  | { kind: "create" }
  | { kind: "drop"; reason: "archived" };

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

export function parseReplyMavenRef(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const match = REPLYMAVEN_REF_PATTERN.exec(text);
  return match?.[1]?.toLowerCase() ?? null;
}

export function parseEnvelopeRecipient(
  toAddresses: string[],
): InboundEnvelopeRecipient | null {
  for (const raw of toAddresses) {
    const address = extractEmailAddress(raw);
    if (!address) continue;
    const plus = address.match(PLUS_ADDRESS);
    if (plus?.[1] && plus[2]) {
      return {
        raw: address,
        slug: plus[1].toLowerCase(),
        conversationId: plus[2].toLowerCase(),
      };
    }
    const slug = address.match(SLUG_ADDRESS);
    if (slug?.[1]) {
      return {
        raw: address,
        slug: slug[1].toLowerCase(),
        conversationId: null,
      };
    }
  }
  return null;
}

export function originatingAddressFromHeaders(
  headers: Record<string, string>,
  envelopeRaw: string,
): string | null {
  const envelope = extractEmailAddress(envelopeRaw);
  for (const key of HEADER_ORIGIN_KEYS) {
    const value = headers[key];
    if (!value) continue;
    for (const candidate of extractEmailAddresses(value)) {
      if (isEnvelopeDomain(candidate)) continue;
      if (envelope && candidate === envelope) continue;
      return candidate;
    }
  }
  return null;
}

export function normalizeHeaderMap(headersField: unknown): Record<string, string> {
  const headerLookup: Record<string, string> = {};
  if (headersField && typeof headersField === "object" && !Array.isArray(headersField)) {
    for (const [key, value] of Object.entries(headersField)) {
      headerLookup[key.toLowerCase()] = String(value ?? "");
    }
    return headerLookup;
  }
  if (Array.isArray(headersField)) {
    for (const header of headersField) {
      if (!header || typeof header !== "object") continue;
      const record = header as Record<string, unknown>;
      const name = String(record.name ?? "").toLowerCase();
      if (name) headerLookup[name] = String(record.value ?? "");
    }
  }
  return headerLookup;
}

export function parseSender(fromAddress: unknown): {
  email: string;
  name: string | null;
} | null {
  let raw: string;
  if (typeof fromAddress === "string") {
    raw = fromAddress;
  } else if (
    fromAddress &&
    typeof fromAddress === "object" &&
    "address" in fromAddress &&
    typeof (fromAddress as { address?: unknown }).address === "string"
  ) {
    raw = (fromAddress as { address: string }).address;
  } else {
    return null;
  }
  const email = extractEmailAddress(raw);
  if (!email) return null;
  const nameMatch = raw.match(/^\s*"?([^"<]+)"?\s*</);
  const name = nameMatch?.[1]?.trim() || null;
  return { email, name };
}

export function parseInboundAttachments(
  attachments: unknown,
): InboundEmailAttachmentRef[] {
  if (!Array.isArray(attachments)) return [];
  const parsed: InboundEmailAttachmentRef[] = [];
  for (const item of attachments) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    if (!id) continue;
    parsed.push({
      id,
      filename: typeof record.filename === "string" ? record.filename : "attachment",
      contentType:
        typeof record.content_type === "string"
          ? record.content_type
          : typeof record.contentType === "string"
            ? record.contentType
            : "application/octet-stream",
      size: typeof record.size === "number" && Number.isFinite(record.size)
        ? record.size
        : 0,
      contentId:
        typeof record.content_id === "string"
          ? record.content_id
          : typeof record.contentId === "string"
            ? record.contentId
            : null,
    });
  }
  return parsed;
}

export function isAutoSubmittedMail(headers: Record<string, string>): boolean {
  const auto = headers["auto-submitted"]?.trim().toLowerCase();
  if (auto && auto !== "no") return true;
  const prec = headers.precedence?.trim().toLowerCase();
  if (prec === "bulk" || prec === "list" || prec === "junk") return true;
  const rp = headers["return-path"]?.trim();
  return rp === "<>";
}

export async function resolveInboundConversation(lookups: {
  byMessageId(): Promise<"archived" | "found" | null>;
  byPlusAddress(): Promise<"archived" | "found" | null>;
  byBodyRef(): Promise<"archived" | "found" | null>;
  byRecentOpen(): Promise<"found" | null>;
}): Promise<ConversationResolveDecision> {
  const steps: Array<{
    via: ConversationResolveVia;
    lookup: () => Promise<"archived" | "found" | null>;
  }> = [
    { via: "in-reply-to", lookup: lookups.byMessageId },
    { via: "plus-address", lookup: lookups.byPlusAddress },
    { via: "body-ref", lookup: lookups.byBodyRef },
    { via: "recent-open", lookup: lookups.byRecentOpen },
  ];
  for (const step of steps) {
    const result = await step.lookup();
    if (result === "archived") return { kind: "drop", reason: "archived" };
    if (result === "found") return { kind: "found", via: step.via };
  }
  return { kind: "create" };
}

export function buildInboundReplyTo(
  slug: string,
  conversationId: string,
): string {
  return `${slug}+c${conversationId}@${EMAIL_DOMAIN}`;
}

export function inboundReplyRefLine(conversationId: string): string {
  return `ReplyMaven ref: ${conversationId}`;
}

export async function emailVisitorId(
  projectId: string,
  email: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${projectId}:${email}`),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `email:${hex}`;
}

function isEnvelopeDomain(address: string): boolean {
  return address.endsWith(`@${EMAIL_DOMAIN}`);
}

export function extractEmailAddress(value: string): string | null {
  const angle = value.match(/<([^>]+)>/);
  const raw = (angle ? angle[1] : value).trim().toLowerCase();
  if (!raw.includes("@")) return null;
  return raw;
}

function extractEmailAddresses(value: string): string[] {
  const matches = value.match(ADDRESS_IN_TEXT) ?? [];
  return matches.map((address) => address.toLowerCase());
}
