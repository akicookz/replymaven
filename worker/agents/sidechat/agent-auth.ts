import type {
  SidechatActorClaims,
  SidechatChildClaims,
  SidechatParentClaims,
} from "../../../shared/sidechat-agent";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SIDECHAT_TOKEN_AUDIENCE = "replymaven-sidechat";
const SIDECHAT_TOKEN_VERSION = 1;
const SIDECHAT_TOKEN_LIFETIME_SECONDS = 120;
const MAX_CLOCK_SKEW_SECONDS = 30;
const TRUSTED_CLAIMS_HEADER = "x-replymaven-sidechat-claims";
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
  const input = remainder === 0 ? padded : padded.padEnd(padded.length + 4 - remainder, "=");
  try {
    return Uint8Array.from(atob(input), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRole(value: unknown): value is SidechatActorClaims["role"] {
  return value === "owner" || value === "admin" || value === "member";
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function parseClaims(value: unknown): SidechatActorClaims | null {
  if (!isRecord(value)) return null;
  const baseIsValid =
    isSafeId(value.userId) &&
    isSafeId(value.effectiveUserId) &&
    isSafeId(value.projectId) &&
    isSafeId(value.parentName) &&
    isRole(value.role) &&
    Number.isInteger(value.iat) &&
    Number.isInteger(value.exp) &&
    value.aud === SIDECHAT_TOKEN_AUDIENCE &&
    value.v === SIDECHAT_TOKEN_VERSION;
  if (!baseIsValid) return null;

  const base = {
    userId: value.userId as string,
    effectiveUserId: value.effectiveUserId as string,
    projectId: value.projectId as string,
    parentName: value.parentName as string,
    role: value.role as SidechatActorClaims["role"],
    iat: value.iat as number,
    exp: value.exp as number,
    aud: SIDECHAT_TOKEN_AUDIENCE,
    v: SIDECHAT_TOKEN_VERSION,
  } as const;

  if (value.scope === "parent" && Object.keys(value).length === 10) {
    return { ...base, scope: "parent" };
  }

  if (
    value.scope === "child" &&
    Object.keys(value).length === 15 &&
    isSafeId(value.conversationId) &&
    value.childName === `sc_${value.conversationId}` &&
    typeof value.canSubmit === "boolean" &&
    typeof value.canApproveOnce === "boolean" &&
    typeof value.canAlwaysAllow === "boolean"
  ) {
    return {
      ...base,
      scope: "child",
      conversationId: value.conversationId,
      childName: value.childName,
      canSubmit: value.canSubmit,
      canApproveOnce: value.canApproveOnce,
      canAlwaysAllow: value.canAlwaysAllow,
    };
  }

  return null;
}

function canonicalClaims(claims: SidechatActorClaims): string {
  const base = {
    userId: claims.userId,
    effectiveUserId: claims.effectiveUserId,
    projectId: claims.projectId,
    parentName: claims.parentName,
    role: claims.role,
    iat: claims.iat,
    exp: claims.exp,
    aud: claims.aud,
    v: claims.v,
  };
  if (claims.scope === "parent") {
    return JSON.stringify({ ...base, scope: claims.scope });
  }
  return JSON.stringify({
    ...base,
    scope: claims.scope,
    conversationId: claims.conversationId,
    childName: claims.childName,
    canSubmit: claims.canSubmit,
    canApproveOnce: claims.canApproveOnce,
    canAlwaysAllow: claims.canAlwaysAllow,
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

function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

function withVerifiedClaims(
  request: Request,
  claims: SidechatActorClaims,
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

export function toSidechatChildName(conversationId: string): string {
  if (!SAFE_ID.test(conversationId)) {
    throw new Error("Invalid Sidechat conversation ID");
  }
  return `sc_${conversationId}`;
}

export async function signSidechatToken(
  claims: SidechatActorClaims,
  secret: string,
): Promise<string> {
  const parsed = parseClaims(claims);
  if (!parsed || canonicalClaims(parsed) !== canonicalClaims(claims)) {
    throw new Error("Invalid Sidechat claims");
  }
  const payload = encodeBase64Url(encoder.encode(canonicalClaims(parsed)));
  return `${payload}.${encodeBase64Url(await hmac(payload, secret))}`;
}

export async function verifySidechatToken(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1_000),
): Promise<SidechatActorClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, encodedSignature] = parts;
  if (!payload || !encodedSignature) return null;
  const signature = decodeBase64Url(encodedSignature);
  const payloadBytes = decodeBase64Url(payload);
  if (!signature || !payloadBytes) return null;

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
  const claims = parseClaims(decoded);
  if (!claims) return null;
  if (encodeBase64Url(encoder.encode(canonicalClaims(claims))) !== payload) {
    return null;
  }
  if (
    claims.iat > now + MAX_CLOCK_SKEW_SECONDS ||
    claims.exp <= now ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > SIDECHAT_TOKEN_LIFETIME_SECONDS
  ) {
    return null;
  }
  return claims;
}

export function readVerifiedSidechatClaims(
  request: Request,
): SidechatActorClaims | null {
  const encoded = request.headers.get(TRUSTED_CLAIMS_HEADER);
  if (!encoded) return null;
  const bytes = decodeBase64Url(encoded);
  if (!bytes) return null;
  try {
    return parseClaims(JSON.parse(decoder.decode(bytes)));
  } catch {
    return null;
  }
}

export async function authorizeParentAgentRequest(
  request: Request,
  parentName: string,
  secret: string,
  now?: number,
): Promise<Request | Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return unauthorized();
  const claims = await verifySidechatToken(token, secret, now);
  if (!claims) return unauthorized();
  if (
    claims.scope !== "parent" ||
    claims.projectId !== parentName ||
    claims.parentName !== parentName
  ) {
    return notFound();
  }
  return withVerifiedClaims(request, claims);
}

export async function authorizeSubAgentRequest(
  request: Request,
  parentName: string,
  childName: string,
  secret: string,
  now?: number,
): Promise<Request | Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return unauthorized();
  const claims = await verifySidechatToken(token, secret, now);
  if (!claims) return unauthorized();
  if (
    claims.scope !== "child" ||
    claims.projectId !== parentName ||
    claims.parentName !== parentName ||
    claims.childName !== childName ||
    toSidechatChildName(claims.conversationId) !== childName
  ) {
    return notFound();
  }
  return withVerifiedClaims(request, claims);
}

function decodedPathSegments(pathname: string): string[] | null {
  try {
    return pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

export async function authorizeSidechatAgentRouteRequest(
  request: Request,
  secret: string,
  now?: number,
): Promise<Request | Response> {
  const segments = decodedPathSegments(new URL(request.url).pathname);
  if (
    !segments ||
    segments[0] !== "agents" ||
    segments[1] !== "maven-project-agent" ||
    !segments[2]
  ) {
    return notFound();
  }
  const parentName = segments[2];
  if (segments[3] !== "sub") {
    return authorizeParentAgentRequest(request, parentName, secret, now);
  }
  if (
    segments[4] !== "maven-chat-agent" ||
    !segments[5]
  ) {
    return notFound();
  }
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return unauthorized();
  const claims = await verifySidechatToken(token, secret, now);
  if (!claims) return unauthorized();
  if (
    claims.scope !== "child" ||
    claims.projectId !== parentName ||
    claims.parentName !== parentName ||
    claims.childName !== segments[5] ||
    toSidechatChildName(claims.conversationId) !== segments[5]
  ) {
    return notFound();
  }
  // Keep the signed token for the parent's independent registry/auth gate.
  // The parent removes it before forwarding and replaces it with verified
  // internal claims for the child connection.
  return request;
}

export type { SidechatChildClaims, SidechatParentClaims };
