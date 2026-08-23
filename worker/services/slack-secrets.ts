import { decrypt, encrypt, isEncrypted } from "./encryption-service";

export async function encryptSlackSecret(
  value: string,
  encryptionKey: string,
): Promise<string> {
  return encrypt(value, encryptionKey);
}

export async function resolveSlackSecret(
  stored: string | null | undefined,
  encryptionKey: string,
): Promise<string | null> {
  if (!stored) return null;
  if (!isEncrypted(stored)) return stored;
  try {
    return await decrypt(stored, encryptionKey);
  } catch {
    return null;
  }
}

function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function matchesSlackRequestSignature(input: {
  signingSecret: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  rawBody: string;
  now?: number;
}): Promise<boolean> {
  const timestamp = input.timestamp?.trim() ?? "";
  const signature = input.signature?.trim() ?? "";
  if (!timestamp || !signature.startsWith("v0=")) return false;
  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 60 * 5) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${timestamp}:${input.rawBody}`),
  );
  const expected = `v0=${encodeHex(new Uint8Array(digest))}`;
  return timingSafeEqual(expected, signature);
}
