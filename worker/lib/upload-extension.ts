const UPLOAD_EXTENSION_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/**
 * File extension for an upload, taken from the validated content type rather
 * than the filename.
 *
 * Consumers validate the returned URL against a strict extension regex, so a
 * filename-derived extension breaks them: a JPEG named `photo.jfif` (the
 * Chrome-on-Windows default) or a file with no extension uploads fine and then
 * fails validation on save.
 *
 * Unknown-but-allowed types keep the old filename fallback, sanitized to ASCII
 * alphanumerics because the URL is checked against a same-origin path regex and
 * raw extensions can carry spaces or quotes.
 */
export function uploadExtensionFor(
  contentType: string,
  filename: string,
): string {
  const known = UPLOAD_EXTENSION_BY_TYPE[contentType];
  if (known) return known;
  const raw = filename.split(".").pop() ?? "";
  const sanitized = raw.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return sanitized === "" ? "bin" : sanitized;
}
