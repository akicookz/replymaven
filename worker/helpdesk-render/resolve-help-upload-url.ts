import { getLocalUploadKey } from "../../shared/upload-ownership";

const HELP_UPLOAD_ORIGIN = "https://replymaven.com";

/**
 * Help HTML can be served on a tenant domain. Origin-relative upload paths
 * would then load from that host. Point them at ReplyMaven.
 */
export function resolveHelpUploadUrl(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const key = getLocalUploadKey(trimmed);
  if (!key) return trimmed;
  return `${HELP_UPLOAD_ORIGIN}/api/uploads/${key}`;
}
