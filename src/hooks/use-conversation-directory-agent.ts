import { useCallback } from "react";
import { useAgent } from "agents/react";
import type {
  MavenConversationSummary,
  MavenInboxCounts,
  MavenProjectEvent,
  MavenProjectState,
  SidechatSummarySessionResponse,
} from "../../shared/sidechat-agent";
import type { Conversation } from "@/lib/inbox/types";

interface UseConversationDirectoryAgentOptions {
  session: SidechatSummarySessionResponse;
  onEvent?(event: MavenProjectEvent): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSummary(value: unknown): value is MavenConversationSummary {
  if (!isRecord(value)) return false;
  return typeof value.conversationId === "string" &&
    typeof value.publicChildName === "string" &&
    value.publicChildName === `pub_${value.conversationId}` &&
    (value.status === "active" || value.status === "waiting_agent" ||
      value.status === "agent_replied" || value.status === "closed") &&
    typeof value.childRevision === "number" &&
    Number.isFinite(value.childRevision) &&
    typeof value.lastActivityAt === "number" &&
    Number.isFinite(value.lastActivityAt) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt);
}

function isInboxCounts(value: unknown): value is MavenInboxCounts {
  if (!isRecord(value)) return false;
  return ["needs-you", "all", "snoozed", "resolved", "archived", "flagged"]
    .every((key) =>
      typeof value[key] === "number" && Number.isFinite(value[key]) &&
      value[key] >= 0
    );
}

function optionalIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function serializedMetadata(value: Record<string, unknown>): string | null {
  return Object.keys(value).length > 0 ? JSON.stringify(value) : null;
}

export function buildConversationDirectoryAgentOptions(
  session: SidechatSummarySessionResponse,
) {
  return {
    agent: session.parentAgent,
    name: session.parentName,
    query: { token: session.token },
    queryDeps: [session.token],
  };
}

export function readMavenProjectEvent(data: unknown): MavenProjectEvent | null {
  if (typeof data !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed)) return null;
    if (parsed.type === "conversation-summary" && isSummary(parsed.summary)) {
      return { type: parsed.type, summary: parsed.summary };
    }
    if (parsed.type === "inbox-counts" && isInboxCounts(parsed.counts)) {
      return { type: parsed.type, counts: parsed.counts };
    }
    if (
      parsed.type === "customer-updated" &&
      typeof parsed.customerId === "string" && parsed.customerId.length > 0
    ) {
      return { type: parsed.type, customerId: parsed.customerId };
    }
    return null;
  } catch {
    return null;
  }
}

export function summaryToDashboardConversation(
  summary: MavenConversationSummary,
): Conversation {
  return {
    id: summary.conversationId,
    customerId: summary.customerId,
    visitorId: summary.visitorId,
    visitorName: summary.visitorName,
    visitorEmail: summary.visitorEmail,
    status: summary.status,
    closeReason: summary.closeReason,
    priority: summary.priority,
    snoozedUntil: optionalIso(summary.snoozedUntil),
    archivedAt: optionalIso(summary.archivedAt),
    purgeStartedAt: optionalIso(summary.purgeStartedAt),
    assigneeId: summary.assigneeId,
    metadata: serializedMetadata(summary.metadata),
    visitorLastSeenAt: optionalIso(summary.visitorLastSeenAt),
    visitorPresence: summary.visitorPresence,
    visitorLastOnlineAt: optionalIso(summary.visitorLastOnlineAt),
    createdAt: new Date(summary.createdAt).toISOString(),
    updatedAt: new Date(summary.updatedAt).toISOString(),
    lastActivityAt: new Date(summary.lastActivityAt).toISOString(),
    lastMessage: summary.lastMessageId && summary.lastMessageAuthor
      ? {
          id: summary.lastMessageId,
          role: summary.lastMessageAuthor,
          content: summary.lastMessagePreview ?? "",
          senderName: summary.lastMessageSenderName,
          emailedAt: optionalIso(summary.lastMessageEmailedAt),
          createdAt: new Date(
            summary.lastMessageCreatedAt ?? summary.lastActivityAt,
          ).toISOString(),
        }
      : null,
  };
}

export function useConversationDirectoryAgent(
  options: UseConversationDirectoryAgentOptions,
) {
  const { onEvent } = options;
  const onMessage = useCallback((event: MessageEvent) => {
    const parsed = readMavenProjectEvent(event.data);
    if (parsed) onEvent?.(parsed);
  }, [onEvent]);
  return useAgent<MavenProjectState>({
    ...buildConversationDirectoryAgentOptions(options.session),
    onMessage,
  });
}
