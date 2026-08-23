export type PublicConversationStatus =
  | "active"
  | "waiting_agent"
  | "agent_replied"
  | "closed";

export type PublicMessageAuthor = "visitor" | "bot" | "agent" | "system";

export interface PublicSourceReference {
  title: string;
  url: string | null;
  type: "webpage" | "pdf" | "faq";
}

export interface PublicMessageMetadata {
  v: 1;
  channel: "public";
  projectId: string;
  conversationId: string;
  author: PublicMessageAuthor;
  senderName: string | null;
  senderAvatar: string | null;
  userId: string | null;
  imageUrls: string[];
  sources: PublicSourceReference[];
  createdAt: number;
  deliveredAt: number | null;
  readAt: number | null;
  emailedAt: number | null;
  systemKind: string | null;
  idempotencyKey?: string | null;
  origin?: "widget" | "dashboard" | "telegram" | "slack" | "email" | "mcp" | null;
  externalReplyTo?: string | null;
}

export interface PublicMessageRecord {
  id: string;
  conversationId: string;
  author: PublicMessageAuthor;
  content: string;
  imageUrls: string[];
  sources: PublicSourceReference[];
  senderName: string | null;
  senderAvatar: string | null;
  userId: string | null;
  systemKind: string | null;
  createdAt: number;
  deliveredAt: number | null;
  readAt: number | null;
  emailedAt: number | null;
  idempotencyKey?: string | null;
  origin?: "widget" | "dashboard" | "telegram" | "slack" | "email" | "mcp" | null;
  externalReplyTo?: string | null;
}

export interface PublicChannelThreads {
  telegram?: string;
  slack?: string;
}

export function publicChannelThreads(
  telegramThreadId: string | null | undefined,
  stored?: PublicChannelThreads | null,
): PublicChannelThreads {
  const threads: PublicChannelThreads = stored ? { ...stored } : {};
  if (telegramThreadId) {
    threads.telegram = telegramThreadId;
  } else {
    delete threads.telegram;
  }
  return threads;
}

export interface PublicConversationRecord {
  id: string;
  projectId: string;
  customerId: string | null;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: PublicConversationStatus;
  closeReason: "resolved" | "ended" | "spam" | "bot_resolved" | null;
  telegramThreadId: string | null;
  channelThreads: PublicChannelThreads;
  metadata: Record<string, unknown>;
  chatState: Record<string, unknown>;
  lastActivityAt: number;
  visitorLastSeenAt: number | null;
  visitorPresence: "active" | "background";
  visitorLastOnlineAt: number | null;
  snoozedUntil: number | null;
  archivedAt: number | null;
  purgeStartedAt: number | null;
  externalActionStartedAt: number | null;
  priority: "low" | "medium" | "high";
  assigneeId: string | null;
  createdAt: number;
  updatedAt: number;
  ownershipRevision: number;
}

export function toPublicChildName(conversationId: string): `pub_${string}` {
  return `pub_${conversationId}`;
}

export function toSidechatChildName(conversationId: string): `sc_${string}` {
  return `sc_${conversationId}`;
}

export function parseMavenChildName(name: string): {
  kind: "public" | "sidechat";
  conversationId: string;
} {
  if (name.startsWith("pub_") && name.length > 4) {
    return { kind: "public", conversationId: name.slice(4) };
  }
  if (name.startsWith("sc_") && name.length > 3) {
    return { kind: "sidechat", conversationId: name.slice(3) };
  }
  throw new Error("Invalid Maven child name");
}
