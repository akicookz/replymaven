export const PUBLIC_APP_ORIGIN = "https://replymaven.com";

const UPLOAD_PATH_PREFIX = "/api/uploads/";
const UPLOAD_KEY_RE = /^[A-Za-z0-9._/-]+$/;

export function publicUploadUrl(key: string): string {
  return `${PUBLIC_APP_ORIGIN}${UPLOAD_PATH_PREFIX}${key}`;
}

/** Keep local development uploads on the local Worker origin. */
export function publicUploadUrlForRequest(request: Request, key: string): string {
  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return `${UPLOAD_PATH_PREFIX}${key}`;
  }
  return publicUploadUrl(key);
}

/** Relative leftovers and the absolute URLs /api/upload now returns. */
export function isAllowedStoredUploadUrl(url: string): boolean {
  if (!url || url.includes("..")) return false;
  let path = url;
  if (url.startsWith(`${PUBLIC_APP_ORIGIN}${UPLOAD_PATH_PREFIX}`)) {
    path = url.slice(PUBLIC_APP_ORIGIN.length);
  } else if (!url.startsWith(UPLOAD_PATH_PREFIX)) {
    return false;
  }
  if (path.includes("//") || !path.startsWith(UPLOAD_PATH_PREFIX)) return false;
  const key = path.slice(UPLOAD_PATH_PREFIX.length);
  return key.length > 0 && UPLOAD_KEY_RE.test(key);
}
