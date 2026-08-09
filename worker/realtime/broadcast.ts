import { type AppEnv } from "../types";
import {
  type ConversationStatus,
  type MessagePayload,
  type SafeSidechatMessageMetadata,
  type ServerEvent,
  type SidechatMessagePayload,
  type SidechatServerEvent,
  type SidechatCoordinationSnapshot,
} from "../../shared/ws-events";
import { type MessageRow } from "../db";

interface BroadcastOptions {
  excludeSubjectId?: string;
  audience?: "agents";
}

export function messageRowToPayload(row: MessageRow): MessagePayload {
  if (row.channel !== "public") {
    throw new Error("Cannot broadcast a non-public row as message:new");
  }
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

export function sidechatMessageRowToPayload(
  row: MessageRow,
): SidechatMessagePayload {
  if (
    row.channel !== "sidechat" ||
    (row.role !== "agent" && row.role !== "bot")
  ) {
    throw new Error("Unsafe sidechat message row");
  }

  let parsedMetadata: unknown = null;
  if (row.metadata !== null) {
    try {
      parsedMetadata = JSON.parse(row.metadata);
    } catch {
      throw new Error("Unsafe sidechat message metadata");
    }
  }

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    kind: row.kind,
    metadata: sanitizeSidechatMessageMetadata(row.kind, parsedMetadata),
    senderName: row.senderName,
    createdAt: row.createdAt.getTime(),
  };
}

export function sanitizeSidechatMessageMetadata(
  kind: SidechatMessagePayload["kind"],
  value: unknown,
): SafeSidechatMessageMetadata | null {
  if (value === null) return null;

  if (
    kind !== "reply_draft" ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("Unsafe sidechat message metadata");
  }

  const keys = Object.keys(value);
  const draft = Reflect.get(value, "draft");
  if (
    keys.length !== 1 ||
    keys[0] !== "draft" ||
    typeof draft !== "string" ||
    draft.length === 0 ||
    draft.length > 5_000
  ) {
    throw new Error("Unsafe sidechat message metadata");
  }
  return { draft };
}

export function sanitizeSidechatServerEvent(
  event: SidechatServerEvent,
): SidechatServerEvent {
  switch (event.type) {
    case "sidechat:message":
      return {
        type: event.type,
        conversationId: event.conversationId,
        message: {
          id: event.message.id,
          role: event.message.role,
          content: event.message.content,
          kind: event.message.kind,
          metadata: sanitizeSidechatMessageMetadata(
            event.message.kind,
            event.message.metadata,
          ),
          senderName: event.message.senderName,
          createdAt: event.message.createdAt,
        },
      };
    case "sidechat:delta":
      return {
        type: event.type,
        conversationId: event.conversationId,
        runId: event.runId,
        delta: event.delta,
      };
    case "sidechat:activity":
      return {
        type: event.type,
        conversationId: event.conversationId,
        runId: event.runId,
        label: event.label,
        phase: event.phase,
      };
    case "sidechat:status":
      return {
        type: event.type,
        conversationId: event.conversationId,
        status: event.status,
        runId: event.runId,
        revision: event.revision,
        updatedAt: event.updatedAt,
      };
    default:
      throw new Error("Unsupported sidechat event");
  }
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

export function broadcastSidechatMessage(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  row: MessageRow,
): void {
  dispatch(
    env,
    ctx,
    conversationId,
    {
      type: "sidechat:message",
      conversationId,
      message: sidechatMessageRowToPayload(row),
    },
    { audience: "agents" },
  );
}

export function broadcastSidechatDelta(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  runId: string,
  delta: string,
): void {
  dispatch(
    env,
    ctx,
    conversationId,
    { type: "sidechat:delta", conversationId, runId, delta },
    { audience: "agents" },
  );
}

export function broadcastSidechatActivity(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  runId: string,
  label: string,
  phase: "start" | "finish",
): void {
  dispatch(
    env,
    ctx,
    conversationId,
    { type: "sidechat:activity", conversationId, runId, label, phase },
    { audience: "agents" },
  );
}

export function broadcastSidechatStatus(
  env: AppEnv,
  ctx: ExecutionContext,
  conversationId: string,
  snapshot: SidechatCoordinationSnapshot,
): void {
  dispatch(
    env,
    ctx,
    conversationId,
    { type: "sidechat:status", conversationId, ...snapshot },
    { audience: "agents" },
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
