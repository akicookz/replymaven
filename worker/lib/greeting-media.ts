export type GreetingMediaType = "image" | "video";

const VIDEO_EXTENSION_RE = /\.(?:mp4|webm|ogv|ogg)(?:$|[?#])/i;

export function isGreetingVideoUrl(mediaUrl: string): boolean {
  return VIDEO_EXTENSION_RE.test(mediaUrl);
}

export interface GreetingMediaSource {
  imageUrl: string | null;
  videoUrl?: string | null;
}

export interface ResolvedGreetingMedia {
  mediaType: GreetingMediaType | null;
  videoUrl: string | null;
  /** Artwork when there is no video, poster frame when there is. */
  imageUrl: string | null;
}

/**
 * Rows created before `video_url` existed stored the video in `image_url`, so a
 * video-looking `image_url` with no `video_url` is still read as the video.
 */
export function resolveGreetingMedia(
  row: GreetingMediaSource,
): ResolvedGreetingMedia {
  const video = row.videoUrl?.trim() || null;
  const image = row.imageUrl?.trim() || null;

  if (video) return { mediaType: "video", videoUrl: video, imageUrl: image };
  if (image && isGreetingVideoUrl(image)) {
    return { mediaType: "video", videoUrl: image, imageUrl: null };
  }
  if (image) return { mediaType: "image", videoUrl: null, imageUrl: image };
  return { mediaType: null, videoUrl: null, imageUrl: null };
}
