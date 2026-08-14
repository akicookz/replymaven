import { MessageType } from "@cloudflare/ai-chat/types";
import { parseProtocolMessage } from "agents/chat";
import type { UIMessage } from "ai";
import type { PublicChatChildClaims } from "../../../../shared/public-chat-agent";
import type { PublicMessageRecord } from "../../../../shared/maven-conversation";
import {
  getLocalUploadKey,
  isConversationUploadKeyOwnedByConversation,
} from "../../../../shared/upload-ownership";
import { toPublicUiMessage } from "./public-message";

// The visitor's client holds and echoes at most this many messages, so a long
// conversation cannot grow the submit frame past the WebSocket message limit.
// Stored history is never trimmed; the server rebuilds the body from its own
// copy either way.
export const PUBLIC_SUBMIT_HISTORY_WINDOW = 200;

const MAX_MESSAGE_ID_LENGTH = 200;
const MAX_TEXT_LENGTH = 8_000;
const MAX_ATTACHMENTS = 5;
const MAX_PAGE_CONTEXT_ENTRIES = 20;
const MAX_PAGE_CONTEXT_KEY_LENGTH = 80;
const MAX_PAGE_CONTEXT_VALUE_LENGTH = 1_000;

interface PublicProtocolGuardInput {
  raw: string;
  authoritativeMessages: UIMessage[];
  claims: PublicChatChildClaims | null;
  expectedOrigin?: string | null;
  now?: number;
}

export type PublicProtocolGuardResult =
  | {
      allowed: true;
      raw: string;
      submittedMessageId: string | null;
    }
  | {
      allowed: false;
      requestId: string | null;
      close: boolean;
      reason: string;
      detail?: Record<string, unknown>;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function sameStructure(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function readAttachmentUrls(
  value: unknown,
  claims: PublicChatChildClaims,
  expectedOrigin: string | null,
): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return null;
  const urls: string[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.length > 2_048
    ) return null;
    try {
      const parsed = new URL(candidate);
      const key = getLocalUploadKey(candidate);
      // Origin equality is the control; a protocol check would break local
      // verification against an http://localhost widget origin.
      if (
        expectedOrigin === null ||
        parsed.origin !== expectedOrigin ||
        !key?.startsWith(`${claims.projectId}/`) ||
        !isConversationUploadKeyOwnedByConversation(
          key,
          claims.conversationId,
        )
      ) return null;
    } catch {
      return null;
    }
    if (urls.includes(candidate)) return null;
    urls.push(candidate);
  }
  return urls;
}

function isPageContext(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_PAGE_CONTEXT_ENTRIES && entries.every(
    ([key, entry]) =>
      key.length > 0 &&
      key.length <= MAX_PAGE_CONTEXT_KEY_LENGTH &&
      typeof entry === "string" &&
      entry.length <= MAX_PAGE_CONTEXT_VALUE_LENGTH,
  );
}

interface ValidatedUserMessage {
  id: string;
  content: string;
  imageUrls: string[];
}

function validateNewUserMessage(
  value: unknown,
  authoritativeMessages: UIMessage[],
  attachmentUrls: string[],
): ValidatedUserMessage | null {
  if (!isRecord(value) || !exactKeys(value, ["id", "role", "parts"])) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > MAX_MESSAGE_ID_LENGTH ||
    value.role !== "user" ||
    !Array.isArray(value.parts) ||
    value.parts.length === 0 ||
    authoritativeMessages.some((message) => message.id === value.id)
  ) return null;

  let content = "";
  const imageUrls: string[] = [];
  for (const part of value.parts) {
    if (!isRecord(part) || typeof part.type !== "string") return null;
    if (part.type === "text") {
      if (!exactKeys(part, ["type", "text"]) || typeof part.text !== "string") {
        return null;
      }
      content += part.text;
      if (content.length > MAX_TEXT_LENGTH) return null;
      continue;
    }
    if (part.type === "file") {
      if (
        !exactKeys(part, ["type", "mediaType", "url"], ["filename"]) ||
        typeof part.mediaType !== "string" ||
        !part.mediaType.startsWith("image/") ||
        typeof part.url !== "string" ||
        !attachmentUrls.includes(part.url) ||
        (part.filename !== undefined && typeof part.filename !== "string") ||
        imageUrls.includes(part.url)
      ) return null;
      imageUrls.push(part.url);
      continue;
    }
    return null;
  }
  if (content.trim().length === 0 && imageUrls.length === 0) return null;
  if (
    imageUrls.length !== attachmentUrls.length ||
    attachmentUrls.some((url) => !imageUrls.includes(url))
  ) return null;
  return { id: value.id, content, imageUrls };
}

function describeMessageShape(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return { type: typeof value };
  const message = value as Record<string, unknown>;
  return {
    role: message.role,
    keys: Object.keys(message).sort(),
    parts: Array.isArray(message.parts)
      ? message.parts.map((part) =>
        part && typeof part === "object"
          ? (part as Record<string, unknown>).type
          : typeof part
      )
      : null,
    metadataKeys: message.metadata && typeof message.metadata === "object"
      ? Object.keys(message.metadata as Record<string, unknown>).sort()
      : null,
  };
}

function reject(
  reason: string,
  requestId: string | null = null,
  close = false,
  detail?: Record<string, unknown>,
): PublicProtocolGuardResult {
  return { allowed: false, requestId, close, reason, ...(detail ? { detail } : {}) };
}

