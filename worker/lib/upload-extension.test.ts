import { describe, expect, test } from "bun:test";
import { uploadExtensionFor } from "./upload-extension";
import { createHelpCategorySchema } from "../validation";

/** Category icons accept an uploaded image path matched by a strict extension
 *  regex — the same shape every consumer of an /api/upload URL uses. */
function iconUrlAccepted(url: string): boolean {
  return createHelpCategorySchema.safeParse({ name: "n", icon: url }).success;
}

describe("uploadExtensionFor", () => {
  test("uses the content type, not the filename", () => {
    // Chrome on Windows names JPEG screenshots .jfif; .jpe and no extension at
    // all also occur. All three used to produce an unusable cover URL.
    expect(uploadExtensionFor("image/jpeg", "photo.jfif")).toBe("jpg");
    expect(uploadExtensionFor("image/jpeg", "photo.jpe")).toBe("jpg");
    expect(uploadExtensionFor("image/jpeg", "screenshot")).toBe("jpg");
    expect(uploadExtensionFor("image/png", "a.PNG")).toBe("png");
    expect(uploadExtensionFor("image/svg+xml", "icon.svg")).toBe("svg");
    expect(uploadExtensionFor("application/pdf", "manual.PDF")).toBe("pdf");
  });

  test("falls back to a sanitized filename extension for unknown types", () => {
    expect(uploadExtensionFor("application/zip", "bundle.zip")).toBe("zip");
    expect(uploadExtensionFor("application/zip", 'weird."name.tar')).toBe("tar");
    // No dot at all: pop() returns the whole name, which is the pre-existing
    // behaviour for unrecognized types.
    expect(uploadExtensionFor("application/zip", "noext")).toBe("noext");
    expect(uploadExtensionFor("application/zip", "!!!")).toBe("bin");
  });

  test("raster image types yield a URL the icon schema accepts", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      const ext = uploadExtensionFor(type, "whatever.jfif");
      expect(iconUrlAccepted(`/api/uploads/user-1/abc.${ext}`)).toBe(true);
    }
  });

  test("the old filename-derived extension is what these consumers reject", () => {
    expect(iconUrlAccepted("/api/uploads/user-1/abc.jfif")).toBe(false);
  });
});
