import { z } from "zod";
import { type PublicConversationStore } from "../../../conversations/public-conversation-store";
import { type ProjectService } from "../../../services/project-service";
import { logError, logInfo, logWarn } from "../../../observability";
import { createEscalation } from "../../post-turn/escalation";
import { requestTeamNote } from "../../../services/team-note";
import type { AppEnv } from "../../../types";
import {
  fallbackAiParticipationForStatus,
  parseChatState,
  type MavenToolDefinition,
  type MavenTurnContext,
} from "../../types";

export interface RequestTeamHelpInput {
  customerName?: string;
  customerEmail?: string;
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

// Maven writes the note to the team itself (system-origin Sidechat turn), so
// the tool takes no summary. It does take what the customer already said
// about themselves; the runtime only asks for what is still missing.
const requestTeamHelpInputSchema = z
  .object({
    customerName: z.string().trim().min(1).max(100).optional(),
    customerEmail: z.string().trim().email().max(320).optional(),
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

// The model already saw the customer's name and email in the transcript.
// Store what it passed so the contact gate only asks for what is missing.
async function storeCustomerContactFromModel(
  dependencies: { chatService: PublicConversationStore; context: MavenTurnContext },
  conversation: NonNullable<Awaited<ReturnType<PublicConversationStore["getOperational"]>>>,
  input: RequestTeamHelpInput,
): Promise<typeof conversation> {
  const visitorName = !conversation.visitorName?.trim() && input.customerName
    ? input.customerName
    : undefined;
  const visitorEmail = !conversation.visitorEmail?.trim() && input.customerEmail
    ? input.customerEmail.toLowerCase()
    : undefined;
  if (visitorName === undefined && visitorEmail === undefined) {
    return conversation;
  }
  const remaining: Array<"name" | "email"> = [];
  if (!conversation.visitorName?.trim() && visitorName === undefined) {
    remaining.push("name");
  }
  if (!conversation.visitorEmail?.trim() && visitorEmail === undefined) {
    remaining.push("email");
  }
  try {
    const updated = await dependencies.chatService.updatePendingTeamRequestContact(
      dependencies.context.projectId,
      conversation.id,
      {
        status: conversation.status,
        chatState: JSON.stringify(conversation.chatState),
      },
      {
        ...(visitorName === undefined ? {} : { visitorName }),
        ...(visitorEmail === undefined ? {} : { visitorEmail }),
        awaitingContactFields: remaining,
      },
    );
    return updated ?? conversation;
  } catch (error) {
    logError("team_request.store_contact_failed", error, {
      projectId: dependencies.context.projectId,
      conversationId: conversation.id,
    });
    return conversation;
  }
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

interface TeamRequestOperationDependencies {
  context: MavenTurnContext;
  chatService: PublicConversationStore;
  projectService: ProjectService;
  env: {
    BETTER_AUTH_URL: string;
    RESEND_API_KEY?: string;
    MAVEN_PROJECT_AGENT: AppEnv["MAVEN_PROJECT_AGENT"];
  };
  executionCtx: ExecutionContext;
}

export async function repairAcceptedTeamRequest(
  dependencies: TeamRequestOperationDependencies,
): Promise<void> {
  try {
    const [project, conversation] = await Promise.all([
      dependencies.projectService.getProjectById(
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

    const escalation = await createEscalation({
      chatService: dependencies.chatService,
      project,
      conversation,
      summary: acceptedRequest.summary,
      acceptedTeamRequestToken: acceptedRequest.acceptanceToken,
    });
    if (escalation.accepted && escalation.created) {
      await requestTeamNote({
        projectId: project.id,
        conversationId: dependencies.context.conversationId,
        actorUserId: project.userId,
        noteKey: escalation.summaryMessageId ?? dependencies.context.conversationId,
        env: dependencies.env,
      });
    }
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
  env: {
    BETTER_AUTH_URL: string;
    RESEND_API_KEY?: string;
    MAVEN_PROJECT_AGENT: AppEnv["MAVEN_PROJECT_AGENT"];
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
      const result = await run(input);
      logInfo("team_request.result", {
        projectId: dependencies.context.projectId,
        conversationId: dependencies.context.conversationId,
        status: result.status,
        ...("requestState" in result ? { requestState: result.requestState } : {}),
        ...("requiredFields" in result ? { requiredFields: result.requiredFields } : {}),
      });
      return result;
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

  async function run(input: unknown): Promise<RequestTeamHelpResult> {
    {
      const parsedInput = requestTeamHelpInputSchema.safeParse(input);
      if (!parsedInput.success) {
        logWarn("team_request.invalid_input", {
          projectId: dependencies.context.projectId,
          conversationId: dependencies.context.conversationId,
          issues: parsedInput.error.issues.map((issue) =>
            `${issue.path.join(".")}: ${issue.message}`
          ),
        });
        return createUnavailableResult();
      }

      const [project, settings, loadedConversation] = await Promise.all([
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
      if (!project || !loadedConversation) {
        logWarn("team_request.missing_project_or_conversation", {
          projectId: dependencies.context.projectId,
          conversationId: dependencies.context.conversationId,
        });
        return createUnavailableResult();
      }
      const conversation = await storeCustomerContactFromModel(
        dependencies,
        loadedConversation,
        parsedInput.data,
      );

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
        logWarn("team_request.status_unavailable", {
          projectId: dependencies.context.projectId,
          conversationId: dependencies.context.conversationId,
          status: conversation.status,
        });
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
          summary: "",
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
      if (claim.status !== "claimed") {
        logWarn("team_request.claim_unavailable", {
          projectId: dependencies.context.projectId,
          conversationId: dependencies.context.conversationId,
          claimStatus: claim.status,
        });
        return createUnavailableResult();
      }

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
        const escalation = await createEscalation({
          chatService: dependencies.chatService,
          project,
          conversation: {
            id: claimedConversation.id,
            visitorId: claimedConversation.visitorId,
            visitorName: claimedConversation.visitorName,
            visitorEmail: claimedConversation.visitorEmail,
            status: claimedConversation.status,
            metadata: claimedConversation.metadata,
          },
          summary: acceptedRequest?.summary ?? "",
          acceptedTeamRequestToken: acceptedRequest?.acceptanceToken,
        });
        if (escalation.accepted && escalation.created) {
          await requestTeamNote({
            projectId: project.id,
            conversationId: dependencies.context.conversationId,
            actorUserId: project.userId,
            noteKey: escalation.summaryMessageId ??
              dependencies.context.conversationId,
            env: dependencies.env,
          });
        }
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "created",
        );
      } catch (error) {
        logError("team_request.escalation_failed", error, {
          projectId: dependencies.context.projectId,
          conversationId: dependencies.context.conversationId,
        });
        return createRequestedResult(
          agentLabel,
          avgResponseTime,
          "created",
        );
      }
    }
  }
}
