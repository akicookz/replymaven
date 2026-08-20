import { PUBLIC_APP_ORIGIN } from "../lib/public-upload-url";

/**
 * Leftover relative upload paths have no host. Prefix ReplyMaven so help HTML
 * on a tenant domain does not request them there. Absolute hrefs stay as stored.
 */
export function resolveHelpUploadUrl(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/api/uploads/") && !trimmed.includes("..")) {
    return `${PUBLIC_APP_ORIGIN}${trimmed}`;
  }
  return trimmed;
}
