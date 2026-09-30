import type { CustomerInput } from "../../shared/customer-types";
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import type { HonoAppContext } from "../types";
import type { ProjectRow } from "../db/schema";
import { users } from "../db/auth.schema";
import { createPublicConversationStore } from "../conversations/create-public-conversation-store";
import type { PublicConversationRecord } from "../../shared/maven-conversation";
import { readConversationChannelMetadata } from "../../shared/maven-conversation";
import { ProjectService } from "./project-service";
import { CustomerIdentityService } from "./customer-identity-service";
import { ChannelIdentityService } from "./channel-identity-service";
import { VisitorBanService } from "./visitor-ban-service";
import { TeamService } from "./team-service";
import { InboundAddressService } from "./inbound-address-service";
import { EmailService, parseEmailMessageId } from "./email-service";
import { TelegramService } from "./telegram-service";
import { SlackService } from "./slack-service";
import { listEnabledAgentChannels, telegramMessageRecorder } from "./enabled-agent-channels";
import { buildEmailChannelEnablement, buildEmailInbound, createEmailAgentChannel } from "./email-agent-channel";
import { ingestTeammateMessage } from "./ingest-teammate-message";
import { forwardVisitorToJoinedHumans } from "./run-agent-channel-outbound";
import { skippedAttachmentNote, storeInboundAttachments } from "./inbound-attachment-service";
import { emailVisitorId, parseReplyMavenRef, parseConversationReference, resolveInboundConversation, OPEN_INBOUND_THREAD_MS, type InboundEnvelopeRecipient, type InboundEmailAttachmentRef } from "./inbound-email-routing";
import { touchLinkedCustomerAfterVisitorMessage } from "../chat-runtime/customer-last-seen";
import { runChannelTurn } from "../chat-runtime/orchestration/run-channel-turn";
import { logError, logWarn } from "../observability";

export interface InboundMessageInput {
  project: ProjectRow;
  emailId: string;
  senderEmail: string;
  senderName: string | null;
  envelopeRecipient: InboundEnvelopeRecipient;
  emailText: string;
  cleanedText: string;
  headers: Record<string, string>;
  replyToMessageId?: string;
  subject: string | null;
  rfcMessageId: string | null;
  inboundAttachments: InboundEmailAttachmentRef[];
  originatingAddress: string | null;
  inboundAddress: string;
  idempotencyKey: string;
  checkRateLimit(key: string, limit: number, windowMs: number): boolean;
  broadcastCustomerChanges(c: Context<HonoAppContext>, projectId: string, customerIds: string[]): void;
  api?: {
    customer: CustomerInput & { id?: string };
    visitorText: string;
    prepareVisitor(conversation: PublicConversationRecord): Promise<Response | null>;
  };
}

