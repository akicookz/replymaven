import { EmailService } from "../../services/email-service";
import { type ChatService } from "../../services/chat-service";
import { type ProjectService } from "../../services/project-service";
import { type TelegramService } from "../../services/telegram-service";
import { type WidgetService } from "../../services/widget-service";
import { logError, logInfo } from "../../observability";

function formatSubmissionValue(value: string | null | undefined): string {
  return value?.trim() || "Not provided";
}

export async function createTeamRequestSubmission(params: {
  chatService: ChatService;
  widgetService: WidgetService;
  projectService: ProjectService;
  telegramService?: TelegramService;
  project: { id: string; name: string };
  conversation: {
    id: string;
    visitorId: string | null;
    visitorName: string | null;
    visitorEmail: string | null;
  };
  conversationHistory: Array<{ role: string; content: string }>;
  summary: string;
  email: string;
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
}): Promise<{ submissionId: string; summary: string; telegramThreadId?: string }> {
  const summary = params.summary.trim() || "Visitor asked for team follow-up.";
  logInfo("team_request.started", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    hasTelegram: Boolean(
      params.telegramService &&
        params.settings?.telegramBotToken &&
        params.settings?.telegramChatId,
    ),
    hasEmail: Boolean(params.env.RESEND_API_KEY),
    summaryLength: summary.length,
    historyCount: params.conversationHistory.length,
  });

  const formData = {
    Name: formatSubmissionValue(params.conversation.visitorName),
    Email: params.email,
    Message: summary,
  };

  const submission = await params.widgetService.createInquiry(
    params.project.id,
    params.conversation.visitorId ?? undefined,
    formData,
  );
  logInfo("team_request.submission_created", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    submissionId: submission.id,
  });

  await params.chatService.updateConversation(
    params.conversation.id,
    params.project.id,
    {
      metadata: JSON.stringify({
        teamRequestPending: false,
        teamRequestSubmittedAt: new Date().toISOString(),
        teamRequestSubmissionId: submission.id,
        teamRequestSummary: summary,
      }),
    },
  );
  logInfo("team_request.conversation_updated", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    submissionId: submission.id,
  });

  let telegramThreadId: string | undefined;

  if (
    params.telegramService &&
    params.settings?.telegramBotToken &&
    params.settings?.telegramChatId
  ) {
    try {
      const messageId = await params.telegramService.notifyInquiry(
        params.settings.telegramBotToken,
        params.settings.telegramChatId,
        formData,
        params.env.BETTER_AUTH_URL,
        params.project.id,
      );
      if (messageId) {
        telegramThreadId = String(messageId);
      }
      logInfo("team_request.telegram_notified", {
        projectId: params.project.id,
        conversationId: params.conversation.id,
        submissionId: submission.id,
        telegramThreadId: telegramThreadId ?? null,
      });
    } catch (error) {
      logError("team_request.telegram_failed", error, {
        projectId: params.project.id,
        conversationId: params.conversation.id,
        submissionId: submission.id,
      });
    }
  }

  if (params.env.RESEND_API_KEY) {
    const emailService = new EmailService(params.env.RESEND_API_KEY);
    const ownerEmail = await params.projectService.getOwnerEmail(params.project.id);
    if (ownerEmail) {
      const projectName = params.settings?.companyName ?? params.project.name;
      const dashboardUrl = `${params.env.BETTER_AUTH_URL}/app/projects/${params.project.id}/inquiries`;
      logInfo("team_request.email_queued", {
        projectId: params.project.id,
        conversationId: params.conversation.id,
        submissionId: submission.id,
      });
      params.executionCtx.waitUntil(
        emailService
          .sendInquiryNotification({
            ownerEmail,
            projectName,
            formData,
            dashboardUrl,
          })
          .catch((err) => {
            logError("team_request.email_failed", err, {
              projectId: params.project.id,
              conversationId: params.conversation.id,
              submissionId: submission.id,
            });
          }),
      );
    }
  }

  logInfo("team_request.completed", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    submissionId: submission.id,
    telegramThreadId: telegramThreadId ?? null,
  });

  return { submissionId: submission.id, summary, telegramThreadId };
}
