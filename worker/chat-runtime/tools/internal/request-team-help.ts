import { z } from "zod";
import { type PublicConversationStore } from "../../../conversations/public-conversation-store";
import { type ProjectService } from "../../../services/project-service";
import { type TelegramService } from "../../../services/telegram-service";
import { type SlackService } from "../../../services/slack-service";
import { listEnabledAgentChannels } from "../../../services/enabled-agent-channels";
import { logError } from "../../../observability";
import { createEscalation } from "../../post-turn/escalation";
import {
  fallbackAiParticipationForStatus,
  parseChatState,
  type MavenToolDefinition,
  type MavenTurnContext,
} from "../../types";

const REQUEST_TEAM_HELP_MAX_SUMMARY_CHARS = 700;
export interface RequestTeamHelpInput {
  summary: string;
}

export type RequestTeamHelpResult =
  | {
      status: "requested";
      requestState: "created" | "already_pending";
      agentLabel: string;
      avgResponseTime: string | null;
    }
  | {
      status: "contact_required";
      requiredFields: Array<"name" | "email">;
    }
  | { status: "unavailable"; retryable: true };

const requestTeamHelpInputSchema = z
  .object({
    summary: z
      .string()
      .trim()
      .min(1)
      .max(REQUEST_TEAM_HELP_MAX_SUMMARY_CHARS),
  })
  .strict();

function createCapability(projectId: string): MavenToolDefinition["capability"] {
  return {
    id: "internal-request-team-help",
    projectId,
    connectionId: null,
    modelName: "request_team_help",
    displayName: "Request team help",
    source: "internal",
    allowedChannels: ["public"],
    access: "write",
    enabled: true,
    schemaFingerprint: "internal-request-team-help-v1",
  };
}

function createUnavailableResult(): RequestTeamHelpResult {
  return {
    status: "unavailable",
    retryable: true,
  };
}

function createRequestedResult(
  agentLabel: string,
  avgResponseTime: string | null,
  requestState: "created" | "already_pending",
): RequestTeamHelpResult {
  return {
    status: "requested",
    requestState,
    agentLabel,
    avgResponseTime,
  };
}

function getMissingContactFields(conversation: {
  visitorName: string | null;
  visitorEmail: string | null;
}): Array<"name" | "email"> {
  const requiredFields: Array<"name" | "email"> = [];
  if (!conversation.visitorName?.trim()) requiredFields.push("name");
  if (!conversation.visitorEmail?.trim()) requiredFields.push("email");
  return requiredFields;
}

interface AcceptedTeamRequest {
  acceptanceToken: string;
  needsRepair: boolean;
  summary: string;
}

function getAcceptedTeamRequest(
  metadata: Record<string, unknown> | string | null,
): AcceptedTeamRequest | null {
  try {
    const parsed: unknown = typeof metadata === "string"
      ? JSON.parse(metadata)
      : metadata;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.mavenTeamRequestAcceptedAt !== "string") return null;
    if (typeof record.mavenTeamRequestAcceptanceToken !== "string") {
      return null;
    }
    const needsRepair =
      typeof record.escalatedAt !== "string" ||
      typeof record.reviewSummaryMessageId !== "string" ||
      record.teamRequestSummaryPending === true ||
      record.teamRequestNotificationState === "pending";
    if (
      typeof record.teamRequestSummary !== "string" ||
      typeof record.reviewSummaryMessageId !== "string"
    ) {
      return null;
    }
    const summary = record.teamRequestSummary.trim();
    if (!summary) return null;
    return {
      acceptanceToken: record.mavenTeamRequestAcceptanceToken,
      needsRepair,
      summary,
    };
  } catch {
    return null;
  }
}

function enabledChannels(
  telegramService: TelegramService | undefined,
  slackService: SlackService | undefined,
  settings: {
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
    slackBotToken?: string | null;
    slackChannelId?: string | null;
    botName?: string | null;
  } | null,
) {
  return listEnabledAgentChannels({
    telegram: telegramService
      ? {
          storedBotToken: settings?.telegramBotToken,
          chatId: settings?.telegramChatId,
          botName: settings?.botName,
          service: telegramService,
        }
      : null,
    slack: slackService
      ? {
          storedBotToken: settings?.slackBotToken,
          channelId: settings?.slackChannelId,
          botName: settings?.botName,
          service: slackService,
        }
      : null,
  });
}

interface TeamRequestOperationDependencies {
  context: MavenTurnContext;
  chatService: PublicConversationStore;
  projectService: ProjectService;
  telegramService?: TelegramService;
  slackService?: SlackService;
  env: {
    BETTER_AUTH_URL: string;
    RESEND_API_KEY?: string;
  };
  executionCtx: ExecutionContext;
}