// Both inbound adapters use this path. Provider parsing stays outside it;
// conversation resolution, sender roles and email reply delivery stay here.
export async function processInboundMessage(
  c: Context<HonoAppContext>,
  input: InboundMessageInput,
): Promise<Response> {
  const { project, emailId, senderEmail, senderName, envelopeRecipient,
    emailText, cleanedText, headers, subject, rfcMessageId, inboundAttachments,
    originatingAddress, inboundAddress, idempotencyKey, checkRateLimit,
    broadcastCustomerChanges } = input;
  const db = drizzle(c.env.DB);
  const projectService = new ProjectService(db);
  const resend = new Resend(c.env.RESEND_API_KEY);
  let acceptedMessageId: string | null = null;
  // ─── Locate the conversation ─────────────────────────────────────────
  const chatService = createPublicConversationStore({ db, env: c.env });
  const referencedMessageId = input.replyToMessageId ??
    parseEmailMessageId(headers["in-reply-to"]) ??
    parseEmailMessageId(headers.references, { source: "references" });
  const bodyRefConversationId =
    parseReplyMavenRef(emailText) ?? parseConversationReference(emailText);
  let conversation = null as Awaited<
    ReturnType<typeof chatService.getRecentByVisitorEmail>
  > | null;

  const loadConversation = async function loadConversation(
    conversationId: string,
  ): Promise<"archived" | "found" | null> {
    const conv = await chatService.get(project.id, conversationId);
    if (!conv) return null;
    if (conv.archivedAt) return "archived";
    conversation = conv;
    return "found";
  };

  const decision = await resolveInboundConversation({
    async byMessageId() {
      if (!referencedMessageId) return null;
      const sourceMessage = await chatService.getPublicMessageById(
        referencedMessageId,
        project.id,
      );
      if (!sourceMessage) return null;
      return loadConversation(sourceMessage.conversationId);
    },
    async byPlusAddress() {
      if (!envelopeRecipient.conversationId) return null;
      return loadConversation(envelopeRecipient.conversationId);
    },
    async byBodyRef() {
      if (!bodyRefConversationId) return null;
      return loadConversation(bodyRefConversationId);
    },
    async byRecentOpen() {
      const recent = await chatService.getRecentByVisitorEmail(
        project.id,
        senderEmail,
        {
          openOnly: true,
          touchedSinceMs: Date.now() - OPEN_INBOUND_THREAD_MS,
        },
      );
      if (!recent) return null;
      conversation = recent;
      return "found";
    },
  });
  if (decision.kind === "drop") {
    return input.api ? c.json({ error: "Conversation is archived" }, 410) : c.json({ ok: true });
  }
  // A teammate forwarding a customer's mail starts a conversation with no
  // customer yet; the mail (quoted part included) becomes their first
  // message to Maven, who reads the customer off the forwarded headers.
  const forwardingTeammate = decision.kind === "create"
    ? await new ChannelIdentityService(db).resolveByEmail({
      projectId: project.id,
      ownerId: project.userId,
      email: senderEmail,
    })
    : null;
  if (decision.kind === "create" && forwardingTeammate) {
    if (!checkRateLimit(`inbound-create:${project.id}:${senderEmail}`, 8, 60 * 60 * 1000)) {
      return input.api ? c.json({ error: "Conversation creation limit reached" }, 429) : c.json({ ok: true });
    }
    conversation = await chatService.create({
      projectId: project.id,
      customerId: null,
      visitorId: await emailVisitorId(project.id, `forward:${emailId}`),
      visitorName: null,
      visitorEmail: null,
      metadata: {
        channel: "email",
        subject: subject?.replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, "").trim() || undefined,
        inboundAddress,
        forwardedBy: forwardingTeammate.userId,
      },
    });
  } else if (decision.kind === "create") {
    const visitorId = await emailVisitorId(project.id, senderEmail);
    const banned = await new VisitorBanService(db).isVisitorBanned(
      project.id,
      visitorId,
      senderEmail,
    );
    if (banned) return input.api ? c.json({ error: "Customer is blocked" }, 403) : c.json({ ok: true });
    if (!checkRateLimit(`inbound-create:${project.id}:${senderEmail}`, 8, 60 * 60 * 1000)) {
      return input.api ? c.json({ error: "Conversation creation limit reached" }, 429) : c.json({ ok: true });
    }
    const identityService = new CustomerIdentityService(db, chatService);
    let customerId: string | null = input.api?.customer.id ?? null;
    const resolution = await identityService.resolveCustomer(project.id, {
      email: senderEmail,
      externalId: input.api?.customer.externalId,
    });
    if (resolution.kind === "resolved") {
      customerId = resolution.customerId;
    } else if (resolution.kind === "none" && !customerId) {
      const created = await identityService.createCustomer(project.id, {
        email: senderEmail,
        name: senderName,
        phone: input.api?.customer.phone,
        externalId: input.api?.customer.externalId,
        customFields: input.api?.customer.customFields ?? {},
      });
      if (created.kind === "created") customerId = created.customer.id;
      if (created.kind === "existing_customer") customerId = created.customerId;
    }
    conversation = await chatService.create({
      projectId: project.id,
      customerId,
      visitorId,
      visitorName: senderName,
      visitorEmail: senderEmail,
      metadata: {
        channel: "email",
        subject: subject ?? undefined,
        inboundAddress,
      },
    });
    if (customerId) {
      await identityService.linkConversation(
        project.id,
        conversation.id,
        customerId,
      );
    }
  }
  if (!conversation) {
    logWarn("inbound_email.unroutable", {
      emailId,
      projectId: project.id,
      hasReferencedMessageId: referencedMessageId !== null,
    });
    return c.json({ ok: true });
  }
  const inboundConversation = conversation;
  if (originatingAddress) {
    c.executionCtx.waitUntil(
      new InboundAddressService(db)
        .discover(project.id, originatingAddress)
        .then(() => undefined),
    );
  }

  // Per-conversation duplicate-content guard (defends against retries that
  // bypass the KV check, e.g. a different email_id with identical content).
  const existingMessages = await chatService.getMessagesSince(
    project.id,
    inboundConversation.id,
    Date.now() - 5 * 60 * 1000,
  );
  const alreadyProcessed = cleanedText
    ? existingMessages.some((message) => message.content === cleanedText ||
      (input.api && message.content === input.api.visitorText))
    : existingMessages.some((message) => message.idempotencyKey === `email:${emailId}`);
  if (alreadyProcessed) {
    return input.api
      ? c.json({ ok: true, duplicate: true, conversationId: inboundConversation.id })
      : c.json({ ok: true });
  }

  // ─── Determine inbound role: visitor vs. agent ───────────────────────
  const visitorEmail = inboundConversation.visitorEmail?.toLowerCase() ?? null;
  const isVisitor = visitorEmail !== null && visitorEmail === senderEmail;

  let agentUser: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  } | null = null;
  if (!isVisitor) {
    // Trust Resend's MX-level filtering for SPF/DKIM/DMARC enforcement —
    // their API doesn't surface auth verdicts to webhook consumers, so we
    // rely on them to reject hard-fail mail before forwarding. We still
    // require the sender's email to match a stored user account that has
    // explicit access to this project (owner or accepted team member).
    const userRows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        profilePicture: users.profilePicture,
        image: users.image,
      })
      .from(users)
      .where(eq(users.email, senderEmail))
      .limit(1);
    const candidate = userRows[0];
    if (candidate) {
      const isOwner = candidate.id === project.userId;
      let hasAccess = isOwner;
      if (!isOwner) {
        // Sender access is about this specific project's owner, independent of
        // whichever team the sender currently has active.
        const teamService = new TeamService(db);
        const membership = await teamService.getMembershipForOwner(
          candidate.id,
          project.userId,
        );
        hasAccess = Boolean(
          membership &&
          (
            membership.accessAllProjects ||
            await teamService.memberHasProjectAccess(
              membership.id,
              project.id,
            )
          ),
        );
      }
      if (hasAccess) {
        agentUser = {
          id: candidate.id,
          name: candidate.name,
          email: candidate.email,
          avatar: candidate.profilePicture ?? candidate.image ?? null,
        };
      }
    }
  }

  if (!isVisitor && !agentUser) {
    console.error(
      `[InboundEmail] Sender ${senderEmail} is neither the visitor nor a project member`,
    );
    return input.api ? c.json({ error: "Sender does not belong to this conversation" }, 403) : c.json({ ok: true });
  }

  if (isVisitor && input.api) {
    const ban = await new VisitorBanService(db).isVisitorBanned(project.id, inboundConversation.visitorId, senderEmail);
    if (ban || inboundConversation.closeReason === "spam") return c.json({ error: "Customer is blocked" }, 403);
    const failure = await input.api.prepareVisitor(inboundConversation);
    if (failure) return failure;
  }

  if (inboundConversation.status === "closed") {
    await chatService.reopen(project.id, inboundConversation.id);
  }


  if (isVisitor) {
    // ─── Visitor reply branch ─────────────────────────────────────────
    let storedAttachments = {
      imageUrls: [] as string[],
      attachments: [] as Array<{
        url: string;
        filename: string;
        contentType: string;
        size: number;
      }>,
      skipped: [] as Array<{ filename: string; reason: string }>,
    };
    if (inboundAttachments.length > 0) {
      try {
        storedAttachments = await storeInboundAttachments({
          request: c.req.raw,
          projectId: project.id,
          conversationId: inboundConversation.id,
          attachments: inboundAttachments,
          async fetchAttachment(id) {
            const result = await resend.emails.receiving.attachments.get({
              emailId,
              id,
            });
            const data = result.data as { download_url?: string } | null;
            if (result.error || !data?.download_url) {
              throw new Error(result.error?.message ?? "Attachment URL missing");
            }
            const downloaded = await fetch(data.download_url);
            if (!downloaded.ok || !downloaded.body) {
              throw new Error(`Attachment download failed: ${downloaded.status}`);
            }
            return downloaded;
          },
          async putObject(key, body, contentType) {
            await c.env.UPLOADS.put(key, body, {
              httpMetadata: { contentType },
              customMetadata: {
                ownerType: "conversation",
                ownerId: inboundConversation.id,
                projectId: project.id,
              },
            });
          },
        });
      } catch (error) {
        logError("inbound_email.attachment_failed", error, {
          emailId,
          projectId: project.id,
          conversationId: inboundConversation.id,
        });
        return c.json({ error: "Could not store attachments" }, 502);
      }
    }
    const skippedNote = skippedAttachmentNote(storedAttachments.skipped);
    const visitorContent = [input.api?.visitorText ?? cleanedText, skippedNote].filter(Boolean).join("\n\n");
    const inboundEmailMessage = await chatService.addPublicMessage(
      {
        conversationId: inboundConversation.id,
        role: "visitor",
        content: visitorContent,
        imageUrls: storedAttachments.imageUrls,
        attachments: storedAttachments.attachments,
        sources: null,
        idempotencyKey: `email:${emailId}`,
        origin: "email",
        externalReplyTo: referencedMessageId,
        rfcMessageId,
        senderName: senderName ?? inboundConversation.visitorName,
      },
      project.id,
    );
    if (!inboundEmailMessage) return c.json({ ok: true });
    acceptedMessageId = inboundEmailMessage.id;
    c.executionCtx.waitUntil(
      touchLinkedCustomerAfterVisitorMessage({
        projectId: project.id,
        customerId: inboundConversation.customerId,
        visitorId: inboundConversation.visitorId,
        occurredAt: new Date(inboundEmailMessage.createdAt),
        identityService: new CustomerIdentityService(
          db,
          createPublicConversationStore({ db, env: c.env }),
        ),
        logFailure(error) {
          logError("inbound_email.customer_last_seen_failed", error, {
            projectId: project.id,
            conversationId: inboundConversation.id,
            customerId: inboundConversation.customerId,
          });
        },
        onTouched(customerId) {
          broadcastCustomerChanges(c, project.id, [customerId]);
        },
      }),
    );
    const stillOperational = await chatService.getOperational(
      project.id,
      inboundConversation.id,
    );
    if (!stillOperational) return c.json({ ok: true });

    const chatState = await chatService.getChatState(
      project.id,
      inboundConversation.id,
    );
    if (
      chatState.aiParticipation === "human_only" &&
      chatState.activeHumanRoutes.length > 0
    ) {
      try {
        const telegramService = new TelegramService(db, c.env.ENCRYPTION_KEY);
        const slackService = new SlackService(db, c.env.ENCRYPTION_KEY);
        const [tgSettings, slackSettings] = await Promise.all([
          telegramService.getTelegramSettings(project.id),
          slackService.getSlackSettings(project.id),
        ]);
        const channels = listEnabledAgentChannels({
          email: buildEmailChannelEnablement({
            env: c.env,
            projectService,
            chatService,
            project: { id: project.id, slug: project.slug, name: project.name },
            botName: null,
          }),
          telegram: tgSettings?.telegramBotToken && tgSettings.telegramChatId
            ? {
                storedBotToken: tgSettings.telegramBotToken,
                chatId: tgSettings.telegramChatId,
                service: telegramService,
                recordMessage: telegramMessageRecorder(c.env, project.id),
              }
            : null,
          slack: slackSettings?.slackBotToken && slackSettings.slackChannelId
            ? {
                storedBotToken: slackSettings.slackBotToken,
                channelId: slackSettings.slackChannelId,
                service: slackService,
              }
            : null,
        });
        await forwardVisitorToJoinedHumans({
          channels,
          activeHumanRoutes: chatState.activeHumanRoutes,
          conversationId: inboundConversation.id,
          conversationLink:
            `${c.env.BETTER_AUTH_URL}/app/projects/${project.id}/conversations?filter=needs-you&id=${inboundConversation.id}`,
          visitorName: inboundConversation.visitorName ?? senderEmail,
          content: input.api ? input.api.visitorText : `[via email] ${cleanedText}`,
          channelThreads: inboundConversation.channelThreads,
          telegramThreadId: inboundConversation.telegramThreadId,
          email: { db, projectId: project.id },
        });
      } catch (err) {
        console.error("[InboundEmail] Joined-route forward failed:", err);
      }
    } else if (chatState.aiParticipation !== "human_only") {
      const settings = await projectService.getSettings(project.id);
      const channelMeta = readConversationChannelMetadata(
        stillOperational.metadata,
      );
      c.executionCtx.waitUntil((async () => {
        const botMessage = await runChannelTurn({
          db,
          env: c.env,
          executionCtx: c.executionCtx,
          chatService,
          projectService,
          project: {
            id: project.id,
            userId: project.userId,
            name: project.name,
          },
          settings,
          conversation: stillOperational,
          currentMessage: visitorContent,
          isNewConversation: decision.kind === "create",
          channel: channelMeta.channel,
          aiParticipation: chatState.aiParticipation,
        });
        if (
          !botMessage ||
          !inboundConversation.visitorEmail ||
          !c.env.RESEND_API_KEY
        ) {
          return;
        }
        const threadMessages = await chatService.getMessages(
          project.id,
          inboundConversation.id,
        );
        const referencesRfcIds = threadMessages
          .map((message) => message.rfcMessageId)
          .filter((id): id is string => Boolean(id));
        const emailService = new EmailService(c.env.RESEND_API_KEY);
        const sent = await emailService.sendAgentMessageEmail({
          to: inboundConversation.visitorEmail,
          projectSlug: project.slug,
          projectName: project.name,
          conversationId: inboundConversation.id,
          messageId: botMessage.id,
          messageContent: botMessage.content,
          inReplyToRfcId: rfcMessageId,
          referencesRfcIds,
          subject: channelMeta.subject ?? subject,
          autoSubmitted: true,
          authorName: botMessage.senderName ?? "Maven",
          customerName: inboundConversation.visitorName,
        });
        await chatService.markEmailed({
          projectId: project.id,
          conversationId: inboundConversation.id,
          messageId: botMessage.id,
          rfcMessageId: await emailService.resolveRfcMessageId(sent.id),
        });
      })().catch((error: unknown) => {
        logError("inbound_email.channel_turn_failed", error, {
          projectId: project.id,
          conversationId: inboundConversation.id,
        });
      }));
    }
  } else if (agentUser) {
    // ─── Teammate branch: the mail is a message to the team thread ────
    const emailEnablement = buildEmailChannelEnablement({
      env: c.env,
      projectService,
      chatService,
      project: { id: project.id, slug: project.slug, name: project.name },
      botName: (await projectService.getSettings(project.id))?.botName,
    });
    if (!emailEnablement) return c.json({ ok: true });
    // No saved thread subject (the first send could not record one): keep
    // the subject the teammate is replying under so Maven's answer threads.
    const replySubject = subject
      ?.replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, "")
      .trim();
    if (
      !forwardingTeammate &&
      replySubject &&
      !inboundConversation.channelThreads?.email
    ) {
      await emailEnablement.writeThread({
        conversationId: inboundConversation.id,
        userId: agentUser.id,
        rfcMessageId,
        subject: replySubject,
      }).catch((error: unknown) => {
        logError("inbound_email.thread_subject_failed", error, {
          conversationId: inboundConversation.id,
        });
      });
    }
    await ingestTeammateMessage({
      adapter: createEmailAgentChannel(emailEnablement),
      inbound: buildEmailInbound({
        emailId,
        // The quoted part is the point of a forward; keep it there.
        text: forwardingTeammate ? emailText.slice(0, 20_000) : cleanedText,
        rfcMessageId,
        conversationId: inboundConversation.id,
        author: {
          userId: agentUser.id,
          displayName: agentUser.name,
          email: agentUser.email,
        },
      }),
      botName: emailEnablement.botName,
      projectId: project.id,
      project: { id: project.id, slug: project.slug, name: project.name },
      actorUserId: agentUser.id,
      db,
      chatService,
      env: c.env,
      getAgentModeConversations: () => chatService.listAgentMode(project.id),
      findByChannelThread: async () => null,
    });
  }

  // Mark this email_id as fully processed (24h TTL). Done last so synchronous
  // failures (DB write, fetch, etc.) leave the marker absent and Resend's
  // retry will re-process. Note: queued outbound sends in `waitUntil` can
  // still fail *after* this point — the message is in the DB but the
  // recipient never gets the email. The dashboard "Send as email" button can
  // be used to re-send manually; failures are logged with `[InboundEmail]`.
  await c.env.CONVERSATIONS_CACHE.put(idempotencyKey, "1", {
    expirationTtl: 60 * 60 * 24,
  });

  return input.api
    ? c.json({ ok: true, conversationId: inboundConversation.id, messageId: acceptedMessageId }, 202)
    : c.json({ ok: true });
}
