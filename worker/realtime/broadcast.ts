import { type AppEnv } from "../types";
import {
  type ConversationStatus,
  type MessagePayload,
  type ServerEvent,
} from "../../shared/ws-events";
import { type MessageRow } from "../db";

interface BroadcastOptions {
  excludeSubjectId?: string;
  audience?: "agents";
}

export function messageRowToPayload(row: MessageRow): MessagePayload {
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
  row: MessageRow,
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
