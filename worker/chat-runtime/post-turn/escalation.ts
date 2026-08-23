import { EmailService } from "../../services/email-service";
import { type PublicConversationStore } from "../../conversations/public-conversation-store";
import { type ProjectService } from "../../services/project-service";
import {
  readChannelThreadId,
  type AgentChannelAdapter,
} from "../../services/agent-channel";
import { logError, logInfo } from "../../observability";
import { buildConversationDeepLink } from "../../lib/deep-links";
import type { PublicChannelThreads } from "../../../shared/maven-conversation";

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

async function runWithExternalActionLease<T>(
  store: PublicConversationStore,
  projectId: string,
  conversationId: string,
  action: () => Promise<T>,
): Promise<{ executed: boolean; value?: T }> {
  const lease = await store.acquireExternalAction({
    projectId,
    conversationId,
  });
  if (!lease) return { executed: false };
  try {
    return { executed: true, value: await action() };
  } finally {
    await store.releaseExternalAction(lease);
  }
}

// Escalates a conversation for human review. No ticket row is written — the
// detailed summary (built by the caller) is posted once into the thread as a
// dashboard-only `review_summary` system message, broadcast live, and the
// conversation metadata is stamped with `escalatedAt` + `reviewSummaryMessageId`
// while preserving any existing keys (country/city/source, etc.). Telegram and
// email pings carry the summary plus a conversation deep-link. Notification
// failures are logged and swallowed so escalation never blocks the turn.
export async function createEscalation(params: {
  chatService: PublicConversationStore;
  projectService: ProjectService;
  agentChannels?: AgentChannelAdapter[];
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
  acceptedTeamRequestToken?: string;
  notifyExternalActions?: boolean;
  claimExternalNotificationAttempt?: () => Promise<boolean>;
  persistTelegramThreadId?: (threadId: string) => Promise<boolean>;
  persistChannelThread?: (
    channel: AgentChannelAdapter["channel"],
    threadId: string,
  ) => Promise<boolean>;
}): Promise<{
  summary: string;
  summaryMessageId: string | null;
  telegramThreadId?: string;
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
    hasMessenger: (params.agentChannels ?? []).length > 0,
    hasEmail: Boolean(params.env.RESEND_API_KEY),
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

  const conversationUrl = buildConversationDeepLink(
    params.env.BETTER_AUTH_URL,
    params.project.id,
    params.conversation.id,
    summaryMessageId,
  );

  const isUpdate = !created;

  const agentChannels = params.agentChannels ?? [];
  const hasMessenger = agentChannels.length > 0;
  const notificationsEnabled = params.notifyExternalActions !== false;
  let externalActionsClaimed = false;

  let telegramThreadId: string | undefined;
  if (notificationsEnabled && hasMessenger) {
    try {
      const notification = await runWithExternalActionLease(
          params.chatService,
          params.project.id,
          params.conversation.id,
          async () => {
            externalActionsClaimed = params.claimExternalNotificationAttempt
              ? await params.claimExternalNotificationAttempt()
              : true;
            if (!externalActionsClaimed) {
              return { claimed: false, persisted: [] as Array<{
                channel: AgentChannelAdapter["channel"];
                threadId: string;
              }> };
            }
            const persisted: Array<{
              channel: AgentChannelAdapter["channel"];
              threadId: string;
            }> = [];
            for (const adapter of agentChannels) {
              const threadId = await adapter.notifyEscalation({
                conversationId: params.conversation.id,
                visitorName: params.conversation.visitorName,
                visitorEmail: params.conversation.visitorEmail,
                summary,
                conversationUrl,
                isUpdate,
                threadId: isUpdate
                  ? readChannelThreadId(params.conversation, adapter.channel)
                  : null,
              });
              if (threadId) {
                persisted.push({ channel: adapter.channel, threadId });
              }
            }
            return { claimed: true, persisted };
          },
        );
      if (!notification.executed) {
        return { summary, summaryMessageId, created, accepted: true };
      }
      if (!notification.value?.claimed) {
        return { summary, summaryMessageId, created, accepted: true };
      }
      for (const item of notification.value.persisted) {
        if (item.channel === "telegram") {
          telegramThreadId = item.threadId;
        }
        const persist = item.channel === "telegram"
          ? params.persistTelegramThreadId
          : (threadId: string) =>
            params.persistChannelThread?.(item.channel, threadId)
            ?? Promise.resolve(false);
        if (!persist) continue;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const persisted = await persist(item.threadId);
            if (!persisted) {
              logError(
                "escalation.channel_thread_persistence_rejected",
                new Error("Channel thread persistence was rejected"),
                {
                  projectId: params.project.id,
                  conversationId: params.conversation.id,
                  channel: item.channel,
                  threadId: item.threadId,
                },
              );
            }
            break;
          } catch (error) {
            if (attempt === 1) {
              logError("escalation.channel_thread_persistence_failed", error, {
                projectId: params.project.id,
                conversationId: params.conversation.id,
                channel: item.channel,
                threadId: item.threadId,
              });
            }
          }
        }
      }
      logInfo("escalation.telegram_notified", {
        projectId: params.project.id,
        conversationId: params.conversation.id,
        telegramThreadId: telegramThreadId ?? null,
        isUpdate,
        repliedToMessageId: isUpdate
          ? parseTelegramThreadId(params.conversation.telegramThreadId)
          : null,
      });
    } catch (error) {
      logError("escalation.telegram_failed", error, {
        projectId: params.project.id,
        conversationId: params.conversation.id,
      });
    }
  }

  if (notificationsEnabled && params.env.RESEND_API_KEY) {
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
        runWithExternalActionLease(
            params.chatService,
            params.project.id,
            params.conversation.id,
            async () => {
              if (!hasMessenger) {
                externalActionsClaimed =
                  params.claimExternalNotificationAttempt
                    ? await params.claimExternalNotificationAttempt()
                    : true;
              }
              if (!externalActionsClaimed) return;
              await emailService.sendEscalationNotification({
                ownerEmail,
                projectName,
                projectSlug: params.project.slug,
                visitorName: params.conversation.visitorName,
                visitorEmail: params.conversation.visitorEmail,
                visitorId: params.conversation.visitorId,
                summary,
                conversationUrl,
                accentColor: null,
              });
            },
          ).catch((err: unknown) => {
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
