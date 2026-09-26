import { type DrizzleD1Database } from "drizzle-orm/d1";
import { isMavenAssignee } from "../../shared/maven-assignee";
import {
  readConversationChannelMetadata,
  type PublicConversationRecord,
  type PublicMessageRecord,
} from "../../shared/maven-conversation";
import { type PublicConversationStore } from "../conversations/public-conversation-store";
import type { ActiveHumanRoute } from "../chat-runtime/types";
import { getAssignableUsers, isAllowedAssignee } from "./assignable-users";
import { EmailService } from "./email-service";
import { canHandConversationToMaven, recordMavenAssignment } from "./maven-assignment";
import { ProjectService } from "./project-service";
import { VisitorBanService } from "./visitor-ban-service";

// One body per conversation action, shared by the dashboard routes and the
// Sidechat action tools so the two can never drift.

type Db = DrizzleD1Database<Record<string, unknown>>;

export type AssignConversationResult =
  | { ok: true }
  | { error: "not_found" | "not_assignable" };

export async function assignConversation(input: {
  db: Db;
  chatService: PublicConversationStore;
  projectId: string;
  conversationId: string;
  assigneeId: string | null;
  actorName: string | null;
  instructions?: string | null;
  // When a teammate takes the conversation from a channel, customer messages
  // start reaching them there right away.
  route?: ActiveHumanRoute | null;
}): Promise<AssignConversationResult> {
  const conversation = await input.chatService.getOperational(
    input.projectId,
    input.conversationId,
  );
  if (!conversation) return { error: "not_found" };

  const assignable = await getAssignableUsers(input.db, input.projectId);
  if (!isAllowedAssignee(input.assigneeId, assignable)) {
    return { error: "not_assignable" };
  }

  if (isMavenAssignee(input.assigneeId)) {
    if (input.instructions !== undefined) {
      await input.chatService.updateConversation(
        conversation.id,
        input.projectId,
        {
          metadata: JSON.stringify({
            ...conversation.metadata,
            agentHandbackInstructions: input.instructions?.trim() || null,
          }),
        },
      );
    }
    if (isMavenAssignee(conversation.assigneeId)) return { ok: true };
    if (canHandConversationToMaven(conversation)) {
      await input.chatService.transitionOwnership({
        projectId: input.projectId,
        conversationId: conversation.id,
        event: "ai_handed_back",
      });
    }
    const settings = await new ProjectService(input.db).getSettings(
      input.projectId,
    );
    await recordMavenAssignment({
      chatService: input.chatService,
      conversationId: conversation.id,
      projectId: input.projectId,
      botName: settings?.botName,
      actorName: input.actorName,
      reason: "manual",
    });
    return { ok: true };
  }

  await input.chatService.applyAction({
    projectId: input.projectId,
    conversationId: conversation.id,
    action: { action: "assign", assigneeId: input.assigneeId },
  });
  // Assigning a person makes the conversation theirs: Maven stops answering
  // the customer and their plain replies go straight to the customer.
  if (input.assigneeId !== null && conversation.status !== "closed") {
    await input.chatService.takeHumanOwnership(input.projectId, conversation.id);
    if (input.route) {
      await input.chatService.joinHumanRoute(
        input.projectId,
        conversation.id,
        input.route,
      );
    }
  }
  return { ok: true };
}

export type CloseConversationResult =
  | { ok: true }
  | { error: "not_found" };

export async function closeConversation(input: {
  chatService: PublicConversationStore;
  projectId: string;
  conversationId: string;
  closeReason?: "resolved" | "ended" | "spam";
}): Promise<CloseConversationResult> {
  const conversation = await input.chatService.getOperational(
    input.projectId,
    input.conversationId,
  );
  if (!conversation) return { error: "not_found" };
  await input.chatService.setStatus(
    input.projectId,
    conversation.id,
    "closed",
    input.closeReason,
  );
  return { ok: true };
}

export type BlockCustomerResult =
  | { ok: true; closedIds: string[]; ban: Awaited<ReturnType<VisitorBanService["banVisitor"]>> }
  | { error: "not_found" | "already_banned" };

