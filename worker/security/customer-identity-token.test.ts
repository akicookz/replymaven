import { describe, expect, test } from "bun:test";
import type { CustomerIdentityTokenPayload } from "../../shared/customer-types";
import { encrypt } from "../services/encryption-service";
import {
  InvalidIdentityTokenError,
  verifyCustomerIdentityToken,
} from "./customer-identity-token";

const SECRET = "test-customer-identity-secret";
const ENCRYPTION_KEY = "11".repeat(32);
const NOW = 1_800_000_500;

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function encodeJson(payload: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

async function signPayload(
  payload: unknown,
  secret = SECRET,
): Promise<string> {
  const payloadSegment = encodeJson(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadSegment),
  );
  return `${payloadSegment}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function validPayload(): CustomerIdentityTokenPayload {
  return {
    v: 1,
    projectId: "project-1",
    externalId: "account-1",
    email: "sam@example.com",
    name: "Sam",
    customFields: { plan: "pro" },
    iat: 1_800_000_000,
    exp: 1_800_000_900,
  };
}

async function verify(token: string): Promise<CustomerIdentityTokenPayload> {
  return verifyCustomerIdentityToken({
    token,
    encryptedSecret: await encrypt(SECRET, ENCRYPTION_KEY),
    encryptionKey: ENCRYPTION_KEY,
    expectedProjectId: "project-1",
    nowSeconds: NOW,
  });
}

describe("verifyCustomerIdentityToken", () => {
  test("returns a valid authenticated payload", async () => {
    const payload = validPayload();

    expect(await verify(await signPayload(payload))).toEqual(payload);
  });

  test("rejects retired AI fields from an otherwise valid signed payload", async () => {
    const retiredField = { ...validPayload(), aiFieldKeys: ["plan"] };

    await expect(
      verify(await signPayload(retiredField)),
    ).rejects.toBeInstanceOf(InvalidIdentityTokenError);
  });

  test("rejects changed payloads, signatures, and signed custom fields", async () => {
    const token = await signPayload(validPayload());
    const [payloadSegment, signatureSegment] = token.split(".");
    const changedPayload = encodeJson({
      ...validPayload(),
      email: "attacker@example.com",
    });
    const changedFields = encodeJson({
      ...validPayload(),
      customFields: { plan: "enterprise" },
    });
    const changedSignature = `${signatureSegment.slice(0, -1)}${
      signatureSegment.endsWith("A") ? "B" : "A"
    }`;
    const invalidTokens = [
      `${changedPayload}.${signatureSegment}`,
      `${payloadSegment}.${changedSignature}`,
      `${changedFields}.${signatureSegment}`,
    ];

    for (const invalidToken of invalidTokens) {
      await expect(verify(invalidToken)).rejects.toBeInstanceOf(
        InvalidIdentityTokenError,
      );
    }
  });

  test("rejects wrong project, expiry, future issue time, and long lifetime", async () => {
    const invalidPayloads = [
      { ...validPayload(), projectId: "project-2" },
      { ...validPayload(), exp: NOW },
      { ...validPayload(), iat: NOW + 1, exp: NOW + 900 },
      { ...validPayload(), iat: NOW - 10, exp: NOW + 3_591 },
    ];

    for (const payload of invalidPayloads) {
      await expect(verify(await signPayload(payload))).rejects.toBeInstanceOf(
        InvalidIdentityTokenError,
      );
    }
  });

  test("rejects missing stable identity and malformed token segments", async () => {
    const valid = validPayload();
    const unstable = {
      v: valid.v,
      projectId: valid.projectId,
      name: valid.name,
      customFields: valid.customFields,
      iat: valid.iat,
      exp: valid.exp,
    };
    const invalidTokens = [
      await signPayload(unstable),
      "only-one-segment",
      "too.many.segments",
      "not+base64url.signature",
      ".signature",
    ];

    for (const token of invalidTokens) {
      await expect(verify(token)).rejects.toBeInstanceOf(
        InvalidIdentityTokenError,
      );
    }
  });
});
