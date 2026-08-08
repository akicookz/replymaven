import { z } from "zod";
import { type MessageRow } from "../../../db";
import { type ChatService } from "../../../services/chat-service";
import { type ProjectService } from "../../../services/project-service";
import { type TelegramService } from "../../../services/telegram-service";
import { fallbackRenderHandoffMessage } from "../../llm/render-handoff-message";
import {
  buildTeamHelpUnavailableMessage,
  createEscalation,
} from "../../post-turn/escalation";
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
  | { status: "requested"; visitorMessage: string }
  | {
      status: "contact_required";
      requiredFields: Array<"name" | "email">;
    }
  | { status: "unavailable"; visitorMessage: string };

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
    visitorMessage: buildTeamHelpUnavailableMessage(),
  };
}

function createRequestedResult(
  agentLabel: string,
  variant: "created" | "already_forwarded",
): RequestTeamHelpResult {
  return {
    status: "requested",
    visitorMessage: fallbackRenderHandoffMessage({
      kind: "escalated",
      variant,
      agentLabel,
    }),
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
  metadata: string | null,
): AcceptedTeamRequest | null {
  try {
    const parsed: unknown = metadata ? JSON.parse(metadata) : null;
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

export function createRequestTeamHelpTool(dependencies: {
  context: MavenTurnContext;
  chatService: ChatService;
  projectService: ProjectService;
  telegramService?: TelegramService;
  env: {
    BETTER_AUTH_URL: string;
    RESEND_API_KEY?: string;
  };
  executionCtx: ExecutionContext;
  onTeamRequested(): void;
  broadcast(message: MessageRow): void;
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
        dependencies.chatService.getOperationalConversationById(
          dependencies.context.conversationId,
          dependencies.context.projectId,
        ),
      ]);
      if (!project || !conversation) return createUnavailableResult();

      const agentLabel = settings?.agentName?.trim() || "our team";
      if (conversation.status === "agent_replied") {
        return createRequestedResult(agentLabel, "already_forwarded");
      }
      if (
        conversation.status !== "active" &&
        conversation.status !== "waiting_agent"
      ) {
        return createUnavailableResult();
      }

      const chatState = parseChatState(conversation.chatState, {
        fallbackAiParticipation: fallbackAiParticipationForStatus(
          conversation.status,
        ),
      });
      if (chatState.aiParticipation === "human_only") {
        return createRequestedResult(agentLabel, "already_forwarded");
      }

      if (conversation.status === "waiting_agent") {
        const acceptedRequest = getAcceptedTeamRequest(
          conversation.metadata,
        );
        if (acceptedRequest?.needsRepair) {
          try {
            await createEscalation({
              chatService: dependencies.chatService,
              projectService: dependencies.projectService,
              telegramService: dependencies.telegramService,
              project,
              conversation,
              summary: acceptedRequest.summary,
              acceptedTeamRequestToken: acceptedRequest.acceptanceToken,
              settings,
              env: dependencies.env,
              executionCtx: dependencies.executionCtx,
              broadcast: dependencies.broadcast,
              claimExternalNotificationAttempt() {
                return dependencies.chatService.claimNewTeamRequestNotification(
                  dependencies.context.conversationId,
                  dependencies.context.projectId,
                  acceptedRequest.acceptanceToken,
                );
              },
              persistTelegramThreadId(threadId) {
                return dependencies.chatService.persistNewTeamRequestTelegramThreadId(
                  dependencies.context.conversationId,
                  dependencies.context.projectId,
                  acceptedRequest.acceptanceToken,
                  threadId,
                );
              },
            });
          } catch {
            // The durable ownership state remains truthful even if repair fails.
          }
        }
        return createRequestedResult(agentLabel, "already_forwarded");
      }

      const requiredFields = getMissingContactFields(conversation);
      if (requiredFields.length > 0 && !chatState.contactDeclined) {
        return {
          status: "contact_required",
          requiredFields,
        };
      }

      const claim =
        await dependencies.chatService.claimNewTeamRequest(
          dependencies.context.conversationId,
          dependencies.context.projectId,
          parsedInput.data.summary,
        );
      if (claim.status === "contact_required") {
        return {
          status: "contact_required",
          requiredFields: claim.requiredFields,
        };
      }
      if (claim.status === "already_requested") {
        return createRequestedResult(agentLabel, "already_forwarded");
      }
      if (claim.status !== "claimed") return createUnavailableResult();

      // Reload after the compare-and-set ownership claim. This is the final
      // authoritative gate before createEscalation can reach Telegram/email.
      const claimedConversation =
        await dependencies.chatService.getOperationalConversationById(
          dependencies.context.conversationId,
          dependencies.context.projectId,
        );
      if (!claimedConversation) {
        return createRequestedResult(agentLabel, "created");
      }
      const claimedState = parseChatState(claimedConversation.chatState, {
        fallbackAiParticipation: fallbackAiParticipationForStatus(
          claimedConversation.status,
        ),
      });
      if (
        claimedConversation.status === "agent_replied" ||
        claimedState.aiParticipation === "human_only"
      ) {
        return createRequestedResult(agentLabel, "already_forwarded");
      }
      if (claimedConversation.status !== "waiting_agent") {
        return createRequestedResult(agentLabel, "created");
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
          telegramService: dependencies.telegramService,
          project,
          conversation: {
            id: claimedConversation.id,
            visitorId: claimedConversation.visitorId,
            visitorName: claimedConversation.visitorName,
            visitorEmail: claimedConversation.visitorEmail,
            telegramThreadId: claimedConversation.telegramThreadId,
            status: claimedConversation.status,
            metadata: claimedConversation.metadata,
          },
          summary: acceptedSummary,
          acceptedTeamRequestToken: acceptedRequest?.acceptanceToken,
          settings,
          env: dependencies.env,
          executionCtx: dependencies.executionCtx,
          broadcast: dependencies.broadcast,
          claimExternalNotificationAttempt() {
            return dependencies.chatService.claimNewTeamRequestNotification(
              dependencies.context.conversationId,
              dependencies.context.projectId,
              acceptedRequest?.acceptanceToken ?? "",
            );
          },
          persistTelegramThreadId(threadId) {
            if (!acceptedRequest) return Promise.resolve(false);
            return dependencies.chatService.persistNewTeamRequestTelegramThreadId(
              dependencies.context.conversationId,
              dependencies.context.projectId,
              acceptedRequest.acceptanceToken,
              threadId,
            );
          },
        });
        return createRequestedResult(agentLabel, "created");
      } catch {
        return createRequestedResult(agentLabel, "created");
      }
    },
    async reauthorize() {
      const [project, conversation] = await Promise.all([
        dependencies.projectService.getProjectById(
          dependencies.context.projectId,
        ),
        dependencies.chatService.getOperationalConversationById(
          dependencies.context.conversationId,
          dependencies.context.projectId,
        ),
      ]);
      return project && conversation ? capability : null;
    },
  };
}
