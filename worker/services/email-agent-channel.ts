import type { PublicConversationStore } from "../conversations/public-conversation-store";
import { readConversationChannelMetadata } from "../../shared/maven-conversation";
import { logWarn } from "../observability";
import type {
  AgentChannelAdapter,
  AgentChannelInbound,
  AgentChannelResolve,
} from "./agent-channel";
import { composeEmail, EmailService, firstName } from "./email-service";
import type { ProjectService } from "./project-service";
import { readConversationIdFromReplyText } from "./telegram-agent-channel";

export interface EmailChannelRecipient {
  userId: string;
  email: string;
  name: string;
}

export interface EmailChannelEnablement {
  service: EmailService;
  project: { id: string; slug: string; name: string };
  botName: string | null | undefined;
  // Everyone who gets a new thread (the escalation note).
  recipients(): Promise<EmailChannelRecipient[]>;
  readThreads(
    conversationId: string,
  ): Promise<{ subject: string; byUser: Record<string, string> } | null>;
  writeThread(input: {
    conversationId: string;
    userId: string;
    rfcMessageId: string | null;
    subject: string;
  }): Promise<void>;
}

const EMAIL_DOMAIN = "updates.replymaven.com";

function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function stripSubjectPrefixes(subject: string): string {
  return subject.replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, "").trim();
}

// Email is the third transport. One thread per teammate: each send replies to
// the last RFC id we have for that person, and every mail in a conversation
// reuses the subject set by its first email (D10).
export function createEmailAgentChannel(
  input: EmailChannelEnablement,
): AgentChannelAdapter {
  return {
    channel: "email",
    async resolveConversation(fields) {
      const conversationId = readConversationIdFromReplyText(
        fields.inbound.replyToText,
      );
      return conversationId
        ? { kind: "targeted", conversationId }
        : { kind: "none", reason: "email_without_conversation" };
    },
    async post(fields) {
      const threads = await input.readThreads(fields.conversationId);
      const recipients = fields.recipient
        ? await resolveRecipient(input, fields.recipient)
        : await input.recipients();
      if (recipients.length === 0) return null;

      const storedSubject = threads?.subject ?? null;
      const givenSubject = fields.subject ?? null;
      const subject = storedSubject ??
        (stripSubjectPrefixes(givenSubject ?? firstLine(fields.text)) ||
          "Support conversation");
      // When the first line becomes the subject it leaves the body.
      const body = storedSubject === null && givenSubject === null
        ? fields.text.replace(firstLine(fields.text), "").trim() || fields.text
        : fields.text;

      const botName = input.botName?.trim() || "Maven";
      let lastRfcId: string | null = null;
      for (const recipient of recipients) {
        const inReplyTo = fields.recipient
          ? fields.threadId ?? threads?.byUser[recipient.userId] ?? null
          : threads?.byUser[recipient.userId] ?? null;
        // Replies route by the reply-to address; only the link is shown.
        const composed = composeEmail({
          bodyMarkdown: body,
          recipientName: firstName(recipient.name),
          links: [{ label: "Open the conversation", url: fields.conversationLink }],
          signature: [botName],
        });
        try {
          const sent = await input.service.sendTeammateEmail({
            from: `${botName} <${input.project.slug}@${EMAIL_DOMAIN}>`,
            replyTo: `${input.project.slug}+c${fields.conversationId}@${EMAIL_DOMAIN}`,
            to: recipient.email,
            subject: inReplyTo ? `Re: ${subject}` : subject,
            text: composed.text,
            html: composed.html,
            inReplyTo,
          });
          const rfcId = await input.service.resolveRfcMessageId(sent.id);
          if (rfcId) lastRfcId = rfcId;
          // The subject is saved even without the id so later mails keep it.
          await input.writeThread({
            conversationId: fields.conversationId,
            userId: recipient.userId,
            rfcMessageId: rfcId,
            subject,
          });
        } catch (error) {
          logWarn("email_channel.post_failed", {
            conversationId: fields.conversationId,
            recipient: recipient.userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return lastRfcId;
    },
  };
}

async function resolveRecipient(
  input: EmailChannelEnablement,
  email: string,
): Promise<EmailChannelRecipient[]> {
  const wanted = email.trim().toLowerCase();
  const known = (await input.recipients()).find((candidate) =>
    candidate.email.toLowerCase() === wanted
  );
  return known ? [known] : [];
}

export function buildEmailInbound(input: {
  emailId: string;
  text: string;
  rfcMessageId: string | null;
  conversationId: string;
  author: { userId: string; displayName: string | null; email: string };
}): AgentChannelInbound {
  return {
    channel: "email",
    text: input.text,
    externalMessageId: input.emailId,
    replyToExternalId: input.rfcMessageId,
    replyToText: `Conversation: ${input.conversationId}`,
    author: { ...input.author, externalId: null },
  };
}

// Everything the email adapter needs, from the project row alone. Returns
// null when the platform cannot send mail.
export function buildEmailChannelEnablement(input: {
  env: { RESEND_API_KEY?: string };
  projectService: ProjectService;
  chatService: PublicConversationStore;
  project: { id: string; slug: string; name: string };
  botName: string | null | undefined;
}): EmailChannelEnablement | null {
  if (!input.env.RESEND_API_KEY) return null;
  const service = new EmailService(input.env.RESEND_API_KEY);
  return {
    service,
    project: input.project,
    botName: input.botName,
    recipients: () =>
      input.projectService.getEscalationRecipients(input.project.id),
    async readThreads(conversationId) {
      const conversation = await input.chatService.getOperational(
        input.project.id,
        conversationId,
      );
      const stored = conversation?.channelThreads?.email;
      if (stored) return stored;
      // A forwarded thread already has a subject before Maven ever writes.
      const subject = readConversationChannelMetadata(conversation?.metadata).subject;
      return subject ? { subject, byUser: {} } : null;
    },
    async writeThread(fields) {
      await input.chatService.updateEmailThread(
        input.project.id,
        fields.conversationId,
        fields,
      );
    },
  };
}

export type { AgentChannelResolve };
