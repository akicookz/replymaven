import { type Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { ProjectService } from "../services/project-service";
import { ChatService } from "../services/chat-service";
import { type HonoAppContext } from "../types";

interface UpgradeContext {
  conversationId: string;
  projectId: string;
  kind: "agent" | "visitor";
  subjectId: string;
}

async function forwardUpgradeToDO(
  c: Context<HonoAppContext>,
  ctx: UpgradeContext,
): Promise<Response> {
  if (c.req.header("upgrade") !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }

  const stub = c.env.CONVERSATION_DO.get(
    c.env.CONVERSATION_DO.idFromName(ctx.conversationId),
  );

  const forwardHeaders = new Headers(c.req.raw.headers);
  forwardHeaders.set("x-conn-kind", ctx.kind);
  forwardHeaders.set("x-subject-id", ctx.subjectId);
  forwardHeaders.set("x-conversation-id", ctx.conversationId);
  forwardHeaders.set("x-project-id", ctx.projectId);

  return stub.fetch(
    new Request("https://do/connect", {
      method: "GET",
      headers: forwardHeaders,
    }),
  );
}

export async function handleWidgetWsUpgrade(
  c: Context<HonoAppContext>,
): Promise<Response> {
  const slug = c.req.param("projectSlug");
  const conversationId = c.req.param("id");
  const visitorId = c.req.query("visitorId");

  if (!slug || !conversationId || !visitorId) {
    return c.json({ error: "Missing parameters" }, 400);
  }

  const db = drizzle(c.env.DB);
  const projectService = new ProjectService(db);
  const project = await projectService.getProjectBySlugPublic(slug);
  if (!project) return c.json({ error: "Project not found" }, 404);

  const chatService = new ChatService(db);
  const conversation = await chatService.getConversationById(
    conversationId,
    project.id,
  );
  if (!conversation) return c.json({ error: "Conversation not found" }, 404);
  if (conversation.visitorId !== visitorId) {
    return c.json({ error: "Forbidden" }, 403);
  }
  if (conversation.status === "closed") {
    return c.json({ error: "Conversation closed" }, 410);
  }

  return forwardUpgradeToDO(c, {
    conversationId,
    projectId: project.id,
    kind: "visitor",
    subjectId: visitorId,
  });
}

export async function handleDashboardWsUpgrade(
  c: Context<HonoAppContext>,
): Promise<Response> {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const projectId = c.req.param("id");
  const convId = c.req.param("convId");
  if (!projectId || !convId) {
    return c.json({ error: "Missing parameters" }, 400);
  }

  const db = c.get("db");
  const projectService = new ProjectService(db);
  const project = await projectService.getProjectById(projectId);
  const effectiveUserId = c.get("effectiveUserId") ?? user.id;
  if (!project || project.userId !== effectiveUserId) {
    return c.json({ error: "Not found" }, 404);
  }

  const chatService = new ChatService(db);
  const conversation = await chatService.getConversationById(convId, project.id);
  if (!conversation) return c.json({ error: "Not found" }, 404);

  return forwardUpgradeToDO(c, {
    conversationId: convId,
    projectId: project.id,
    kind: "agent",
    subjectId: user.id,
  });
}
