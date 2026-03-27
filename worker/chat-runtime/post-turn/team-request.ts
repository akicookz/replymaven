import { EmailService } from "../../services/email-service";
import { type ChatService } from "../../services/chat-service";
import { type ProjectService } from "../../services/project-service";
import { type TelegramService } from "../../services/telegram-service";
import { type WidgetService } from "../../services/widget-service";

function capitalizeRole(role: string): string {
  if (!role) return "Unknown";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatTeamRequestTranscript(
  conversationHistory: Array<{ role: string; content: string }>,
): string {
  return conversationHistory
    .filter((message) => message.content.trim())
    .slice(-12)
    .map((message) => `${capitalizeRole(message.role)}: ${message.content.trim()}`)
    .join("\n\n")
    .slice(0, 5000);
}

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
}): Promise<{ submissionId: string; summary: string }> {
  const summary = params.summary.trim() || "Visitor asked for team follow-up.";
  const transcript =
    formatTeamRequestTranscript(params.conversationHistory) ||
    "No recent chat history available.";

  const formData = {
    Type: "AI team request",
    "Conversation ID": params.conversation.id,
    "Requester name": formatSubmissionValue(params.conversation.visitorName),
    "Requester email": params.email,
    "Request summary": summary,
    "Recent chat": transcript,
  };

  const submission = await params.widgetService.createInquiry(
    params.project.id,
    params.conversation.visitorId ?? undefined,
    formData,
  );

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

  if (
    params.telegramService &&
    params.settings?.telegramBotToken &&
    params.settings?.telegramChatId
  ) {
    params.executionCtx.waitUntil(
      params.telegramService
        .notifyInquiry(
          params.settings.telegramBotToken,
          params.settings.telegramChatId,
          formData,
          params.env.BETTER_AUTH_URL,
          params.project.id,
        )
        .catch(() => {
          // Ignore Telegram failures for follow-up submissions.
        }),
    );
  }

  if (params.env.RESEND_API_KEY) {
    const emailService = new EmailService(params.env.RESEND_API_KEY);
    const ownerEmail = await params.projectService.getOwnerEmail(params.project.id);
    if (ownerEmail) {
      const projectName = params.settings?.companyName ?? params.project.name;
      const dashboardUrl = `${params.env.BETTER_AUTH_URL}/app/projects/${params.project.id}/inquiries`;
      params.executionCtx.waitUntil(
        emailService
          .sendInquiryNotification({
            ownerEmail,
            projectName,
            formData,
            dashboardUrl,
          })
          .catch((err) => {
            console.error("Team request email failed:", err);
          }),
      );
    }
  }

  return { submissionId: submission.id, summary };
}