export async function repairAcceptedTeamRequest(
  dependencies: TeamRequestOperationDependencies,
): Promise<void> {
  try {
    const [project, settings, conversation] = await Promise.all([
      dependencies.projectService.getProjectById(
        dependencies.context.projectId,
      ),
      dependencies.projectService.getSettings(
        dependencies.context.projectId,
      ),
      dependencies.chatService.getOperational(
        dependencies.context.projectId,
        dependencies.context.conversationId,
      ),
    ]);
    if (!project || !conversation || conversation.status !== "waiting_agent") {
      return;
    }
    const chatState = parseChatState(JSON.stringify(conversation.chatState), {
      fallbackAiParticipation: fallbackAiParticipationForStatus(
        conversation.status,
      ),
    });
    if (chatState.aiParticipation !== "assist_until_agent") return;
    const acceptedRequest = getAcceptedTeamRequest(conversation.metadata);
    if (!acceptedRequest?.needsRepair) return;

    await createEscalation({
      chatService: dependencies.chatService,
      projectService: dependencies.projectService,
      agentChannels: enabledChannels(
        dependencies.telegramService,
        dependencies.slackService,
        settings,
      ),
      project,
      conversation,
      summary: acceptedRequest.summary,
      acceptedTeamRequestToken: acceptedRequest.acceptanceToken,
      settings,
      env: dependencies.env,
      executionCtx: dependencies.executionCtx,
      claimExternalNotificationAttempt() {
        return dependencies.chatService.claimTeamRequestNotification(
          dependencies.context.projectId,
          dependencies.context.conversationId,
          acceptedRequest.acceptanceToken,
        );
      },
      async releaseExternalNotificationAttempt() {
        await dependencies.chatService.releaseTeamRequestNotification(
          dependencies.context.projectId,
          dependencies.context.conversationId,
          acceptedRequest.acceptanceToken,
        );
      },
      persistTelegramThreadId(threadId) {
        return dependencies.chatService.persistTeamRequestTelegramThreadId(
          dependencies.context.projectId,
          dependencies.context.conversationId,
          acceptedRequest.acceptanceToken,
          threadId,
        );
      },
      persistChannelThread(channel, threadId) {
        return dependencies.chatService.updateChannelThread(
          dependencies.context.projectId,
          dependencies.context.conversationId,
          channel,
          threadId,
        ).then(() => true);
      },
    });
  } catch (error) {
    logError("team_request.repair_failed", error, {
      projectId: dependencies.context.projectId,
      conversationId: dependencies.context.conversationId,
    });
  }
}

