import { type AppEnv } from "../types";
import {
  type ConversationStatus,
  type MessagePayload,
  type ServerEvent,
} from "../../shared/ws-events";
import { serializeMessageImageUrls } from "../../shared/message-images";
import { type PublicMessageRecord } from "../../shared/maven-conversation";

interface BroadcastOptions {
  excludeSubjectId?: string;
  audience?: "agents";
}

interface LegacyMessageLike {
  id: string;
  role: PublicMessageRecord["author"];
  content: string;
  imageUrl: string | null;
  sources: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  createdAt: Date;
}

type BroadcastMessage = PublicMessageRecord | LegacyMessageLike;

export function messageRowToPayload(row: BroadcastMessage): MessagePayload {
  if (!("author" in row)) {
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      imageUrl: row.imageUrl,
      sources: row.sources,
      senderName: row.senderName,
      senderAvatar: row.senderAvatar,
      createdAt: row.createdAt.getTime(),
    };
  }
  return {
    id: row.id,
    role: row.author,
    content: row.content,
    imageUrl: serializeMessageImageUrls(row.imageUrls),
    sources:
      row.sources.length > 0
        ? JSON.stringify(row.sources)
        : row.systemKind
          ? JSON.stringify({ systemKind: row.systemKind })
          : null,
    senderName: row.senderName,
    senderAvatar: row.senderAvatar,
    createdAt: row.createdAt,
  };
}

function dispatch(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  event: ServerEvent,
  options: BroadcastOptions = {},
): void {
  const stub = env.CONVERSATION_DO.get(
    env.CONVERSATION_DO.idFromName(conversationId),
  );
  ctx.waitUntil(
    stub
      .fetch("https://do/internal/broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal": env.INTERNAL_BROADCAST_SECRET,
        },
        body: JSON.stringify({
          event,
          excludeSubjectId: options.excludeSubjectId,
          audience: options.audience,
        }),
      })
      .then(() => undefined)
      .catch(() => undefined),
  );
}

export function broadcastMessageNew(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  row: BroadcastMessage,
  options: BroadcastOptions = {},
): void {
  dispatch(
    env,
    ctx,
    conversationId,
    {
      type: "message:new",
      conversationId,
      message: messageRowToPayload(row),
    },
    options,
  );
}

export function broadcastMessageDeleted(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  messageId: string,
  options: BroadcastOptions = {},
): void {
  dispatch(
    env,
    ctx,
    conversationId,
    {
      type: "message:deleted",
      conversationId,
      messageId,
    },
    options,
  );
}

export function broadcastStatusChange(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  status: ConversationStatus,
): void {
  dispatch(env, ctx, conversationId, {
    type: "status:change",
    conversationId,
    status,
    updatedAt: Date.now(),
  });
}

export function broadcastClosed(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  reason: string | null,
): void {
  dispatch(env, ctx, conversationId, {
    type: "conversation:closed",
    conversationId,
    reason,
  });
}

export function broadcastArchived(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  archivedAt: Date = new Date(),
): void {
  dispatch(env, ctx, conversationId, {
    type: "conversation:archived",
    conversationId,
    archivedAt: archivedAt.getTime(),
  });
}

export function broadcastConversationUpdated(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
): void {
  dispatch(
    env,
    ctx,
    conversationId,
    {
      type: "conversation:updated",
      conversationId,
      updatedAt: Date.now(),
    },
    { audience: "agents" },
  );
}

export function broadcastCustomerUpdated(
  env: AppEnv,
  ctx: ExecutionContext,
  projectId: string,
  customerIds: string[],
): void {
  if (customerIds.length === 0) return;
  dispatch(
    env,
    ctx,
    `customer-project:${projectId}`,
    {
      type: "customer:updated",
      projectId,
      customerIds,
      updatedAt: Date.now(),
    },
    { audience: "agents" },
  );
}

export function broadcastMessageStatus(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  status: "delivered" | "read",
  messageIds: string[],
): void {
  if (messageIds.length === 0) return;
  dispatch(
    env,
    ctx,
    conversationId,
    {
      type: "message:status",
      conversationId,
      status,
      messageIds,
      at: Date.now(),
    },
    { audience: "agents" },
  );
}
