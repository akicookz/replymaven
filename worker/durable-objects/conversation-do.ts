import { drizzle } from "drizzle-orm/d1";
import { ChatService } from "../services/chat-service";
import { type AppEnv } from "../types";
import { type MessageRow } from "../db";
import {
  compareMessagePositions,
  type ServerEvent,
  type StableMessagePosition,
} from "../../shared/ws-events";
import { messageRowToPayload } from "../realtime/broadcast";

const REPLAY_INCLUSIVE_LOOKBACK_MS = 1_000;

export interface RealtimeSocket {
  deserializeAttachment(): unknown;
  send(payload: string): void;
  close(code: number, reason: string): void;
}

export interface ResumeCursors {
  lastMessageId: string | null;
}

export interface ConversationReplayReader {
  getPublicMessageById(
    id: string,
  ): Promise<{ id: string; conversationId: string; createdAt: Date } | null>;
  getPublicMessagesSince(
    conversationId: string,
    since: number,
  ): Promise<MessageRow[]>;
}

export interface SocketAttachment {
  kind: "agent" | "visitor";
  subjectId: string;
  conversationId: string;
  projectId: string;
  roomKind: "conversation" | "customer_project";
}

export interface BroadcastBody {
  event: ServerEvent;
  excludeSubjectId?: string;
  audience?: "agents";
}

export function broadcastEventToSockets(
  sockets: RealtimeSocket[],
  body: BroadcastBody,
): void {
  const event = body.event;
  const payload = JSON.stringify(event);
  const agentOnly = body.audience === "agents";

  for (const ws of sockets) {
    const attachment = ws.deserializeAttachment() as
      | SocketAttachment
      | undefined;
    if (
      body.excludeSubjectId &&
      attachment?.subjectId === body.excludeSubjectId
    ) {
      continue;
    }
    if (agentOnly && attachment?.kind !== "agent") {
      continue;
    }
    try {
      ws.send(payload);
      if (
        event.type === "conversation:archived" &&
        attachment?.kind === "visitor"
      ) {
        ws.close(1000, "conversation_archived");
      }
    } catch {
      // Socket might be in a weird state — Cloudflare will clean it up.
    }
  }
}

export async function replayConversationMessages(
  ws: RealtimeSocket,
  attachment: SocketAttachment,
  cursors: ResumeCursors,
  reader: ConversationReplayReader,
): Promise<void> {
  let publicSince = 0;
  let publicCursor: StableMessagePosition | null = null;
  if (cursors.lastMessageId) {
    const lastPublic = await reader.getPublicMessageById(
      cursors.lastMessageId,
    );
    if (lastPublic?.conversationId === attachment.conversationId) {
      publicCursor = {
        id: lastPublic.id,
        createdAt: lastPublic.createdAt.getTime(),
      };
      publicSince = Math.max(
        0,
        publicCursor.createdAt - REPLAY_INCLUSIVE_LOOKBACK_MS,
      );
    }
  }

  const publicRows = replayRowsAfterCursor(
    await reader.getPublicMessagesSince(
      attachment.conversationId,
      publicSince,
    ),
    publicCursor,
  );
  for (const row of publicRows) {
    let message;
    try {
      message = messageRowToPayload(row);
    } catch {
      // The replay query is not trusted as an audience boundary. A private or
      // malformed row must never be converted into a public event.
      continue;
    }
    try {
      ws.send(
        JSON.stringify({
          type: "message:new",
          conversationId: attachment.conversationId,
          message,
        } satisfies ServerEvent),
      );
    } catch {
      // A disconnected socket cannot receive the remainder of replay.
      return;
    }
  }

}

function replayRowsAfterCursor(
  rows: MessageRow[],
  cursor: StableMessagePosition | null,
): MessageRow[] {
  return rows
    .filter((row) => {
      if (!cursor) return true;
      const createdAt = row.createdAt.getTime();
      return (
        createdAt > cursor.createdAt ||
        (createdAt === cursor.createdAt && row.id !== cursor.id)
      );
    })
    .sort((left, right) =>
      compareMessagePositions(
        { id: left.id, createdAt: left.createdAt.getTime() },
        { id: right.id, createdAt: right.createdAt.getTime() },
      ),
    );
}

