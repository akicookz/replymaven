// Multiple attachment URLs are packed into the messages.image_url text column
// as a JSON array string (same pattern as messages.sources) — no D1 migration,
// and legacy single-URL rows keep working. Shared by worker, SPA, and widget.

export function parseMessageImageUrls(
  raw: string | null | undefined,
): string[] {
  const value = raw?.trim();
  if (!value) return [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (url): url is string => typeof url === "string" && url.length > 0,
        );
      }
    } catch {
      // Fall through — treat as a plain (odd-looking) URL.
    }
  }
  return [value];
}

/** Image-only sends store a server placeholder ("Sent an image"/"Sent images")
 *  as content — it is synthetic, never something a user meaningfully typed. */
export function isImagePlaceholderContent(content: string): boolean {
  return content === "Sent an image" || content === "Sent images";
}

/** Whether a message's text content should be rendered. The synthetic
 *  image-only placeholder is always suppressed (the image itself carries the
 *  meaning); real text always shows. Single source of truth for every surface
 *  (inbox bubbles, focus view, widget) so the rule can't drift. */
export function shouldShowMessageContent(
  content: string | null | undefined,
): boolean {
  return !!content && !isImagePlaceholderContent(content);
}

export function serializeMessageImageUrls(
  urls: readonly string[],
): string | null {
  const cleaned = urls.map((url) => url.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) return cleaned[0];
  return JSON.stringify(cleaned);
}
