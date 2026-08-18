import { decrypt, encrypt, isEncrypted } from "./encryption-service";

// A bot token is a live credential: it can rewrite the bot's profile, read its
// chats, and repoint its webhook. It is stored encrypted, and every read goes
// through `resolveTelegramToken` so rows written before this change still work.
export async function encryptTelegramToken(
  token: string,
  encryptionKey: string,
): Promise<string> {
  return encrypt(token, encryptionKey);
}

export async function resolveTelegramToken(
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

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Telegram echoes this back in `X-Telegram-Bot-Api-Secret-Token` on every
// update, which is what separates a real update from anyone who knows the
// project id. Derived rather than stored so it needs no column and no rotation
// path of its own. Telegram accepts 1-256 characters of [A-Za-z0-9_-].
export async function deriveTelegramWebhookSecret(
  projectId: string,
  encryptionKey: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(encryptionKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`telegram-webhook:${projectId}`),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export function matchesTelegramWebhookSecret(
  expected: string,
  received: string | null | undefined,
): boolean {
  if (!received || received.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  }
  return mismatch === 0;
}
