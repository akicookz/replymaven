import { EmailService } from "../../services/email-service";
import { type ChatService } from "../../services/chat-service";
import { type ProjectService } from "../../services/project-service";
import { type TelegramService } from "../../services/telegram-service";
import { type MessageRow } from "../../db";
import { logError, logInfo } from "../../observability";
import { buildConversationDeepLink } from "../../lib/deep-links";

export function buildTeamHelpUnavailableMessage(): string {
  return "I couldn't forward that to the team just now. I can keep helping here, or you can try again in a moment.";
}

export function parseTelegramThreadId(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

// Escalates a conversation for human review. No ticket row is written — the
// detailed summary (built by the caller) is posted once into the thread as a
// dashboard-only `review_summary` system message, broadcast live, and the
// conversation metadata is stamped with `escalatedAt` + `reviewSummaryMessageId`
// while preserving any existing keys (country/city/source, etc.). Telegram and
// email pings carry the summary plus a conversation deep-link. Notification
// failures are logged and swallowed so escalation never blocks the turn.
export async function createEscalation(params: {
  chatService: ChatService;
  projectService: ProjectService;
  telegramService?: TelegramService;
  project: { id: string; name: string };
  conversation: {
    id: string;
    visitorId: string | null;
    visitorName: string | null;
    visitorEmail: string | null;
    telegramThreadId?: string | null;
    status: string;
    metadata: string | null;
  };
  summary: string;
  settings: {
    companyName?: string | null;
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
  } | null;
  env: {
    BETTER_AUTH_URL: string;
    RESEND_API_KEY?: string;
  };
  executionCtx: ExecutionContext;
  broadcast: (message: MessageRow) => void;
  notifyExternalActions?: boolean;
  claimExternalNotificationAttempt?: () => Promise<boolean>;
}): Promise<{
  summary: string;
  summaryMessageId: string | null;
  telegramThreadId?: string;
  created: boolean;
  accepted: boolean;
}> {
  const summary = params.summary.trim() || "Visitor asked for team follow-up.";

  // First escalation vs repeat: a prior escalation leaves `escalatedAt` in the
  // conversation metadata.
  let existingMeta: Record<string, unknown> = {};
  try {
    const parsed = params.conversation.metadata
      ? JSON.parse(params.conversation.metadata)
      : {};
    existingMeta = typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    /* ignore malformed metadata */
  }
  const created =
    typeof existingMeta.escalatedAt !== "string" ||
    existingMeta.teamRequestSummaryPending === true;

  logInfo("escalation.started", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    hasTelegram: Boolean(
      params.telegramService &&
        params.settings?.telegramBotToken &&
        params.settings?.telegramChatId,
    ),
    hasEmail: Boolean(params.env.RESEND_API_KEY),
    summaryLength: summary.length,
    created,
  });

  // Persist the idempotency key before inserting the summary. If inserting or
  // broadcasting fails after this write, a later repair uses the same message
  // id and cannot append a duplicate summary.
  let summaryMessageId: string | null =
    typeof existingMeta.reviewSummaryMessageId === "string"
      ? existingMeta.reviewSummaryMessageId
      : null;
  const summaryNeedsPersistence =
    created ||
    summaryMessageId === null ||
    existingMeta.teamRequestSummaryPending === true;
  summaryMessageId ??= crypto.randomUUID();

  // Patch only escalation-owned keys. `updateConversation` merges this patch
  // against the live row so a delayed repair cannot replay stale ownership or
  // notification state over a newer compare-and-set result.
  const updatedConversation = await params.chatService.updateConversation(
    params.conversation.id,
    params.project.id,
    {
      metadata: JSON.stringify({
        teamRequestSummary: summary,
        escalatedAt:
          typeof existingMeta.escalatedAt === "string"
            ? existingMeta.escalatedAt
            : new Date().toISOString(),
        reviewSummaryMessageId: summaryMessageId,
        ...(summaryNeedsPersistence
          ? { teamRequestSummaryPending: true }
          : {}),
      }),
    },
  );
  if (!updatedConversation) {
    return {
      summary,
      summaryMessageId: null,
      created: false,
      accepted: false,
    };
  }

  if (summaryNeedsPersistence) {
    const row = await params.chatService.addSystemMessage(
      params.conversation.id,
      "review_summary",
      summary,
      summaryMessageId,
    );
    if (row) {
      params.broadcast(row);
    }

    const completedConversation = await params.chatService.updateConversation(
      params.conversation.id,
      params.project.id,
      {
        metadata: JSON.stringify({
          teamRequestSummary: summary,
          reviewSummaryMessageId: summaryMessageId,
          teamRequestSummaryPending: false,
        }),
      },
    );
    if (!completedConversation) {
      return {
        summary,
        summaryMessageId,
        created: false,
        accepted: false,
      };
    }
  }
  logInfo("escalation.conversation_updated", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    created,
    summaryMessageId: summaryMessageId ?? null,
  });

  const conversationUrl = buildConversationDeepLink(
    params.env.BETTER_AUTH_URL,
    params.project.id,
    params.conversation.id,
    summaryMessageId,
  );

  const isUpdate = !created;

  const hasExternalActions = Boolean(
    (params.telegramService &&
      params.settings?.telegramBotToken &&
      params.settings?.telegramChatId) ||
      params.env.RESEND_API_KEY,
  );
  const externalActionsClaimed =
    params.notifyExternalActions !== false && hasExternalActions
      ? params.claimExternalNotificationAttempt
        ? await params.claimExternalNotificationAttempt()
        : true
      : false;

  let telegramThreadId: string | undefined;
  if (
    externalActionsClaimed &&
    params.telegramService &&
    params.settings?.telegramBotToken &&
    params.settings?.telegramChatId
  ) {
    try {
      const replyToMessageId = isUpdate
        ? parseTelegramThreadId(params.conversation.telegramThreadId)
        : undefined;
      const notification = await params.chatService
        .runExternalActionIfOperational(
          params.conversation.id,
          params.project.id,
          () => params.telegramService!.notifyEscalation(
            params.settings!.telegramBotToken!,
            params.settings!.telegramChatId!,
            {
              visitorName: params.conversation.visitorName,
              visitorEmail: params.conversation.visitorEmail,
              summary,
              conversationUrl,
              conversationId: params.conversation.id,
              isUpdate,
              replyToMessageId,
            },
          ),
        );
      const messageId = notification.value ?? null;
      if (!notification.executed) {
        return { summary, summaryMessageId, created, accepted: true };
      }
      if (messageId) {
        telegramThreadId = String(messageId);
      }
      logInfo("escalation.telegram_notified", {
        projectId: params.project.id,
        conversationId: params.conversation.id,
        telegramThreadId: telegramThreadId ?? null,
        isUpdate,
        repliedToMessageId: replyToMessageId ?? null,
      });
    } catch (error) {
      logError("escalation.telegram_failed", error, {
        projectId: params.project.id,
        conversationId: params.conversation.id,
      });
    }
  }

  if (externalActionsClaimed && params.env.RESEND_API_KEY) {
    const emailService = new EmailService(params.env.RESEND_API_KEY);
    const ownerEmail = await params.projectService.getOwnerEmail(
      params.project.id,
    );
    if (ownerEmail) {
      const projectName = params.settings?.companyName ?? params.project.name;
      logInfo("escalation.email_queued", {
        projectId: params.project.id,
        conversationId: params.conversation.id,
        isUpdate,
      });
      params.executionCtx.waitUntil(
        params.chatService
          .runExternalActionIfOperational(
            params.conversation.id,
            params.project.id,
            () => emailService.sendEscalationNotification({
              ownerEmail,
              projectName,
              visitorName: params.conversation.visitorName,
              visitorEmail: params.conversation.visitorEmail,
              visitorId: params.conversation.visitorId,
              summary,
              conversationUrl,
              accentColor: null,
            }),
          )
          .catch((err) => {
            logError("escalation.email_failed", err, {
              projectId: params.project.id,
              conversationId: params.conversation.id,
            });
          }),
      );
    }
  }

  logInfo("escalation.completed", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    created,
    telegramThreadId: telegramThreadId ?? null,
  });

  return {
    summary,
    summaryMessageId,
    telegramThreadId,
    created,
    accepted: true,
  };
}
