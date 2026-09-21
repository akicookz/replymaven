import type { PublicMessageAttachment } from "../../shared/maven-conversation";
import { publicUploadUrlForRequest } from "../lib/public-upload-url";

const INBOUND_ATTACHMENT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const INBOUND_ATTACHMENT_MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

export interface StoredInboundAttachments {
  imageUrls: string[];
  attachments: PublicMessageAttachment[];
  skipped: Array<{ filename: string; reason: string }>;
}

export interface InboundAttachmentToStore {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
}

function conversationAttachmentKey(
  projectId: string,
  conversationId: string,
  filename: string,
): string {
  const rawExt = filename.split(".").pop() ?? "";
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${projectId}/conversation-attachments/${conversationId}/${crypto.randomUUID()}.${ext}`;
}

// Carries a content_id, so the body references it with cid: and it renders
// inline rather than as a file chip.
function rendersInline(
  attachment: InboundAttachmentToStore,
): boolean {
  return Boolean(attachment.contentId) &&
    attachment.contentType.toLowerCase().startsWith("image/");
}

// Images stay on the unauthenticated upload path because the widget renders
// them with no session. Everything else goes through the dashboard route.
function servedPublicly(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("image/");
}

function publicFileUrl(
  request: Request,
  projectId: string,
  key: string,
  contentType: string,
): string {
  if (servedPublicly(contentType)) {
    return publicUploadUrlForRequest(request, key);
  }
  return `/api/projects/${projectId}/files/${key}`;
}

export function skippedAttachmentNote(
  skipped: Array<{ filename: string; reason: string }>,
): string {
  if (skipped.length === 0) return "";
  return skipped
    .map((item) => `[Skipped attachment: ${item.filename} (${item.reason})]`)
    .join("\n");
}

export async function storeInboundAttachments(options: {
  request: Request;
  projectId: string;
  conversationId: string;
  attachments: InboundAttachmentToStore[];
  fetchAttachment(id: string): Promise<Response>;
  putObject(
    key: string,
    body: ReadableStream<Uint8Array>,
    contentType: string,
  ): Promise<void>;
}): Promise<StoredInboundAttachments> {
  const imageUrls: string[] = [];
  const attachments: PublicMessageAttachment[] = [];
  const skipped: Array<{ filename: string; reason: string }> = [];
  let usedBytes = 0;

  for (const attachment of options.attachments) {
    if (attachment.size > INBOUND_ATTACHMENT_MAX_FILE_BYTES) {
      skipped.push({
        filename: attachment.filename,
        reason: "over 25MB limit",
      });
      continue;
    }
    if (usedBytes + attachment.size > INBOUND_ATTACHMENT_MAX_MESSAGE_BYTES) {
      skipped.push({
        filename: attachment.filename,
        reason: "message over 40MB limit",
      });
      continue;
    }

    const downloaded = await options.fetchAttachment(attachment.id).catch(
      () => null,
    );
    if (!downloaded?.ok || !downloaded.body) {
      // One unreachable attachment must not cost the others their upload.
      skipped.push({
        filename: attachment.filename,
        reason: "could not be downloaded",
      });
      continue;
    }
    const key = conversationAttachmentKey(
      options.projectId,
      options.conversationId,
      attachment.filename,
    );
    await options.putObject(key, downloaded.body, attachment.contentType);
    usedBytes += attachment.size;
    const url = publicFileUrl(
      options.request,
      options.projectId,
      key,
      attachment.contentType,
    );
    if (rendersInline(attachment)) {
      imageUrls.push(url);
    } else {
      attachments.push({
        url,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
      });
    }
  }

  return { imageUrls, attachments, skipped };
}
