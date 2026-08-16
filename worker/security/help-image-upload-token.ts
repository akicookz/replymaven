/**
 * Short-lived signed tokens that authorize a single R2 write for one help
 * center image.
 *
 * MCP tool inputs are JSON, so the only in-band way to send an image is base64
 * in a tool argument — a 500KB screenshot costs roughly 200k tokens that way.
 * A signed URL keeps the bytes out of the model transcript entirely: the tool
 * hands back a URL, the caller PUTs the file to it directly.
 *
 * The token binds the exact R2 key and content type, so a leaked one can only
 * overwrite the object it was issued for, and only until it expires.
 */

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export const HELP_IMAGE_UPLOAD_TTL_SECONDS = 900;

/** Same ceiling as /api/upload, so both paths reject the same files. */
export const MAX_HELP_IMAGE_BYTES = 10 * 1024 * 1024;

export const HELP_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
] as const;

export type HelpImageContentType = (typeof HELP_IMAGE_CONTENT_TYPES)[number];

export interface HelpImageUploadPayload {
  v: 1;
  projectId: string;
  key: string;
  contentType: HelpImageContentType;
  exp: number;
}

export class InvalidUploadTokenError extends Error {
  constructor() {
    super("Invalid or expired upload token");
    this.name = "InvalidUploadTokenError";
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(segment: string): Uint8Array {
  if (!segment || !BASE64_URL_PATTERN.test(segment)) {
    throw new InvalidUploadTokenError();
  }
  const normalized = segment.replaceAll("-", "+").replaceAll("_", "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const decoded = atob(normalized + "=".repeat(paddingLength));
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== segment) {
    throw new InvalidUploadTokenError();
  }
  return bytes;
}

async function importHmacKey(
  secret: string,
  usage: "sign" | "verify",
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signHelpImageUploadToken(input: {
  payload: HelpImageUploadPayload;
  secret: string;
}): Promise<string> {
  const payloadSegment = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(input.payload)),
  );
  const key = await importHmacKey(input.secret, "sign");
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadSegment),
  );
  return `${payloadSegment}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyHelpImageUploadToken(input: {
  token: string;
  secret: string;
  nowSeconds: number;
}): Promise<HelpImageUploadPayload> {
  try {
    const segments = input.token.split(".");
    if (segments.length !== 2) throw new InvalidUploadTokenError();
    const [payloadSegment, signatureSegment] = segments;
    const payloadBytes = decodeBase64Url(payloadSegment!);
    const signatureBytes = decodeBase64Url(signatureSegment!);
    const key = await importHmacKey(input.secret, "verify");
    const verified = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(payloadSegment!),
    );
    if (!verified) throw new InvalidUploadTokenError();

    const payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes),
    ) as HelpImageUploadPayload;

    if (
      payload.v !== 1 ||
      typeof payload.projectId !== "string" ||
      typeof payload.key !== "string" ||
      typeof payload.exp !== "number" ||
      !HELP_IMAGE_CONTENT_TYPES.includes(payload.contentType)
    ) {
      throw new InvalidUploadTokenError();
    }
    if (payload.exp <= input.nowSeconds) throw new InvalidUploadTokenError();
    if (!isHelpImageKey(payload.key, payload.projectId)) {
      throw new InvalidUploadTokenError();
    }
    return payload;
  } catch {
    throw new InvalidUploadTokenError();
  }
}

/**
 * Help images sit under `help-images/`, deliberately outside the `{projectId}/`
 * prefix that AI Search indexes as a recursive folder range. Anything below
 * that prefix would be swept into RAG retrieval as if it were a resource.
 */
export function buildHelpImageKey(input: {
  projectId: string;
  extension: string;
}): string {
  const ext = input.extension.toLowerCase().replace(/[^a-z0-9]/gu, "") || "bin";
  return `help-images/${input.projectId}/${crypto.randomUUID()}.${ext}`;
}

export function isHelpImageKey(key: string, projectId: string): boolean {
  return (
    key.startsWith(`help-images/${projectId}/`) &&
    /^help-images\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.[a-z0-9]+$/u.test(key)
  );
}

export function isHelpImageContentType(
  value: string,
): value is HelpImageContentType {
  return (HELP_IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}

export function extensionForContentType(
  contentType: HelpImageContentType,
): string {
  const map: Record<HelpImageContentType, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return map[contentType];
}
