import { describe, expect, test } from "bun:test";
import { isEncrypted } from "./encryption-service";
import {
  deriveTelegramWebhookSecret,
  encryptTelegramToken,
  matchesTelegramWebhookSecret,
  resolveTelegramToken,
} from "./telegram-secrets";

const key = "a".repeat(64);
const otherKey = "b".repeat(64);
const token = "8154237761:AAHkq2Vv0y0Zm7Q1x9rTuWbN3sLpQ4dFgHi";

describe("telegram token at rest", () => {
  test("encrypts to an opaque value and reads back the token", async () => {
    const stored = await encryptTelegramToken(token, key);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(":");
    expect(isEncrypted(stored)).toBe(true);
    expect(await resolveTelegramToken(stored, key)).toBe(token);
  });

  test("reads a legacy plaintext row unchanged", async () => {
    // Rows written before encryption hold the raw token; the ':' in every
    // Telegram token makes them impossible to mistake for base64 ciphertext.
    expect(isEncrypted(token)).toBe(false);
    expect(await resolveTelegramToken(token, key)).toBe(token);
  });

  test("returns null for empty rows and for a value the key cannot open", async () => {
    expect(await resolveTelegramToken(null, key)).toBeNull();
    expect(await resolveTelegramToken(undefined, key)).toBeNull();
    expect(await resolveTelegramToken("", key)).toBeNull();
    const stored = await encryptTelegramToken(token, key);
    expect(await resolveTelegramToken(stored, otherKey)).toBeNull();
  });
});

describe("telegram webhook secret", () => {
  test("is stable per project and unguessable across projects", async () => {
    const first = await deriveTelegramWebhookSecret("project-1", key);
    expect(await deriveTelegramWebhookSecret("project-1", key)).toBe(first);
    expect(await deriveTelegramWebhookSecret("project-2", key)).not.toBe(first);
    expect(await deriveTelegramWebhookSecret("project-1", otherKey))
      .not.toBe(first);
  });

  test("uses only the characters Telegram accepts", async () => {
    const secret = await deriveTelegramWebhookSecret("project-1", key);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  });

  test("matches only the exact secret", async () => {
    const secret = await deriveTelegramWebhookSecret("project-1", key);
    expect(matchesTelegramWebhookSecret(secret, secret)).toBe(true);
    expect(matchesTelegramWebhookSecret(secret, null)).toBe(false);
    expect(matchesTelegramWebhookSecret(secret, undefined)).toBe(false);
    expect(matchesTelegramWebhookSecret(secret, "")).toBe(false);
    expect(matchesTelegramWebhookSecret(secret, secret.slice(0, -1))).toBe(false);
    expect(
      matchesTelegramWebhookSecret(secret, `${secret.slice(0, -1)}X`),
    ).toBe(false);
  });
});
