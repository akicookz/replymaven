import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Context } from "hono";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  type ConversationRow,
  type MessageRow,
  type ProjectRow,
  type ProjectSettingsRow,
  type QuickActionRow,
  type ResourceRow,
  type WidgetConfigRow,
} from "./db";
import { users } from "./db/auth.schema";
import { type HonoAppContext } from "./types";
import { buildMcpAuthenticateHeader } from "./mcp-oauth";
import { ProjectService } from "./services/project-service";
import { WidgetService } from "./services/widget-service";
import { ResourceService } from "./services/resource-service";
import { ChatService } from "./services/chat-service";
import { DashboardService } from "./services/dashboard-service";
import { triggerAutoRagSync } from "./services/autorag-sync";
import { getTeamContext } from "./services/team-context";
import {
  MCP_OAUTH_SCOPES,
  type McpOAuthScope,
  McpOAuthService,
} from "./services/mcp-oauth-service";
import {
  broadcastMessageNew,
  broadcastStatusChange,
} from "./realtime/broadcast";
import {
  createResourceSchema,
  createFaqResourceSchema,
  updateFaqResourceSchema,
} from "./validation";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppDb = DrizzleD1Database<Record<string, unknown>>;

interface McpRequestContext {
  db: AppDb;
  env: HonoAppContext["Bindings"];
  executionCtx: ExecutionContext;
  userId: string;
  userName: string;
  effectiveUserId: string;
  activeRole: "owner" | "admin" | "member" | null;
  activeAccessAllProjects: boolean;
  activeProjectIds: string[] | null;
  scopes: McpOAuthScope[];
}

interface TruncatedText {
  text: string | null;
  truncated: boolean;
  originalLength: number;
}

const confirmedMutationSchema = z
  .literal(true)
  .describe("Must be true after the user explicitly confirms this mutation.");

// ─── Request Handler ──────────────────────────────────────────────────────────

export async function handleMcpRequest(
  c: Context<HonoAppContext>,
): Promise<Response> {
  const context = await getMcpRequestContext(c);
  if (!context) return unauthorizedMcpResponse(c);

  const server = createReplyMavenMcpServer({
    ...context,
  });

  return createMcpHandler(server, {
    route: "/api/mcp",
    authContext: {
      props: {
        userId: context.userId,
        effectiveUserId: context.effectiveUserId,
      },
    },
  })(c.req.raw, c.env, c.executionCtx);
}

async function getMcpRequestContext(
  c: Context<HonoAppContext>,
): Promise<McpRequestContext | null> {
  const db = c.get("db");
  const bearerToken = getBearerToken(c.req.header("authorization"));

  if (bearerToken) {
    const oauthService = new McpOAuthService(db);
    const token = await oauthService.validateAccessToken(bearerToken);
    if (!token) return null;

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
      })
      .from(users)
      .where(eq(users.id, token.userId))
      .limit(1);
    const user = rows[0];
    if (!user) return null;

    const teamContext = await getTeamContext(
      c.env.CONVERSATIONS_CACHE,
      db,
      user.id,
    );

    return {
      db,
      env: c.env,
      executionCtx: c.executionCtx,
      userId: user.id,
      userName: user.name,
      effectiveUserId: teamContext.effectiveUserId,
      activeRole: teamContext.activeRole,
      activeAccessAllProjects: teamContext.accessAllProjects,
      activeProjectIds: teamContext.projectIds,
      scopes: token.scopes,
    };
  }

  const user = c.get("user");
  if (!user) return null;

  return {
    db,
    env: c.env,
    executionCtx: c.executionCtx,
    userId: user.id,
    userName: user.name,
    effectiveUserId: c.get("effectiveUserId") ?? user.id,
    activeRole: c.get("activeRole"),
    activeAccessAllProjects: c.get("activeAccessAllProjects"),
    activeProjectIds: c.get("activeProjectIds"),
    scopes: [...MCP_OAUTH_SCOPES],
  };
}

function getBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function unauthorizedMcpResponse(c: Context<HonoAppContext>): Response {
  const origin = new URL(c.req.url).origin;
  return c.json(
    { error: "Unauthorized" },
    401,
    { "WWW-Authenticate": buildMcpAuthenticateHeader(origin) },
  );
}

