export const OG_IMAGE_MIN_WIDTH = 600;
export const OG_IMAGE_MIN_HEIGHT = 315;
export const OG_IMAGE_ASPECT = 1.91;
export const OG_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const OG_OK_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export function ogImageTypeFromUrl(url: string): string | null {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) {
    const header = trimmed.slice("data:".length).split(";")[0] ?? "";
    return header || null;
  }
  try {
    const path = new URL(trimmed, "https://example.invalid").pathname;
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".gif")) return "image/gif";
    if (path.endsWith(".webp")) return "image/webp";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".bmp")) return "image/bmp";
    if (path.endsWith(".ico")) return "image/x-icon";
    if (path.endsWith(".avif")) return "image/avif";
    if (path.endsWith(".tif") || path.endsWith(".tiff")) return "image/tiff";
  } catch {
    return null;
  }
  return null;
}

export function isLikelySafeOgImageUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (/^https?:\/\//i.test(u)) return true;
  if (u.startsWith("/")) return true;
  if (/^data:image\//i.test(u)) return true;
  return false;
}

export function staticOgImageWarnings(url: string): string[] {
  const warnings: string[] = [];
  const trimmed = url.trim();
  if (!trimmed) return warnings;

  if (!isLikelySafeOgImageUrl(trimmed)) {
    warnings.push(
      "Use an https, site-relative, or image data URL. Social crawlers ignore other schemes.",
    );
  }
  if (/^data:/i.test(trimmed)) {
    warnings.push(
      "Data URLs are not fetched by most social crawlers. Upload the image instead.",
    );
  }

  const type = ogImageTypeFromUrl(trimmed);
  if (type && !OG_OK_TYPES.has(type)) {
    warnings.push(
      "Use JPEG, PNG, GIF, or WebP. SVG and other types are dropped by most networks.",
    );
  }

  return warnings;
}

export function dimensionOgImageWarnings(
  width: number,
  height: number,
): string[] {
  const warnings: string[] = [];
  if (width < OG_IMAGE_MIN_WIDTH || height < OG_IMAGE_MIN_HEIGHT) {
    warnings.push(
      `Image is ${width}×${height}. Large previews need at least ${OG_IMAGE_MIN_WIDTH}×${OG_IMAGE_MIN_HEIGHT}; 1200×630 is the usual size.`,
    );
  }
  if (width > 0 && height > 0) {
    const aspect = width / height;
    if (Math.abs(aspect - OG_IMAGE_ASPECT) > 0.21) {
      warnings.push(
        `Aspect ratio is ${aspect.toFixed(2)}:1. Open Graph images work best at about 1.91:1 (1200×630).`,
      );
    }
  }
  return warnings;
}

export function sizeOgImageWarnings(bytes: number): string[] {
  if (bytes <= OG_IMAGE_MAX_BYTES) return [];
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return [
    `File is ${mb}MB. Keep Open Graph images under 8MB or some networks skip them.`,
  ];
}

export function typeOgImageWarnings(contentType: string): string[] {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mime || mime === "application/octet-stream") return [];
  if (OG_OK_TYPES.has(mime)) return [];
  return [
    `Type is ${mime}. Use JPEG, PNG, GIF, or WebP.`,
  ];
}