export class ConversationDO implements DurableObject {
  constructor(
    private state: DurableObjectState,
    private env: AppEnv,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/connect") {
      return this.handleConnect(req);
    }
    if (url.pathname === "/internal/broadcast") {
      return this.handleBroadcast(req);
    }
    if (url.pathname === "/internal/close") {
      return this.handleCloseAll(req);
    }
    return new Response("Not found", { status: 404 });
  }

  private async handleConnect(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const kind = req.headers.get("x-conn-kind");
    const subjectId = req.headers.get("x-subject-id");
    const conversationId = req.headers.get("x-conversation-id");
    const projectId = req.headers.get("x-project-id");
    const roomKind = req.headers.get("x-room-kind") ?? "conversation";

    if (
      (kind !== "agent" && kind !== "visitor") ||
      !subjectId ||
      !conversationId ||
      !projectId ||
      (roomKind !== "conversation" && roomKind !== "customer_project") ||
      (roomKind === "customer_project" && kind !== "agent")
    ) {
      return new Response("Missing connection headers", { status: 400 });
    }

    if (roomKind === "conversation") {
      const db = drizzle(this.env.DB);
      const chatService = new ChatService(db);
      const conversation = kind === "agent"
        ? await chatService.getConversationById(conversationId, projectId)
        : await chatService.getOperationalConversationById(
            conversationId,
            projectId,
          );
      if (!conversation) {
        return new Response("Conversation unavailable", { status: 410 });
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const attachment: SocketAttachment = {
      kind,
      subjectId,
      conversationId,
      projectId,
      roomKind,
    };
    server.serializeAttachment(attachment);

    this.state.acceptWebSocket(server, [
      `kind:${kind}`,
      `subject:${subjectId}`,
    ]);

    // Mark the visitor as active on connect. Done in waitUntil-style fire
    // and forget — failure to update presence shouldn't fail the upgrade.
    if (kind === "visitor" && roomKind === "conversation") {
      this.markVisitorPresence(conversationId, projectId, "active").catch(() => {
        // best-effort; the next presence frame or HTTP heartbeat will resync
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private async markVisitorPresence(
    conversationId: string,
    projectId: string,
    state: "active" | "background",
  ): Promise<void> {
    const db = drizzle(this.env.DB);
    const chatService = new ChatService(db);
    await chatService.updateVisitorLastSeen(conversationId, projectId, state);
  }

  async webSocketMessage(
    ws: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof raw !== "string") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") return;
    const msg = parsed as {
      type?: string;
      lastMessageId?: string | null;
      state?: string;
      upToMessageId?: string;
    };

    if (msg.type === "ping") {
      this.safeSend(ws, { type: "pong", t: Date.now() });
      return;
    }

    if (msg.type === "resume") {
      await this.replayMissed(ws, {
        lastMessageId: msg.lastMessageId ?? null,
      });
      return;
    }

    if (
      msg.type === "presence" &&
      (msg.state === "active" || msg.state === "background")
    ) {
      const att = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (att?.kind === "visitor") {
        await this.markVisitorPresence(
          att.conversationId,
          att.projectId,
          msg.state,
        );
      }
      return;
    }

    if (
      (msg.type === "delivered" || msg.type === "read") &&
      typeof msg.upToMessageId === "string"
    ) {
      const att = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (att?.kind !== "visitor") return;

      const db = drizzle(this.env.DB);
      const chatService = new ChatService(db);
      const conversation = await chatService.getOperationalConversationById(
        att.conversationId,
        att.projectId,
      );
      if (!conversation) return;
      const ids =
        msg.type === "delivered"
          ? await chatService.markPublicDeliveredUpTo(att.conversationId, msg.upToMessageId)
          : await chatService.markPublicReadUpTo(att.conversationId, msg.upToMessageId);
      if (ids.length === 0) return;

      this.broadcastToAgents({
        type: "message:status",
        conversationId: att.conversationId,
        status: msg.type,
        messageIds: ids,
        at: Date.now(),
      });
      return;
    }
  }

  webSocketClose(): void {
    // Hibernation API requires the handler to exist; nothing to do.
  }

  webSocketError(): void {
    // Hibernation API requires the handler to exist; nothing to do.
  }

  private async replayMissed(
    ws: WebSocket,
    cursors: ResumeCursors,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as
      | SocketAttachment
      | undefined;
    if (!attachment) return;
    if (attachment.roomKind !== "conversation") return;

    const db = drizzle(this.env.DB);
    const chatService = new ChatService(db);
    const conversation = attachment.kind === "agent"
      ? await chatService.getConversationById(
          attachment.conversationId,
          attachment.projectId,
        )
      : await chatService.getOperationalConversationById(
          attachment.conversationId,
          attachment.projectId,
        );
    if (!conversation) return;
    await replayConversationMessages(ws, attachment, cursors, chatService);
  }

  private async handleBroadcast(req: Request): Promise<Response> {
    if (
      req.headers.get("X-Internal") !== this.env.INTERNAL_BROADCAST_SECRET
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    let body: BroadcastBody;
    try {
      body = (await req.json()) as BroadcastBody;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    broadcastEventToSockets(this.state.getWebSockets(), body);

    return new Response("ok");
  }

  private async handleCloseAll(req: Request): Promise<Response> {
    if (
      req.headers.get("X-Internal") !== this.env.INTERNAL_BROADCAST_SECRET
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.close(1000, "conversation_closed");
      } catch {
        // ignore
      }
    }
    return new Response("ok");
  }

  private broadcastToAgents(event: ServerEvent): void {
    broadcastEventToSockets(this.state.getWebSockets(), {
      event,
      audience: "agents",
    });
  }

  private safeSend(ws: WebSocket, event: ServerEvent): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // ignore
    }
  }
}
