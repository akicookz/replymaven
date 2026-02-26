// ─── AES-256-GCM Encryption for Sensitive Values ──────────────────────────────
//
// Used to encrypt tool headers (API keys, auth tokens) and other secrets
// before storing in D1. The ENCRYPTION_KEY env var is a hex-encoded 256-bit key.

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // 96 bits, recommended for AES-GCM
const KEY_LENGTH = 256;

async function importKey(hexKey: string): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(
    hexKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
  );
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string in the format: iv:ciphertext
 */
export async function encrypt(
  plaintext: string,
  encryptionKey: string,
): Promise<string> {
  const key = await importKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded,
  );

  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64-encoded string (iv:ciphertext) back to plaintext.
 */
export async function decrypt(
  encrypted: string,
  encryptionKey: string,
): Promise<string> {
  const key = await importKey(encryptionKey);

  const combined = new Uint8Array(
    atob(encrypted)
      .split("")
      .map((c) => c.charCodeAt(0)),
  );

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Encrypt a headers object (key-value pairs).
 * Returns an encrypted JSON string.
 */
export async function encryptHeaders(
  headers: Record<string, string>,
  encryptionKey: string,
): Promise<string> {
  const json = JSON.stringify(headers);
  return encrypt(json, encryptionKey);
}

/**
 * Decrypt an encrypted headers string back to a key-value object.
 */
export async function decryptHeaders(
  encrypted: string,
  encryptionKey: string,
): Promise<Record<string, string>> {
  const json = await decrypt(encrypted, encryptionKey);
  return JSON.parse(json) as Record<string, string>;
}

/**
 * Check if a string looks like it's encrypted (base64 with minimum length for IV + data).
 * Used to handle migration from plaintext to encrypted storage gracefully.
 */
export function isEncrypted(value: string): boolean {
  // Encrypted values are base64-encoded and at least IV_LENGTH bytes long
  // A base64 string of 12+ bytes is at least 16 chars
  if (value.length < 16) return false;
  try {
    const decoded = atob(value);
    // Minimum: 12 bytes IV + 16 bytes (AES-GCM tag) = 28 bytes
    return decoded.length >= 28;
  } catch {
    return false;
  }
}

/**
 * Mask header values for display — show only the key names with masked values.
 * Returns a new object with the same keys but values replaced with bullet characters.
 */
export function maskHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value.length <= 8) {
      masked[key] = "••••••••";
    } else {
      masked[key] = value.slice(0, 4) + "••••" + value.slice(-4);
    }
  }
  return masked;
}