function normalizeRequest(
  raw: string,
  authoritativeMessages: UIMessage[],
  claims: PublicChatChildClaims,
  now: number,
  expectedOrigin: string | null,
): PublicProtocolGuardResult {
  const event = parseProtocolMessage(raw);
  if (event?.type !== "chat-request" || event.init.method !== "POST") {
    return reject("invalid_request");
  }
  let body: unknown;
  try {
    body = JSON.parse(event.init.body ?? "");
  } catch {
    return reject("invalid_body", event.id);
  }
  if (
    !isRecord(body) ||
    !exactKeys(body, ["messages"], [
      "pageContext",
      "attachmentUrls",
      "trigger",
      "token",
    ]) ||
    !Array.isArray(body.messages) ||
    body.messages.length < 1 ||
    body.messages.length > authoritativeMessages.length + 1 ||
    !isPageContext(body.pageContext) ||
    (body.token !== undefined &&
      (typeof body.token !== "string" || body.token.length > 2_048)) ||
    (body.trigger !== undefined && body.trigger !== "submit-message")
  ) return reject("invalid_submission", event.id);

  // The client may hold only the newest window, so its history must match the
  // tail of ours rather than the whole list. It must still echo everything it
  // is expected to hold, so a truncated or edited history is still rejected.
  const echoed = body.messages.length - 1;
  const minimumEcho = Math.min(
    authoritativeMessages.length,
    PUBLIC_SUBMIT_HISTORY_WINDOW,
  );
  if (echoed < minimumEcho) {
    return reject("history_mismatch", event.id, false, {
      echoed,
      minimumEcho,
      authoritative: authoritativeMessages.length,
    });
  }
  const echoOffset = authoritativeMessages.length - echoed;
  for (let index = 0; index < echoed; index += 1) {
    if (
      !sameStructure(
        body.messages[index],
        authoritativeMessages[echoOffset + index],
      )
    ) {
      return reject("history_mismatch", event.id, false, {
        index,
        echoed,
        authoritative: authoritativeMessages.length,
        submitted: describeMessageShape(body.messages[index]),
        expected: describeMessageShape(
          authoritativeMessages[echoOffset + index],
        ),
      });
    }
  }
  const attachmentUrls = readAttachmentUrls(
    body.attachmentUrls,
    claims,
    expectedOrigin,
  );
  if (!attachmentUrls) return reject("invalid_attachments", event.id);
  const submitted = validateNewUserMessage(
    body.messages.at(-1),
    authoritativeMessages,
    attachmentUrls,
  );
  if (!submitted) return reject("invalid_user_message", event.id);

  const record: PublicMessageRecord = {
    id: submitted.id,
    conversationId: claims.conversationId,
    author: "visitor",
    content: submitted.content,
    imageUrls: submitted.imageUrls,
    sources: [],
    senderName: null,
    senderAvatar: null,
    userId: null,
    systemKind: null,
    createdAt: now,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
  };
  // Rebuild from our own copy, bounded to the same window so the SDK's
  // downstream broadcasts stay small. Older rows survive because the appended
  // message carries an id the server has not seen.
  const normalizedBody = {
    ...body,
    messages: [
      ...structuredClone(
        authoritativeMessages.slice(-PUBLIC_SUBMIT_HISTORY_WINDOW),
      ),
      toPublicUiMessage(record, claims.projectId),
    ],
  };
  let wire: unknown;
  try {
    wire = JSON.parse(raw);
  } catch {
    return reject("invalid_request", event.id);
  }
  if (!isRecord(wire) || !isRecord(wire.init)) {
    return reject("invalid_request", event.id);
  }
  return {
    allowed: true,
    raw: JSON.stringify({
      ...wire,
      init: { ...wire.init, body: JSON.stringify(normalizedBody) },
    }),
    submittedMessageId: submitted.id,
  };
}

export function guardPublicChatProtocolMessage(
  input: PublicProtocolGuardInput,
): PublicProtocolGuardResult {
  const event = parseProtocolMessage(input.raw);
  if (!event) return reject("unknown_protocol", null, true);
  const claims = input.claims;
  if (!claims?.canRead) {
    return reject(
      "unauthorized",
      event.type === "chat-request" ? event.id : null,
      true,
    );
  }

  switch (event.type) {
    case "cancel":
      // Only the visitor who owns the turn may abort it; dashboards use the
      // takeover RPC, which also advances ownership and persists the reply.
      if (claims.actor !== "visitor" || !claims.canSubmitVisitor) {
        return reject("unauthorized", null, true);
      }
      return { allowed: true, raw: input.raw, submittedMessageId: null };
    case "stream-resume-request":
    case "stream-resume-ack":
      return { allowed: true, raw: input.raw, submittedMessageId: null };
    case "chat-request":
      if (claims.actor !== "visitor" || !claims.canSubmitVisitor) {
        return reject("unauthorized", event.id, true);
      }
      return normalizeRequest(
        input.raw,
        input.authoritativeMessages,
        claims,
        input.now ?? Date.now(),
        input.expectedOrigin ?? null,
      );
    case "clear":
    case "messages":
    case "tool-result":
    case "tool-approval":
      return reject("forbidden_protocol", null, true);
  }
}

export function buildPublicProtocolErrorFrame(requestId: string): string {
  return JSON.stringify({
    type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
    id: requestId,
    body: "Public chat request rejected.",
    done: true,
    error: true,
  });
}
