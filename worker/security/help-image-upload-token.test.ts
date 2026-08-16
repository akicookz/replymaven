import { describe, expect, test } from "bun:test";
import {
  buildHelpImageKey,
  extensionForContentType,
  isHelpImageContentType,
  isHelpImageKey,
  signHelpImageUploadToken,
  verifyHelpImageUploadToken,
  type HelpImageUploadPayload,
} from "./help-image-upload-token";

const SECRET = "test-secret-value";
const NOW = 1_770_000_000;

function payload(
  overrides: Partial<HelpImageUploadPayload> = {},
): HelpImageUploadPayload {
  return {
    v: 1,
    projectId: "project-1",
    key: "help-images/project-1/11111111-2222-3333-4444-555555555555.png",
    contentType: "image/png",
    exp: NOW + 900,
    ...overrides,
  };
}

describe("help image upload tokens", () => {
  test("round-trips a valid token", async () => {
    const token = await signHelpImageUploadToken({
      payload: payload(),
      secret: SECRET,
    });
    const verified = await verifyHelpImageUploadToken({
      token,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(verified.key).toBe(payload().key);
    expect(verified.contentType).toBe("image/png");
  });

  test("rejects a token signed with a different secret", async () => {
    const token = await signHelpImageUploadToken({
      payload: payload(),
      secret: "other-secret",
    });
    await expect(
      verifyHelpImageUploadToken({ token, secret: SECRET, nowSeconds: NOW }),
    ).rejects.toThrow("Invalid or expired");
  });

  test("rejects an expired token", async () => {
    const token = await signHelpImageUploadToken({
      payload: payload({ exp: NOW - 1 }),
      secret: SECRET,
    });
    await expect(
      verifyHelpImageUploadToken({ token, secret: SECRET, nowSeconds: NOW }),
    ).rejects.toThrow("Invalid or expired");
  });

  test("rejects a tampered payload", async () => {
    const token = await signHelpImageUploadToken({
      payload: payload(),
      secret: SECRET,
    });
    const forged = await signHelpImageUploadToken({
      payload: payload({ key: "help-images/project-2/aaaa.png" }),
      secret: "other-secret",
    });
    const spliced = `${forged.split(".")[0]}.${token.split(".")[1]}`;
    await expect(
      verifyHelpImageUploadToken({
        token: spliced,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).rejects.toThrow("Invalid or expired");
  });

  test("rejects a key that escapes the help-images prefix", async () => {
    const token = await signHelpImageUploadToken({
      payload: payload({ key: "project-1/articles/steal.md" }),
      secret: SECRET,
    });
    await expect(
      verifyHelpImageUploadToken({ token, secret: SECRET, nowSeconds: NOW }),
    ).rejects.toThrow("Invalid or expired");
  });
});

describe("help image keys", () => {
  test("stay outside the projectId prefix AI Search indexes", () => {
    const key = buildHelpImageKey({ projectId: "project-1", extension: "png" });
    expect(key.startsWith("help-images/project-1/")).toBe(true);
    expect(key.startsWith("project-1/")).toBe(false);
    expect(isHelpImageKey(key, "project-1")).toBe(true);
  });

  test("reject a key belonging to another project", () => {
    const key = buildHelpImageKey({ projectId: "project-1", extension: "png" });
    expect(isHelpImageKey(key, "project-2")).toBe(false);
  });

  test("sanitize the extension", () => {
    const key = buildHelpImageKey({
      projectId: "project-1",
      extension: "../evil",
    });
    expect(key.endsWith(".evil")).toBe(true);
    expect(isHelpImageKey(key, "project-1")).toBe(true);
  });
});

describe("content types", () => {
  test("accepts the allowlist and nothing else", () => {
    expect(isHelpImageContentType("image/png")).toBe(true);
    expect(isHelpImageContentType("image/svg+xml")).toBe(true);
    expect(isHelpImageContentType("image/gif")).toBe(false);
    expect(isHelpImageContentType("application/pdf")).toBe(false);
  });

  test("maps to file extensions", () => {
    expect(extensionForContentType("image/jpeg")).toBe("jpg");
    expect(extensionForContentType("image/svg+xml")).toBe("svg");
  });
});