// ─── Server Factory ───────────────────────────────────────────────────────────

function createReplyMavenMcpServer(context: McpRequestContext): McpServer {
  const server = new McpServer({
    name: "ReplyMaven",
    version: "1.0.0",
  });

  registerListProjectsTool(server, context);
  registerGetProjectOverviewTool(server, context);
  registerListResourcesTool(server, context);
  registerGetResourceContentTool(server, context);
  registerListConversationsTool(server, context);
  registerGetConversationTool(server, context);
  registerSendAgentReplyTool(server, context);
  registerCreateFaqResourceTool(server, context);
  registerUpdateFaqResourceTool(server, context);
  registerCreateWebpageResourceTool(server, context);
  registerReindexResourceTool(server, context);

  return server;
}

// ─── Tool Registration ────────────────────────────────────────────────────────

function registerListProjectsTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List ReplyMaven projects visible to the authenticated user.",
      inputSchema: {
        includeSettings: z
          .boolean()
          .optional()
          .describe("Include non-secret project settings for each project."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ includeSettings }) => {
      requireScope(context, "projects:read");

      const projectService = new ProjectService(context.db);
      const projects = await getVisibleProjects(context);

      if (!includeSettings) {
        return textResult({ projects: projects.map(summarizeProject) });
      }

      const projectsWithSettings = await Promise.all(
        projects.map(async (project) => ({
          ...summarizeProject(project),
          settings: sanitizeProjectSettings(
            await projectService.getSettings(project.id),
          ),
        })),
      );

      return textResult({ projects: projectsWithSettings });
    },
  );
}

function registerGetProjectOverviewTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "get_project_overview",
    {
      title: "Get project overview",
      description:
        "Get high-level project details, settings, widget configuration, dashboard stats, and recent activity.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      requireScope(context, "projects:read");

      const project = await getAccessibleProject(context, projectId);
      const projectService = new ProjectService(context.db);
      const widgetService = new WidgetService(context.db);
      const dashboardService = new DashboardService(context.db);

      const [settings, widgetConfig, quickActions, stats] = await Promise.all([
        projectService.getSettings(project.id),
        widgetService.getWidgetConfig(project.id),
        widgetService.getQuickActions(project.id),
        dashboardService.getStats(context.effectiveUserId, project.id),
      ]);

      return textResult({
        project: summarizeProject(project),
        settings: sanitizeProjectSettings(settings),
        widgetConfig: sanitizeWidgetConfig(widgetConfig),
        quickActions: quickActions.map(summarizeQuickAction),
        stats: sanitizeDashboardStats(stats),
      });
    },
  );
}

function registerListResourcesTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "list_resources",
    {
      title: "List resources",
      description:
        "List knowledge resources configured for a ReplyMaven project.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      requireScope(context, "projects:read");

      await getAccessibleProject(context, projectId);

      const resourceService = new ResourceService(
        context.db,
        context.env.UPLOADS,
      );
      const resources = await resourceService.getResourcesByProject(projectId);
      const pageCounts =
        await resourceService.getCrawledPageCountsByResource(projectId);

      return textResult({
        resources: resources.map((resource) =>
          summarizeResource(resource, pageCounts.get(resource.id) ?? 0),
        ),
      });
    },
  );
}

function registerGetResourceContentTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "get_resource_content",
    {
      title: "Get resource content",
      description:
        "Read the extracted content for a knowledge resource. Content is truncated by default.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        resourceId: z.string().min(1).describe("ReplyMaven resource ID."),
        maxChars: z
          .number()
          .int()
          .min(500)
          .max(30_000)
          .optional()
          .describe("Maximum content characters to return. Defaults to 8000."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, resourceId, maxChars }) => {
      requireScope(context, "projects:read");

      await getAccessibleProject(context, projectId);

      const resourceService = new ResourceService(
        context.db,
        context.env.UPLOADS,
      );
      const resource = await resourceService.getResourceById(
        resourceId,
        projectId,
      );
      if (!resource) throw new Error("Resource not found");

      const content = await resourceService.getResourceContent(
        resourceId,
        projectId,
      );
      if (!content) throw new Error("Resource content not found");

      return textResult({
        resource: summarizeResource(resource, null),
        content: truncateText(content.content, maxChars ?? 8_000),
        pairs: content.pairs ?? null,
      });
    },
  );
}

function registerListConversationsTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "list_conversations",
    {
      title: "List conversations",
      description:
        "List recent conversations for a ReplyMaven project, optionally filtered by status or visitor search.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        status: z
          .enum(["open", "closed", "all"])
          .optional()
          .describe("Conversation status filter. Defaults to open."),
        searchQuery: z
          .string()
          .max(100)
          .optional()
          .describe("Optional visitor name or email search."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum conversations to return. Defaults to 20."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, status, searchQuery, limit }) => {
      requireScope(context, "projects:read");

      await getAccessibleProject(context, projectId);

      const chatService = new ChatService(context.db);
      const conversations = await chatService.getConversationsByProject(
        projectId,
        limit ?? 20,
        0,
        status ?? "open",
        searchQuery,
      );

      return textResult({
        conversations: conversations.map(summarizeConversation),
      });
    },
  );
}

function registerGetConversationTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "get_conversation",
    {
      title: "Get conversation",
      description:
        "Read a conversation and its recent message history for a ReplyMaven project.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        conversationId: z
          .string()
          .min(1)
          .describe("ReplyMaven conversation ID."),
        maxMessages: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum latest messages to return. Defaults to 50."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, conversationId, maxMessages }) => {
      requireScope(context, "projects:read");

      await getAccessibleProject(context, projectId);

      const chatService = new ChatService(context.db);
      const conversation = await chatService.getConversationById(
        conversationId,
        projectId,
      );
      if (!conversation) throw new Error("Conversation not found");

      const messages = await chatService.getMessages(conversation.id);
      const latestMessages = messages.slice(-(maxMessages ?? 50));

      return textResult({
        conversation: summarizeConversation(conversation),
        messages: latestMessages.map(summarizeMessage),
      });
    },
  );
}

function registerSendAgentReplyTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "send_agent_reply",
    {
      title: "Send agent reply",
      description:
        "Send an agent reply to a ReplyMaven conversation and notify the live widget.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        conversationId: z
          .string()
          .min(1)
          .describe("ReplyMaven conversation ID."),
        content: z.string().min(1).max(5_000).describe("Reply content."),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, conversationId, content }) => {
      requireScope(context, "conversations:reply");

      await getAccessibleProject(context, projectId);

      const chatService = new ChatService(context.db);
      const conversation = await chatService.getConversationById(
        conversationId,
        projectId,
      );
      if (!conversation) throw new Error("Conversation not found");

      const avatar = await getCurrentUserAvatar(context);

      if (conversation.status === "closed") {
        await chatService.reopenConversation(conversation.id, projectId);
      }

      const message = await chatService.addMessage({
        conversationId: conversation.id,
        role: "agent",
        content: content.trim(),
        userId: context.userId,
        senderName: context.userName,
        senderAvatar: avatar,
      });

      await chatService.updateConversationStatus(
        conversation.id,
        projectId,
        "agent_replied",
      );

      broadcastMessageNew(context.env, context.executionCtx, conversation.id, message, {
        excludeSubjectId: context.userId,
      });
      broadcastStatusChange(
        context.env,
        context.executionCtx,
        conversation.id,
        "agent_replied",
      );

      return textResult({
        ok: true,
        message: summarizeMessage(message),
      });
    },
  );
}

function registerCreateFaqResourceTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "create_faq_resource",
    {
      title: "Create FAQ resource",
      description:
        "Create a structured FAQ knowledge resource and queue it for AI Search indexing.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        title: createFaqResourceSchema.shape.title.describe(
          "FAQ resource title.",
        ),
        description: createFaqResourceSchema.shape.description.describe(
          "Optional FAQ resource description.",
        ),
        pairs: createFaqResourceSchema.shape.pairs.describe(
          "FAQ question and answer pairs.",
        ),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, title, description, pairs }) => {
      requireScope(context, "resources:write");

      await getAccessibleProject(context, projectId);

      const resourceService = new ResourceService(
        context.db,
        context.env.UPLOADS,
      );
      const resource = await resourceService.createResource({
        projectId,
        type: "faq",
        title: title.trim(),
        description: description?.trim() || null,
        content: JSON.stringify(pairs),
      });

      context.executionCtx.waitUntil(
        (async () => {
          await resourceService.ingestFaqFromPairs(
            projectId,
            resource.id,
            resource.title,
            pairs,
          );
          await triggerAutoRagSync(context.env, "mcp.resource.create.faq");
        })(),
      );

      return textResult({
        ok: true,
        resource: summarizeResource(resource, null),
      });
    },
  );
}

function registerUpdateFaqResourceTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "update_faq_resource",
    {
      title: "Update FAQ resource",
      description:
        "Replace a structured FAQ resource's title, description, and pairs, then queue AI Search sync.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        resourceId: z.string().min(1).describe("FAQ resource ID."),
        title: updateFaqResourceSchema.shape.title.describe(
          "Replacement FAQ resource title. Defaults to the current title.",
        ),
        description: updateFaqResourceSchema.shape.description.describe(
          "Optional replacement FAQ resource description.",
        ),
        pairs: updateFaqResourceSchema.shape.pairs.describe(
          "Replacement FAQ question and answer pairs.",
        ),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, resourceId, title, description, pairs }) => {
      requireScope(context, "resources:write");

      await getAccessibleProject(context, projectId);

      const resourceService = new ResourceService(
        context.db,
        context.env.UPLOADS,
      );
      const resource = await resourceService.getResourceById(
        resourceId,
        projectId,
      );
      if (!resource || resource.type !== "faq") {
        throw new Error("FAQ resource not found");
      }

      const updated = await resourceService.updateFaqResource(
        resource.id,
        projectId,
        title?.trim() || resource.title,
        pairs,
        description?.trim() || null,
      );
      if (!updated) throw new Error("FAQ resource update failed");

      context.executionCtx.waitUntil(
        triggerAutoRagSync(context.env, "mcp.resource.update.faq"),
      );

      return textResult({
        ok: true,
        resource: summarizeResource(updated, null),
      });
    },
  );
}

function registerCreateWebpageResourceTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "create_webpage_resource",
    {
      title: "Create webpage resource",
      description:
        "Create a webpage knowledge resource and queue Cloudflare crawling plus AI Search indexing. PDF uploads are intentionally unsupported.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        title: createResourceSchema.shape.title.describe(
          "Webpage resource title.",
        ),
        url: z.string().url().max(2_048).describe("Webpage URL to crawl."),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ projectId, title, url }) => {
      requireScope(context, "resources:write");

      await getAccessibleProject(context, projectId);

      const resourceService = new ResourceService(
        context.db,
        context.env.UPLOADS,
      );
      const resource = await resourceService.createResource({
        projectId,
        type: "webpage",
        title: title.trim(),
        url,
      });

      context.executionCtx.waitUntil(
        (async () => {
          await resourceService.ingestWebpage(
            projectId,
            resource.id,
            url,
            resource.title,
            context.env.CRAWL_QUEUE,
            context.env.CF_ACCOUNT_ID,
            context.env.BROWSER_RENDERING_API_TOKEN,
          );
          await triggerAutoRagSync(context.env, "mcp.resource.create.webpage");
        })(),
      );

      return textResult({
        ok: true,
        resource: summarizeResource(resource, 0),
        message: "Webpage crawl and indexing started.",
      });
    },
  );
}

function registerReindexResourceTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "reindex_resource",
    {
      title: "Reindex resource",
      description:
        "Reindex a webpage or FAQ resource. PDF reindexing is intentionally unsupported through MCP.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        resourceId: z.string().min(1).describe("Resource ID to reindex."),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ projectId, resourceId }) => {
      requireScope(context, "resources:write");

      await getAccessibleProject(context, projectId);

      const resourceService = new ResourceService(
        context.db,
        context.env.UPLOADS,
      );
      const resource = await resourceService.getResourceById(
        resourceId,
        projectId,
      );
      if (!resource) throw new Error("Resource not found");
      if (resource.type === "pdf") {
        throw new Error("PDF reindexing is not supported through MCP");
      }

      await resourceService.updateResourceStatus(resource.id, projectId, "pending");

      if (resource.type === "webpage") {
        if (!resource.url) throw new Error("Webpage resource is missing a URL");
        context.executionCtx.waitUntil(
          (async () => {
            await resourceService.ingestWebpage(
              projectId,
              resource.id,
              resource.url ?? "",
              resource.title,
              context.env.CRAWL_QUEUE,
              context.env.CF_ACCOUNT_ID,
              context.env.BROWSER_RENDERING_API_TOKEN,
            );
            await triggerAutoRagSync(context.env, "mcp.resource.reindex.webpage");
          })(),
        );
      } else if (resource.type === "faq") {
        context.executionCtx.waitUntil(
          (async () => {
            await resourceService.ingestFaq(
              projectId,
              resource.id,
              resource.title,
              resource.content ?? "",
            );
            await triggerAutoRagSync(context.env, "mcp.resource.reindex.faq");
          })(),
        );
      }

      return textResult({
        ok: true,
        resource: summarizeResource(resource, null),
        message: "Reindexing started.",
      });
    },
  );
}

// ─── Access Control ───────────────────────────────────────────────────────────

function requireScope(context: McpRequestContext, scope: McpOAuthScope): void {
  if (!context.scopes.includes(scope)) {
    throw new Error(`MCP token is missing required scope: ${scope}`);
  }
}

async function getVisibleProjects(
  context: McpRequestContext,
): Promise<ProjectRow[]> {
  const projectService = new ProjectService(context.db);
  const projects = await projectService.getProjectsByUserId(
    context.effectiveUserId,
  );

  if (context.activeRole !== "member" || context.activeAccessAllProjects) {
    return projects;
  }

  const allowed = new Set(context.activeProjectIds ?? []);
  return projects.filter((project) => allowed.has(project.id));
}

async function getAccessibleProject(
  context: McpRequestContext,
  projectId: string,
): Promise<ProjectRow> {
  const projectService = new ProjectService(context.db);
  const project = await projectService.getProjectById(projectId);

  if (!project || project.userId !== context.effectiveUserId) {
    throw new Error("Project not found");
  }

  if (context.activeRole === "member" && !context.activeAccessAllProjects) {
    const allowed = context.activeProjectIds ?? [];
    if (!allowed.includes(project.id)) {
      throw new Error("Project not found");
    }
  }

  return project;
}

async function getCurrentUserAvatar(
  context: McpRequestContext,
): Promise<string | null> {
  const rows = await context.db
    .select({
      profilePicture: users.profilePicture,
      image: users.image,
    })
    .from(users)
    .where(eq(users.id, context.userId))
    .limit(1);

  return rows[0]?.profilePicture ?? rows[0]?.image ?? null;
}

// ─── Serialization ────────────────────────────────────────────────────────────

function textResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function summarizeProject(project: ProjectRow): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    domain: project.domain,
    onboarded: project.onboarded,
    createdAt: serializeDate(project.createdAt),
    updatedAt: serializeDate(project.updatedAt),
  };
}

function sanitizeProjectSettings(
  settings: ProjectSettingsRow | null,
): Record<string, unknown> | null {
  if (!settings) return null;

  return {
    aiSearchInstanceName: settings.aiSearchInstanceName,
    telegramConfigured: Boolean(
      settings.telegramBotToken || settings.telegramChatId,
    ),
    companyName: settings.companyName,
    companyUrl: settings.companyUrl,
    industry: settings.industry,
    companyContext: settings.companyContext,
    botName: settings.botName,
    agentName: settings.agentName,
    toneOfVoice: settings.toneOfVoice,
    customTonePrompt: settings.customTonePrompt,
    introMessage: settings.introMessage,
    autoCannedDraft: settings.autoCannedDraft,
    autoRefinement: settings.autoRefinement,
    autoCloseMinutes: settings.autoCloseMinutes,
    helpCustomUrl: settings.helpCustomUrl,
    createdAt: serializeDate(settings.createdAt),
    updatedAt: serializeDate(settings.updatedAt),
  };
}

