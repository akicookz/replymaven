import type { PublicMessageRecord } from "../../shared/maven-conversation";
import type { PublicConversationStore } from "../conversations/public-conversation-store";
import { EmailService } from "./email-service";

export type EmailLastReplyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "no_visitor_email"
        | "no_reply"
        | "already_emailed"
        | "conflict"
        | "failed";
    };

export function findLastAgentReply(
  messages: PublicMessageRecord[],
): PublicMessageRecord | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.author === "agent") return message;
  }
  return null;
}

export async function emailLastAgentReply(input: {
  chatService: PublicConversationStore;
  emailService: EmailService;
  projectId: string;
  projectSlug: string;
  projectName: string;
  conversationId: string;
  visitorEmail: string | null;
  actorName: string | null;
  dashboardUrl: string;
  accentColor: string | null;
}): Promise<EmailLastReplyResult> {
  const visitorEmail = input.visitorEmail?.trim() ?? "";
  if (!visitorEmail) return { ok: false, reason: "no_visitor_email" };

  const messages = await input.chatService.getMessages(
    input.projectId,
    input.conversationId,
  );
  const message = findLastAgentReply(messages);
  if (!message) return { ok: false, reason: "no_reply" };
  if (message.emailedAt) return { ok: false, reason: "already_emailed" };

  const lease = await input.chatService.acquireExternalAction({
    projectId: input.projectId,
    conversationId: input.conversationId,
  });
  if (!lease) return { ok: false, reason: "conflict" };

  try {
    await input.emailService.sendAgentMessageEmail({
      to: visitorEmail,
      projectSlug: input.projectSlug,
      projectName: input.projectName,
      conversationId: input.conversationId,
      messageId: message.id,
      agentName: message.senderName ?? input.actorName ?? "Support",
      agentAvatar: message.senderAvatar ?? null,
      messageContent: message.content,
      imageUrls: message.imageUrls,
      dashboardUrl: input.dashboardUrl,
      accentColor: input.accentColor,
    });
    await input.chatService.markEmailed({
      projectId: input.projectId,
      conversationId: input.conversationId,
      messageId: message.id,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    await input.chatService.releaseExternalAction(lease);
  }
}
