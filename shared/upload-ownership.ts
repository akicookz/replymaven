const UPLOAD_PATH_PREFIX = "/api/uploads/";

export function getLocalUploadKey(imageUrl: string): string | null {
  const path = imageUrl.split(/[?#]/, 1)[0];
  if (!path.startsWith(UPLOAD_PATH_PREFIX)) return null;

  const key = path.slice(UPLOAD_PATH_PREFIX.length);
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("\\")
  ) {
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