function sanitizeWidgetConfig(
  config: WidgetConfigRow | null,
): Record<string, unknown> | null {
  if (!config) return null;

  return {
    primaryColor: config.primaryColor,
    backgroundColor: config.backgroundColor,
    textColor: config.textColor,
    headerText: config.headerText,
    headerSubtitle: config.headerSubtitle,
    avatarUrl: config.avatarUrl,
    position: config.position,
    borderRadius: config.borderRadius,
    fontFamily: config.fontFamily,
    bannerUrl: config.bannerUrl,
    bannerPosition: config.bannerPosition,
    homeTitle: config.homeTitle,
    homeSubtitle: config.homeSubtitle,
    allowedPages: parseJsonValue(config.allowedPages),
    backgroundStyle: config.backgroundStyle,
    createdAt: serializeDate(config.createdAt),
    updatedAt: serializeDate(config.updatedAt),
  };
}

function summarizeQuickAction(action: QuickActionRow): Record<string, unknown> {
  return {
    id: action.id,
    type: action.type,
    label: action.label,
    action: action.action,
    icon: action.icon,
    showOnHome: action.showOnHome,
    sortOrder: action.sortOrder,
    createdAt: serializeDate(action.createdAt),
  };
}

function summarizeResource(
  resource: ResourceRow,
  crawledPageCount: number | null,
): Record<string, unknown> {
  return {
    id: resource.id,
    projectId: resource.projectId,
    type: resource.type,
    title: resource.title,
    description: resource.description,
    url: resource.url,
    status: resource.status,
    lastIndexedAt: serializeDate(resource.lastIndexedAt),
    crawledPageCount,
    createdAt: serializeDate(resource.createdAt),
    updatedAt: serializeDate(resource.updatedAt),
  };
}

function summarizeConversation(
  conversation: ConversationRow,
): Record<string, unknown> {
  return {
    id: conversation.id,
    projectId: conversation.projectId,
    visitorId: conversation.visitorId,
    visitorName: conversation.visitorName,
    visitorEmail: conversation.visitorEmail,
    status: conversation.status,
    closeReason: conversation.closeReason,
    lastActivityAt: serializeDate(conversation.lastActivityAt),
    visitorLastSeenAt: serializeDate(conversation.visitorLastSeenAt),
    visitorPresence: conversation.visitorPresence,
    visitorLastOnlineAt: serializeDate(conversation.visitorLastOnlineAt),
    createdAt: serializeDate(conversation.createdAt),
    updatedAt: serializeDate(conversation.updatedAt),
  };
}

function summarizeMessage(message: MessageRow): Record<string, unknown> {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    imageUrl: message.imageUrl,
    sources: parseJsonValue(message.sources),
    senderName: message.senderName,
    createdAt: serializeDate(message.createdAt),
    emailedAt: serializeDate(message.emailedAt),
  };
}

function sanitizeDashboardStats(
  stats: Awaited<ReturnType<DashboardService["getStats"]>>,
): Record<string, unknown> {
  return {
    totalProjects: stats.totalProjects,
    totalConversations: stats.totalConversations,
    activeConversations: stats.activeConversations,
    totalMessages: stats.totalMessages,
    totalResources: stats.totalResources,
    pendingCannedDrafts: stats.pendingCannedDrafts,
    conversationsByDay: stats.conversationsByDay,
    conversationsByStatus: stats.conversationsByStatus,
    recentConversations: stats.recentConversations.map(summarizeConversation),
  };
}

function truncateText(input: string | null, maxChars: number): TruncatedText {
  if (!input) {
    return {
      text: input,
      truncated: false,
      originalLength: 0,
    };
  }

  if (input.length <= maxChars) {
    return {
      text: input,
      truncated: false,
      originalLength: input.length,
    };
  }

  return {
    text: `${input.slice(0, maxChars)}...`,
    truncated: true,
    originalLength: input.length,
  };
}

function serializeDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function parseJsonValue(raw: string | null): unknown {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
