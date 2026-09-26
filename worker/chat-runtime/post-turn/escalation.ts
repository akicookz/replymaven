import { type PublicConversationStore } from "../../conversations/public-conversation-store";
import { logInfo } from "../../observability";
import type { PublicChannelThreads } from "../../../shared/maven-conversation";

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

// Escalates a conversation for human review: state only. The dashboard-only
// `review_summary` pill is written once and the metadata is stamped with
// `escalatedAt` + `reviewSummaryMessageId`. Telling the team is Maven's job:
// the caller starts a system-origin Sidechat turn and the note it writes is
// mirrored to every channel (see MavenProjectAgent.mirrorSidechatReply).
export async function createEscalation(params: {
  chatService: PublicConversationStore;
  project: { id: string; name: string; slug: string };
  conversation: {
    id: string;
    visitorId: string | null;
    visitorName: string | null;
    visitorEmail: string | null;
    telegramThreadId?: string | null;
    channelThreads?: PublicChannelThreads;
    status: string;
    metadata: Record<string, unknown> | string | null;
  };
  summary: string;
  acceptedTeamRequestToken?: string;
}): Promise<{
  summary: string;
  summaryMessageId: string | null;
  created: boolean;
  accepted: boolean;
}> {
  let summary = params.summary.trim() || "Visitor asked for team follow-up.";
  let existingMeta: Record<string, unknown> = {};
  let created: boolean;
  let summaryMessageId: string | null;
  let summaryNeedsPersistence: boolean;
  let legacyMavenAcceptanceToken: string | null = null;

  if (params.acceptedTeamRequestToken) {
    const acceptance = await params.chatService.getTeamRequestAcceptance(
      params.project.id,
      params.conversation.id,
      params.acceptedTeamRequestToken,
    );
    if (!acceptance) {
      return {
        summary,
        summaryMessageId: null,
        created: false,
        accepted: false,
      };
    }
    summary =
      acceptance.summary.trim() || "Visitor asked for team follow-up.";
    summaryMessageId = acceptance.summaryMessageId;
    summaryNeedsPersistence = acceptance.summaryPending;
    created =
      acceptance.summaryPending || acceptance.notificationState === "pending";
  } else {
    try {
      const parsed = typeof params.conversation.metadata === "string"
        ? JSON.parse(params.conversation.metadata)
        : params.conversation.metadata ?? {};
      existingMeta =
        typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      /* ignore malformed metadata */
    }
    legacyMavenAcceptanceToken =
      typeof existingMeta.mavenTeamRequestAcceptanceToken === "string"
        ? existingMeta.mavenTeamRequestAcceptanceToken
        : null;
    created =
      typeof existingMeta.escalatedAt !== "string" ||
      existingMeta.teamRequestSummaryPending === true ||
      (typeof existingMeta.mavenTeamRequestAcceptedAt === "string" &&
        existingMeta.teamRequestNotificationState === "pending");
    summaryMessageId =
      typeof existingMeta.reviewSummaryMessageId === "string"
        ? existingMeta.reviewSummaryMessageId
        : null;
    summaryNeedsPersistence =
      created ||
      summaryMessageId === null ||
      existingMeta.teamRequestSummaryPending === true;
    summaryMessageId ??= crypto.randomUUID();
  }

  logInfo("escalation.started", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    summaryLength: summary.length,
    created,
  });

  if (!params.acceptedTeamRequestToken) {
    const updatedConversation =
      await params.chatService.updateLegacyEscalationMetadata(
        params.project.id,
        params.conversation.id,
        {
          expectedMavenAcceptanceToken: legacyMavenAcceptanceToken,
          summary,
          summaryMessageId,
          escalatedAt:
            typeof existingMeta.escalatedAt === "string"
              ? existingMeta.escalatedAt
              : new Date().toISOString(),
          ...(summaryNeedsPersistence ? { summaryPending: true } : {}),
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
  }

  if (summaryNeedsPersistence) {
    if (params.acceptedTeamRequestToken) {
      await params.chatService.addTeamRequestSummary(
        params.project.id,
        params.conversation.id,
        params.acceptedTeamRequestToken,
      );
    } else {
      await params.chatService.appendSystem({
        projectId: params.project.id,
        conversationId: params.conversation.id,
        kind: "review_summary",
        content: summary,
        idempotencyKey: summaryMessageId ?? undefined,
      });
    }

    const completed = params.acceptedTeamRequestToken
      ? await params.chatService.completeTeamRequestSummary({
          conversationId: params.conversation.id,
          projectId: params.project.id,
          acceptanceToken: params.acceptedTeamRequestToken,
        })
      : Boolean(
          await params.chatService.updateLegacyEscalationMetadata(
            params.project.id,
            params.conversation.id,
            {
              expectedMavenAcceptanceToken: legacyMavenAcceptanceToken,
              summary,
              summaryMessageId,
              summaryPending: false,
            },
          ),
        );
    if (!completed) {
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

  logInfo("escalation.completed", {
    projectId: params.project.id,
    conversationId: params.conversation.id,
    created,
  });

  return { summary, summaryMessageId, created, accepted: true };
}
