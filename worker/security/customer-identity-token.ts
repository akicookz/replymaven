import type { CustomerIdentityTokenPayload } from "../../shared/customer-types";
import { decrypt } from "../services/encryption-service";
import { customerIdentityTokenPayloadSchema } from "../validation";

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export class InvalidIdentityTokenError extends Error {
  constructor() {
    super("Invalid customer identity token");
    this.name = "InvalidIdentityTokenError";
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
    throw new InvalidIdentityTokenError();
  }
  const normalized = segment.replaceAll("-", "+").replaceAll("_", "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const decoded = atob(normalized + "=".repeat(paddingLength));
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== segment) {
    throw new InvalidIdentityTokenError();
  }
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export async function verifyCustomerIdentityToken(input: {
  token: string;
  encryptedSecret: string;
  encryptionKey: string;
  expectedProjectId: string;
  nowSeconds: number;
}): Promise<CustomerIdentityTokenPayload> {
  try {
    const segments = input.token.split(".");
    if (segments.length !== 2) throw new InvalidIdentityTokenError();
    const [payloadSegment, signatureSegment] = segments;
    const payloadBytes = decodeBase64Url(payloadSegment);
    const signatureBytes = decodeBase64Url(signatureSegment);
    const secret = await decrypt(input.encryptedSecret, input.encryptionKey);
    const key = await importHmacKey(secret);
    const verified = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(payloadSegment),
    );
    if (!verified) throw new InvalidIdentityTokenError();

    const rawPayload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes),
    ) as unknown;
    const parsed = customerIdentityTokenPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) throw new InvalidIdentityTokenError();
    if (parsed.data.projectId !== input.expectedProjectId) {
      throw new InvalidIdentityTokenError();
    }
    if (
      parsed.data.exp <= input.nowSeconds ||
      parsed.data.iat > input.nowSeconds
    ) {
      throw new InvalidIdentityTokenError();
    }
    return parsed.data;
  } catch {
    throw new InvalidIdentityTokenError();
  }
}
