import type { PublicChatChildClaims } from "../../../../shared/public-chat-agent";
import { toPublicChildName } from "../../../../shared/maven-conversation";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PUBLIC_CHAT_AUDIENCE = "replymaven-public-chat";
const PUBLIC_CHAT_VERSION = 1;
const PUBLIC_CHAT_LIFETIME_SECONDS = 120;
const MAX_CLOCK_SKEW_SECONDS = 30;
const TRUSTED_CLAIMS_HEADER = "x-replymaven-public-chat-claims";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const remainder = padded.length % 4;
  const input = remainder === 0
    ? padded
    : padded.padEnd(padded.length + 4 - remainder, "=");
  try {
    return Uint8Array.from(
      atob(input),
      (character) => character.charCodeAt(0),
    );
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isPublicChatAgentId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function parsePublicClaims(value: unknown): PublicChatChildClaims | null {
  if (!isRecord(value) || Object.keys(value).length !== 13) return null;
  if (
    value.v !== PUBLIC_CHAT_VERSION ||
    value.aud !== PUBLIC_CHAT_AUDIENCE ||
    value.scope !== "child" ||
    !isPublicChatAgentId(value.projectId) ||
    value.parentName !== value.projectId ||
    !isPublicChatAgentId(value.conversationId) ||
    value.childName !== toPublicChildName(value.conversationId) ||
    typeof value.canSubmitVisitor !== "boolean" ||
    value.canRead !== true ||
    !Number.isInteger(value.iat) ||
    !Number.isInteger(value.exp)
  ) return null;

  if (value.actor === "visitor") {
    if (
      !isPublicChatAgentId(value.visitorId) ||
      value.canSubmitVisitor !== true
    ) {
      return null;
    }
  } else if (value.actor === "dashboard") {
    if (value.visitorId !== null || value.canSubmitVisitor !== false) {
      return null;
    }
  } else {
    return null;
  }

  return {
    v: 1,
    aud: PUBLIC_CHAT_AUDIENCE,
    scope: "child",
    actor: value.actor,
    projectId: value.projectId,
    parentName: value.parentName,
    conversationId: value.conversationId,
    childName: value.childName,
    visitorId: value.visitorId,
    canSubmitVisitor: value.canSubmitVisitor,
    canRead: true,
    iat: value.iat as number,
    exp: value.exp as number,
  };
}

function canonicalClaims(claims: PublicChatChildClaims): string {
  return JSON.stringify({
    v: claims.v,
    aud: claims.aud,
    scope: claims.scope,
    actor: claims.actor,
    projectId: claims.projectId,
    parentName: claims.parentName,
    conversationId: claims.conversationId,
    childName: claims.childName,
    visitorId: claims.visitorId,
    canSubmitVisitor: claims.canSubmitVisitor,
    canRead: claims.canRead,
    iat: claims.iat,
    exp: claims.exp,
  });
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("SIDECHAT_TOKEN_SECRET is too short");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function withVerifiedClaims(
  request: Request,
  claims: PublicChatChildClaims,
): Request {
  const url = new URL(request.url);
  url.searchParams.delete("token");
  const forwarded = new Request(url.toString(), request);
  forwarded.headers.set(
    TRUSTED_CLAIMS_HEADER,
    encodeBase64Url(encoder.encode(canonicalClaims(claims))),
  );
  return forwarded;
}

export async function signPublicChatToken(
  claims: PublicChatChildClaims,
  secret: string,
): Promise<string> {
  const parsed = parsePublicClaims(claims);
  if (!parsed || canonicalClaims(parsed) !== canonicalClaims(claims)) {
    throw new Error("Invalid public chat claims");
  }
  const payload = encodeBase64Url(encoder.encode(canonicalClaims(parsed)));
  return `${payload}.${encodeBase64Url(await hmac(payload, secret))}`;
}

export async function verifyPublicChatToken(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1_000),
): Promise<PublicChatChildClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, encodedSignature] = parts;
  if (!payload || !encodedSignature) return null;
  const payloadBytes = decodeBase64Url(payload);
  const signature = decodeBase64Url(encodedSignature);
  if (!payloadBytes || !signature) return null;

  let expected: Uint8Array;
  try {
    expected = await hmac(payload, secret);
  } catch {
    return null;
  }
  if (!constantTimeEqual(signature, expected)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return null;
  }
  const claims = parsePublicClaims(decoded);
  if (!claims) return null;
  if (encodeBase64Url(encoder.encode(canonicalClaims(claims))) !== payload) {
    return null;
  }
  if (
    claims.iat > now + MAX_CLOCK_SKEW_SECONDS ||
    claims.exp <= now ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > PUBLIC_CHAT_LIFETIME_SECONDS
  ) return null;
  return claims;
}

export function readVerifiedPublicChatClaims(
  request: Request,
): PublicChatChildClaims | null {
  const encoded = request.headers.get(TRUSTED_CLAIMS_HEADER);
  if (!encoded) return null;
  const bytes = decodeBase64Url(encoded);
  if (!bytes) return null;
  try {
    return parsePublicClaims(JSON.parse(decoder.decode(bytes)));
  } catch {
    return null;
  }
}

export function readPublicChatConnectionClaims(
  state: unknown,
): PublicChatChildClaims | null {
  if (!isRecord(state)) return null;
  return parsePublicClaims(state.publicChatActor);
}

interface PublicSubAgentAuthorizationOptions {
  expectedVisitorId?: string | null;
  now?: number;
}

export async function authorizePublicSubAgentRequest(
  request: Request,
  parentName: string,
  childName: string,
  secret: string,
  options: PublicSubAgentAuthorizationOptions = {},
): Promise<Request | Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return unauthorized();
  const claims = await verifyPublicChatToken(token, secret, options.now);
  if (!claims) return unauthorized();
  if (
    claims.projectId !== parentName ||
    claims.parentName !== parentName ||
    claims.childName !== childName ||
    toPublicChildName(claims.conversationId) !== childName ||
    (options.expectedVisitorId !== undefined &&
      claims.visitorId !== options.expectedVisitorId)
  ) return notFound();
  return withVerifiedClaims(request, claims);
}

export async function authorizePublicAgentRouteRequest(
  request: Request,
  secret: string,
  now?: number,
): Promise<Request | Response> {
  let segments: string[];
  try {
    segments = new URL(request.url).pathname.split("/").filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return notFound();
  }
  if (
    segments[0] !== "agents" ||
    segments[1] !== "maven-project-agent" ||
    !segments[2] ||
    segments[3] !== "sub" ||
    segments[4] !== "maven-chat-agent" ||
    !segments[5]?.startsWith("pub_")
  ) return notFound();

  const token = new URL(request.url).searchParams.get("token");
  if (!token) return unauthorized();
  const claims = await verifyPublicChatToken(token, secret, now);
  if (!claims) return unauthorized();
  if (
    claims.projectId !== segments[2] ||
    claims.parentName !== segments[2] ||
    claims.childName !== segments[5] ||
    toPublicChildName(claims.conversationId) !== segments[5]
  ) return notFound();
  return request;
}
