import { drizzle } from "drizzle-orm/d1";
import { ChatService } from "../services/chat-service";
import { type AppEnv } from "../types";
import { type ServerEvent, type MessagePayload } from "../../shared/ws-events";

interface SocketAttachment {
  kind: "agent" | "visitor";
  subjectId: string;
  conversationId: string;
  projectId: string;
  roomKind: "conversation" | "customer_project";
}

interface BroadcastBody {
  event: ServerEvent;
  excludeSubjectId?: string;
  audience?: "agents";
}

function toMessagePayload(row: {
  id: string;
  role: "visitor" | "bot" | "agent" | "system";
  content: string;
  imageUrl: string | null;
  sources: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  createdAt: Date;
}): MessagePayload {
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
      const conversation = await new ChatService(
        db,
      ).getOperationalConversationById(conversationId, projectId);
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
      await this.replayMissed(ws, msg.lastMessageId ?? null);
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
          ? await chatService.markDeliveredUpTo(att.conversationId, msg.upToMessageId)
          : await chatService.markReadUpTo(att.conversationId, msg.upToMessageId);
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
    lastMessageId: string | null,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as
      | SocketAttachment
      | undefined;
    if (!attachment) return;
    if (attachment.roomKind !== "conversation") return;

    const db = drizzle(this.env.DB);
    const chatService = new ChatService(db);
    const conversation = await chatService.getOperationalConversationById(
      attachment.conversationId,
      attachment.projectId,
    );
    if (!conversation) return;

    let sinceMs = 0;
    if (lastMessageId) {
      const last = await chatService.getMessageById(lastMessageId);
      if (last && last.conversationId === attachment.conversationId) {
        sinceMs = last.createdAt.getTime();
      }
    }

    const missed = await chatService.getMessagesSince(
      attachment.conversationId,
      sinceMs,
    );

    for (const row of missed) {
      this.safeSend(ws, {
        type: "message:new",
        conversationId: attachment.conversationId,
        message: toMessagePayload(row),
      });
    }
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

    const payload = JSON.stringify(body.event);
    const sockets = this.state.getWebSockets();
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
      if (body.audience === "agents" && attachment?.kind !== "agent") {
        continue;
      }
      try {
        ws.send(payload);
        if (
          body.event.type === "conversation:archived" &&
          attachment?.kind === "visitor"
        ) {
          ws.close(1000, "conversation_archived");
        }
      } catch {
        // Socket might be in a weird state — Cloudflare will clean it up.
      }
    }

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
    const payload = JSON.stringify(event);
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (att?.kind !== "agent") continue;
      try {
        ws.send(payload);
      } catch {
        // Socket might be in a weird state — Cloudflare will clean it up.
      }
    }
  }

  private safeSend(ws: WebSocket, event: ServerEvent): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // ignore
    }
  }
}
