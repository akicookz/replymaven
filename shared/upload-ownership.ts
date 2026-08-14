const UPLOAD_PATH_PREFIX = "/api/uploads/";

export function getLocalUploadKey(imageUrl: string): string | null {
  let path: string;
  try {
    path = new URL(imageUrl, "https://replymaven.invalid").pathname;
  } catch {
    return null;
  }
  if (!path.startsWith(UPLOAD_PATH_PREFIX)) return null;

  // Upload keys are server-generated and never contain "%", so one decode
  // round with a leftover-"%" rejection also blocks double-encoded traversal.
  let key: string;
  try {
    key = decodeURIComponent(path.slice(UPLOAD_PATH_PREFIX.length));
  } catch {
    return null;
  }
  if (!key || key.includes("%") || key.includes("\\")) return null;
  const segments = key.split("/");
  if (!segments.every((segment) => segment !== "" && segment !== "..")) {
    return null;
  }

  return key;
}

export function isProjectChatUploadUrl(
  imageUrl: string,
  projectId: string,
): boolean {
  const key = getLocalUploadKey(imageUrl);
  return key?.startsWith(`${projectId}/chat-images/`) ?? false;
}

export function isConversationUploadUrl(
  imageUrl: string,
  projectId: string,
  conversationId: string,
): boolean {
  const key = getLocalUploadKey(imageUrl);
  return key?.startsWith(
    `${projectId}/conversation-attachments/${conversationId}/`,
  ) ?? false;
}

export function isConversationUploadKeyOwnedByConversation(
  key: string,
  conversationId: string,
): boolean {
  if (!key || key.includes("\\")) return false;
  const segments = key.split("/");
  return segments.length >= 4 &&
    segments.every((segment) => segment !== "" && segment !== "..") &&
    segments[1] === "conversation-attachments" &&
    segments[2] === conversationId;
}
