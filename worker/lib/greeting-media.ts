export type GreetingMediaType = "image" | "video";

const VIDEO_EXTENSION_RE = /\.(?:mp4|webm|ogv)(?:$|[?#])/i;

/**
 * Greetings reuse the existing image_url column. The media type is derived
 * from the stored URL so no schema change is needed.
 */
export function getGreetingMediaType(
  mediaUrl: string | null | undefined,
): GreetingMediaType | null {
  if (!mediaUrl) return null;
  return VIDEO_EXTENSION_RE.test(mediaUrl) ? "video" : "image";
}

export function isGreetingVideoUrl(mediaUrl: string): boolean {
  return VIDEO_EXTENSION_RE.test(mediaUrl);
}
