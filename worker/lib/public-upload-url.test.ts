import { describe, expect, test } from "bun:test";
import {
  isAllowedStoredUploadUrl,
  publicUploadUrl,
} from "./public-upload-url";

describe("publicUploadUrl", () => {
  test("returns the ReplyMaven upload href", () => {
    expect(publicUploadUrl("user-1/mark.png")).toBe(
      "https://replymaven.com/api/uploads/user-1/mark.png",
    );
  });
});

describe("isAllowedStoredUploadUrl", () => {
  test("accepts a relative leftover and an absolute ReplyMaven href", () => {
    expect(isAllowedStoredUploadUrl("/api/uploads/user-1/grid.png")).toBe(true);
    expect(
      isAllowedStoredUploadUrl(
        "https://replymaven.com/api/uploads/user-1/grid.png",
      ),
    ).toBe(true);
  });

  test("rejects a foreign host and traversal", () => {
    expect(
      isAllowedStoredUploadUrl("https://encited.com/api/uploads/foo.png"),
    ).toBe(false);
    expect(isAllowedStoredUploadUrl("/api/uploads/../secret.png")).toBe(false);
    expect(isAllowedStoredUploadUrl("https://cdn.example/grid.png")).toBe(
      false,
    );
  });
});