export async function blockCustomer(input: {
  db: Db;
  chatService: PublicConversationStore;
  projectId: string;
  conversationId: string | null;
  visitorId: string;
  visitorEmail: string | null;
  reason: string | null;
  bannedBy: "dashboard" | "agent";
  expiresAt?: Date | null;
}): Promise<BlockCustomerResult> {
  if (input.conversationId) {
    const conversation = await input.chatService.getOperational(
      input.projectId,
      input.conversationId,
    );
    if (!conversation) return { error: "not_found" };
  }

  const banService = new VisitorBanService(input.db);
  const existing = await banService.isVisitorBanned(
    input.projectId,
    input.visitorId,
    input.visitorEmail,
  );
  if (existing) return { error: "already_banned" };

  // Close the named conversation as spam (even if it was already closed —
  // the Flagged tab is where a blocked visitor's thread belongs), then sweep
  // ALL of the visitor's other open conversations too: the ban 403s the
  // visitor, so any leftovers would sit in Needs You forever.
  const closedIds = new Set<string>();
  if (input.conversationId) {
    await input.chatService.setStatus(
      input.projectId,
      input.conversationId,
      "closed",
      "spam",
    );
    closedIds.add(input.conversationId);
  }
  const sweptIds = await input.chatService.closeOpenAsSpam(
    input.projectId,
    input.visitorId,
    input.visitorEmail,
  );
  for (const id of sweptIds) closedIds.add(id);

  const ban = await banService.banVisitor({
    projectId: input.projectId,
    visitorId: input.visitorId,
    visitorEmail: input.visitorEmail,
    reason: input.reason,
    bannedBy: input.bannedBy,
    bannedFromConversationId: input.conversationId,
    expiresAt: input.expiresAt ?? null,
  });
  return { ok: true, closedIds: [...closedIds], ban };
}

// Emails a message that is in the conversation to the customer's address.
// Email conversations reply in their thread; chat conversations get a first
// email with its own subject.
export async function emailMessageToCustomer(input: {
  env: { RESEND_API_KEY?: string };
  chatService: PublicConversationStore;
  project: { id: string; slug: string; name: string };
  conversation: Pick<
    PublicConversationRecord,
    "id" | "visitorEmail" | "visitorName" | "metadata"
  >;
  message: Pick<
    PublicMessageRecord,
    "id" | "content" | "imageUrls" | "author" | "senderName"
  >;
}): Promise<{ delivered: boolean }> {
  const channelMeta = readConversationChannelMetadata(input.conversation.metadata);
  const to = input.conversation.visitorEmail?.trim();
  if (!to || !input.env.RESEND_API_KEY) return { delivered: false };
  const threadMessages = await input.chatService.getMessages(
    input.project.id,
    input.conversation.id,
  );
  const referencesRfcIds = threadMessages
    .map((message) => message.rfcMessageId)
    .filter((id): id is string => Boolean(id));
  const inReplyToRfcId = [...threadMessages]
    .reverse()
    .find((message) => message.author === "visitor" && message.rfcMessageId)
    ?.rfcMessageId ?? null;
  const isEmailThread = channelMeta.channel === "email" || referencesRfcIds.length > 0;
  const emailService = new EmailService(input.env.RESEND_API_KEY);
  const sent = await emailService.sendAgentMessageEmail({
    to,
    projectSlug: input.project.slug,
    projectName: input.project.name,
    conversationId: input.conversation.id,
    messageId: input.message.id,
    messageContent: input.message.content,
    imageUrls: input.message.imageUrls,
    inReplyToRfcId,
    referencesRfcIds,
    // A chat conversation keeps this subject for every mail it gets.
    subject: channelMeta.subject ?? `Your conversation with ${input.project.name}`,
    subjectIsReply: isEmailThread,
    autoSubmitted: true,
    authorName: input.message.senderName ??
      (input.message.author === "bot" ? "Maven" : null),
    customerName: input.conversation.visitorName,
  });
  await input.chatService.markEmailed({
    projectId: input.project.id,
    conversationId: input.conversation.id,
    messageId: input.message.id,
    rfcMessageId: await emailService.resolveRfcMessageId(sent.id),
  });
  return { delivered: true };
}

// Delivery follows the conversation's channel: an email thread gets the
// message by email, everything else is already in the widget.
export async function deliverMessageToCustomerChannel(input: {
  env: { RESEND_API_KEY?: string };
  chatService: PublicConversationStore;
  project: { id: string; slug: string; name: string };
  conversation: Pick<
    PublicConversationRecord,
    "id" | "visitorEmail" | "visitorName" | "metadata"
  >;
  message: Pick<
    PublicMessageRecord,
    "id" | "content" | "imageUrls" | "author" | "senderName"
  >;
}): Promise<{ delivered: boolean }> {
  if (readConversationChannelMetadata(input.conversation.metadata).channel !== "email") {
    return { delivered: false };
  }
  return emailMessageToCustomer(input);
}
