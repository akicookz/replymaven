import { EmailService } from "../../services/email-service";
import { type ChatService } from "../../services/chat-service";
import { type ProjectService } from "../../services/project-service";
import { type TelegramService } from "../../services/telegram-service";
import { type MessageRow } from "../../db";
import { logError, logInfo } from "../../observability";

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
}): Promise<{
  summary: string;
  summaryMessageId: string | null;
  telegramThreadId?: string;
  created: boolean;
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
  const created = typeof existingMeta.escalatedAt !== "string";

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

  // Post the agent-facing summary into the thread once, on first escalation.
  let summaryMessageId: string | null =
    typeof existingMeta.reviewSummaryMessageId === "string"
      ? existingMeta.reviewSummaryMessageId
      : null;
  if (created) {
    const row = await params.chatService.addSystemMessage(
      params.conversation.id,
      "review_summary",
      summary,
    );
    summaryMessageId = row.id;
    params.broadcast(row); // live dashboards render the callout immediately
  }

  // Preserve existing metadata keys (country/city/source, etc.) — spread the
  // parsed map so we never clobber them. `updateConversation` also re-merges
  // against the stored row, but the spread keeps this write self-consistent.
  await params.chatService.updateConversation(
    params.conversation.id,
    params.project.id,
    {
      metadata: JSON.stringify({
        ...existingMeta,
        teamRequestSummary: summary,
        escalatedAt:
          typeof existingMeta.escalatedAt === "string"
            ? existingMeta.escalatedAt
            : new Date().toISOString(),
        ...(summaryMessageId ? { reviewSummaryMessageId: summaryMessageId } : {}),
      }),
    },
  );
  logInfo("escalation.conversation_updated", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    created,
    summaryMessageId: summaryMessageId ?? null,
  });

  const conversationUrl =
    `${params.env.BETTER_AUTH_URL}/app/projects/${params.project.id}/conversations` +
    `?filter=needs-you&id=${params.conversation.id}` +
    (summaryMessageId ? `&msg=${summaryMessageId}` : "");

  const isUpdate = !created;

  let telegramThreadId: string | undefined;
  if (
    params.telegramService &&
    params.settings?.telegramBotToken &&
    params.settings?.telegramChatId
  ) {
    try {
      const replyToMessageId = isUpdate
        ? parseTelegramThreadId(params.conversation.telegramThreadId)
        : undefined;
      const messageId = await params.telegramService.notifyEscalation(
        params.settings.telegramBotToken,
        params.settings.telegramChatId,
        {
          visitorName: params.conversation.visitorName,
          visitorEmail: params.conversation.visitorEmail,
          summary,
          conversationUrl,
          isUpdate,
          replyToMessageId,
        },
      );
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

  if (params.env.RESEND_API_KEY) {
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
        emailService
          .sendEscalationNotification({
            ownerEmail,
            projectName,
            visitorName: params.conversation.visitorName,
            visitorEmail: params.conversation.visitorEmail,
            visitorId: params.conversation.visitorId,
            summary,
            conversationUrl,
            accentColor: null,
          })
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

  return { summary, summaryMessageId, telegramThreadId, created };
}