export function createRequestTeamHelpTool(dependencies: {
  context: MavenTurnContext;
  chatService: PublicConversationStore;
  projectService: ProjectService;
  telegramService?: TelegramService;
  slackService?: SlackService;
  env: {
    BETTER_AUTH_URL: string;
    RESEND_API_KEY?: string;
  };
  executionCtx: ExecutionContext;
  onTeamRequested(): void;
}): MavenToolDefinition {
  const capability = createCapability(dependencies.context.projectId);

  return {
    capability,
    description:
      "Request follow-up from the human support team for the current public conversation.",
    inputSchema: requestTeamHelpInputSchema,
    async execute(input) {
      const parsedInput = requestTeamHelpInputSchema.safeParse(input);
      if (!parsedInput.success) return createUnavailableResult();

      const [project, settings, conversation] = await Promise.all([
        dependencies.projectService.getProjectById(
          dependencies.context.projectId,
        ),
        dependencies.projectService.getSettings(
          dependencies.context.projectId,
        ),
        dependencies.chatService.getOperational(
          dependencies.context.projectId,
          dependencies.context.conversationId,
        ),
      ]);
      if (!project || !conversation) return createUnavailableResult();

      const agentLabel = settings?.agentName?.trim() || "our team";
      const avgResponseTime = settings?.avgResponseTime?.trim() || null;
      if (conversation.status === "agent_replied") {
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "already_pending",
        );
      }
      if (
        conversation.status !== "active" &&
        conversation.status !== "waiting_agent"
      ) {
        return createUnavailableResult();
      }

      const chatState = parseChatState(JSON.stringify(conversation.chatState), {
        fallbackAiParticipation: fallbackAiParticipationForStatus(
          conversation.status,
        ),
      });
      if (chatState.aiParticipation === "human_only") {
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "already_pending",
        );
      }

      if (conversation.status === "waiting_agent") {
        await repairAcceptedTeamRequest(dependencies);
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "already_pending",
        );
      }

      const requiredFields = getMissingContactFields(conversation);
      if (requiredFields.length > 0 && !chatState.contactDeclined) {
        const pendingConversation =
          await dependencies.chatService.updatePendingTeamRequestContact(
            dependencies.context.projectId,
            dependencies.context.conversationId,
            {
              status: conversation.status,
              chatState: JSON.stringify(conversation.chatState),
            },
            { awaitingContactFields: requiredFields },
          );
        if (!pendingConversation) return createUnavailableResult();
        return {
          status: "contact_required",
          requiredFields,
        };
      }

      const claim =
        await dependencies.chatService.claimTeamRequest({
          projectId: dependencies.context.projectId,
          conversationId: dependencies.context.conversationId,
          summary: parsedInput.data.summary,
        });
      if (claim.status === "contact_required") {
        const latestConversation =
          await dependencies.chatService.getOperational(
            dependencies.context.projectId,
            dependencies.context.conversationId,
          );
        if (!latestConversation) return createUnavailableResult();
        const pendingConversation =
          await dependencies.chatService.updatePendingTeamRequestContact(
            dependencies.context.projectId,
            dependencies.context.conversationId,
            {
              status: latestConversation.status,
              chatState: JSON.stringify(latestConversation.chatState),
            },
            { awaitingContactFields: claim.requiredFields },
          );
        if (!pendingConversation) return createUnavailableResult();
        return {
          status: "contact_required",
          requiredFields: claim.requiredFields,
        };
      }
      if (claim.status === "already_requested") {
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "already_pending",
        );
      }
      if (claim.status !== "claimed") return createUnavailableResult();

      // Reload after the compare-and-set ownership claim. This is the final
      // authoritative gate before createEscalation can reach Telegram/email.
      const claimedConversation =
        await dependencies.chatService.getOperational(
          dependencies.context.projectId,
          dependencies.context.conversationId,
        );
      if (!claimedConversation) {
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "created",
        );
      }
      const claimedState = parseChatState(
        JSON.stringify(claimedConversation.chatState),
        {
        fallbackAiParticipation: fallbackAiParticipationForStatus(
          claimedConversation.status,
        ),
        },
      );
      if (
        claimedConversation.status === "agent_replied" ||
        claimedState.aiParticipation === "human_only"
      ) {
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "already_pending",
        );
      }
      if (claimedConversation.status !== "waiting_agent") {
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "created",
        );
      }
      try {
        dependencies.onTeamRequested();
      } catch {
        // Realtime/status notification failures must not undo ownership.
      }

      try {
        const acceptedRequest = getAcceptedTeamRequest(
          claimedConversation.metadata,
        );
        const acceptedSummary =
          acceptedRequest?.summary ?? parsedInput.data.summary;
        await createEscalation({
          chatService: dependencies.chatService,
          projectService: dependencies.projectService,
          agentChannels: enabledChannels(
            dependencies.telegramService,
            dependencies.slackService,
            settings,
          ),
          project,
          conversation: {
            id: claimedConversation.id,
            visitorId: claimedConversation.visitorId,
            visitorName: claimedConversation.visitorName,
            visitorEmail: claimedConversation.visitorEmail,
            telegramThreadId: claimedConversation.telegramThreadId,
            channelThreads: claimedConversation.channelThreads,
            status: claimedConversation.status,
            metadata: claimedConversation.metadata,
          },
          summary: acceptedSummary,
          acceptedTeamRequestToken: acceptedRequest?.acceptanceToken,
          settings,
          env: dependencies.env,
          executionCtx: dependencies.executionCtx,
          claimExternalNotificationAttempt() {
            return dependencies.chatService.claimTeamRequestNotification(
              dependencies.context.projectId,
              dependencies.context.conversationId,
              acceptedRequest?.acceptanceToken ?? "",
            );
          },
          async releaseExternalNotificationAttempt() {
            if (!acceptedRequest) return;
            await dependencies.chatService.releaseTeamRequestNotification(
              dependencies.context.projectId,
              dependencies.context.conversationId,
              acceptedRequest.acceptanceToken,
            );
          },
          persistTelegramThreadId(threadId) {
            if (!acceptedRequest) return Promise.resolve(false);
            return dependencies.chatService.persistTeamRequestTelegramThreadId(
              dependencies.context.projectId,
              dependencies.context.conversationId,
              acceptedRequest.acceptanceToken,
              threadId,
            );
          },
          persistChannelThread(channel, threadId) {
            return dependencies.chatService.updateChannelThread(
              dependencies.context.projectId,
              dependencies.context.conversationId,
              channel,
              threadId,
            ).then(() => true);
          },
        });
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "created",
        );
      } catch {
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "created",
        );
      }
    },
    async reauthorize() {
      const [project, conversation] = await Promise.all([
        dependencies.projectService.getProjectById(
          dependencies.context.projectId,
        ),
        dependencies.chatService.getOperational(
          dependencies.context.projectId,
          dependencies.context.conversationId,
        ),
      ]);
      return project && conversation ? capability : null;
    },
  };
}
