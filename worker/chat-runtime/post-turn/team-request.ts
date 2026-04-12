import { EmailService } from "../../services/email-service";
import { type ChatService } from "../../services/chat-service";
import { type ProjectService } from "../../services/project-service";
import { type TelegramService } from "../../services/telegram-service";
import { buildInquiryTitle, type WidgetService } from "../../services/widget-service";
import { logError, logInfo } from "../../observability";
import { type InquiryFieldSpec } from "../types";

function formatSubmissionValue(value: string | null | undefined): string {
  return value?.trim() || "Not provided";
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

export function buildDynamicFormData(params: {
  inquiryFields: InquiryFieldSpec[] | null | undefined;
  existingInquiry: Record<string, string> | null | undefined;
  extractedRefinementData: Record<string, string> | null | undefined;
  visitorName: string | null;
  email: string;
  summary: string;
}): Record<string, string> {
  const fields = params.inquiryFields ?? [];
  const existing = params.existingInquiry ?? {};
  const extracted = params.extractedRefinementData ?? {};

  if (fields.length === 0) {
    return {
      Name: formatSubmissionValue(params.visitorName),
      Email: params.email,
      Message: params.summary,
      ...existing,
      ...extracted,
    };
  }

  const result: Record<string, string> = {};
  for (const field of fields) {
    const label = field.label;
    const extractedValue = extracted[label]?.trim();
    const existingValue = existing[label]?.trim();

    if (extractedValue && extractedValue.length > 0) {
      result[label] = extractedValue;
      continue;
    }
    if (existingValue && existingValue.length > 0) {
      result[label] = existingValue;
      continue;
    }

    const lowered = label.toLowerCase();
    if (lowered === "name" || lowered.includes("name")) {
      result[label] = formatSubmissionValue(params.visitorName);
      continue;
    }
    if (lowered === "email" || lowered.includes("email")) {
      result[label] = params.email;
      continue;
    }
    if (
      lowered === "message" ||
      lowered === "summary" ||
      lowered === "details" ||
      lowered === "description" ||
      lowered.includes("message") ||
      lowered.includes("summary") ||
      lowered.includes("details")
    ) {
      result[label] = params.summary;
      continue;
    }
    result[label] = "Not provided";
  }

  return result;
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
    telegramThreadId?: string | null;
  };
  conversationHistory: Array<{ role: string; content: string }>;
  summary: string;
  email: string;
  inquiryFields?: InquiryFieldSpec[] | null;
  existingInquiry?: Record<string, string> | null;
  extractedRefinementData?: Record<string, string> | null;
  appendMode?: boolean;
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
}): Promise<{
  submissionId: string;
  summary: string;
  telegramThreadId?: string;
  created: boolean;
  appended: boolean;
}> {
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

  const formData = buildDynamicFormData({
    inquiryFields: params.inquiryFields,
    existingInquiry: params.existingInquiry,
    extractedRefinementData: params.extractedRefinementData,
    visitorName: params.conversation.visitorName,
    email: params.email,
    summary,
  });
  const inquiryTitle = buildInquiryTitle({
    visitorName: params.conversation.visitorName,
    visitorEmail: params.conversation.visitorEmail,
    visitorId: params.conversation.visitorId,
  });

  const submission = await params.widgetService.createInquiry({
    projectId: params.project.id,
    conversationId: params.conversation.id,
    visitorId: params.conversation.visitorId ?? undefined,
    title: inquiryTitle,
    data: formData,
    appendMode: params.appendMode ?? false,
  });
  logInfo("team_request.submission_created", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    submissionId: submission.inquiry.id,
    created: submission.created,
    appended: submission.appended,
  });

  if (!submission.created && !submission.appended) {
    logInfo("team_request.reused_existing_submission", {
      projectId: params.project.id,
      conversationId: params.conversation.id,
      submissionId: submission.inquiry.id,
    });
  }

  if (submission.appended) {
    logInfo("team_request.appended_existing_submission", {
      projectId: params.project.id,
      conversationId: params.conversation.id,
      submissionId: submission.inquiry.id,
    });
  }

  await params.chatService.updateConversation(
    params.conversation.id,
    params.project.id,
    {
      metadata: JSON.stringify({
        teamRequestPending: false,
        teamRequestSubmittedAt: new Date().toISOString(),
        teamRequestSubmissionId: submission.inquiry.id,
        teamRequestSummary: summary,
      }),
    },
  );
  logInfo("team_request.conversation_updated", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    submissionId: submission.inquiry.id,
  });

  let telegramThreadId: string | undefined;
  const shouldNotify = submission.created || submission.appended;
  const isUpdate = submission.appended && !submission.created;

  if (
    shouldNotify &&
    params.telegramService &&
    params.settings?.telegramBotToken &&
    params.settings?.telegramChatId
  ) {
    try {
      const replyToMessageId = isUpdate
        ? parseTelegramThreadId(params.conversation.telegramThreadId)
        : undefined;
      const messageId = await params.telegramService.notifyInquiry(
        params.settings.telegramBotToken,
        params.settings.telegramChatId,
        formData,
        params.env.BETTER_AUTH_URL,
        params.project.id,
        {
          isUpdate,
          replyToMessageId,
        },
      );
      if (messageId) {
        telegramThreadId = String(messageId);
      }
      logInfo("team_request.telegram_notified", {
        projectId: params.project.id,
        conversationId: params.conversation.id,
        submissionId: submission.inquiry.id,
        telegramThreadId: telegramThreadId ?? null,
        isUpdate,
        repliedToMessageId: replyToMessageId ?? null,
      });
    } catch (error) {
      logError("team_request.telegram_failed", error, {
        projectId: params.project.id,
        conversationId: params.conversation.id,
        submissionId: submission.inquiry.id,
      });
    }
  }

  if (shouldNotify && params.env.RESEND_API_KEY) {
    const emailService = new EmailService(params.env.RESEND_API_KEY);
    const ownerEmail = await params.projectService.getOwnerEmail(params.project.id);
    if (ownerEmail) {
      const projectName = params.settings?.companyName ?? params.project.name;
      const dashboardUrl = `${params.env.BETTER_AUTH_URL}/app/projects/${params.project.id}/inquiries`;
      logInfo("team_request.email_queued", {
        projectId: params.project.id,
        conversationId: params.conversation.id,
        submissionId: submission.inquiry.id,
        isUpdate,
      });
      params.executionCtx.waitUntil(
        emailService
          .sendInquiryNotification({
            ownerEmail,
            projectName,
            formData,
            dashboardUrl,
            isUpdate,
          })
          .catch((err) => {
            logError("team_request.email_failed", err, {
              projectId: params.project.id,
              conversationId: params.conversation.id,
              submissionId: submission.inquiry.id,
            });
          }),
      );
    }
  }

  logInfo("team_request.completed", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    submissionId: submission.inquiry.id,
    created: submission.created,
    telegramThreadId: telegramThreadId ?? null,
  });

  return {
    submissionId: submission.inquiry.id,
    summary,
    telegramThreadId,
    created: submission.created,
    appended: submission.appended,
  };
}
