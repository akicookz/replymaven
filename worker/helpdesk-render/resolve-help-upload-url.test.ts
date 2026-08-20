import { describe, expect, test } from "bun:test";
import { resolveHelpUploadUrl } from "./resolve-help-upload-url";

describe("resolveHelpUploadUrl", () => {
  test("prefixes a relative upload path", () => {
    expect(resolveHelpUploadUrl("/api/uploads/user-1/mark.png")).toBe(
      "https://replymaven.com/api/uploads/user-1/mark.png",
    );
  });

  test("keeps an already-absolute upload URL", () => {
    expect(
      resolveHelpUploadUrl(
        "https://replymaven.com/api/uploads/help-images/project-1/shot.jpg",
      ),
    ).toBe("https://replymaven.com/api/uploads/help-images/project-1/shot.jpg");
  });

  test("leaves a foreign https URL alone", () => {
    expect(resolveHelpUploadUrl("https://encited.com/marketing/hero.webp")).toBe(
      "https://encited.com/marketing/hero.webp",
    );
  });

  test("does not prefix a traversal upload path", () => {
    expect(resolveHelpUploadUrl("/api/uploads/../secret.png")).toBe(
      "/api/uploads/../secret.png",
    );
  });

  test("returns null for empty input", () => {
    expect(resolveHelpUploadUrl(null)).toBeNull();
    expect(resolveHelpUploadUrl("")).toBeNull();
    expect(resolveHelpUploadUrl("   ")).toBeNull();
  });
});
