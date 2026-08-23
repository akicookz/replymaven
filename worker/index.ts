import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getAgentByName, routeAgentRequest } from "agents";
import { cors } from "hono/cors";
import { except } from "hono/combine";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNotNull } from "drizzle-orm";
import { users } from "./db/auth.schema";
import {
  projectSettings as projectSettingsTable,
  resources as resourcesTable,
  type HelpArticleRow,
} from "./db/schema";
import { createAuth } from "./auth";
import { type AppEnv, type HonoAppContext, type Plan } from "./types";
import { ProjectService } from "./services/project-service";
import { WidgetService } from "./services/widget-service";
import {
  getAssignableUsers,
  isAllowedAssignee,
  mavenAssignableUser,
} from "./services/assignable-users";
import { ContactFormService } from "./services/contact-form-service";
import { createPublicConversationStore } from "./conversations/create-public-conversation-store";
import { AgentPublicConversationStore } from "./conversations/agent-public-conversation-store";
import { dashboardReplyIdentity } from "./conversations/dashboard-reply-identity";
import {
  toLegacyConversationDto,
  toLegacyLastMessagePreviewDto,
  toLegacyMessageDto,
} from "./conversations/public-conversation-dto";
import {
  type PublicConversationStore,
  parsePublicInboxFilter,
} from "./conversations/public-conversation-store";
import { canAutoCloseConversationStatus } from "./conversations/conversation-staleness";
import { CustomerIdentityService } from "./services/customer-identity-service";
import { CustomerService } from "./services/customer-service";
import { ResourceService, type FaqPair } from "./services/resource-service";
import { triggerAutoRagSync } from "./services/autorag-sync";
import { FAQ_SET_MAX_CHARS } from "../shared/faq-limits";
import {
  findCustomCssViolation,
  sanitizeCustomCss,
} from "../shared/sanitize-custom-css";
import {
  isConversationUploadUrl,
} from "../shared/upload-ownership";
import { publicUploadUrl } from "./lib/public-upload-url";
import { AiService } from "./services/ai-service";
import { executeChannelBotNameCommand } from "./services/run-bot-name-command";
import { runAgentChannelInbound } from "./services/run-agent-channel-inbound";
import { createTelegramAgentChannel } from "./services/telegram-agent-channel";
import { listEnabledAgentChannels } from "./services/enabled-agent-channels";
import {
  createSlackAgentChannel,
  readSlackMessageInbound,
  readSlackUrlVerification,
} from "./services/slack-agent-channel";
import { SlackService } from "./services/slack-service";
import { resolveSlackChannelBinding } from "./services/slack-chat-binding";
import {
  encryptSlackSecret,
  matchesSlackRequestSignature,
  resolveSlackSecret,
} from "./services/slack-secrets";
import { forwardVisitorThroughAgentChannels } from "./services/run-agent-channel-outbound";
import {
  canHandConversationToMaven,
  recordMavenAssignment,
} from "./services/maven-assignment";
import { isMavenAssignee } from "../shared/maven-assignee";
import { TelegramService } from "./services/telegram-service";
import { resolveTelegramChatBinding } from "./services/telegram-chat-binding";
import { parseConversationReference } from "./services/inbound-email-routing";
import { migrateTelegramSecrets } from "./migrations/telegram-secret-migration";
import {
  deriveTelegramWebhookSecret,
  encryptTelegramToken,
  matchesTelegramWebhookSecret,
} from "./services/telegram-secrets";
import { DashboardService } from "./services/dashboard-service";
import { CrawlService, type CrawlMessage } from "./services/crawl-service";
import { purgeExpiredArchivedConversations } from "./services/conversation-retention-service";
import {
  EmailService,
  parseEmailMessageId,
  RESERVED_INBOUND_LOCAL_PARTS,
} from "./services/email-service";
import { ToolService } from "./services/tool-service";
import { GuidelineService } from "./services/guideline-service";
import { HelpdeskService } from "./services/helpdesk-service";
import { McpOAuthService } from "./services/mcp-oauth-service";
import { renderHelpIndex } from "./helpdesk-render/render-help-index";
import { renderHelpCategory } from "./helpdesk-render/render-help-category";
import { renderHelpArticle } from "./helpdesk-render/render-help-article";
import { renderHelpSearch } from "./helpdesk-render/render-help-search";
import { renderSitemap } from "./helpdesk-render/render-sitemap";
import { renderRobots } from "./helpdesk-render/render-robots";
import {
  renderMarkdown,
  ensureArticleTitle,
} from "./helpdesk-render/render-markdown";
import {
  buildHelpUrl,
  isOwnHelpCenterUrl,
  normalizeHelpCustomUrl,
  resolveHelpCustomUrl,
} from "./helpdesk-render/build-help-url";
import { defaultHelpHomeMarkdown } from "../shared/help-home-markdown";
import { expandHelpHomeBlocks } from "./helpdesk-render/expand-help-home-blocks";
import {
  sanitizeHelpHomeBackgroundFit,
  sanitizeHelpHomeBackgroundPosition,
  sanitizeHelpHomeBackgroundUrl,
} from "./helpdesk-render/sanitize-help-home-background-url";
import { sanitizeHelpThemeDefault } from "./helpdesk-render/help-theme-default";
import { groupArticlesByCategory } from "./helpdesk-render/group-articles";
import {
  dispatchPublicHelp,
  helpHtmlHeaders,
  helpNotFoundCacheHeaders,
  helpSearchHeaders,
  helpSitemapCacheHeaders,
  helpUncachedHeaders,
  invalidateHelpPageCache,
  isPublicHelpPath,
  publicHelpHtmlChanged,
  scheduleHelpPageCachePurge,
} from "./helpdesk-render/help-page-cache";
import { matchHelpArticlesFromQuery } from "./helpdesk-render/help-search";
import {
  OWN_DOCS_DISPATCH_HEADER,
  hostedHelpRedirectUrl,
  hostedHelpShouldNoindex,
  isHelpProxyPass,
  isOwnDocsDispatch,
  stripOwnDocsDispatchHeader,
} from "./helpdesk-render/hosted-help-seo";
import {
  loadPublicHelpPage,
  type PublicHelpPageContext,
} from "./helpdesk-render/load-public-help-page";
import { applyHelpArticleSeoDefaults } from "./helpdesk-render/apply-help-article-seo-defaults";
import {
  encryptHeaders,
  decryptHeaders,
  maskHeaders,
  isEncrypted,
} from "./services/encryption-service";
import { BillingService } from "./services/billing-service";
import {
  addProjectAccessToMembers,
  TeamService,
} from "./services/team-service";
import {
  getTeamContext,
  invalidateTeamContext,
} from "./services/team-context";
import { VisitorBanService } from "./services/visitor-ban-service";
import { touchLinkedCustomerAfterVisitorMessage } from "./chat-runtime/customer-last-seen";
import {
  buildContactAcceptedPayload,
  buildContactFormMessage,
  extractFormEmail,
  extractFormName,
  markContactAiUnavailable,
} from "./chat-runtime/contact-support/contact-support";
import { runContactSupportFollowUp } from "./chat-runtime/contact-support/run-contact-support-follow-up";
import { createEscalation } from "./chat-runtime/post-turn/escalation";
import { buildToolRegistry } from "./chat-runtime/tools/http-tool-executor";
import { isReturningVisitorGap, toToolDefinition } from "./chat-runtime/types";
import { logError, logWarn } from "./observability";
import { slugify } from "./lib/slugify";
import { parseHelpTopNav } from "./lib/help-top-nav";
import { parseHelpAnalytics } from "./lib/help-analytics";
import {
  handleConversationCustomer,
  handleCreateCustomer,
  handleDeleteCustomer,
  handleGetCustomer,
  handleListCustomers,
  handleMergeCustomers,
  handleSignedWidgetIdentify,
  handleUpdateCustomer,
  serializeProjectSettings,
} from "./routes/customer-handlers";
import {
  handleCreateToolRequest,
  handleListToolsRequest,
  handleUpdateToolRequest,
} from "./routes/tool-handlers";
import {
  handleCreateSidechatSession,
  handleGetSidechatSummaries,
  type SidechatRouteActor,
} from "./routes/sidechat-agent-handlers";
import {
  handleConversationRuntimeBackfill,
  handleConversationRuntimeVerify,
} from "./routes/conversation-runtime-admin";
import { ConversationRuntimeMigrationService } from "./migrations/conversation-runtime-backfill";
import {
  handleCreateDashboardPublicAgentSession,
  handleCreateWidgetPublicAgentSession,
} from "./routes/public-agent-handlers";
import {
  handleConnectProjectMcp,
  handleDisconnectProjectMcp,
  handleGetProjectMcp,
  handleGrantProjectToolAlwaysAllow,
  handleMcpOAuthCallback,
  handleRefreshProjectMcp,
  handleUpdateProjectMcpPolicy,
  handleRevokeProjectToolAlwaysAllow,
} from "./routes/project-mcp-handlers";
import { deleteProjectWithNativeCleanup } from "./routes/project-cleanup";
import { authorizeSidechatAgentRouteRequest } from "./agents/sidechat/agent-auth";
import { authorizePublicAgentRouteRequest } from "./agents/maven/public/public-agent-auth";
import { MavenProjectAgent } from "./agents/maven/maven-project-agent";
import { handleMcpRequest } from "./mcp-server";
import {
  handleMcpAuthorizationServerMetadata,
  handleMcpAuthorizeGet,
  handleMcpAuthorizePost,
  handleMcpClientRegistration,
  handleMcpProtectedResourceMetadata,
  handleMcpToken,
  handleMcpTokenRevocation,
} from "./mcp-oauth";
export { MavenProjectAgent };
export { MavenChatAgent } from "./agents/maven/maven-chat-agent";
import {
  createProjectSchema,
  updateProjectSchema,
  updateProjectSettingsSchema,
  updateWidgetConfigSchema,
  createQuickActionSchema,
  updateQuickActionSchema,
  createResourceSchema,
  createFaqResourceSchema,
  updateFaqResourceSchema,
  updateResourceContentSchema,
  generateFaqRequestSchema,
  applyFaqSplitSchema,
  movePairSchema,
  updateCrawledPageContentSchema,
  createConversationSchema,
  agentReplySchema,
  updateTelegramSchema,
  updateSlackSchema,
  onboardingStep1Schema,
  onboardingContextSchema,
  onboardingWidgetSchema,
  updateVisitorEmailSchema,
  updateConversationPublicSchema,
  updateTicketConfigSchema,
  submitContactFormSchema,
  testToolSchema,
  createCheckoutSchema,
  inviteTeamMemberSchema,
  updateTeamMemberRoleSchema,
  switchTeamSchema,
  updateProfileSchema,
  requestEmailChangeSchema,
  verifyEmailChangeSchema,
  createGuidelineSchema,
  updateGuidelineSchema,
  usageLogQuerySchema,
  sendMessageAsEmailSchema,
  snoozeSchema,
  prioritySchema,
  assignSchema,
  bulkConversationActionSchema,
  banVisitorSchema,
  createGreetingSchema,
  updateGreetingSchema,
  reorderGreetingsSchema,
  createHelpCategorySchema,
  updateHelpCategorySchema,
  createHelpArticleSchema,
  updateHelpArticleSchema,
  previewHelpArticleSchema,
  reorderHelpItemsSchema,
  helpTestProxySchema,
} from "./validation";
import {
  MAX_HELP_IMAGE_BYTES,
  verifyHelpImageUploadToken,
} from "./security/help-image-upload-token";
import { BodyTooLargeError, readLimitedBody } from "./lib/read-limited-body";
import { uploadExtensionFor } from "./lib/upload-extension";

// ─── Simple IP-based rate limiter (in-memory, per-isolate) ────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = Date.now();

function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();

  // Periodic cleanup of expired entries to prevent memory growth
  if (now - lastCleanup > 60_000) {
    lastCleanup = now;
    for (const [k, v] of rateLimitMap) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }

  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

function getClientIp(c: {
  req: { header: (name: string) => string | undefined };
}): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

// ─── Streaming body reader with a hard byte cap ───────────────────────────────
async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const remaining = buf.length - offset;
    if (remaining <= 0) break;
    if (chunk.byteLength <= remaining) {
      buf.set(chunk, offset);
      offset += chunk.byteLength;
    } else {
      buf.set(chunk.subarray(0, remaining), offset);
      offset += remaining;
      break;
    }
  }
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(buf);
}

// ─── Zod validation helper ────────────────────────────────────────────────────
function validate<T>(
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: { issues: Array<{ message: string }> };
    };
  },
  data: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { success: true, data: result.data as T };
  const message = result.error?.issues?.[0]?.message ?? "Validation failed";
  return { success: false, error: message };
}

async function maskStoredToolHeaders(
  headers: string | null,
  encryptionKey: string,
): Promise<Record<string, string> | null> {
  if (!headers) return null;
  try {
    const decrypted = isEncrypted(headers)
      ? await decryptHeaders(headers, encryptionKey)
      : (JSON.parse(headers) as Record<string, string>);
    return maskHeaders(decrypted);
  } catch {
    return null;
  }
}

function isConversationStale(
  conv: {
    status: string;
    lastActivityAt: Date | number | null;
    createdAt: Date | number;
  },
  autoCloseMinutes: number,
): boolean {
  if (!canAutoCloseConversationStatus(conv.status)) return false;
  const activity = conv.lastActivityAt ?? conv.createdAt;
  const last = activity instanceof Date ? activity.getTime() : activity;
  return last < Date.now() - autoCloseMinutes * 60_000;
}

async function runWithConversationExternalAction<T>(
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

interface BrowserRenderingMarkdownResponse {
  success: boolean;
  result: string;
}

const CONTEXT_SOURCE_MAX_CHARS = 45_000;
const CONTEXT_MAX_WEB_PAGES_PER_RESOURCE = 8;

function truncateForContextSource(input: string, remaining: number): string {
  if (remaining <= 0) return "";
  if (input.length <= remaining) return input;
  return `${input.slice(0, remaining)}...`;
}

function normalizeFaqContent(content: string | null): string {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content) as Array<{
      question?: string;
      answer?: string;
    }>;
    if (!Array.isArray(parsed)) return content;
    const lines = parsed
      .filter((pair) => pair.question && pair.answer)
      .map((pair) => `- Q: ${pair.question}\n  A: ${pair.answer}`);
    return lines.length > 0 ? lines.join("\n") : content;
  } catch {
    return content;
  }
}

async function buildContextSourceFromResources(
  projectId: string,
  resourceService: ResourceService,
  resources: Array<{
    id: string;
    type: "webpage" | "pdf" | "faq";
    title: string;
    url: string | null;
    content: string | null;
  }>,
): Promise<string> {
  const sections: string[] = [];
  let remaining = CONTEXT_SOURCE_MAX_CHARS;

  for (const resource of resources) {
    if (remaining < 250) break;
    let section = "";

    if (resource.type === "faq") {
      const faqContent = normalizeFaqContent(resource.content);
      if (faqContent) {
        section = `## FAQ Resource: ${resource.title}\n${faqContent}`;
      }
    } else if (resource.type === "pdf") {
      if (resource.content) {
        section = `## PDF Resource: ${resource.title}\n${resource.content}`;
      }
    } else if (resource.type === "webpage") {
      const pages = await resourceService.getCrawledPages(
        resource.id,
        projectId,
      );
      const crawledPages = pages
        .filter((page) => page.status === "crawled")
        .slice(0, CONTEXT_MAX_WEB_PAGES_PER_RESOURCE);
      const pageSections: string[] = [];

      for (const page of crawledPages) {
        const pageContent = await resourceService.getCrawledPageContent(
          page.id,
          resource.id,
          projectId,
        );
        if (!pageContent) continue;
        pageSections.push(
          `### ${page.pageTitle ?? page.url}\nURL: ${page.url}\n\n${pageContent}`,
        );
      }

      if (pageSections.length > 0) {
        section = `## Website Resource: ${resource.title}\n${pageSections.join("\n\n")}`;
      } else if (resource.url) {
        section = `## Website Resource: ${resource.title}\nURL: ${resource.url}`;
      }
    }

    if (!section.trim()) continue;
    const clipped = truncateForContextSource(section, remaining);
    sections.push(clipped);
    remaining -= clipped.length;
  }

  return sections.join("\n\n---\n\n");
}

async function fetchWebsiteMarkdownWithBrowserApi(
  websiteUrl: string,
  env: AppEnv,
): Promise<string | null> {
  try {
    const browserApiBase = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering`;
    const response = await fetch(`${browserApiBase}/markdown`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.BROWSER_RENDERING_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: websiteUrl,
        gotoOptions: {
          waitUntil: "networkidle2",
        },
        rejectRequestPattern: [
          "/^.*\\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff|mp4|webm|ogg|mp3|wav|woff2?|ttf|eot|otf|css)$/i",
        ],
      }),
    });

    if (!response.ok) return null;
    const data = (await response.json()) as BrowserRenderingMarkdownResponse;
    if (!data.success || !data.result) return null;

    const markdown = data.result.trim();
    if (markdown.length < 100) return null;
    return markdown;
  } catch {
    return null;
  }
}

/**
 * Enforces per-project access for team members scoped to specific projects.
 * Owners and admins (and members with account-wide access) pass through; a
 * scoped member hitting a project they weren't granted gets a 404, matching
 * the "not found" response used elsewhere for cross-account access. Mounted on
 * `/api/projects/:id` and `/api/projects/:id/*`; the per-route handlers still
 * perform their own ownership checks (defense in depth).
 */
const projectAccessMiddleware: MiddlewareHandler<HonoAppContext> = async (
  c,
  next,
) => {
  const user = c.get("user");
  if (!user) return next(); // handler returns 401

  const projectId = c.req.param("id");
  if (!projectId) return next();

  // Owners, admins, and members with account-wide access pass through.
  const role = c.get("activeRole");
  if (role !== "member" || c.get("activeAccessAllProjects")) return next();

  // Scoped member: allow only their granted projects (resolved from cache).
  const allowed = c.get("activeProjectIds");
  if (allowed && allowed.includes(projectId)) return next();
  return c.json({ error: "Not found" }, 404);
};

async function canAccessCustomerProject(
  c: Context<HonoAppContext>,
  projectId: string,
): Promise<boolean> {
  const user = c.get("user");
  if (!user) return false;
  const effectiveUserId = c.get("effectiveUserId") ?? user.id;
  const project = await new ProjectService(c.get("db")).getProjectById(
    projectId,
  );
  return project?.userId === effectiveUserId;
}

function broadcastCustomerChanges(
  c: Context<HonoAppContext>,
  projectId: string,
  customerIds: string[],
): void {
  if (customerIds.length === 0) return;
  c.executionCtx.waitUntil((async () => {
    const parent = await getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId);
    await parent.notifyCustomerUpdated(customerIds);
  })().catch(() => {
    // Realtime invalidation is advisory; queries refetch on their own.
  }));
}

function getSidechatRouteActor(
  c: Context<HonoAppContext>,
): SidechatRouteActor | null {
  const user = c.get("user");
  const effectiveUserId = c.get("effectiveUserId");
  const role = c.get("activeRole");
  return user && effectiveUserId && role
    ? {
        userId: user.id,
        effectiveUserId,
        role,
        accessAllProjects: c.get("activeAccessAllProjects"),
        projectIds: c.get("activeProjectIds"),
      }
    : null;
}

const app = new Hono<HonoAppContext>()
  // ─── Global CORS ────────────────────────────────────────────────────────────
  .use("*", cors())
  // ─── Auth-specific CORS ─────────────────────────────────────────────────────
  .use(
    "/api/auth/*",
    cors({
      origin: (origin) => origin || "*",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["POST", "GET", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    }),
  )
  // ─── Better Auth handler ────────────────────────────────────────────────────
  .on(["POST", "GET"], "/api/auth/*", (c) => {
    const auth = createAuth(c.env, c.req.raw.cf as CfProperties);
    return auth.handler(c.req.raw);
  })
  // ─── Native Maven Agent routing ───────────────────────────────────────────
  // The signed two-minute session token is verified before the parent Agent
  // or any registered child facet is woken. Both HTTP and WebSocket requests
  // pass through the same exact route/claim matcher.
  .all("/agents/*", async (c) => {
    async function authorizePublicRequest(request: Request): Promise<Request | Response> {
      const authorized = await authorizePublicAgentRouteRequest(
        request,
        c.env.SIDECHAT_TOKEN_SECRET,
      );
      if (authorized instanceof Response) return authorized;
      const segments = new URL(authorized.url).pathname.split("/")
        .filter(Boolean);
      const projectId = segments[2];
      return projectId
        ? authorized
        : c.json({ error: "not_found" }, 404);
    }
    const response = await routeAgentRequest(c.req.raw, c.env, {
      onBeforeConnect(request) {
        return new URL(request.url).pathname.includes(
            "/sub/maven-chat-agent/pub_",
          )
          ? authorizePublicRequest(request)
          : authorizeSidechatAgentRouteRequest(
              request,
              c.env.SIDECHAT_TOKEN_SECRET,
            );
      },
      onBeforeRequest(request) {
        return new URL(request.url).pathname.includes(
            "/sub/maven-chat-agent/pub_",
          )
          ? authorizePublicRequest(request)
          : authorizeSidechatAgentRouteRequest(
              request,
              c.env.SIDECHAT_TOKEN_SECRET,
            );
      },
    });
    return response ?? c.json({ error: "not_found" }, 404);
  })
  // Native MCP OAuth callbacks do not carry a dashboard session. The Agents
  // SDK validates the one-time OAuth state inside the exact project Agent.
  .all("/api/sidechat/mcp/oauth/:projectId", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`sidechat-mcp-oauth:${ip}`, 30, 60_000)) {
      return c.json({ error: "rate_limited" }, 429);
    }
    const projectId = c.req.param("projectId");
    return handleMcpOAuthCallback({
      projectId,
      request: c.req.raw,
      getParent: () =>
        getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId),
    });
  })
  // ─── Static SPA fallback ───────────────────────────────────────────────────
  // /help/* is reserved for the helpdesk feature (see helpdesk-render/), and
  // /docs is our own project's help center served from the same routes.
  // Excluding them here lets the public help routes registered below intercept
  // those paths before the SPA fallback fires.
  .use(
    "*",
    except(
      [
        "/api/*",
        "/help/*",
        "/docs",
        "/docs/*",
        "/.well-known/*",
        "/widget-agent-runtime.js",
      ],
      async (c) => {
        return c.env.ASSETS.fetch(c.req.raw);
      },
    ),
  )

  // ─── OAuth Metadata (public) ──────────────────────────────────────────────
  .get(
    "/.well-known/oauth-authorization-server",
    handleMcpAuthorizationServerMetadata,
  )
  .get(
    "/.well-known/oauth-protected-resource",
    handleMcpProtectedResourceMetadata,
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC WIDGET ENDPOINTS (no auth)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Widget Config ──────────────────────────────────────────────────────────
  .get("/api/widget/:projectSlug/config", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`wconf:${ip}`, 30, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const widgetService = new WidgetService(db);
    const config = await widgetService.getFullWidgetConfig(project.id);
    const widget = config.widget
      ? {
          ...config.widget,
          customCss: sanitizeCustomCss(config.widget.customCss),
        }
      : config.widget;
    return c.json({ ...config, widget, projectName: project.name });
  })

  // ─── Signed Customer Identity ──────────────────────────────────────────────
  .post("/api/widget/:projectSlug/identify", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`identify:${ip}`, 20, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(
      c.req.param("projectSlug"),
    );
    if (!project) return c.json({ error: "Project not found" }, 404);
    const settings = await projectService.getSettings(project.id);
    const chatService = createPublicConversationStore({ db, env: c.env });

    return handleSignedWidgetIdentify({
      projectId: project.id,
      body: await c.req.json(),
      encryptedSecret: settings?.customerIdentitySecret ?? null,
      encryptionKey: c.env.ENCRYPTION_KEY,
      nowSeconds: Math.floor(Date.now() / 1000),
      getConversation(projectId, conversationId) {
        return chatService.getConversationById(conversationId, projectId);
      },
      identityService: new CustomerIdentityService(
        db,
        createPublicConversationStore({ db, env: c.env }),
      ),
      onCustomersChanged(customerIds) {
        broadcastCustomerChanges(c, project.id, customerIds);
      },
    });
  })

  // ─── Create Conversation ────────────────────────────────────────────────────
  .post("/api/widget/:projectSlug/conversations", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`conv:${ip}`, 10, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json();
    const parsed = validate(createConversationSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const customerIdentityService = new CustomerIdentityService(
      db,
      createPublicConversationStore({ db, env: c.env }),
    );
    const linkedCustomer = await customerIdentityService.findCustomerByVisitorId(
      project.id,
      parsed.data.visitorId,
    );
    const visitorName = parsed.data.visitorName ?? linkedCustomer?.name ?? null;
    const visitorEmail =
      parsed.data.visitorEmail ?? linkedCustomer?.email ?? null;

    const banService = new VisitorBanService(db);
    const ban = await banService.isVisitorBanned(
      project.id,
      parsed.data.visitorId,
      visitorEmail,
    );
    if (ban) {
      return c.json({ banned: true, reason: ban.reason }, 403);
    }

    // Enrich metadata with geo data from Cloudflare headers
    const cf = c.req.raw.cf as CfProperties | undefined;
    const geoMeta: Record<string, string> = {
      ...(parsed.data.metadata ?? {}),
    };
    if (cf?.country) geoMeta.country = String(cf.country);
    if (cf?.city) geoMeta.city = String(cf.city);
    if (cf?.region) geoMeta.region = String(cf.region);
    if (cf?.timezone) geoMeta.timezone = String(cf.timezone);
    if (ip !== "unknown") geoMeta.ip = ip;
    const userAgent = c.req.header("user-agent");
    if (userAgent) geoMeta.userAgent = userAgent;

    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.createConversation({
      projectId: project.id,
      customerId: linkedCustomer?.id ?? null,
      visitorId: parsed.data.visitorId,
      visitorName,
      visitorEmail,
      metadata: JSON.stringify(geoMeta),
    });

    return c.json(toLegacyConversationDto(conversation), 201);
  })

  // ─── Public Agent Session ──────────────────────────────────────────────────
  .post(
    "/api/widget/:projectSlug/conversations/:id/agent-session",
    async (c) => {
      const ip = getClientIp(c);
      if (!checkRateLimit(`agent-session:${ip}`, 20, 60_000)) {
        return c.json({ error: "Rate limit exceeded" }, 429);
      }
      let visitorId: string | null = null;
      try {
        const body: unknown = await c.req.json();
        if (
          body &&
          typeof body === "object" &&
          !Array.isArray(body) &&
          typeof (body as Record<string, unknown>).visitorId === "string"
        ) {
          visitorId = (body as Record<string, string>).visitorId;
        }
      } catch {
        visitorId = null;
      }
      if (!visitorId || visitorId.length > 128) {
        return c.json({ error: "visitorId is required" }, 400);
      }
      const db = drizzle(c.env.DB);
      const conversationStore = createPublicConversationStore({ db, env: c.env });
      const agentStore = new AgentPublicConversationStore({ db, env: c.env });
      return handleCreateWidgetPublicAgentSession({
        request: c.req.raw,
        projectSlug: c.req.param("projectSlug"),
        conversationId: c.req.param("id"),
        visitorId,
        secret: c.env.SIDECHAT_TOKEN_SECRET,
        projectService: new ProjectService(db),
        conversationStore,
        banService: new VisitorBanService(db),
        ensurePublicConversation(conversation) {
          return agentStore.ensurePublicConversation(conversation);
        },
      });
    },
  )

  // ─── Get Active Conversation by Visitor ────────────────────────────────────
  .get("/api/widget/:projectSlug/conversations/active", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`actconv:${ip}`, 30, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const visitorId = c.req.query("visitorId");
    if (!visitorId) return c.json({ error: "visitorId is required" }, 400);

    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.getActiveConversationByVisitor(
      project.id,
      visitorId,
    );
    if (!conversation) return c.json({ conversation: null });
    return c.json({ conversation: toLegacyConversationDto(conversation) });
  })

  .post("/api/widget/:projectSlug/conversations/:id/heartbeat", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`hb:${ip}`, 30, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const conversationId = c.req.param("id");
    const db = drizzle(c.env.DB);

    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    let presence: "active" | "background" = "active";
    let deliveredUpTo: string | undefined;
    let readUpTo: string | undefined;
    try {
      const body = await c.req.json();
      if (body.presence === "background") presence = "background";
      if (typeof body.deliveredUpTo === "string") deliveredUpTo = body.deliveredUpTo;
      if (typeof body.readUpTo === "string") readUpTo = body.readUpTo;
    } catch {
      // No body or invalid JSON — default to active
    }

    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.updateVisitorLastSeen(
      conversationId,
      project.id,
      presence,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    if (deliveredUpTo) {
      await chatService.markDelivery({
        projectId: project.id,
        conversationId,
        upToMessageId: deliveredUpTo,
        kind: "delivered",
      });
    }
    if (readUpTo) {
      await chatService.markDelivery({
        projectId: project.id,
        conversationId,
        upToMessageId: readUpTo,
        kind: "read",
      });
    }

    return c.json({ ok: true, status: conversation.status });
  })

  // ─── Widget Image Upload ──────────────────────────────────────────────────────
  .post("/api/widget/:projectSlug/upload", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`upload:${ip}`, 10, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const formData = await c.req.parseBody();
    const file = formData["file"];
    if (!file || typeof file === "string") {
      return c.json({ error: "No file provided" }, 400);
    }

    const fileObj = file as File;

    // Only allow images
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(fileObj.type)) {
      return c.json(
        { error: "Only JPEG, PNG, and WebP images are allowed" },
        400,
      );
    }

    // Max 5MB
    if (fileObj.size > 5 * 1024 * 1024) {
      return c.json({ error: "Image too large (max 5MB)" }, 400);
    }

    const rawExt = fileObj.name.split(".").pop() ?? "";
    const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const requestedConversationId = formData["conversationId"];
    const requestedVisitorId = formData["visitorId"];
    let uploadKey: string;
    let customMetadata: Record<string, string>;
    if (
      typeof requestedConversationId === "string" &&
      requestedConversationId
    ) {
      if (
        typeof requestedVisitorId !== "string" ||
        !requestedVisitorId
      ) {
        return c.json({ error: "Visitor identity is required" }, 400);
      }
      const chatService = createPublicConversationStore({ db, env: c.env });
      const conversation = await chatService.getOperationalConversationById(
        requestedConversationId,
        project.id,
      );
      if (!conversation || conversation.visitorId !== requestedVisitorId) {
        return c.json({ error: "Conversation not found" }, 404);
      }
      uploadKey = `${project.id}/conversation-attachments/${conversation.id}/${crypto.randomUUID()}.${ext}`;
      customMetadata = {
        ownerType: "conversation",
        ownerId: conversation.id,
        projectId: project.id,
      };
    } else {
      // Backward compatibility for older widget bundles. These uploads remain
      // in the widget-only namespace and are reference-checked before purge.
      uploadKey = `${project.id}/chat-images/${crypto.randomUUID()}.${ext}`;
      customMetadata = { ownerType: "project", ownerId: project.id };
    }
    const buffer = await fileObj.arrayBuffer();

    await c.env.UPLOADS.put(uploadKey, buffer, {
      httpMetadata: { contentType: fileObj.type },
      customMetadata,
    });

    return c.json({ url: `/api/uploads/${uploadKey}` }, 201);
  })

  .post("/api/widget/:projectSlug/conversations/:id/email", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`email:${ip}`, 10, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const conversationId = c.req.param("id");
    const db = drizzle(c.env.DB);

    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json();
    const parsed = validate(updateVisitorEmailSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.getOperationalConversationById(
      conversationId,
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    await chatService.updateConversationEmail(
      conversationId,
      project.id,
      parsed.data.email,
    );

    return c.json({ ok: true });
  })

  // ─── Update Conversation (public - for widget identity/metadata sync) ─────
  .patch("/api/widget/:projectSlug/conversations/:id", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`updconv:${ip}`, 20, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const conversationId = c.req.param("id");
    const db = drizzle(c.env.DB);

    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json();
    const parsed = validate(updateConversationPublicSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.getOperationalConversationById(
      conversationId,
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    const updated = await chatService.updateConversation(
      conversationId,
      project.id,
      {
        visitorName: parsed.data.visitorName,
        visitorEmail: parsed.data.visitorEmail,
        metadata: parsed.data.metadata
          ? JSON.stringify(parsed.data.metadata)
          : undefined,
      },
    );

    return c.json(updated);
  })

  // ─── Contact Form Submit (public) ────────────────────────────────────────
  // Mounted on both /inquiries (legacy back-compat for installed widgets) and
  // /tickets (new canonical path). Same handler. Submissions no longer create
  // ticket rows — they post a visitor message and put the conversation into
  // Needs You, same as any other escalation.
  .on(
    "POST",
    [
      "/api/widget/:projectSlug/inquiries",
      "/api/widget/:projectSlug/tickets",
    ],
    async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`cform:${ip}`, 5, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const db = drizzle(c.env.DB);

    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json();
    const parsed = validate(submitContactFormSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const contactFormService = new ContactFormService(db);
    const chatService = createPublicConversationStore({ db, env: c.env });

    // Verify contact form is enabled
    const formConfig = await contactFormService.getConfig(project.id);
    if (!formConfig?.enabled) {
      return c.json({ error: "Contact form is not enabled" }, 400);
    }

    const visitorId = parsed.data.visitorId ?? crypto.randomUUID();
    const customerIdentityService = new CustomerIdentityService(
      db,
      createPublicConversationStore({ db, env: c.env }),
    );
    const linkedCustomer = await customerIdentityService.findCustomerByVisitorId(
      project.id,
      visitorId,
    );
    const visitorEmail =
      parsed.data.visitorEmail ??
      extractFormEmail(parsed.data.data) ??
      linkedCustomer?.email ??
      null;
    const visitorName =
      parsed.data.visitorName ??
      extractFormName(parsed.data.data) ??
      linkedCustomer?.name ??
      null;

    const ban = await new VisitorBanService(db).isVisitorBanned(
      project.id,
      visitorId,
      visitorEmail,
    );
    if (ban) {
      return c.json({ banned: true, reason: ban.reason }, 403);
    }

    let conversation = await chatService.getActiveConversationByVisitor(
      project.id,
      visitorId,
    );
    const created = !conversation;

    if (conversation) {
      const updatedConversation = await chatService.updateConversation(
        conversation.id,
        project.id,
        {
          visitorName: visitorName ?? undefined,
          visitorEmail: visitorEmail ?? undefined,
        },
      );
      conversation = updatedConversation ?? conversation;
    } else {
      const cf = c.req.raw.cf as CfProperties | undefined;
      // Stored metadata.source value kept as historical "inquiry" string —
      // existing rows already have this value and there's no value-add in migrating.
      const metadata: Record<string, string> = {
        source: "inquiry",
      };
      if (cf?.country) metadata.country = String(cf.country);
      if (cf?.city) metadata.city = String(cf.city);
      if (cf?.region) metadata.region = String(cf.region);
      if (cf?.timezone) metadata.timezone = String(cf.timezone);
      if (ip !== "unknown") metadata.ip = ip;
      const userAgent = c.req.header("user-agent");
      if (userAgent) metadata.userAgent = userAgent;

      conversation = await chatService.createConversation({
        projectId: project.id,
        customerId: linkedCustomer?.id ?? null,
        visitorId,
        visitorName: visitorName ?? null,
        visitorEmail: visitorEmail ?? null,
        metadata: JSON.stringify(metadata),
      });
    }

    const previousActivityAt = created ? null : conversation.lastActivityAt;
    const formMessage = buildContactFormMessage(
      parsed.data.data,
      visitorName,
      visitorEmail,
    );
    const formVisitorResult = await chatService.addPublicVisitorMessageWithFirstTurn(
      {
        conversationId: conversation.id,
        content: formMessage,
        imageUrl: null,
        sources: null,
      },
      project.id,
    );
    if (!formVisitorResult) {
      return c.json({ error: "Conversation archived" }, 410);
    }
    const formVisitorMessage = formVisitorResult.message;
    const isFirstVisitorTurn = formVisitorResult.isFirstVisitorTurn;
    const isReturningVisitor = !isFirstVisitorTurn &&
      isReturningVisitorGap(previousActivityAt, Date.now());

    const settings = await projectService.getSettings(project.id);
    const statusAfterTeamRequest = await chatService.prepareContactSupportOwnership(
      project.id,
      conversation.id,
    );
    if (!statusAfterTeamRequest) {
      return c.json({ error: "Conversation ownership changed. Try again." }, 409);
    }
    conversation =
      (await chatService.getOperationalConversationById(
        conversation.id,
        project.id,
      )) ??
      conversation;

    const telegramService =
      settings?.telegramBotToken && settings.telegramChatId
        ? new TelegramService(db, c.env.ENCRYPTION_KEY)
        : undefined;
    const slackService =
      settings?.slackBotToken && settings.slackChannelId
        ? new SlackService(db, c.env.ENCRYPTION_KEY)
        : undefined;
    const escalation = await createEscalation({
      chatService,
      projectService,
      agentChannels: listEnabledAgentChannels({
        telegram: telegramService
          ? {
              storedBotToken: settings?.telegramBotToken,
              chatId: settings?.telegramChatId,
              botName: settings?.botName,
              service: telegramService,
            }
          : null,
        slack: slackService
          ? {
              storedBotToken: settings?.slackBotToken,
              channelId: settings?.slackChannelId,
              botName: settings?.botName,
              service: slackService,
            }
          : null,
      }),
      project: { id: project.id, name: project.name, slug: project.slug },
      conversation: {
        id: conversation.id,
        visitorId: conversation.visitorId,
        visitorName: conversation.visitorName,
        visitorEmail: conversation.visitorEmail,
        telegramThreadId: conversation.telegramThreadId,
        channelThreads: conversation.channelThreads,
        status: conversation.status,
        metadata: conversation.metadata,
      },
      summary: formMessage,
      settings,
      env: {
        BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
        RESEND_API_KEY: c.env.RESEND_API_KEY,
      },
      executionCtx: c.executionCtx,
      persistTelegramThreadId(threadId) {
        return chatService.updateTelegramThreadId(
          project.id,
          conversation.id,
          threadId,
        ).then(() => true);
      },
      persistChannelThread(channel, threadId) {
        return chatService.updateChannelThread(
          project.id,
          conversation.id,
          channel,
          threadId,
        ).then(() => true);
      },
    });
    if (escalation.telegramThreadId) {
      await chatService.updateTelegramThreadId(
        project.id,
        conversation.id,
        escalation.telegramThreadId,
      );
    }

    const contactAccepted = buildContactAcceptedPayload({
      conversationId: conversation.id,
      visitorMessageId: formVisitorMessage.id,
      conversationStatus: statusAfterTeamRequest,
      visitorName: conversation.visitorName,
      visitorEmail: conversation.visitorEmail,
      botName: settings?.botName ?? null,
      isFirstVisitorTurn,
      isReturningVisitor,
    });

    // team_requested leaves the AI in assist_until_agent, so Maven answers in
    // the background while the team review is pending. agent_replied means a
    // human already owns the conversation; the AI stays out.
    const billingService = new BillingService(db, c.env);
    const subscription = await billingService.getSubscriptionByUserId(
      project.userId,
    );
    const aiAllowed = statusAfterTeamRequest === "waiting_agent" &&
      Boolean(subscription && billingService.isSubscriptionActive(subscription)) &&
      (await billingService.checkMessageLimit(project.userId, subscription))
        .allowed;
    if (aiAllowed) {
      c.executionCtx.waitUntil(runContactSupportFollowUp({
        db,
        env: c.env,
        executionCtx: c.executionCtx,
        chatService,
        projectService,
        project: {
          id: project.id,
          userId: project.userId,
          name: project.name,
        },
        settings,
        conversation,
        formMessage,
        isFirstVisitorTurn,
        isReturningVisitor,
      }));
    }
    return c.json(
      {
        id: conversation.id,
        created,
        ...(aiAllowed
          ? contactAccepted
          : markContactAiUnavailable(contactAccepted)),
      },
      201,
    );
  })

  // ─── Telegram Webhook ───────────────────────────────────────────────────────
  .post("/api/telegram/webhook/:projectId", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`tg:${ip}`, 60, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const projectId = c.req.param("projectId");
    const db = drizzle(c.env.DB);

    const telegramService = new TelegramService(db, c.env.ENCRYPTION_KEY);
    const tgSettings = await telegramService.getTelegramSettings(projectId);
    if (!tgSettings?.telegramBotToken) {
      return c.json({ error: "Telegram not configured" }, 400);
    }

    // Only Telegram knows the secret it echoes here. Webhooks registered
    // before the secret existed send nothing, so those updates are handled but
    // treated as unverified, and the webhook is re-registered so the next one
    // carries the header.
    const webhookSecret = await deriveTelegramWebhookSecret(
      projectId,
      c.env.ENCRYPTION_KEY,
    );
    const trusted = matchesTelegramWebhookSecret(
      webhookSecret,
      c.req.header("x-telegram-bot-api-secret-token"),
    );
    if (!trusted) {
      logWarn("telegram.webhook_unverified", { projectId });
      c.executionCtx.waitUntil(
        telegramService.setWebhook(
          tgSettings.telegramBotToken,
          `${c.env.BETTER_AUTH_URL}/api/telegram/webhook/${projectId}`,
          webhookSecret,
        ).then(() => undefined).catch((error: unknown) => {
          logError("telegram.webhook_reregister_failed", error, { projectId });
        }),
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await c.req.json()) as { message?: any };
    const message = body.message;

    // First verified update binds the chat the project posts to, which is why
    // the owner never has to hand us a token to poll getUpdates with.
    const binding = resolveTelegramChatBinding({
      storedChatId: tgSettings.telegramChatId,
      trusted,
      chat: message?.chat,
    });
    if (binding.action === "bind") {
      await new ProjectService(db).updateSettings(projectId, {
        telegramChatId: binding.chatId,
      });
      await telegramService.sendMessage(
        tgSettings.telegramBotToken,
        binding.chatId,
        "<b>Connected.</b> Conversations that need a human land here, and replies to them go back to the visitor.",
        message?.message_id,
      ).catch(() => undefined);
      return c.json({ ok: true });
    }
    if (!tgSettings.telegramChatId) {
      return c.json({ ok: true });
    }
    if (!message?.text) {
      return c.json({ ok: true });
    }

    const chatService = createPublicConversationStore({ db, env: c.env });
    const projectService = new ProjectService(db);
    const projectSettings = await projectService.getSettings(projectId);
    const project = await projectService.getProjectById(projectId);
    const botName = projectSettings?.botName;
    const adapter = createTelegramAgentChannel({
      botName,
      storedBotToken: tgSettings.telegramBotToken,
      chatId: tgSettings.telegramChatId,
      service: telegramService,
    });
    await runAgentChannelInbound({
      adapter,
      inbound: {
        channel: "telegram",
        text: message.text,
        actorName: message.from?.first_name ?? null,
        commandId:
          `telegram:${projectId}:${String(message.chat?.id ?? "unknown")}:${String(message.message_id)}`,
        externalMessageId: String(message.message_id),
        replyToExternalId: message.reply_to_message?.message_id === undefined
          ? null
          : String(message.reply_to_message.message_id),
        replyToText: message.reply_to_message?.text ?? null,
      },
      botName,
      getAgentModeConversations: () =>
        chatService.getAgentModeConversations(projectId),
      findByChannelThread: async () => null,
      getOperationalConversation: async (conversationId) => {
        const conversation = await chatService.getOperationalConversationById(
          conversationId,
          projectId,
        );
        return conversation
          ? {
              id: conversation.id,
              visitorId: conversation.visitorId,
              visitorEmail: conversation.visitorEmail,
              metadata: conversation.metadata,
            }
          : null;
      },
      executeCommand: async (fields) =>
        executeChannelBotNameCommand({
          text: fields.text,
          botName,
          actorName: fields.actorName,
          commandId: fields.commandId,
          now: Date.now(),
          projectId,
          conversation: fields.conversation,
          chatService,
          db,
          env: c.env,
          projectSettings,
          projectName: project?.name ?? "Support",
          actorUserId: project?.userId ?? "",
          origin: "telegram",
        }),
      appendHuman: async (fields) =>
        chatService.appendHuman({
          projectId,
          conversationId: fields.conversationId,
          content: fields.content,
          senderName: fields.senderName,
          idempotencyKey: fields.idempotencyKey,
          origin: "telegram",
          externalReplyTo: fields.externalReplyTo,
        }).catch((error: unknown) => {
          logError("telegram.reply_append_failed", error, {
            projectId,
            conversationId: fields.conversationId,
          });
          return null;
        }),
    });

    return c.json({ ok: true });
  })

  .post("/api/slack/events/:projectId", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`slack:${ip}`, 60, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const projectId = c.req.param("projectId");
    const db = drizzle(c.env.DB);
    const slackService = new SlackService(db, c.env.ENCRYPTION_KEY);
    const slackSettings = await slackService.getSlackSettings(projectId);
    if (!slackSettings?.slackBotToken || !slackSettings.slackSigningSecret) {
      return c.json({ error: "Slack not configured" }, 400);
    }

    const rawBody = await c.req.text();
    const signingSecret = await resolveSlackSecret(
      slackSettings.slackSigningSecret,
      c.env.ENCRYPTION_KEY,
    );
    if (!signingSecret) {
      return c.json({ error: "Slack not configured" }, 400);
    }
    const trusted = await matchesSlackRequestSignature({
      signingSecret,
      timestamp: c.req.header("x-slack-request-timestamp"),
      signature: c.req.header("x-slack-signature"),
      rawBody,
    });
    if (!trusted) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch {
      return c.json({ error: "Invalid payload" }, 400);
    }

    const challenge = readSlackUrlVerification(payload);
    if (challenge !== null) {
      return c.json({ challenge });
    }

    const inbound = readSlackMessageInbound(payload, projectId);
    if (!inbound) {
      return c.json({ ok: true });
    }

    const binding = resolveSlackChannelBinding({
      storedChannelId: slackSettings.slackChannelId,
      trusted: true,
      channelId: inbound.channelId,
    });
    if (binding.action === "bind") {
      await new ProjectService(db).updateSettings(projectId, {
        slackChannelId: binding.channelId,
      });
      await slackService.postMessage(slackSettings.slackBotToken, {
        channelId: binding.channelId,
        text:
          "*Connected.* Conversations that need a human land here, and replies to them go back to the visitor.",
        threadTs: inbound.inbound.externalMessageId,
      }).catch(() => undefined);
      return c.json({ ok: true });
    }
    if (!slackSettings.slackChannelId) {
      return c.json({ ok: true });
    }

    const chatService = createPublicConversationStore({ db, env: c.env });
    const projectService = new ProjectService(db);
    const projectSettings = await projectService.getSettings(projectId);
    const project = await projectService.getProjectById(projectId);
    const botName = projectSettings?.botName;
    const adapter = createSlackAgentChannel({
      botName,
      storedBotToken: slackSettings.slackBotToken,
      channelId: slackSettings.slackChannelId,
      service: slackService,
    });
    const parent = await getAgentByName(
      c.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    await runAgentChannelInbound({
      adapter,
      inbound: inbound.inbound,
      botName,
      getAgentModeConversations: () =>
        chatService.getAgentModeConversations(projectId),
      findByChannelThread: async (threadId) => {
        const found = await parent.findConversationByChannelThread(
          "slack",
          threadId,
        ) as { conversationId?: string } | null;
        return found?.conversationId ?? null;
      },
      getOperationalConversation: async (conversationId) => {
        const conversation = await chatService.getOperationalConversationById(
          conversationId,
          projectId,
        );
        return conversation
          ? {
              id: conversation.id,
              visitorId: conversation.visitorId,
              visitorEmail: conversation.visitorEmail,
              metadata: conversation.metadata,
            }
          : null;
      },
      executeCommand: async (fields) =>
        executeChannelBotNameCommand({
          text: fields.text,
          botName,
          actorName: fields.actorName,
          commandId: fields.commandId,
          now: Date.now(),
          projectId,
          conversation: fields.conversation,
          chatService,
          db,
          env: c.env,
          projectSettings,
          projectName: project?.name ?? "Support",
          actorUserId: project?.userId ?? "",
          origin: "slack",
        }),
      appendHuman: async (fields) =>
        chatService.appendHuman({
          projectId,
          conversationId: fields.conversationId,
          content: fields.content,
          senderName: fields.senderName,
          idempotencyKey: fields.idempotencyKey,
          origin: "slack",
          externalReplyTo: fields.externalReplyTo,
        }).catch((error: unknown) => {
          logError("slack.reply_append_failed", error, {
            projectId,
            conversationId: fields.conversationId,
          });
          return null;
        }),
    });

    return c.json({ ok: true });
  })

  // ─── Widget Embed JS (redirect to R2 custom domain) ────────────────────────
  .get("/api/widget-embed.js", (c) => {
    return c.redirect("https://widget.replymaven.com/widget-embed.js", 301);
  })

  // Apex embeds resolve the runtime from scriptOrigin, which is this host.
  // Local dev serves the freshly built asset from public/ instead of the R2
  // CDN copy so widget changes are testable before a widget deploy.
  .get("/widget-agent-runtime.js", (c) => {
    const hostname = new URL(c.req.url).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return c.env.ASSETS.fetch(c.req.raw);
    }
    return c.redirect(
      "https://widget.replymaven.com/widget-agent-runtime.js",
      301,
    );
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC HELP CENTER (HTML, no auth)
  // ═══════════════════════════════════════════════════════════════════════════
  .get("/help/:projectSlug/sitemap.xml", async (c) => {
    const started = await beginPublicHelpRequest(c);
    if (!started.ok) return started.response;

    const xml = renderSitemap({
      project: started.page.project,
      categories: started.page.categories,
      articles: started.page.publishedArticles,
      helpCustomUrl: started.page.helpCustomUrl,
    });
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        ...helpSitemapCacheHeaders(started.page.project.id),
      },
    });
  })
  .get("/help/:projectSlug/robots.txt", async (c) => {
    const started = await beginPublicHelpRequest(c);
    if (!started.ok) return started.response;

    const body = renderRobots({
      projectSlug: started.page.project.slug,
      helpCustomUrl: started.page.helpCustomUrl,
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...helpSitemapCacheHeaders(started.page.project.id),
      },
    });
  })
  .get("/help/:projectSlug/:categorySlug/:articleSlug", async (c) => {
    const started = await beginPublicHelpRequest(c);
    if (!started.ok) return started.response;
    const { page } = started;
    const categorySlug = c.req.param("categorySlug");
    const rawArticleSlug = c.req.param("articleSlug");
    // "<article>.md" serves the raw markdown (slugs themselves never
    // contain dots), used by the Copy page button and LLM deep links.
    const wantsMarkdown = rawArticleSlug.endsWith(".md");
    const articleSlug = wantsMarkdown
      ? rawArticleSlug.slice(0, -3)
      : rawArticleSlug;
    const category = page.categories.find((item) => item.slug === categorySlug);
    const navArticle = category
      ? (page.articlesByCategory.get(category.id) ?? []).find(
          (item) => item.slug === articleSlug,
        )
      : undefined;
    if (!category || !navArticle) {
      return c.text(
        "Not found",
        404,
        helpNotFoundCacheHeaders(page.project.id),
      );
    }
    const article = await page.helpService.getArticleById(
      navArticle.id,
      page.project.id,
    );
    if (!article || article.status !== "published") {
      return c.text(
        "Not found",
        404,
        helpNotFoundCacheHeaders(page.project.id),
      );
    }

    if (wantsMarkdown) {
      const markdown = ensureArticleTitle(
        article.content ?? "",
        article.title,
      );
      return c.body(markdown, 200, {
        "Content-Type": "text/markdown; charset=utf-8",
        ...helpHtmlHeaders(page.project.id, { noindex: started.noindex }),
      });
    }

    const siblings = page.articlesByCategory.get(category.id) ?? [];
    const currentIndex = siblings.findIndex((a) => a.id === article.id);
    const prevArticle = currentIndex > 0 ? siblings[currentIndex - 1] : null;
    const nextArticle =
      currentIndex >= 0 && currentIndex < siblings.length - 1
        ? siblings[currentIndex + 1]
        : null;

    const { html: bodyHtml, toc } = await renderMarkdown(
      ensureArticleTitle(article.content ?? "", article.title),
      {
        projectSlug: page.project.slug,
        customUrl: page.helpCustomUrl,
      },
    );

    const html = renderHelpArticle({
      project: page.project,
      category,
      categories: page.categories,
      articlesByCategory: page.articlesByCategory,
      article,
      bodyHtml,
      toc,
      prevArticle,
      nextArticle,
      widgetConfig: page.widgetConfig,
      helpCustomUrl: page.helpCustomUrl,
      topNav: page.topNav,
      customCss: page.customCss,
      analytics: page.analytics,
      themeDefault: page.themeDefault,
      noindex: started.noindex,
    });
    return c.html(
      `<!doctype html>${html.toString()}`,
      200,
      helpHtmlHeaders(page.project.id, { noindex: started.noindex }),
    );
  })
  .get("/help/:projectSlug/search", async (c) => {
    const started = await beginPublicHelpRequest(c);
    if (!started.ok) return started.response;
    const { page } = started;
    const query = (c.req.query("q") ?? "").trim().slice(0, 200);

    const results =
      query.length > 0
        ? matchHelpArticlesFromQuery(
            query,
            page.publishedArticles,
            page.categories,
          )
        : [];

    const html = renderHelpSearch({
      project: page.project,
      query,
      results,
      categories: page.categories,
      articlesByCategory: page.articlesByCategory,
      widgetConfig: page.widgetConfig,
      helpCustomUrl: page.helpCustomUrl,
      topNav: page.topNav,
      customCss: page.customCss,
      analytics: page.analytics,
      themeDefault: page.themeDefault,
      noindex: started.noindex,
    });
    return c.html(
      `<!doctype html>${html.toString()}`,
      200,
      helpSearchHeaders({ noindex: started.noindex }),
    );
  })
  .get("/help/:projectSlug/:categorySlug", async (c) => {
    const started = await beginPublicHelpRequest(c);
    if (!started.ok) return started.response;
    const { page } = started;
    const categorySlug = c.req.param("categorySlug");
    const category = page.categories.find((item) => item.slug === categorySlug);
    if (!category) {
      return c.text(
        "Not found",
        404,
        helpNotFoundCacheHeaders(page.project.id),
      );
    }

    const html = renderHelpCategory({
      project: page.project,
      category,
      categories: page.categories,
      articles: page.articlesByCategory.get(category.id) ?? [],
      articlesByCategory: page.articlesByCategory,
      widgetConfig: page.widgetConfig,
      helpCustomUrl: page.helpCustomUrl,
      topNav: page.topNav,
      customCss: page.customCss,
      analytics: page.analytics,
      themeDefault: page.themeDefault,
      noindex: started.noindex,
    });
    return c.html(
      `<!doctype html>${html.toString()}`,
      200,
      helpHtmlHeaders(page.project.id, { noindex: started.noindex }),
    );
  })
  .get("/help/:projectSlug", async (c) => {
    const started = await beginPublicHelpRequest(c);
    if (!started.ok) return started.response;
    const { page } = started;

    const enriched = page.categories.map((cat) => ({
      ...cat,
      articleCount: page.articlesByCategory.get(cat.id)?.length ?? 0,
    }));

    const categoryById = new Map(
      page.categories.map((cat) => [cat.id, cat]),
    );
    const publishedArticles = page.publishedArticles.flatMap((article) => {
      const category = categoryById.get(article.categoryId);
      if (!category) return [];
      return [{ article, category }];
    });

    const homeUrl = buildHelpUrl({
      projectSlug: page.project.slug,
      customUrl: page.helpCustomUrl,
    });
    const source =
      page.settings?.helpHomeMarkdown?.trim() ||
      defaultHelpHomeMarkdown(page.project.name);
    const rendered = await renderMarkdown(source, {
      projectSlug: page.project.slug,
      customUrl: page.helpCustomUrl,
    });
    const bodyHtml = expandHelpHomeBlocks(rendered.html, {
      projectSlug: page.project.slug,
      customUrl: page.helpCustomUrl,
      searchAction: `${homeUrl}/search`,
      categories: enriched,
      publishedArticles,
    });

    const html = renderHelpIndex({
      project: page.project,
      categories: enriched,
      articlesByCategory: page.articlesByCategory,
      widgetConfig: page.widgetConfig,
      helpCustomUrl: page.helpCustomUrl,
      topNav: page.topNav,
      customCss: page.customCss,
      analytics: page.analytics,
      themeDefault: page.themeDefault,
      homeBackgroundUrl: page.settings?.helpHomeBackgroundUrl ?? null,
      homeBackgroundPosition: page.settings?.helpHomeBackgroundPosition ?? null,
      homeBackgroundFit: page.settings?.helpHomeBackgroundFit ?? null,
      bodyHtml,
      noindex: started.noindex,
    });
    return c.html(
      `<!doctype html>${html.toString()}`,
      200,
      helpHtmlHeaders(page.project.id, { noindex: started.noindex }),
    );
  })

  // ─── Own docs (/docs) ────────────────────────────────────────────────────
  // replymaven.com/docs is the "replymaven" project's help center, served by
  // re-dispatching to the canonical /help routes above. resolveHelpCustomUrl
  // maps our project to https://replymaven.com/docs in code (tenant settings
  // may not point at our domain), so every rendered link, canonical tag, and
  // sitemap entry stays on /docs.
  .get("/docs", serveOwnDocs)
  .get("/docs/*", serveOwnDocs)

  // ═══════════════════════════════════════════════════════════════════════════
  // INBOUND EMAIL WEBHOOK (public, no auth — Resend sends email.received events)
  // ═══════════════════════════════════════════════════════════════════════════
  .post("/api/webhooks/inbound-mail", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`inbound-mail:${ip}`, 30, 60_000)) {
      return c.json({ ok: true });
    }

    const svixId = c.req.header("svix-id");
    const svixTimestamp = c.req.header("svix-timestamp");
    const svixSignature = c.req.header("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      return c.json({ error: "Missing webhook signature headers" }, 400);
    }

    const rawBody = await c.req.text();

    const secret = c.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[InboundEmail] RESEND_WEBHOOK_SECRET not configured");
      return c.json({ ok: true });
    }

    const secretBytes = Uint8Array.from(
      atob(secret.startsWith("whsec_") ? secret.slice(6) : secret),
      (ch) => ch.charCodeAt(0),
    );
    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      new TextEncoder().encode(signedContent),
    );
    const expectedSignature = btoa(
      String.fromCharCode(...new Uint8Array(signatureBytes)),
    );

    const signatures = svixSignature.split(" ");
    const verified = signatures.some((sig) => {
      if (!sig.includes(",")) return false;
      const [version, sigValue] = sig.split(",");
      if (version !== "v1" || !sigValue) return false;
      if (sigValue.length !== expectedSignature.length) return false;
      let mismatch = 0;
      for (let i = 0; i < sigValue.length; i++) {
        mismatch |= sigValue.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
      }
      return mismatch === 0;
    });
    if (!verified) {
      console.error("[InboundEmail] Webhook signature verification failed");
      return c.json({ error: "Invalid signature" }, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (payload.type !== "email.received") {
      return c.json({ ok: true });
    }

    const emailId = payload.data?.email_id;
    const fromAddress = payload.data?.from;
    const toAddresses: string[] = payload.data?.to ?? [];

    if (!emailId || !fromAddress || toAddresses.length === 0) {
      console.error("[InboundEmail] Missing required fields in payload");
      return c.json({ ok: true });
    }

    // KV idempotency: skip duplicate webhook deliveries we've already finished
    // processing. Set AFTER the work completes (see end of handler) so that
    // failed runs are still retried by Resend rather than silently dropped.
    const idempotencyKey = `inbound-email:${emailId}`;
    const seen = await c.env.CONVERSATIONS_CACHE.get(idempotencyKey);
    if (seen) {
      return c.json({ ok: true });
    }

    // Extract project slug from to address ({slug}@updates.replymaven.com).
    // Slugs are stored lowercase, so normalize the local part up front.
    let projectSlug: string | null = null;
    for (const addr of toAddresses) {
      const match = addr.match(/^([^@]+)@updates\.replymaven\.com$/i);
      if (match) {
        projectSlug = match[1].toLowerCase();
        break;
      }
    }

    if (!projectSlug || RESERVED_INBOUND_LOCAL_PARTS.has(projectSlug)) {
      return c.json({ ok: true });
    }

    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(projectSlug);
    if (!project) {
      console.error(`[InboundEmail] Project not found for slug: ${projectSlug}`);
      return c.json({ ok: true });
    }

    // Fetch full email content + headers from Resend API
    let emailText = "";
    let inReplyToHeader: string | null = null;
    let referencesHeader: string | null = null;
    let autoSubmittedHeader: string | null = null;
    let precedenceHeader: string | null = null;
    let returnPathHeader: string | null = null;
    try {
      const emailRes = await fetch(
        `https://api.resend.com/emails/receiving/${emailId}`,
        {
          headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (emailRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const emailData = (await emailRes.json()) as any;
        emailText = (emailData.text ?? "").trim();
        if (!emailText && emailData.html) {
          emailText = emailData.html
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .trim();
        }

        // Defensively normalize the headers payload — Resend may surface it
        // as a top-level field, an object map, or an array of {name, value}.
        const headerLookup: Record<string, string> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const headersField = emailData.headers as any;
        if (
          headersField &&
          typeof headersField === "object" &&
          !Array.isArray(headersField)
        ) {
          for (const [k, v] of Object.entries(headersField)) {
            headerLookup[k.toLowerCase()] = String(v ?? "");
          }
        } else if (Array.isArray(headersField)) {
          for (const h of headersField) {
            const name = String(h?.name ?? "").toLowerCase();
            if (name) headerLookup[name] = String(h?.value ?? "");
          }
        }
        const readHeader = (name: string): string | null =>
          headerLookup[name.toLowerCase()] ?? null;

        // `in_reply_to` and `references` are not surfaced as top-level fields
        // by Resend — they live in the `headers` object only.
        inReplyToHeader = readHeader("in-reply-to");
        referencesHeader = readHeader("references");
        autoSubmittedHeader = readHeader("auto-submitted");
        precedenceHeader = readHeader("precedence");
        returnPathHeader = readHeader("return-path");
      } else {
        // 401 here means RESEND_API_KEY cannot read inbound mail (a
        // sending-only key), which drops every reply. Answer 5xx so Resend
        // retries and the failure is visible in its webhook dashboard instead
        // of looking delivered.
        logError(
          "inbound_email.fetch_failed",
          new Error(`Resend returned ${emailRes.status}`),
          {
            emailId,
            status: emailRes.status,
            projectSlug,
            restrictedKey: emailRes.status === 401,
          },
        );
        return c.json({ error: "Could not read the inbound email" }, 502);
      }
    } catch (err) {
      logError("inbound_email.fetch_failed", err, { emailId, projectSlug });
      return c.json({ error: "Could not read the inbound email" }, 502);
    }

    // Drop auto-responders to prevent feedback loops between the two sides.
    // Conformant senders set `Auto-Submitted: auto-replied|auto-generated`,
    // `Precedence: bulk|list|junk`, or use an empty `Return-Path: <>` (DSN).
    const isAutoSubmitted = (() => {
      const auto = autoSubmittedHeader?.trim().toLowerCase();
      if (auto && auto !== "no") return true;
      const prec = precedenceHeader?.trim().toLowerCase();
      if (prec === "bulk" || prec === "list" || prec === "junk") return true;
      const rp = returnPathHeader?.trim();
      if (rp === "<>") return true;
      return false;
    })();
    if (isAutoSubmitted) {
      console.log(
        `[InboundEmail] Dropping auto-submitted email ${emailId} (auto=${autoSubmittedHeader}, prec=${precedenceHeader}, rp=${returnPathHeader})`,
      );
      await c.env.CONVERSATIONS_CACHE.put(idempotencyKey, "1", {
        expirationTtl: 60 * 60 * 24,
      });
      return c.json({ ok: true });
    }

    if (!emailText) {
      return c.json({ ok: true });
    }

    // Strip quoted reply content (lines starting with ">", "On ... wrote:", etc.)
    const lines = emailText.split("\n");
    const cleanLines: string[] = [];
    for (const line of lines) {
      if (/^On .+ wrote:$/i.test(line.trim())) break;
      if (/^-{2,}\s*Original Message/i.test(line.trim())) break;
      if (/^_{2,}/.test(line.trim())) break;
      if (line.trim().startsWith(">")) continue;
      cleanLines.push(line);
    }
    const cleanedText = cleanLines.join("\n").trim();
    if (!cleanedText) {
      return c.json({ ok: true });
    }

    // Resend formats `from` as a string. Per their docs it is typically
    // `"Display Name <user@example.com>"`, but bare `"user@example.com"` also
    // appears in the wild. Extract the angle-bracketed address when present.
    let rawFrom: string;
    if (typeof fromAddress === "string") {
      rawFrom = fromAddress;
    } else if (typeof fromAddress === "object" && fromAddress?.address) {
      rawFrom = fromAddress.address;
    } else {
      console.error("[InboundEmail] Unexpected from address format:", fromAddress);
      return c.json({ ok: true });
    }
    const angleMatch = rawFrom.match(/<([^>]+)>/);
    const senderEmail = (angleMatch ? angleMatch[1] : rawFrom).trim().toLowerCase();
    if (!senderEmail) {
      console.error("[InboundEmail] Could not extract email from from-field:", rawFrom);
      return c.json({ ok: true });
    }

    // ─── Locate the conversation ─────────────────────────────────────────
    // Prefer In-Reply-To (single id), fall back to References (last id is the
    // most recent ancestor). If neither matches, fall back to a sender-email
    // lookup so visitor-initiated email replies still work without our headers.
    const chatService = createPublicConversationStore({ db, env: c.env });
    const referencedMessageId =
      parseEmailMessageId(inReplyToHeader) ??
      parseEmailMessageId(referencesHeader, { source: "references" });
    let conversation = null as Awaited<
      ReturnType<typeof chatService.getRecentConversationByVisitorEmail>
    > | null;
    let referencedAgentUserId: string | null = null;
    if (referencedMessageId) {
      const sourceMessage = await chatService.getPublicMessageById(
        referencedMessageId,
        project.id,
      );
      if (sourceMessage) {
        const conv = await chatService.getConversationById(
          sourceMessage.conversationId,
          project.id,
        );
        if (conv?.archivedAt) return c.json({ ok: true });
        if (conv) {
          conversation = conv;
          referencedAgentUserId = sourceMessage.userId ?? null;
        }
      }
    }
    // Every reply quotes the conversation link we sent, which is the only
    // routing signal that survives: Resend replaces our `Message-ID`, so the
    // `In-Reply-To` above references the sending provider's id, never ours.
    if (!conversation) {
      const referencedConversationId = parseConversationReference(emailText);
      if (referencedConversationId) {
        const conv = await chatService.getConversationById(
          referencedConversationId,
          project.id,
        );
        if (conv?.archivedAt) return c.json({ ok: true });
        if (conv) conversation = conv;
      }
    }
    // Last resort, and visitors only: a team member replying from their own
    // inbox is never the visitor on any conversation.
    if (!conversation) {
      conversation = await chatService.getRecentConversationByVisitorEmail(
        project.id,
        senderEmail,
      );
    }
    if (!conversation) {
      logWarn("inbound_email.unroutable", {
        emailId,
        projectId: project.id,
        hasReferencedMessageId: referencedMessageId !== null,
      });
      return c.json({ ok: true });
    }

    // Per-conversation duplicate-content guard (defends against retries that
    // bypass the KV check, e.g. a different email_id with identical content).
    const existingMessages = await chatService.getPublicMessagesSince(
      conversation.id,
      Date.now() - 5 * 60 * 1000,
      project.id,
    );
    const alreadyProcessed = existingMessages.some(
      (m) => m.content === cleanedText,
    );
    if (alreadyProcessed) {
      return c.json({ ok: true });
    }

    // ─── Determine inbound role: visitor vs. agent ───────────────────────
    const visitorEmail = conversation.visitorEmail?.toLowerCase() ?? null;
    const isVisitor = visitorEmail !== null && visitorEmail === senderEmail;

    let agentUser: {
      id: string;
      name: string;
      email: string;
      avatar: string | null;
    } | null = null;
    if (!isVisitor) {
      // Trust Resend's MX-level filtering for SPF/DKIM/DMARC enforcement —
      // their API doesn't surface auth verdicts to webhook consumers, so we
      // rely on them to reject hard-fail mail before forwarding. We still
      // require the sender's email to match a stored user account that has
      // explicit access to this project (owner or accepted team member).
      const userRows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          profilePicture: users.profilePicture,
          image: users.image,
        })
        .from(users)
        .where(eq(users.email, senderEmail))
        .limit(1);
      const candidate = userRows[0];
      if (candidate) {
        const isOwner = candidate.id === project.userId;
        let hasAccess = isOwner;
        if (!isOwner) {
          // Sender access is about this specific project's owner, independent of
          // whichever team the sender currently has active.
          const teamService = new TeamService(db);
          const membership = await teamService.getMembershipForOwner(
            candidate.id,
            project.userId,
          );
          hasAccess = membership !== null;
        }
        if (hasAccess) {
          agentUser = {
            id: candidate.id,
            name: candidate.name,
            email: candidate.email,
            avatar: candidate.profilePicture ?? candidate.image ?? null,
          };
        }
      }
    }

    if (!isVisitor && !agentUser) {
      console.error(
        `[InboundEmail] Sender ${senderEmail} is neither the visitor nor a project member`,
      );
      return c.json({ ok: true });
    }

    if (conversation.status === "closed") {
      await chatService.reopenConversation(conversation.id, project.id);
    }

    const widgetService = new WidgetService(db);
    const widgetCfgForReply = await widgetService.getWidgetConfig(project.id);

    if (isVisitor) {
      // ─── Visitor reply branch ─────────────────────────────────────────
      const inboundEmailMessage = await chatService.addPublicMessage(
        {
          conversationId: conversation.id,
          role: "visitor",
          content: cleanedText,
          sources: null,
          idempotencyKey: `email:${emailId}`,
          origin: "email",
          externalReplyTo: referencedMessageId,
        },
        project.id,
      );
      if (!inboundEmailMessage) return c.json({ ok: true });
      c.executionCtx.waitUntil(
        touchLinkedCustomerAfterVisitorMessage({
          projectId: project.id,
          customerId: conversation.customerId,
          visitorId: conversation.visitorId,
          occurredAt: new Date(inboundEmailMessage.createdAt),
          identityService: new CustomerIdentityService(
            db,
            createPublicConversationStore({ db, env: c.env }),
          ),
          logFailure(error) {
            logError("inbound_email.customer_last_seen_failed", error, {
              projectId: project.id,
              conversationId: conversation.id,
              customerId: conversation.customerId,
            });
          },
          onTouched(customerId) {
            broadcastCustomerChanges(c, project.id, [customerId]);
          },
        }),
      );
      const stillOperational = await chatService.getOperationalConversationById(
        conversation.id,
        project.id,
      );
      if (!stillOperational) return c.json({ ok: true });

      if (
        conversation.status === "waiting_agent" ||
        conversation.status === "agent_replied"
      ) {
        try {
          const telegramService = new TelegramService(db, c.env.ENCRYPTION_KEY);
          const slackService = new SlackService(db, c.env.ENCRYPTION_KEY);
          const [tgSettings, slackSettings] = await Promise.all([
            telegramService.getTelegramSettings(project.id),
            slackService.getSlackSettings(project.id),
          ]);
          const channels = listEnabledAgentChannels({
            telegram: tgSettings?.telegramBotToken && tgSettings.telegramChatId
              ? {
                  storedBotToken: tgSettings.telegramBotToken,
                  chatId: tgSettings.telegramChatId,
                  service: telegramService,
                }
              : null,
            slack: slackSettings?.slackBotToken && slackSettings.slackChannelId
              ? {
                  storedBotToken: slackSettings.slackBotToken,
                  channelId: slackSettings.slackChannelId,
                  service: slackService,
                }
              : null,
          });
          if (channels.length > 0) {
            await runWithConversationExternalAction(
              chatService,
              project.id,
              conversation.id,
              () => forwardVisitorThroughAgentChannels({
                channels,
                conversationId: conversation.id,
                visitorName: conversation.visitorName ?? senderEmail,
                content: `[via email] ${cleanedText}`,
                channelThreads: conversation.channelThreads,
                telegramThreadId: conversation.telegramThreadId,
              }),
            );
          }
        } catch (err) {
          console.error("[InboundEmail] Telegram forward failed:", err);
        }
      }

      // Notify the agent who originated the email thread, if any.
      let recipientUserId = referencedAgentUserId;
      if (!recipientUserId) {
        const fallback =
          await chatService.getLatestEmailedPublicAgentMessage(
            conversation.id,
            project.id,
          );
        recipientUserId = fallback?.userId ?? null;
      }
      if (recipientUserId && c.env.RESEND_API_KEY) {
        const agentRows = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, recipientUserId))
          .limit(1);
        const agentEmail = agentRows[0]?.email;
        if (agentEmail) {
          const emailService = new EmailService(c.env.RESEND_API_KEY);
          const visitorDisplayName =
            conversation.visitorName?.trim() ||
            conversation.visitorEmail?.trim() ||
            "Visitor";
          const dashboardUrl = `${c.env.BETTER_AUTH_URL}/app/projects/${project.id}/conversations/${conversation.id}`;
          c.executionCtx.waitUntil(
            runWithConversationExternalAction(
                chatService,
                project.id,
                conversation.id,
                () => emailService.sendVisitorReplyToAgentEmail({
                  to: agentEmail,
                  projectSlug: project.slug,
                  projectName: project.name,
                  conversationId: conversation.id,
                  messageId: inboundEmailMessage.id,
                  inReplyToMessageId:
                    referencedMessageId ?? inboundEmailMessage.id,
                  visitorDisplayName,
                  messageContent: cleanedText,
                  dashboardUrl,
                  accentColor: widgetCfgForReply?.primaryColor ?? null,
                }),
              )
              .catch((err: unknown) => {
                console.error(
                  "[InboundEmail] Visitor-reply notification failed:",
                  err,
                );
              }),
          );
        }
      }
    } else if (agentUser) {
      // ─── Agent reply branch (round-trip from agent's inbox) ───────────
      const agentMessage = await chatService.appendHuman({
        projectId: project.id,
        conversationId: conversation.id,
        content: cleanedText,
        userId: agentUser.id,
        senderName: agentUser.name,
        senderAvatar: agentUser.avatar,
        idempotencyKey: `email:${emailId}`,
        origin: "email",
        externalReplyTo: referencedMessageId,
      }).catch(() => null);
      if (!agentMessage) {
        return new Response("Conversation not found", { status: 404 });
      }
      await chatService.markPublicMessageAsEmailed(
        conversation.id,
        agentMessage.id,
        project.id,
      );

      // Send the visitor an email with the agent's reply so the round-trip
      // continues over email. Skip if the conversation has no visitorEmail —
      // the message still lands in the dashboard.
      if (conversation.visitorEmail && c.env.RESEND_API_KEY) {
        const emailService = new EmailService(c.env.RESEND_API_KEY);
        const visitorEmail = conversation.visitorEmail;
        const dashboardUrl = `${c.env.BETTER_AUTH_URL}/app/projects/${project.id}/conversations/${conversation.id}`;
        c.executionCtx.waitUntil(
          runWithConversationExternalAction(
              chatService,
              project.id,
              conversation.id,
              () => emailService.sendAgentMessageEmail({
                to: visitorEmail,
                projectSlug: project.slug,
                projectName: project.name,
                conversationId: conversation.id,
                messageId: agentMessage.id,
                agentName: agentUser.name,
                agentAvatar: agentUser.avatar,
                messageContent: cleanedText,
                dashboardUrl,
                accentColor: widgetCfgForReply?.primaryColor ?? null,
                inReplyToMessageId: referencedMessageId ?? null,
                autoSubmitted: true,
              }),
            )
            .catch((err: unknown) => {
              console.error(
                "[InboundEmail] Agent-reply outbound to visitor failed:",
                err,
              );
            }),
        );
      }
    }

    // Mark this email_id as fully processed (24h TTL). Done last so synchronous
    // failures (DB write, fetch, etc.) leave the marker absent and Resend's
    // retry will re-process. Note: queued outbound sends in `waitUntil` can
    // still fail *after* this point — the message is in the DB but the
    // recipient never gets the email. The dashboard "Send as email" button can
    // be used to re-send manually; failures are logged with `[InboundEmail]`.
    await c.env.CONVERSATIONS_CACHE.put(idempotencyKey, "1", {
      expirationTtl: 60 * 60 * 24,
    });

    return c.json({ ok: true });
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // STRIPE WEBHOOK (public, no auth — must be before session middleware)
  // ═══════════════════════════════════════════════════════════════════════════
  .post("/api/billing/webhook", async (c) => {
    const signature = c.req.header("stripe-signature");
    if (!signature) return c.json({ error: "Missing signature" }, 400);

    const rawBody = await c.req.text();
    const db = drizzle(c.env.DB);
    const billingService = new BillingService(db, c.env);

    try {
      const event = await billingService.constructEvent(rawBody, signature);
      await billingService.handleWebhookEvent(event);
      return c.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook error:", err);
      return c.json({ error: "Webhook verification failed" }, 400);
    }
  })

  // ─── Help Image Signed Upload ───────────────────────────────────────────────
  // Public by design: the bearer of a valid short-lived token is authorized,
  // because the MCP client PUTting the bytes has no dashboard session. The
  // token pins one R2 key and one content type, so it cannot write anything
  // else. Issued by the create_help_image_upload MCP tool.
  .put("/api/help-images/upload", async (c) => {
    const token = c.req.query("token");
    if (!token) return c.json({ error: "Missing token" }, 400);

    let payload;
    try {
      payload = await verifyHelpImageUploadToken({
        token,
        secret: c.env.ENCRYPTION_KEY,
        nowSeconds: Math.floor(Date.now() / 1000),
      });
    } catch {
      return c.json({ error: "Invalid or expired upload token" }, 401);
    }

    // Streamed with a running budget rather than buffered then measured: a
    // token holder could otherwise declare a small Content-Length and stream
    // enough bytes to kill the isolate before any check ran.
    let bytes: Uint8Array;
    try {
      bytes = await readLimitedBody(
        c.req.raw.body,
        MAX_HELP_IMAGE_BYTES,
        c.req.header("content-length"),
      );
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return c.json({ error: "File too large (max 10MB)" }, 413);
      }
      throw err;
    }
    if (bytes.byteLength === 0) return c.json({ error: "Empty body" }, 400);

    await c.env.UPLOADS.put(payload.key, bytes, {
      // From the token, not the request header: the signature authorized this
      // exact type, and a mismatched header must not change what we store.
      httpMetadata: { contentType: payload.contentType },
      customMetadata: {
        ownerType: "help-image",
        projectId: payload.projectId,
      },
    });

    return c.json({
      ok: true,
      url: publicUploadUrl(payload.key),
      bytes: bytes.byteLength,
    });
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION MIDDLEWARE (sets user, session, db on context)
  // ═══════════════════════════════════════════════════════════════════════════
  .use("/api/*", async (c, next) => {
    const db = drizzle(c.env.DB);
    c.set("db", db);

    const auth = createAuth(c.env, c.req.raw.cf as CfProperties);
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    c.set("user", session?.user ?? null);
    c.set("session", session?.session ?? null);

    // Set billing + active-team context defaults
    c.set("subscription", null);
    c.set("planLimits", null);
    c.set("effectiveUserId", null);
    c.set("activeRole", null);
    c.set("activeAccessAllProjects", true);
    c.set("activeProjectIds", null);

    // Resolve the active team (KV-cached, 15-min TTL) + subscription.
    if (session?.user) {
      const teamContext = await getTeamContext(
        c.env.CONVERSATIONS_CACHE,
        db,
        session.user.id,
      );
      const effectiveUserId = teamContext.effectiveUserId;
      c.set("effectiveUserId", effectiveUserId);
      c.set("activeRole", teamContext.activeRole);
      c.set("activeAccessAllProjects", teamContext.accessAllProjects);
      c.set("activeProjectIds", teamContext.projectIds);

      const billingService = new BillingService(db, c.env);
      const subscription =
        await billingService.getSubscriptionByUserId(effectiveUserId);
      c.set("subscription", subscription);

      if (subscription) {
        c.set(
          "planLimits",
          BillingService.getPlanLimits(subscription.plan as Plan),
        );
      }
    }

    await next();
  })

  // ─── Public dashboard Agent sessions ──────────────────────────────────────
  .post(
    "/api/projects/:projectId/conversations/:conversationId/agent-session",
    async (c) => {
      const projectId = c.req.param("projectId");
      const db = c.get("db");
      const conversationStore = createPublicConversationStore({ db, env: c.env });
      const agentStore = new AgentPublicConversationStore({ db, env: c.env });
      return handleCreateDashboardPublicAgentSession({
        request: c.req.raw,
        actor: getSidechatRouteActor(c),
        projectId,
        conversationId: c.req.param("conversationId"),
        secret: c.env.SIDECHAT_TOKEN_SECRET,
        projectService: new ProjectService(db),
        conversationStore,
        ensurePublicConversation(conversation) {
          return agentStore.ensurePublicConversation(conversation);
        },
      });
    },
  )

  // ─── Conversation runtime migration controls ─────────────────────────────
  .post("/api/projects/:projectId/conversation-runtime/backfill", async (c) => {
    const projectId = c.req.param("projectId");
    return handleConversationRuntimeBackfill({
      request: c.req.raw,
      actor: getSidechatRouteActor(c),
      projectId,
      projectService: new ProjectService(c.get("db")),
      runtimeService: new ConversationRuntimeMigrationService(
        c.get("db"),
        c.env,
      ),
    });
  })
  .post("/api/projects/:projectId/conversation-runtime/verify", async (c) => {
    const projectId = c.req.param("projectId");
    return handleConversationRuntimeVerify({
      request: c.req.raw,
      actor: getSidechatRouteActor(c),
      projectId,
      projectService: new ProjectService(c.get("db")),
      runtimeService: new ConversationRuntimeMigrationService(
        c.get("db"),
        c.env,
      ),
    });
  })

  // ─── Native Sidechat sessions ─────────────────────────────────────────────
  .post(
    "/api/projects/:projectId/conversations/:conversationId/sidechat/session",
    async (c) => {
      const actor = getSidechatRouteActor(c);
      const projectId = c.req.param("projectId");
      return handleCreateSidechatSession({
        actor,
        projectId,
        conversationId: c.req.param("conversationId"),
        secret: c.env.SIDECHAT_TOKEN_SECRET,
        projectService: new ProjectService(c.get("db")),
        chatService: createPublicConversationStore({ db: c.get("db"), env: c.env }),
        getParent: () =>
          getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId),
      });
    },
  )
  .get("/api/projects/:projectId/sidechat/summaries", async (c) => {
    const actor = getSidechatRouteActor(c);
    const projectId = c.req.param("projectId");
    return handleGetSidechatSummaries({
      actor,
      projectId,
      secret: c.env.SIDECHAT_TOKEN_SECRET,
      projectService: new ProjectService(c.get("db")),
      getParent: () =>
        getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId),
    });
  })

  // ─── Native Sidechat MCP connections ─────────────────────────────────────
  .get("/api/projects/:projectId/sidechat/mcp/connections", async (c) => {
    const actor = getSidechatRouteActor(c);
    const projectId = c.req.param("projectId");
    return handleGetProjectMcp({
      actor,
      projectId,
      projectService: new ProjectService(c.get("db")),
      getParent: () =>
        getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId),
    });
  })
  .post("/api/projects/:projectId/sidechat/mcp/connections", async (c) => {
    const actor = getSidechatRouteActor(c);
    const projectId = c.req.param("projectId");
    return handleConnectProjectMcp({
      actor,
      projectId,
      request: c.req.raw,
      callbackHost: c.env.BETTER_AUTH_URL,
      projectService: new ProjectService(c.get("db")),
      getParent: () =>
        getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId),
    });
  })
  .post(
    "/api/projects/:projectId/sidechat/mcp/connections/:connectionId/refresh",
    async (c) => {
      const actor = getSidechatRouteActor(c);
      const projectId = c.req.param("projectId");
      return handleRefreshProjectMcp({
        actor,
        projectId,
        connectionId: c.req.param("connectionId"),
        projectService: new ProjectService(c.get("db")),
        getParent: () =>
          getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId),
      });
    },
  )
  .patch(
    "/api/projects/:projectId/sidechat/mcp/connections/:connectionId/tools",
    async (c) => {
      const actor = getSidechatRouteActor(c);
      const projectId = c.req.param("projectId");
      return handleUpdateProjectMcpPolicy({
        actor,
        projectId,
        connectionId: c.req.param("connectionId"),
        request: c.req.raw,
        projectService: new ProjectService(c.get("db")),
        getParent: () =>
          getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId),
      });
    },
  )
  .delete(
    "/api/projects/:projectId/sidechat/mcp/connections/:connectionId",
    async (c) => {
      const actor = getSidechatRouteActor(c);
      const projectId = c.req.param("projectId");
      return handleDisconnectProjectMcp({
        actor,
        projectId,
        connectionId: c.req.param("connectionId"),
        projectService: new ProjectService(c.get("db")),
        getParent: () =>
          getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId),
      });
    },
  )
  .post(
    "/api/projects/:projectId/conversations/:conversationId/sidechat/approvals/:approvalId/always",
    async (c) => {
      const actor = getSidechatRouteActor(c);
      const projectId = c.req.param("projectId");
      return handleGrantProjectToolAlwaysAllow({
        actor,
        projectId,
        conversationId: c.req.param("conversationId"),
        approvalId: c.req.param("approvalId"),
        request: c.req.raw,
        projectService: new ProjectService(c.get("db")),
        getParent: () =>
          getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId),
      });
    },
  )
  .delete(
    "/api/projects/:projectId/sidechat/approvals/always",
    async (c) => {
      const actor = getSidechatRouteActor(c);
      const projectId = c.req.param("projectId");
      return handleRevokeProjectToolAlwaysAllow({
        actor,
        projectId,
        request: c.req.raw,
        projectService: new ProjectService(c.get("db")),
        getParent: () =>
          getAgentByName(c.env.MAVEN_PROJECT_AGENT, projectId),
      });
    },
  )

  // ─── MCP OAuth + Server ───────────────────────────────────────────────────
  .post("/api/mcp/register", handleMcpClientRegistration)
  .get("/api/mcp/authorize", handleMcpAuthorizeGet)
  .post("/api/mcp/authorize", handleMcpAuthorizePost)
  .post("/api/mcp/token", handleMcpToken)
  .post("/api/mcp/revoke", handleMcpTokenRevocation)
  .get("/api/mcp/connections", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const service = new McpOAuthService(c.get("db"));
    const connections = await service.listConnections(user.id);
    return c.json({ connections });
  })
  .delete("/api/mcp/connections/:authorizationId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const service = new McpOAuthService(c.get("db"));
    const revoked = await service.revokeAuthorization(
      c.req.param("authorizationId"),
      user.id,
    );
    if (!revoked) return c.json({ error: "Connection not found" }, 404);
    return c.json({ ok: true });
  })
  .all("/api/mcp", async (c) => handleMcpRequest(c))

  // ═══════════════════════════════════════════════════════════════════════════
  // ONBOARDING ENDPOINTS (session-authenticated)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Step 1: Create project with company info ──────────────────────────────
  .post("/api/onboarding", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (c.get("activeRole") === "member") {
      return c.json(
        { error: "Only owners and admins can create projects" },
        403,
      );
    }

    const body = await c.req.json();
    const parsed = validate(onboardingStep1Schema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);

    // Derive domain + placeholder name from the URL; the AI fills in the
    // real website/company name during the scrape step.
    let domain: string;
    try {
      domain = new URL(parsed.data.websiteUrl).hostname;
    } catch {
      return c.json({ error: "Must be a valid URL" }, 400);
    }
    const displayDomain = domain.replace(/^www\./, "");
    const baseSlug = slugify(displayDomain);

    // Resolve to the active owner's id so admins create projects on the team
    // account, not under their own user id (which would orphan the project).
    const effectiveUserId = c.get("effectiveUserId") ?? user.id;

    // Check if this owner already has a project with this slug (idempotent re-entry)
    const existing = await projectService.getProjectBySlug(
      effectiveUserId,
      baseSlug,
    );
    if (existing) {
      // Reuse the existing project — update its settings and return it
      await projectService.updateSettings(existing.id, {
        companyUrl: parsed.data.websiteUrl,
      });
      return c.json({ projectId: existing.id, slug: existing.slug }, 200);
    }

    // Generate a unique slug (appends -2, -3, etc. if needed)
    const slug = await projectService.generateUniqueSlug(
      effectiveUserId,
      baseSlug,
    );

    // Create the project under the owner's account
    const project = await projectService.createProject({
      userId: effectiveUserId,
      name: displayDomain,
      slug,
      domain,
    });

    await projectService.updateSettings(project.id, {
      companyUrl: parsed.data.websiteUrl,
    });

    return c.json({ projectId: project.id, slug: project.slug }, 201);
  })

  // ─── Step 2: Scrape website and build context ─────────────────────────────
  .post("/api/onboarding/:projectId/scrape", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(
      c.req.param("projectId"),
    );
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const settings = await projectService.getSettings(project.id);
    if (!settings?.companyUrl) {
      return c.json({ context: "", scraped: false });
    }

    try {
      // Fetch the website
      const response = await fetch(settings.companyUrl, {
        headers: {
          "User-Agent": "ReplyMaven Bot/1.0 (https://replymaven.com)",
          Accept: "text/html",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        return c.json({ context: "", scraped: false });
      }

      const html = await response.text();

      // Strip HTML tags to get plain text
      const rawText = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();

      // If too little content, let user input manually
      if (rawText.length < 100) {
        return c.json({ context: "", scraped: false });
      }

      // Store as a resource (webpage type) in R2
      const resourceService = new ResourceService(db, c.env.UPLOADS);
      const resource = await resourceService.createResource({
        projectId: project.id,
        type: "webpage",
        title: `${settings.companyName ?? project.name} - Website`,
        url: settings.companyUrl,
      });

      // Ingest in background (use waitUntil to keep isolate alive)
      c.executionCtx.waitUntil(
        resourceService.ingestWebpage(
          project.id,
          resource.id,
          settings.companyUrl,
          resource.title,
          c.env.CRAWL_QUEUE,
          c.env.CF_ACCOUNT_ID,
          c.env.BROWSER_RENDERING_API_TOKEN,
        ),
      );

      // Extract company profile (name, industry, context) via AI
      const aiService = new AiService({
        model: c.env.AI_MODEL,
        geminiApiKey: c.env.GEMINI_API_KEY,
        openaiApiKey: c.env.OPENAI_API_KEY,
      });
      const profile = await aiService.extractCompanyProfile(
        rawText,
        settings.companyUrl,
      );

      if (!profile) {
        return c.json({ context: "", scraped: false });
      }

      // Save the extracted profile to project settings
      await projectService.updateSettings(project.id, {
        companyName: profile.companyName,
        industry: profile.industry,
        companyContext: profile.context,
      });
      if (profile.websiteName) {
        await projectService.updateProject(project.id, project.userId, {
          name: profile.websiteName,
        });
        scheduleHelpPageCachePurge(c.executionCtx, project.id);
      }

      return c.json({
        scraped: true,
        context: profile.context,
        websiteName: profile.websiteName,
        companyName: profile.companyName,
        industry: profile.industry,
      });
    } catch {
      return c.json({ context: "", scraped: false });
    }
  })

  // ─── Step 2: Save reviewed company profile ─────────────────────────────────
  .put("/api/onboarding/:projectId/context", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(onboardingContextSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(
      c.req.param("projectId"),
    );
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    await projectService.updateSettings(project.id, {
      companyName: parsed.data.companyName,
      industry: parsed.data.industry,
      companyContext: parsed.data.companyContext,
    });
    await projectService.updateProject(project.id, project.userId, {
      name: parsed.data.websiteName,
    });
    scheduleHelpPageCachePurge(c.executionCtx, project.id);

    return c.json({ ok: true });
  })

  // ─── Step 3: Update widget styling ────────────────────────────────────────
  .put("/api/onboarding/:projectId/widget", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(onboardingWidgetSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(
      c.req.param("projectId"),
    );
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    await widgetService.updateWidgetConfig(project.id, parsed.data);
    scheduleHelpPageCachePurge(c.executionCtx, project.id);

    return c.json({ ok: true });
  })

  // ─── Step 4: Generate sample customer question ────────────────────────────
  .get("/api/onboarding/:projectId/sample-question", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(
      c.req.param("projectId"),
    );
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const settings = await projectService.getSettings(project.id);
    const context = settings?.companyContext ?? `${project.name} website`;

    const aiService = new AiService({
      model: c.env.AI_MODEL,
      geminiApiKey: c.env.GEMINI_API_KEY,
      openaiApiKey: c.env.OPENAI_API_KEY,
    });
    const question = await aiService.generateSampleQuestion(context);

    return c.json({ question });
  })

  // ─── Step 4: Mark onboarding complete ─────────────────────────────────────
  .post("/api/onboarding/:projectId/complete", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(
      c.req.param("projectId"),
    );
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    await projectService.markOnboarded(project.id);

    return c.json({ ok: true });
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BILLING ENDPOINTS (session-authenticated)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Create Stripe Checkout Session ─────────────────────────────────────────
  .post("/api/billing/checkout", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createCheckoutSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const billingService = new BillingService(db, c.env);

    try {
      const session = await billingService.createCheckoutSession(
        user.id,
        user.email,
        user.name,
        parsed.data.plan,
        parsed.data.interval,
        parsed.data.successUrl,
        parsed.data.cancelUrl,
      );
      return c.json({ url: session.url });
    } catch (err) {
      console.error("Checkout session error:", err);
      return c.json({ error: "Failed to create checkout session" }, 500);
    }
  })

  // ─── Create Stripe Customer Portal Session ─────────────────────────────────
  .post("/api/billing/portal", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const subscription = c.get("subscription");
    if (!subscription) {
      return c.json({ error: "No active subscription" }, 400);
    }

    const db = c.get("db");
    const billingService = new BillingService(db, c.env);

    const body = (await c.req.json().catch(() => ({}))) as {
      returnUrl?: string;
    };
    const returnUrl =
      body.returnUrl || `${c.env.BETTER_AUTH_URL}/app/account/billing`;

    try {
      const portalSession = await billingService.createPortalSession(
        subscription.stripeCustomerId,
        returnUrl,
      );
      return c.json({ url: portalSession.url });
    } catch (err) {
      console.error("Portal session error:", err);
      return c.json({ error: "Failed to create portal session" }, 500);
    }
  })

  // ─── Get Current Subscription + Usage ───────────────────────────────────────
  .get("/api/billing/subscription", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const db = c.get("db");
    const billingService = new BillingService(db, c.env);
    const teamService = new TeamService(db);

    const subscription =
      await billingService.getSubscriptionByUserId(effectiveUserId);
    const currentUsage = await billingService.getUsage(
      effectiveUserId,
      subscription,
    );
    const seatCount = await teamService.getSeatCount(effectiveUserId);
    // Role reflects the active team (resolved by the middleware).
    const activeRole = c.get("activeRole") ?? "owner";

    // If the user hasn't accepted any team invite yet, surface a pending one so
    // the client can route them to /app/team/accept/:id after login instead of
    // the owner onboarding flow.
    const memberships = await teamService.getMembershipsForUser(user.id);
    const pendingInvite =
      memberships.length > 0
        ? null
        : await teamService.getPendingInviteForEmail(user.email);

    if (!subscription) {
      return c.json({
        subscription: null,
        usage: { messagesUsed: 0 },
        usagePeriodStart: null,
        usagePeriodEnd: null,
        limits: null,
        seats: { current: 1, max: 0 },
        role: activeRole,
        pendingInvite: pendingInvite ? { id: pendingInvite.id } : null,
      });
    }

    const limits = BillingService.getPlanLimits(subscription.plan as Plan);
    const usagePeriodStart = billingService.getUsagePeriodStart(subscription);
    const usagePeriodEnd = billingService.getUsagePeriodEnd(subscription);

    return c.json({
      subscription: {
        id: subscription.id,
        plan: subscription.plan,
        interval: subscription.interval,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      usage: {
        messagesUsed: currentUsage?.messagesUsed ?? 0,
      },
      usagePeriodStart,
      usagePeriodEnd,
      limits,
      seats: {
        current: seatCount,
        max: limits.maxSeats,
      },
      role: activeRole,
      pendingInvite: pendingInvite ? { id: pendingInvite.id } : null,
    });
  })

  // ─── Billing Usage Log ──────────────────────────────────────────────────────
  .get("/api/billing/usage-log", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const db = c.get("db");
    const billingService = new BillingService(db, c.env);

    const parsed = validate(usageLogQuerySchema, c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const subscription =
      await billingService.getSubscriptionByUserId(effectiveUserId);
    const result = await billingService.getUsageLog(
      effectiveUserId,
      subscription,
      parsed.data,
    );
    return c.json(result);
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFILE ENDPOINTS (session-authenticated)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Get Current User Profile ───────────────────────────────────────────────
  .get("/api/profile", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        profilePicture: users.profilePicture,
        workTitle: users.workTitle,
        profileSetupCompletedAt: users.profileSetupCompletedAt,
        profileSetupDismissedAt: users.profileSetupDismissedAt,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!rows[0]) return c.json({ error: "User not found" }, 404);
    return c.json(rows[0]);
  })

  // ─── Update Current User Profile ────────────────────────────────────────────
  .put("/api/profile", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateProfileSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const updates: Record<string, unknown> = {};
    updates.profileSetupCompletedAt = new Date();
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.workTitle !== undefined)
      updates.workTitle = parsed.data.workTitle;
    if (parsed.data.profilePicture !== undefined)
      updates.profilePicture = parsed.data.profilePicture;

    if (Object.keys(updates).length > 0) {
      await db.update(users).set(updates).where(eq(users.id, user.id));
    }

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        profilePicture: users.profilePicture,
        workTitle: users.workTitle,
        profileSetupCompletedAt: users.profileSetupCompletedAt,
        profileSetupDismissedAt: users.profileSetupDismissedAt,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    return c.json(rows[0]);
  })

  // ─── Dismiss Profile Setup Prompt ────────────────────────────────────────────
  .post("/api/profile/setup/dismiss", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    await db
      .update(users)
      .set({ profileSetupDismissedAt: new Date() })
      .where(eq(users.id, user.id));

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        profilePicture: users.profilePicture,
        workTitle: users.workTitle,
        profileSetupCompletedAt: users.profileSetupCompletedAt,
        profileSetupDismissedAt: users.profileSetupDismissedAt,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    return c.json(rows[0]);
  })

  // ─── Get Team Members for Author Selection ──────────────────────────────────
  .get("/api/team/authors", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const teamService = new TeamService(db);
    const effectiveUserId = c.get("effectiveUserId") ?? user.id;

    // Get owner info
    const ownerRows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        profilePicture: users.profilePicture,
        workTitle: users.workTitle,
      })
      .from(users)
      .where(eq(users.id, effectiveUserId))
      .limit(1);

    const authors: Array<{
      id: string;
      name: string;
      email: string;
      avatar: string | null;
      workTitle: string | null;
    }> = [];

    if (ownerRows[0]) {
      const o = ownerRows[0];
      authors.push({
        id: o.id,
        name: o.name,
        email: o.email,
        avatar: o.profilePicture ?? o.image,
        workTitle: o.workTitle,
      });
    }

    // Get accepted team members with user info
    const members = await teamService.getAllMembers(effectiveUserId);
    for (const m of members) {
      if (m.status === "accepted" && m.userId) {
        const memberRows = await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            image: users.image,
            profilePicture: users.profilePicture,
            workTitle: users.workTitle,
          })
          .from(users)
          .where(eq(users.id, m.userId))
          .limit(1);

        if (memberRows[0]) {
          const mr = memberRows[0];
          authors.push({
            id: mr.id,
            name: mr.name,
            email: mr.email,
            avatar: mr.profilePicture ?? mr.image,
            workTitle: mr.workTitle,
          });
        }
      }
    }

    return c.json(authors);
  })

  // ─── Request Email Change (send OTP to new email) ────────────────────────
  .post("/api/profile/change-email/request", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // Per-user rate limit: 3 requests per 5 minutes
    if (!checkRateLimit(`email-change:${user.id}`, 3, 300_000)) {
      return c.json({ error: "Too many requests. Try again later." }, 429);
    }

    const body = await c.req.json();
    const parsed = validate(requestEmailChangeSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const { newEmail } = parsed.data;
    const normalizedEmail = newEmail.toLowerCase();

    if (normalizedEmail === user.email.toLowerCase()) {
      return c.json(
        { error: "New email is the same as your current email" },
        400,
      );
    }

    const db = c.get("db");
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    if (existing.length > 0) {
      return c.json({ error: "This email is already in use" }, 400);
    }

    // Generate OTP via Better Auth emailOTP plugin (no user-existence check)
    const auth = createAuth(c.env, c.req.raw.cf as CfProperties);
    const api = auth.api as typeof auth.api & {
      createVerificationOTP: (opts: {
        body: { email: string; type: string };
      }) => Promise<string>;
    };
    const otp = await api.createVerificationOTP({
      body: { email: normalizedEmail, type: "email-verification" },
    });

    // Store intent + OTP in KV (10 min TTL, matches OTP expiry)
    await c.env.CONVERSATIONS_CACHE.put(
      `email-change:${user.id}`,
      JSON.stringify({ newEmail: normalizedEmail, otp, attempts: 0 }),
      { expirationTtl: 600 },
    );

    // Send OTP email manually (since sendVerificationOTP requires existing user)
    try {
      const emailService = new EmailService(c.env.RESEND_API_KEY);
      await emailService.sendOtpEmail(normalizedEmail, otp);
    } catch (err) {
      console.error("[EmailChange] OTP email failed:", err);
      return c.json(
        { error: "Failed to send verification code. Try again." },
        500,
      );
    }

    return c.json({ success: true });
  })

  // ─── Verify Email Change (check OTP and update email) ──────────────────────
  .post("/api/profile/change-email/verify", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(verifyEmailChangeSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const { otp } = parsed.data;

    // Read pending intent from KV
    const intentRaw = await c.env.CONVERSATIONS_CACHE.get(
      `email-change:${user.id}`,
    );
    if (!intentRaw) {
      return c.json({ error: "No pending email change or it expired" }, 400);
    }
    const intent = JSON.parse(intentRaw) as {
      newEmail: string;
      otp: string;
      attempts: number;
    };

    // Check attempt limit (max 5)
    if (intent.attempts >= 5) {
      await c.env.CONVERSATIONS_CACHE.delete(`email-change:${user.id}`);
      return c.json(
        {
          error: "Too many incorrect attempts. Please request a new code.",
          code: "too_many_attempts",
        },
        403,
      );
    }

    // Compare OTP
    if (otp !== intent.otp) {
      intent.attempts++;
      await c.env.CONVERSATIONS_CACHE.put(
        `email-change:${user.id}`,
        JSON.stringify(intent),
        { expirationTtl: 600 },
      );
      const remaining = 5 - intent.attempts;
      return c.json(
        {
          error:
            remaining > 0
              ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
              : "Too many incorrect attempts. Please request a new code.",
          code: remaining > 0 ? "invalid_otp" : "too_many_attempts",
        },
        remaining > 0 ? 400 : 403,
      );
    }

    // OTP is valid — update user email in D1
    const db = c.get("db");
    await db
      .update(users)
      .set({ email: intent.newEmail })
      .where(eq(users.id, user.id));

    // Clean up KV intent
    await c.env.CONVERSATIONS_CACHE.delete(`email-change:${user.id}`);

    return c.json({ success: true, email: intent.newEmail });
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // TEAM ENDPOINTS (session-authenticated)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── List Team Members ──────────────────────────────────────────────────────
  .get("/api/team", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const teamService = new TeamService(db);
    const effectiveUserId = c.get("effectiveUserId") ?? user.id;

    const members = await teamService.getAllMembers(effectiveUserId);

    // Everyone can see an accurate project count, but only owners and admins
    // receive the project ids needed to manage another member's access.
    const activeRole = c.get("activeRole");
    const isPrivileged = activeRole === "owner" || activeRole === "admin";
    const projectMap = await teamService.getMemberProjectMap(effectiveUserId);
    const membersWithProjects = addProjectAccessToMembers(
      members,
      projectMap,
      isPrivileged,
    );
    return c.json({ members: membersWithProjects, ownerId: effectiveUserId });
  })

  // ─── Invite Team Member ─────────────────────────────────────────────────────
  .post("/api/team/invite", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // Only owner and admin of the active team can invite
    const db = c.get("db");
    const teamService = new TeamService(db);
    if (c.get("activeRole") === "member") {
      return c.json(
        { error: "Only owners and admins can invite members" },
        403,
      );
    }

    const body = await c.req.json();
    const parsed = validate(inviteTeamMemberSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    // Check seat limit
    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const subscription = c.get("subscription");
    if (!subscription) {
      return c.json({ error: "No active subscription" }, 403);
    }

    const limits = BillingService.getPlanLimits(subscription.plan as Plan);
    const seatCount = await teamService.getSeatCount(effectiveUserId);
    if (seatCount >= limits.maxSeats) {
      return c.json(
        {
          error: "Seat limit reached. Upgrade your plan for more seats.",
          code: "seat_limit_reached",
        },
        403,
      );
    }

    // Resolve project-access scope. Admins always get account-wide access;
    // members may be limited to a set of projects owned by this account.
    const accessAllProjects =
      parsed.data.role === "admin" ? true : parsed.data.accessAllProjects ?? true;
    const scopedProjectIds = accessAllProjects
      ? []
      : await teamService.filterOwnedProjectIds(
          effectiveUserId,
          parsed.data.projectIds ?? [],
        );

    try {
      const member = await teamService.inviteMember(
        effectiveUserId,
        parsed.data.email,
        parsed.data.role,
        accessAllProjects,
        scopedProjectIds,
      );

      // Send invitation email
      let emailSent = true;
      let emailError: string | undefined;
      try {
        const emailService = new EmailService(c.env.RESEND_API_KEY);
        const acceptUrl = `https://replymaven.com/app/team/accept/${member.id}`;
        await emailService.sendTeamInviteEmail(
          parsed.data.email,
          user.name ?? "A team member",
          user.email,
          parsed.data.role,
          acceptUrl,
        );
      } catch (emailErr) {
        console.error("Failed to send team invite email:", emailErr);
        emailSent = false;
        emailError =
          emailErr instanceof Error
            ? emailErr.message
            : "Failed to send invitation email";
      }

      return c.json({
        ...member,
        emailSent,
        emailError,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to invite member";
      return c.json({ error: message }, 400);
    }
  })

  // ─── Accept Team Invite ─────────────────────────────────────────────────────
  .post("/api/team/accept/:inviteId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const inviteId = c.req.param("inviteId");
    const db = c.get("db");
    const teamService = new TeamService(db);

    try {
      await teamService.acceptInvite(inviteId, user.id, user.email);
      // New membership — recompute the user's team context next request.
      await invalidateTeamContext(c.env.CONVERSATIONS_CACHE, user.id);
      return c.json({ ok: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to accept invite";
      return c.json({ error: message }, 400);
    }
  })

  // ─── Update Team Member Role ────────────────────────────────────────────────
  .patch("/api/team/:memberId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // Only the owner of the active team can change roles
    const db = c.get("db");
    const teamService = new TeamService(db);
    if (c.get("activeRole") !== "owner") {
      return c.json({ error: "Only the account owner can change roles" }, 403);
    }
    const effectiveUserId = c.get("effectiveUserId") ?? user.id;

    const body = await c.req.json();
    const parsed = validate(updateTeamMemberRoleSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    try {
      const memberId = c.req.param("memberId");
      const member = await teamService.updateMemberRole(
        effectiveUserId,
        memberId,
        parsed.data.role,
      );

      // Update project-access scope when provided (admins stay account-wide).
      if (
        parsed.data.role !== "admin" &&
        (parsed.data.accessAllProjects !== undefined ||
          parsed.data.projectIds !== undefined)
      ) {
        const accessAllProjects = parsed.data.accessAllProjects ?? false;
        const scopedProjectIds = accessAllProjects
          ? []
          : await teamService.filterOwnedProjectIds(
              effectiveUserId,
              parsed.data.projectIds ?? [],
            );
        await teamService.setMemberProjectAccess(
          effectiveUserId,
          memberId,
          accessAllProjects,
          scopedProjectIds,
        );
      }

      const updated = await teamService.getMemberById(memberId);
      // Role/access changed — drop the member's cached team context.
      if (updated?.userId) {
        await invalidateTeamContext(c.env.CONVERSATIONS_CACHE, updated.userId);
      }
      return c.json(updated ?? member);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update role";
      return c.json({ error: message }, 400);
    }
  })

  // ─── Remove Team Member ─────────────────────────────────────────────────────
  .delete("/api/team/:memberId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // Owner and admin of the active team can remove members
    const db = c.get("db");
    const teamService = new TeamService(db);
    if (c.get("activeRole") === "member") {
      return c.json(
        { error: "Only owners and admins can remove members" },
        403,
      );
    }

    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const memberId = c.req.param("memberId");

    try {
      // Capture the member's user id before revoking so we can evict their
      // cached team context immediately (the "revalidate on kick" path).
      const member = await teamService.getMemberById(memberId);
      await teamService.revokeMember(effectiveUserId, memberId);
      if (member?.userId) {
        await invalidateTeamContext(c.env.CONVERSATIONS_CACHE, member.userId);
      }
      return c.json({ ok: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to remove member";
      return c.json({ error: message }, 400);
    }
  })

  // ─── Team Switcher: list the teams the user can act in ──────────────────────
  .get("/api/teams", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const teamService = new TeamService(db);
    const memberships = await teamService.getMembershipsForUser(user.id);
    const owners = await teamService.getOwnersInfo(
      memberships.map((m) => m.ownerId),
    );
    const ownerById = new Map(owners.map((o) => [o.id, o]));
    const activeTeamId = c.get("effectiveUserId") ?? user.id;

    const teams = [
      {
        id: user.id,
        name: user.name || user.email || "My account",
        role: "owner" as const,
        own: true,
        isActive: activeTeamId === user.id,
      },
      ...memberships.map((m) => {
        const owner = ownerById.get(m.ownerId);
        return {
          id: m.ownerId,
          name: owner?.name || owner?.email || "Team",
          role: m.role as "admin" | "member",
          own: false,
          isActive: activeTeamId === m.ownerId,
        };
      }),
    ];

    return c.json({ teams, activeTeamId });
  })

  // ─── Team Switcher: change the active team ──────────────────────────────────
  .post("/api/teams/switch", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(switchTeamSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const teamService = new TeamService(db);
    const teamId = parsed.data.teamId;

    // Validate: own team, or a team the user is an accepted member of.
    if (teamId !== user.id) {
      const membership = await teamService.getMembershipForOwner(
        user.id,
        teamId,
      );
      if (!membership) {
        return c.json({ error: "You are not a member of that team" }, 403);
      }
    }

    await teamService.setActiveTeamId(user.id, teamId);
    await invalidateTeamContext(c.env.CONVERSATIONS_CACHE, user.id);
    return c.json({ ok: true });
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD ENDPOINTS (session-authenticated)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Dashboard Stats ────────────────────────────────────────────────────────
  .get("/api/dashboard", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const db = c.get("db");
    const projectId = c.req.query("projectId");

    // Scoped team members may only read stats for a specific project they can
    // access — never the account-wide aggregate (which would span projects they
    // weren't granted).
    if (c.get("activeRole") === "member" && !c.get("activeAccessAllProjects")) {
      const allowed = c.get("activeProjectIds") ?? [];
      if (!projectId || !allowed.includes(projectId)) {
        return c.json({ error: "Not found" }, 404);
      }
    }

    const dashboardService = new DashboardService(
      db,
      createPublicConversationStore({ db, env: c.env }),
    );
    const stats = await dashboardService.getStats(effectiveUserId, projectId);
    return c.json({
      ...stats,
      recentConversations: stats.recentConversations.map(
        toLegacyConversationDto,
      ),
    });
  })

  // ─── Per-project access enforcement (scoped team members) ────────────────────
  .use("/api/projects/:id", projectAccessMiddleware)
  .use("/api/projects/:id/*", projectAccessMiddleware)

  // ─── Customers ─────────────────────────────────────────────────────────────
  .get("/api/projects/:id/customers", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    if (!(await canAccessCustomerProject(c, projectId))) {
      return c.json({ error: "Not found" }, 404);
    }
    return handleListCustomers({
      projectId,
      query: c.req.query(),
      customerService: new CustomerService(
        c.get("db"),
        createPublicConversationStore({ db: c.get("db"), env: c.env }),
      ),
    });
  })
  .post("/api/projects/:id/customers", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    if (!(await canAccessCustomerProject(c, projectId))) {
      return c.json({ error: "Not found" }, 404);
    }
    return handleCreateCustomer({
      projectId,
      body: await c.req.json(),
      identityService: new CustomerIdentityService(
        c.get("db"),
        createPublicConversationStore({ db: c.get("db"), env: c.env }),
      ),
      onCustomersChanged(customerIds) {
        broadcastCustomerChanges(c, projectId, customerIds);
      },
    });
  })
  .get("/api/projects/:id/customers/:customerId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    if (!(await canAccessCustomerProject(c, projectId))) {
      return c.json({ error: "Not found" }, 404);
    }
    return handleGetCustomer({
      projectId,
      customerId: c.req.param("customerId"),
      customerService: new CustomerService(
        c.get("db"),
        createPublicConversationStore({ db: c.get("db"), env: c.env }),
      ),
    });
  })
  .patch("/api/projects/:id/customers/:customerId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    if (!(await canAccessCustomerProject(c, projectId))) {
      return c.json({ error: "Not found" }, 404);
    }
    return handleUpdateCustomer({
      projectId,
      customerId: c.req.param("customerId"),
      body: await c.req.json(),
      identityService: new CustomerIdentityService(
        c.get("db"),
        createPublicConversationStore({ db: c.get("db"), env: c.env }),
      ),
      onCustomersChanged(customerIds) {
        broadcastCustomerChanges(c, projectId, customerIds);
      },
    });
  })
  .delete("/api/projects/:id/customers/:customerId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    if (!(await canAccessCustomerProject(c, projectId))) {
      return c.json({ error: "Not found" }, 404);
    }
    return handleDeleteCustomer({
      projectId,
      customerId: c.req.param("customerId"),
      identityService: new CustomerIdentityService(
        c.get("db"),
        createPublicConversationStore({ db: c.get("db"), env: c.env }),
      ),
      onCustomersChanged(customerIds) {
        broadcastCustomerChanges(c, projectId, customerIds);
      },
    });
  })
  .post(
    "/api/projects/:id/customers/:targetCustomerId/merge",
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const projectId = c.req.param("id");
      if (!(await canAccessCustomerProject(c, projectId))) {
        return c.json({ error: "Not found" }, 404);
      }
      return handleMergeCustomers({
        projectId,
        targetCustomerId: c.req.param("targetCustomerId"),
        body: await c.req.json(),
        identityService: new CustomerIdentityService(
          c.get("db"),
          createPublicConversationStore({ db: c.get("db"), env: c.env }),
        ),
        onCustomersChanged(customerIds) {
          broadcastCustomerChanges(c, projectId, customerIds);
        },
      });
    },
  )
  .post(
    "/api/projects/:id/conversations/:conversationId/customer",
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const projectId = c.req.param("id");
      if (!(await canAccessCustomerProject(c, projectId))) {
        return c.json({ error: "Not found" }, 404);
      }
      return handleConversationCustomer({
        projectId,
        conversationId: c.req.param("conversationId"),
        body: await c.req.json(),
        identityService: new CustomerIdentityService(
          c.get("db"),
          createPublicConversationStore({ db: c.get("db"), env: c.env }),
        ),
        onCustomersChanged(customerIds) {
          broadcastCustomerChanges(c, projectId, customerIds);
        },
      });
    },
  )
  .post("/api/projects/:id/customer-identity-secret/rotate", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (c.get("activeRole") === "member") {
      return c.json({ error: "Forbidden" }, 403);
    }
    const projectId = c.req.param("id");
    if (!(await canAccessCustomerProject(c, projectId))) {
      return c.json({ error: "Not found" }, 404);
    }
    const result = await new ProjectService(
      c.get("db"),
    ).rotateCustomerIdentitySecret(projectId, c.env.ENCRYPTION_KEY);
    return c.json(result);
  })

  // ─── Projects CRUD ──────────────────────────────────────────────────────────
  .get("/api/projects", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const db = c.get("db");
    const service = new ProjectService(db);
    const allProjects = await service.getProjectsByUserId(effectiveUserId);

    // A team member scoped to specific projects only sees those.
    if (c.get("activeRole") === "member" && !c.get("activeAccessAllProjects")) {
      const allowed = new Set(c.get("activeProjectIds") ?? []);
      return c.json(allProjects.filter((p) => allowed.has(p.id)));
    }

    return c.json(allProjects);
  })
  .get("/api/projects/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const db = c.get("db");
    const service = new ProjectService(db);
    const project = await service.getProjectById(c.req.param("id"));
    if (!project || project.userId !== effectiveUserId) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(project);
  })
  .post("/api/projects", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // Check project limit
    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const db = c.get("db");
    const billingService = new BillingService(db, c.env);
    const projectCheck =
      await billingService.checkProjectLimit(effectiveUserId);
    if (!projectCheck.allowed) {
      return c.json(
        {
          error: `Project limit reached (${projectCheck.current}/${projectCheck.max}). Upgrade your plan.`,
          code: "project_limit_reached",
        },
        403,
      );
    }

    const body = await c.req.json();
    const parsed = validate(createProjectSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const service = new ProjectService(db);
    const baseSlug = slugify(parsed.data.name);
    const slug = await service.generateUniqueSlug(effectiveUserId, baseSlug);
    const project = await service.createProject({
      userId: effectiveUserId,
      name: parsed.data.name,
      slug,
      domain: parsed.data.domain,
    });

    return c.json(project, 201);
  })
  .patch("/api/projects/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateProjectSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const db = c.get("db");
    const service = new ProjectService(db);
    const project = await service.updateProject(
      c.req.param("id"),
      effectiveUserId,
      parsed.data,
    );
    if (!project) return c.json({ error: "Not found" }, 404);
    scheduleHelpPageCachePurge(c.executionCtx, project.id);
    return c.json(project);
  })
  .delete("/api/projects/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const db = c.get("db");
    const service = new ProjectService(db);
    const projectId = c.req.param("id");
    let deleted: boolean;
    try {
      deleted = await deleteProjectWithNativeCleanup({
        projectId,
        ownerId: effectiveUserId,
        projectService: service,
        async destroyParent() {
          const parent = await getAgentByName(
            c.env.MAVEN_PROJECT_AGENT,
            projectId,
          );
          await parent.destroyProjectData();
        },
      });
    } catch {
      return c.json({ error: "Project cleanup failed" }, 502);
    }
    if (!deleted) return c.json({ error: "Not found" }, 404);
    scheduleHelpPageCachePurge(c.executionCtx, projectId);
    return c.json({ ok: true });
  })

  // ─── Project Settings ──────────────────────────────────────────────────────
  .get("/api/projects/:id/settings", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const settings = await projectService.getSettings(project.id);
    // Don't expose encrypted keys to frontend
    if (settings) {
      const serialized = serializeProjectSettings(
        settings as unknown as Record<string, unknown>,
      );
      return c.json({
        ...serialized,
        telegramBotToken: settings.telegramBotToken ? "••••••••" : null,
        slackBotToken: settings.slackBotToken ? "••••••••" : null,
        slackSigningSecret: settings.slackSigningSecret ? "••••••••" : null,
        helpTopNav: parseHelpTopNav(settings.helpTopNav),
        helpAnalytics: parseHelpAnalytics(settings.helpAnalytics),
      });
    }
    return c.json(null);
  })
  .put("/api/projects/:id/settings", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateProjectSettingsSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    // Feature gate: custom tone
    const planLimits = c.get("planLimits");
    if (
      parsed.data.toneOfVoice === "custom" &&
      planLimits &&
      !planLimits.customTone
    ) {
      return c.json(
        {
          error: "Custom tone is available on Pro and Business plans.",
          code: "feature_not_available",
        },
        403,
      );
    }

    const helpCustomCssRaw = parsed.data.helpCustomCss;
    let helpCustomCss: string | null | undefined;
    if (helpCustomCssRaw === undefined) {
      helpCustomCss = undefined;
    } else if (helpCustomCssRaw?.trim()) {
      helpCustomCss = helpCustomCssRaw;
    } else {
      helpCustomCss = null;
    }
    const helpHomeMarkdownRaw = parsed.data.helpHomeMarkdown;
    let helpHomeMarkdown: string | null | undefined;
    if (helpHomeMarkdownRaw === undefined) {
      helpHomeMarkdown = undefined;
    } else if (helpHomeMarkdownRaw?.trim()) {
      helpHomeMarkdown = helpHomeMarkdownRaw;
    } else {
      helpHomeMarkdown = null;
    }
    const helpHomeBackgroundUrlRaw = parsed.data.helpHomeBackgroundUrl;
    let helpHomeBackgroundUrl: string | null | undefined;
    if (helpHomeBackgroundUrlRaw === undefined) {
      helpHomeBackgroundUrl = undefined;
    } else if (helpHomeBackgroundUrlRaw === null) {
      helpHomeBackgroundUrl = null;
    } else {
      const sanitized = sanitizeHelpHomeBackgroundUrl(helpHomeBackgroundUrlRaw);
      if (!sanitized) {
        return c.json({ error: "Invalid background image URL" }, 400);
      }
      helpHomeBackgroundUrl = sanitized;
    }
    if (helpCustomCss) {
      const violation = findCustomCssViolation(helpCustomCss);
      if (violation) return c.json({ error: violation }, 400);
      if (planLimits?.customCss !== true) {
        return c.json(
          {
            error: "Custom CSS is available on the Business plan.",
            code: "feature_not_available",
          },
          403,
        );
      }
    }
    if (
      parsed.data.helpAnalytics &&
      parsed.data.helpAnalytics.length > 0 &&
      planLimits?.customCss !== true
    ) {
      return c.json(
        {
          error: "Help analytics embeds are available on the Business plan.",
          code: "feature_not_available",
        },
        403,
      );
    }

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const { helpTopNav, helpAnalytics, ...rest } = parsed.data;
    delete rest.helpCustomCss;
    delete rest.helpHomeMarkdown;
    delete rest.helpHomeBackgroundUrl;
    delete rest.helpHomeBackgroundPosition;
    delete rest.helpHomeBackgroundFit;
    const updatePayload: Parameters<typeof projectService.updateSettings>[1] = {
      ...rest,
    };
    if (helpTopNav !== undefined) {
      updatePayload.helpTopNav =
        helpTopNav === null ? null : JSON.stringify(helpTopNav);
    }
    if (helpCustomCss !== undefined) {
      updatePayload.helpCustomCss = helpCustomCss;
    }
    if (helpAnalytics !== undefined) {
      updatePayload.helpAnalytics =
        helpAnalytics === null || helpAnalytics.length === 0
          ? null
          : JSON.stringify(helpAnalytics);
    }
    if (helpHomeMarkdown !== undefined) {
      updatePayload.helpHomeMarkdown = helpHomeMarkdown;
    }
    if (helpHomeBackgroundUrl !== undefined) {
      updatePayload.helpHomeBackgroundUrl = helpHomeBackgroundUrl;
      if (helpHomeBackgroundUrl === null) {
        updatePayload.helpHomeBackgroundPosition = null;
        updatePayload.helpHomeBackgroundFit = null;
      }
    }
    if (
      parsed.data.helpHomeBackgroundPosition !== undefined &&
      helpHomeBackgroundUrl !== null
    ) {
      updatePayload.helpHomeBackgroundPosition =
        sanitizeHelpHomeBackgroundPosition(
          parsed.data.helpHomeBackgroundPosition,
        );
    }
    if (
      parsed.data.helpHomeBackgroundFit !== undefined &&
      helpHomeBackgroundUrl !== null
    ) {
      updatePayload.helpHomeBackgroundFit =
        parsed.data.helpHomeBackgroundFit === null
          ? null
          : sanitizeHelpHomeBackgroundFit(parsed.data.helpHomeBackgroundFit);
    }

    const settings = await projectService.updateSettings(
      project.id,
      updatePayload,
    );
    if (!settings) return c.json(null);
    if (parsed.data.autoCloseMinutes !== undefined) {
      const parent = await getAgentByName(
        c.env.MAVEN_PROJECT_AGENT,
        project.id,
      );
      await parent.reconcilePublicAutoCloseSchedules(
        settings.autoCloseMinutes,
      );
    }
    const serialized = serializeProjectSettings(
      settings as unknown as Record<string, unknown>,
    );
    if (
      parsed.data.helpCustomUrl !== undefined ||
      parsed.data.helpTopNav !== undefined ||
      parsed.data.helpCustomCss !== undefined ||
      parsed.data.helpHomeMarkdown !== undefined ||
      parsed.data.helpHomeBackgroundUrl !== undefined ||
      parsed.data.helpHomeBackgroundPosition !== undefined ||
      parsed.data.helpHomeBackgroundFit !== undefined ||
      parsed.data.helpThemeDefault !== undefined ||
      parsed.data.helpAnalytics !== undefined
    ) {
      scheduleHelpPageCachePurge(c.executionCtx, project.id);
    }
    return c.json({
      ...serialized,
      telegramBotToken: settings.telegramBotToken ? "••••••••" : null,
      slackBotToken: settings.slackBotToken ? "••••••••" : null,
      slackSigningSecret: settings.slackSigningSecret ? "••••••••" : null,
      helpTopNav: parseHelpTopNav(settings.helpTopNav),
      helpAnalytics: parseHelpAnalytics(settings.helpAnalytics),
    });
  })
  .post("/api/projects/:id/context/refresh", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    try {
      const resourceService = new ResourceService(db, c.env.UPLOADS);
      const resources = await resourceService.getResourcesByProject(project.id);

      const aiService = new AiService({
        model: c.env.AI_MODEL,
        geminiApiKey: c.env.GEMINI_API_KEY,
        openaiApiKey: c.env.OPENAI_API_KEY,
      });

      let contextSource = "";
      let sourceType: "resources" | "website" = "resources";

      if (resources.length > 0) {
        contextSource = await buildContextSourceFromResources(
          project.id,
          resourceService,
          resources,
        );
        if (!contextSource.trim()) {
          return c.json(
            { error: "Could not build enough context from current resources" },
            422,
          );
        }
      } else {
        sourceType = "website";
        const settings = await projectService.getSettings(project.id);
        if (!settings?.companyUrl) {
          return c.json(
            { error: "Set a company website URL or add resources first" },
            400,
          );
        }

        const markdown = await fetchWebsiteMarkdownWithBrowserApi(
          settings.companyUrl,
          c.env,
        );
        if (!markdown) {
          return c.json(
            { error: "Could not extract enough context from the website" },
            422,
          );
        }
        contextSource = markdown;
      }

      const context =
        await aiService.generateStructuredCompanyContext(contextSource);
      if (!context) {
        return c.json({ error: "Failed to generate company context" }, 500);
      }

      await projectService.updateSettings(project.id, {
        companyContext: context,
      });
      return c.json({ context, refreshed: true, source: sourceType });
    } catch (err) {
      console.error(`Context refresh failed for project ${project.id}:`, err);
      return c.json({ error: "Failed to refresh company context" }, 500);
    }
  })

  // ─── Widget Config ──────────────────────────────────────────────────────────
  .get("/api/projects/:id/widget-config", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const config = await widgetService.getWidgetConfig(project.id);
    return c.json(config);
  })
  .put("/api/projects/:id/widget-config", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateWidgetConfigSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const customCssRaw = parsed.data.customCss;
    let customCss: string | null | undefined;
    if (customCssRaw === undefined) {
      customCss = undefined;
    } else if (customCssRaw?.trim()) {
      customCss = customCssRaw;
    } else {
      customCss = null;
    }

    const planLimits = c.get("planLimits");
    if (customCss) {
      const violation = findCustomCssViolation(customCss);
      if (violation) return c.json({ error: violation }, 400);
      if (planLimits && !planLimits.customCss) {
        return c.json(
          {
            error: "Custom CSS is available on the Business plan.",
            code: "feature_not_available",
          },
          403,
        );
      }
    }

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const config = await widgetService.updateWidgetConfig(project.id, {
      ...parsed.data,
      ...(customCss !== undefined ? { customCss } : {}),
    });
    scheduleHelpPageCachePurge(c.executionCtx, project.id);
    return c.json(config);
  })

  // ─── Quick Actions ──────────────────────────────────────────────────────────
  .get("/api/projects/:id/quick-actions", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const actions = await widgetService.getQuickActions(project.id);
    return c.json(actions);
  })
  .post("/api/projects/:id/quick-actions", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createQuickActionSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);

    // Enforce max 1 ticket-form action per project.
    // (Stored enum value is "inquiry" — kept for back-compat with widget bundles.)
    if (parsed.data.type === "inquiry") {
      const existing = await widgetService.getQuickActionsByType(
        project.id,
        parsed.data.type,
      );
      if (existing.length > 0) {
        return c.json(
          {
            error: `Only one ${parsed.data.type.replace("_", " ")} action allowed per project`,
          },
          400,
        );
      }
    }

    // Enforce max 20 actions per project
    const allActions = await widgetService.getQuickActions(project.id);
    if (allActions.length >= 20) {
      return c.json({ error: "Maximum of 20 quick actions allowed" }, 400);
    }

    const action = await widgetService.createQuickAction({
      projectId: project.id,
      ...parsed.data,
    });
    return c.json(action, 201);
  })
  .patch("/api/projects/:id/quick-actions/:actionId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateQuickActionSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const updated = await widgetService.updateQuickAction(
      c.req.param("actionId"),
      project.id,
      parsed.data,
    );
    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json(updated);
  })
  .delete("/api/projects/:id/quick-actions/:actionId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const deleted = await widgetService.deleteQuickAction(
      c.req.param("actionId"),
      project.id,
    );
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  })

  // ─── Greetings ───────────────────────────────────────────────────────────────
  .get("/api/projects/:id/greetings", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const rows = await widgetService.getGreetings(project.id);
    const greetings = rows.map((row) => ({
      id: row.id,
      enabled: row.enabled,
      imageUrl: row.imageUrl,
      imagePosition: row.imagePosition,
      imageAspect: row.imageAspect,
      title: row.title,
      description: row.description,
      ctaText: row.ctaText,
      ctaLink: row.ctaLink,
      authorId: row.authorId,
      allowedPages: row.allowedPages
        ? (JSON.parse(row.allowedPages) as string[])
        : null,
      delaySeconds: row.delaySeconds,
      durationSeconds: row.durationSeconds,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    return c.json(greetings);
  })
  .post("/api/projects/:id/greetings", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createGreetingSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);

    const existing = await widgetService.getGreetings(project.id);
    if (existing.length >= 50) {
      return c.json({ error: "Maximum of 50 greetings allowed" }, 400);
    }

    const row = await widgetService.createGreeting(project.id, parsed.data);
    return c.json(row, 201);
  })
  .patch("/api/projects/:id/greetings/reorder", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(reorderGreetingsSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    await widgetService.reorderGreetings(project.id, parsed.data.ids);
    return c.json({ ok: true });
  })
  .patch("/api/projects/:id/greetings/:greetingId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateGreetingSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const updated = await widgetService.updateGreeting(
      c.req.param("greetingId"),
      project.id,
      parsed.data,
    );
    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json(updated);
  })
  .delete("/api/projects/:id/greetings/:greetingId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const deleted = await widgetService.deleteGreeting(
      c.req.param("greetingId"),
      project.id,
    );
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  })

  // ─── Tools (Dashboard) ───────────────────────────────────────────────────
  .get("/api/projects/:id/tools", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const toolService = new ToolService(db);
    const projectTools = await toolService.getTools(project.id);
    return handleListToolsRequest({
      tools: projectTools,
      maskStoredHeaders: async (headers) =>
        maskStoredToolHeaders(headers, c.env.ENCRYPTION_KEY),
    });
  })

  .post("/api/projects/:id/tools", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // Feature gate: tools
    const planLimits = c.get("planLimits");
    if (planLimits && !planLimits.tools) {
      return c.json(
        {
          error: "Tools are available on Pro and Business plans.",
          code: "feature_not_available",
        },
        403,
      );
    }

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json();
    const toolService = new ToolService(db);
    return handleCreateToolRequest({
      projectId: project.id,
      role: c.get("activeRole") ?? "member",
      body,
      toolService,
      encryptHeaders: async (headers) =>
        encryptHeaders(headers, c.env.ENCRYPTION_KEY),
      maskStoredHeaders: async (headers) =>
        maskStoredToolHeaders(headers, c.env.ENCRYPTION_KEY),
    });
  })

  .patch("/api/projects/:id/tools/:toolId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json();
    const toolService = new ToolService(db);
    return handleUpdateToolRequest({
      projectId: project.id,
      toolId: c.req.param("toolId"),
      role: c.get("activeRole") ?? "member",
      body,
      toolService,
      encryptHeaders: async (headers) =>
        encryptHeaders(headers, c.env.ENCRYPTION_KEY),
      maskStoredHeaders: async (headers) =>
        maskStoredToolHeaders(headers, c.env.ENCRYPTION_KEY),
    });
  })

  .delete("/api/projects/:id/tools/:toolId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const toolService = new ToolService(db);
    const deleted = await toolService.deleteTool(
      c.req.param("toolId"),
      project.id,
    );
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  })

  .post("/api/projects/:id/tools/:toolId/test", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    // Rate limit tool tests: 20 per minute per project
    if (!checkRateLimit(`tooltest:${project.id}`, 20, 60_000)) {
      return c.json(
        { error: "Tool test rate limit exceeded. Please try again shortly." },
        429,
      );
    }

    const body = await c.req.json();
    const parsed = validate(testToolSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const toolService = new ToolService(db);
    const toolDef = await toolService.getToolById(
      c.req.param("toolId"),
      project.id,
    );
    if (!toolDef) return c.json({ error: "Tool not found" }, 404);

    // Decrypt encrypted headers before test execution
    if (toolDef.headers && isEncrypted(toolDef.headers)) {
      try {
        const decrypted = await decryptHeaders(
          toolDef.headers,
          c.env.ENCRYPTION_KEY,
        );
        toolDef.headers = JSON.stringify(decrypted);
      } catch {
        toolDef.headers = null;
      }
    }

    const toolSet = buildToolRegistry([toToolDefinition(toolDef)]);
    const toolFn = toolSet[toolDef.name];

    if (
      !toolFn ||
      !("execute" in toolFn) ||
      typeof toolFn.execute !== "function"
    ) {
      return c.json({ error: "Tool has no execute function" }, 500);
    }

    const startTime = Date.now();
    try {
      const result = await toolFn.execute(parsed.data.params, {
        toolCallId: "test",
        messages: [],
        abortSignal: AbortSignal.timeout(toolDef.timeout),
      });
      const duration = Date.now() - startTime;

      // Log the test execution
      await toolService.logExecution({
        toolId: toolDef.id,
        input: parsed.data.params as Record<string, unknown>,
        output: result,
        status: (result as Record<string, unknown>)?.error
          ? "error"
          : "success",
        duration,
      });

      return c.json({ success: true, result, duration });
    } catch (err) {
      const duration = Date.now() - startTime;
      return c.json({
        success: false,
        error: err instanceof Error ? err.message : "Test execution failed",
        duration,
      });
    }
  })

  .get("/api/projects/:id/tool-executions", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const toolId = c.req.query("toolId");
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);

    const toolService = new ToolService(db);
    const executions = await toolService.getExecutions(project.id, {
      toolId: toolId ?? undefined,
      limit: Math.min(limit, 100),
      offset,
    });

    return c.json(executions);
  })

  // ─── Ticket Config (Dashboard) ────────────────────────────────────────────
  .get("/api/projects/:id/ticket-config", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const contactFormService = new ContactFormService(db);
    const config = await contactFormService.getConfig(project.id);
    if (!config) {
      return c.json({
        enabled: false,
        description: "We'll get back to you within 1-2 hours.",
        fields: [],
      });
    }
    return c.json({
      enabled: config.enabled,
      description: config.description,
      fields: JSON.parse(config.fields || "[]"),
    });
  })
  .put("/api/projects/:id/ticket-config", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateTicketConfigSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const contactFormService = new ContactFormService(db);
    const config = await contactFormService.upsertConfig(
      project.id,
      parsed.data,
    );
    return c.json({
      enabled: config.enabled,
      description: config.description,
      fields: JSON.parse(config.fields || "[]"),
    });
  })

  // ─── Assignable Users (project owner + accepted team members) ─────────────
  .get("/api/projects/:id/assignable-users", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const [assignable, settings] = await Promise.all([
      getAssignableUsers(db, project.id),
      projectService.getSettings(project.id),
    ]);
    return c.json([mavenAssignableUser(settings?.botName), ...assignable]);
  })

  // ─── Resources ─────────────────────────────────────────────────────────────
  .get("/api/projects/:id/resources", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const resourceService = new ResourceService(db, c.env.UPLOADS);
    // eslint-disable-next-line prefer-const -- resources is re-fetched after stale-crawl recovery
    let [resources, counts] = await Promise.all([
      resourceService.getResourcesByProject(project.id),
      resourceService.getCrawledPageCountsByResource(project.id),
    ]);

    // Self-heal crawls stuck on abandoned pending pages (lost queue messages)
    const stuckCrawls = resources.filter(
      (r) => r.type === "webpage" && r.status === "crawling",
    );
    if (stuckCrawls.length > 0) {
      const crawlService = new CrawlService(
        db,
        c.env.UPLOADS,
        c.env.CF_ACCOUNT_ID,
        c.env.BROWSER_RENDERING_API_TOKEN,
      );
      for (const r of stuckCrawls) {
        await crawlService.recoverStaleCrawl(r.id, project.id);
      }
      resources = await resourceService.getResourcesByProject(project.id);
    }

    // Article mirrors are managed from the Articles tab, not listed as sources.
    const enriched = resources
      .filter((r) => !r.sourceArticleId)
      .map((r) =>
        r.type === "webpage" ? { ...r, pageCount: counts.get(r.id) ?? 0 } : r,
      );
    return c.json(enriched);
  })
  .post("/api/projects/:id/resources", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const contentType = c.req.header("content-type") ?? "";
    const resourceService = new ResourceService(db, c.env.UPLOADS);

    // Feature gate: PDF indexing
    const planLimits = c.get("planLimits");
    if (
      contentType.includes("multipart/form-data") &&
      planLimits &&
      !planLimits.pdfIndexing
    ) {
      return c.json(
        {
          error: "PDF indexing is available on Pro and Business plans.",
          code: "feature_not_available",
        },
        403,
      );
    }

    // ─── PDF upload via multipart form ──────────────────────────────────────
    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.parseBody();
      const title = formData["title"];
      const file = formData["file"];

      if (!title || typeof title !== "string" || !title.trim()) {
        return c.json({ error: "Title is required" }, 400);
      }
      if (!file || typeof file === "string") {
        return c.json({ error: "PDF file is required" }, 400);
      }

      const fileObj = file as File;
      if (fileObj.type !== "application/pdf") {
        return c.json({ error: "Only PDF files are allowed" }, 400);
      }
      if (fileObj.size > 10 * 1024 * 1024) {
        return c.json({ error: "File too large (max 10MB)" }, 400);
      }

      const resource = await resourceService.createResource({
        projectId: project.id,
        type: "pdf",
        title: title.trim(),
      });

      const buffer = await fileObj.arrayBuffer();
      c.executionCtx.waitUntil(
        (async () => {
          await resourceService.ingestPdf(
            project.id,
            resource.id,
            buffer,
            title.trim(),
          );
          await triggerAutoRagSync(c.env, "resource.create.pdf");
        })(),
      );

      return c.json(resource, 201);
    }

    // ─── JSON body for webpage/faq ──────────────────────────────────────────
    const body = await c.req.json();

    // Handle FAQ with structured pairs
    if (body.type === "faq" && body.pairs) {
      const parsed = validate(createFaqResourceSchema, body);
      if (!parsed.success) return c.json({ error: parsed.error }, 400);

      const resource = await resourceService.createResource({
        projectId: project.id,
        type: "faq",
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        content: JSON.stringify(parsed.data.pairs),
      });

      c.executionCtx.waitUntil(
        (async () => {
          await resourceService.ingestFaqFromPairs(
            project.id,
            resource.id,
            parsed.data.title,
            parsed.data.pairs,
          );
          await triggerAutoRagSync(c.env, "resource.create.faq");
        })(),
      );

      return c.json(resource, 201);
    }

    // Handle webpage and legacy faq
    const parsed = validate(createResourceSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    if (parsed.data.type === "webpage" && parsed.data.url) {
      const settings = await projectService.getSettings(project.id);
      if (
        isOwnHelpCenterUrl(
          parsed.data.url,
          project.slug,
          resolveHelpCustomUrl(project.slug, settings?.helpCustomUrl),
        )
      ) {
        return c.json(
          {
            error:
              "This page is part of your help center. Published articles are indexed automatically \u2014 no need to add them here.",
            code: "own_help_center_url",
          },
          400,
        );
      }
    }

    const resource = await resourceService.createResource({
      projectId: project.id,
      type: parsed.data.type,
      title: parsed.data.title,
      url: parsed.data.url,
      content: parsed.data.content,
    });

    // Trigger ingestion based on type (use waitUntil to keep isolate alive)
    if (parsed.data.type === "webpage" && parsed.data.url) {
      c.executionCtx.waitUntil(
        (async () => {
          await resourceService.ingestWebpage(
            project.id,
            resource.id,
            parsed.data.url ?? "",
            parsed.data.title,
            c.env.CRAWL_QUEUE,
            c.env.CF_ACCOUNT_ID,
            c.env.BROWSER_RENDERING_API_TOKEN,
          );
          await triggerAutoRagSync(c.env, "resource.create.webpage");
        })(),
      );
    } else if (parsed.data.type === "faq" && parsed.data.content) {
      c.executionCtx.waitUntil(
        (async () => {
          await resourceService.ingestFaq(
            project.id,
            resource.id,
            parsed.data.title,
            parsed.data.content ?? "",
          );
          await triggerAutoRagSync(c.env, "resource.create.faq.legacy");
        })(),
      );
    }

    return c.json(resource, 201);
  })
  .post("/api/projects/:id/resources/generate-faq", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    if (!checkRateLimit(`gen-faq:${project.id}`, 5, 60 * 60 * 1000)) {
      return c.json(
        { error: "Rate limit exceeded. Try again later." },
        429,
      );
    }

    const body = await c.req.json();
    const parsed = validate(generateFaqRequestSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const resourceService = new ResourceService(db, c.env.UPLOADS);
    const allResources = await resourceService.getResourcesByProject(
      project.id,
    );

    // Source pool: webpages, PDFs, and (if user explicitly listed them) FAQs
    // are honored. By default we exclude FAQs from sources — they are the
    // dedupe target, not the input.
    const requestedIds = parsed.data.sourceResourceIds;
    const eligibleResources = allResources.filter((r) => {
      if (requestedIds && requestedIds.length > 0) {
        return requestedIds.includes(r.id);
      }
      return r.type === "webpage" || r.type === "pdf";
    });

    const sourceText = await buildContextSourceFromResources(
      project.id,
      resourceService,
      eligibleResources,
    );

    // Always include company context as background.
    const settings = await projectService.getSettings(project.id);
    const companyContext = settings?.companyContext?.trim() ?? "";
    const combinedSource = companyContext
      ? `## Company Context\n${companyContext}\n\n---\n\n${sourceText}`.slice(
          0,
          CONTEXT_SOURCE_MAX_CHARS,
        )
      : sourceText;

    if (!combinedSource.trim()) {
      return c.json(
        {
          error:
            "No source material available. Add at least one webpage, PDF, or company context first.",
        },
        400,
      );
    }

    const [existingQuestions, existingDescriptions] = await Promise.all([
      resourceService.getAllFaqQuestions(project.id),
      resourceService.getAllFaqDescriptions(project.id),
    ]);

    const aiService = new AiService({
      model: c.env.AI_MODEL,
      geminiApiKey: c.env.GEMINI_API_KEY,
      openaiApiKey: c.env.OPENAI_API_KEY,
    });

    const draft = await aiService.generateFaqFromSources({
      topic: parsed.data.topic,
      sourceText: combinedSource,
      existingQuestions,
      existingDescriptions,
      targetPairCount: parsed.data.targetPairCount ?? 7,
      maxSetChars: 8_000,
      maxPairChars: 2_000,
      maxDescriptionChars: 500,
    });

    if (!draft) {
      return c.json(
        {
          error:
            "Failed to generate FAQ. Try a more specific topic or add more source material.",
        },
        422,
      );
    }

    return c.json(draft);
  })
  .post(
    "/api/projects/:id/resources/:resourceId/split-with-ai",
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const db = c.get("db");
      const projectService = new ProjectService(db);
      const project = await projectService.getProjectById(c.req.param("id"));
      if (
        !project ||
        project.userId !== (c.get("effectiveUserId") ?? user.id)
      ) {
        return c.json({ error: "Not found" }, 404);
      }

      if (!checkRateLimit(`split-faq:${project.id}`, 10, 60 * 60 * 1000)) {
        return c.json(
          { error: "Rate limit exceeded. Try again later." },
          429,
        );
      }

      const resourceService = new ResourceService(db, c.env.UPLOADS);
      const resource = await resourceService.getResourceById(
        c.req.param("resourceId"),
        project.id,
      );
      if (!resource || resource.type !== "faq") {
        return c.json({ error: "Not found" }, 404);
      }

      let pairs: Array<{ question: string; answer: string }> = [];
      try {
        const parsed = JSON.parse(resource.content ?? "[]");
        if (Array.isArray(parsed)) {
          pairs = parsed.filter(
            (p): p is { question: string; answer: string } =>
              !!p &&
              typeof p === "object" &&
              typeof p.question === "string" &&
              typeof p.answer === "string",
          );
        }
      } catch {
        return c.json({ error: "FAQ content is malformed" }, 400);
      }

      if (pairs.length < 2) {
        return c.json(
          { error: "FAQ must have at least 2 pairs to split" },
          400,
        );
      }

      const aiService = new AiService({
        model: c.env.AI_MODEL,
        geminiApiKey: c.env.GEMINI_API_KEY,
        openaiApiKey: c.env.OPENAI_API_KEY,
      });

      const buckets = await aiService.splitFaqIntoBuckets({
        originalTitle: resource.title,
        originalDescription: resource.description ?? null,
        pairs,
        maxBucketChars: 7_000,
      });

      if (!buckets) {
        return c.json(
          {
            error:
              "Failed to produce a valid split. Try again, or shorten pairs manually.",
          },
          422,
        );
      }

      // Resolve indices back to full pair text for the client preview.
      const resolved = buckets.map((bucket) => ({
        title: bucket.title,
        description: bucket.description,
        pairs: bucket.pairIndices.map((i) => pairs[i]),
      }));

      return c.json({ buckets: resolved });
    },
  )
  .post(
    "/api/projects/:id/resources/:resourceId/apply-split",
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const db = c.get("db");
      const projectService = new ProjectService(db);
      const project = await projectService.getProjectById(c.req.param("id"));
      if (
        !project ||
        project.userId !== (c.get("effectiveUserId") ?? user.id)
      ) {
        return c.json({ error: "Not found" }, 404);
      }

      const body = await c.req.json();
      const parsed = validate(applyFaqSplitSchema, body);
      if (!parsed.success) return c.json({ error: parsed.error }, 400);

      const resourceService = new ResourceService(db, c.env.UPLOADS);
      const result = await resourceService.applyFaqSplit(
        project.id,
        c.req.param("resourceId"),
        parsed.data.buckets,
      );

      if (!result) {
        return c.json({ error: "Source FAQ not found" }, 404);
      }

      // Re-ingest each new resource to R2 / AI Search asynchronously, then sync.
      c.executionCtx.waitUntil(
        (async () => {
          await Promise.all(
            result.created.map(async (created) => {
              let bucketPairs: FaqPair[] = [];
              try {
                const parsedPairs = JSON.parse(created.content ?? "[]");
                if (Array.isArray(parsedPairs)) bucketPairs = parsedPairs;
              } catch {
                return;
              }
              if (bucketPairs.length === 0) return;
              await resourceService.ingestFaqFromPairs(
                project.id,
                created.id,
                created.title,
                bucketPairs,
              );
            }),
          );
          await triggerAutoRagSync(c.env, "faq.apply_split");
        })(),
      );

      return c.json({
        created: result.created,
        deletedSourceId: result.deletedSourceId,
      });
    },
  )
  .post(
    "/api/projects/:id/resources/:resourceId/move-pair",
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const db = c.get("db");
      const projectService = new ProjectService(db);
      const project = await projectService.getProjectById(c.req.param("id"));
      if (
        !project ||
        project.userId !== (c.get("effectiveUserId") ?? user.id)
      ) {
        return c.json({ error: "Not found" }, 404);
      }

      const body = await c.req.json();
      const parsed = validate(movePairSchema, body);
      if (!parsed.success) return c.json({ error: parsed.error }, 400);

      const resourceService = new ResourceService(db, c.env.UPLOADS);
      const result = await resourceService.moveFaqPair(
        project.id,
        c.req.param("resourceId"),
        parsed.data.destResourceId,
        parsed.data.pairIndex,
        FAQ_SET_MAX_CHARS,
      );

      if (!result.ok) {
        const status =
          result.reason === "destination_overflow"
            ? 422
            : result.reason === "out_of_range"
              ? 400
              : 404;
        const message =
          result.reason === "destination_overflow"
            ? "Destination FAQ would exceed the character limit."
            : result.reason === "same_resource"
              ? "Source and destination cannot be the same."
              : result.reason === "out_of_range"
                ? "Pair index out of range."
                : "FAQ resource not found.";
        return c.json({ error: message }, status);
      }

      // Re-ingest both sets to R2, then trigger AutoRAG sync.
      c.executionCtx.waitUntil(
        (async () => {
          await Promise.all([
            resourceService.ingestFaqFromPairs(
              project.id,
              c.req.param("resourceId"),
              result.sourceTitle,
              result.sourcePairs,
            ),
            resourceService.ingestFaqFromPairs(
              project.id,
              parsed.data.destResourceId,
              result.destTitle,
              result.destPairs,
            ),
          ]);
          await triggerAutoRagSync(c.env, "faq.move_pair");
        })(),
      );

      return c.json({ ok: true });
    },
  )
  .post("/api/projects/:id/faq-description-suggestion", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    if (!checkRateLimit(`faq-desc:${project.id}`, 20, 60 * 60 * 1000)) {
      return c.json({ error: "Rate limit exceeded. Try again later." }, 429);
    }

    const body = (await c.req.json()) as {
      pairs?: Array<{ question?: unknown; answer?: unknown }>;
    };
    const pairs: FaqPair[] = [];
    for (const entry of body.pairs ?? []) {
      if (
        entry &&
        typeof entry.question === "string" &&
        typeof entry.answer === "string" &&
        entry.question.trim() &&
        entry.answer.trim()
      ) {
        pairs.push({ question: entry.question, answer: entry.answer });
      }
    }
    if (pairs.length < 1) {
      return c.json({ error: "At least one Q&A pair is required" }, 400);
    }

    const aiService = new AiService({
      model: c.env.AI_MODEL,
      geminiApiKey: c.env.GEMINI_API_KEY,
      openaiApiKey: c.env.OPENAI_API_KEY,
    });

    const suggestion = await aiService.suggestFaqDescription({ pairs });
    if (!suggestion) {
      return c.json({ error: "Failed to generate suggestion" }, 422);
    }

    return c.json({ suggestion });
  })
  .delete("/api/projects/:id/resources/:resourceId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const resourceService = new ResourceService(db, c.env.UPLOADS);
    const target = await resourceService.getResourceById(
      c.req.param("resourceId"),
      project.id,
    );
    if (!target) return c.json({ error: "Not found" }, 404);
    if (target.sourceArticleId) {
      return c.json(
        {
          error:
            "This entry mirrors a published help article. Unpublish the article to remove it from the AI index.",
          code: "article_mirror",
        },
        403,
      );
    }
    const deleted = await resourceService.deleteResource(target.id, project.id);
    if (!deleted) return c.json({ error: "Not found" }, 404);
    c.executionCtx.waitUntil(triggerAutoRagSync(c.env, "resource.delete"));
    return c.json({ ok: true });
  })
  .post("/api/projects/:id/resources/:resourceId/reindex", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const resourceService = new ResourceService(db, c.env.UPLOADS);
    const resource = await resourceService.getResourceById(
      c.req.param("resourceId"),
      project.id,
    );
    if (!resource) {
      return c.json({ error: "Not found" }, 404);
    }
    if (resource.sourceArticleId) {
      return c.json(
        {
          error:
            "This entry mirrors a published help article. Re-save the article to refresh its index.",
          code: "article_mirror",
        },
        403,
      );
    }

    // Reset status to pending before re-ingestion
    await resourceService.updateResourceStatus(
      resource.id,
      project.id,
      "pending",
    );

    // Re-trigger ingestion (use waitUntil to keep isolate alive). After the
    // R2 write completes, fire AutoRAG sync so AI Search picks up the change.
    if (resource.type === "webpage" && resource.url) {
      c.executionCtx.waitUntil(
        (async () => {
          await resourceService.ingestWebpage(
            project.id,
            resource.id,
            resource.url ?? "",
            resource.title,
            c.env.CRAWL_QUEUE,
            c.env.CF_ACCOUNT_ID,
            c.env.BROWSER_RENDERING_API_TOKEN,
          );
          await triggerAutoRagSync(c.env, "resource.reindex.webpage");
        })(),
      );
    } else if (resource.type === "faq" && resource.content) {
      c.executionCtx.waitUntil(
        (async () => {
          await resourceService.ingestFaq(
            project.id,
            resource.id,
            resource.title,
            resource.content ?? "",
          );
          await triggerAutoRagSync(c.env, "resource.reindex.faq");
        })(),
      );
    } else if (resource.type === "pdf") {
      // Keep PDF text companion in sync when editable text exists.
      c.executionCtx.waitUntil(
        (async () => {
          try {
            if (resource.content) {
              const updated = await resourceService.updateResourceContent(
                resource.id,
                project.id,
                resource.title,
                resource.content,
              );
              if (!updated) {
                throw new Error("Failed to update PDF text companion");
              }
              return;
            }

            const candidateKeys = [
              resource.r2Key,
              `${project.id}/${resource.id}.pdf`,
              `${project.id}/${resource.id}-text.md`,
            ].filter((key): key is string => Boolean(key));

            let selectedKey: string | null = null;
            let selectedBody: ArrayBuffer | null = null;
            for (const key of candidateKeys) {
              const obj = await c.env.UPLOADS.get(key);
              if (obj) {
                selectedKey = key;
                selectedBody = await obj.arrayBuffer();
                break;
              }
            }

            if (!selectedKey || !selectedBody) {
              await resourceService.updateResourceStatus(
                resource.id,
                project.id,
                "failed",
              );
              return;
            }

            if (selectedKey.endsWith(".pdf")) {
              await c.env.UPLOADS.put(selectedKey, selectedBody, {
                httpMetadata: { contentType: "application/pdf" },
                customMetadata: {
                  context: `PDF document: ${resource.title}`,
                },
              });
            } else {
              await c.env.UPLOADS.put(selectedKey, selectedBody, {
                customMetadata: {
                  context: `PDF document: ${resource.title}`,
                },
              });
            }
            await resourceService.updateResourceStatus(
              resource.id,
              project.id,
              "indexed",
            );
            await triggerAutoRagSync(c.env, "resource.reindex.pdf");
          } catch (err) {
            console.error(
              `PDF reindex failed for resource ${resource.id}:`,
              err,
            );
            await resourceService.updateResourceStatus(
              resource.id,
              project.id,
              "failed",
            );
          }
        })(),
      );
    }

    return c.json({ ok: true, message: "Reindexing started" });
  })

  // ─── Resource Content & Updates ─────────────────────────────────────────────
  .get("/api/projects/:id/resources/:resourceId/content", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const resourceService = new ResourceService(db, c.env.UPLOADS);
    const content = await resourceService.getResourceContent(
      c.req.param("resourceId"),
      project.id,
    );
    if (!content) return c.json({ error: "Not found" }, 404);
    return c.json(content);
  })
  .put("/api/projects/:id/resources/:resourceId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const resourceService = new ResourceService(db, c.env.UPLOADS);
    const resource = await resourceService.getResourceById(
      c.req.param("resourceId"),
      project.id,
    );
    if (!resource) return c.json({ error: "Not found" }, 404);

    const body = await c.req.json();

    // Handle FAQ updates with structured pairs
    if (resource.type === "faq") {
      const parsed = validate(updateFaqResourceSchema, body);
      if (!parsed.success) return c.json({ error: parsed.error }, 400);

      const updated = await resourceService.updateFaqResource(
        resource.id,
        project.id,
        parsed.data.title,
        parsed.data.pairs,
        parsed.data.description ?? null,
      );
      if (!updated) return c.json({ error: "Update failed" }, 500);
      c.executionCtx.waitUntil(
        triggerAutoRagSync(c.env, "resource.update.faq"),
      );
      return c.json(updated);
    }

    // Handle PDF/other content updates
    const parsed = validate(updateResourceContentSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const updated = await resourceService.updateResourceContent(
      resource.id,
      project.id,
      parsed.data.title,
      parsed.data.content,
    );
    if (!updated) return c.json({ error: "Update failed" }, 500);
    c.executionCtx.waitUntil(
      triggerAutoRagSync(c.env, "resource.update.content"),
    );
    return c.json(updated);
  })

  // ─── Crawled Pages ──────────────────────────────────────────────────────────
  .get("/api/projects/:id/resources/:resourceId/pages", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const resourceService = new ResourceService(db, c.env.UPLOADS);
    const resource = await resourceService.getResourceById(
      c.req.param("resourceId"),
      project.id,
    );
    if (!resource || resource.type !== "webpage") {
      return c.json({ error: "Not found" }, 404);
    }

    // Self-heal crawls stuck on abandoned pending pages (lost queue messages)
    if (resource.status === "crawling") {
      const crawlService = new CrawlService(
        db,
        c.env.UPLOADS,
        c.env.CF_ACCOUNT_ID,
        c.env.BROWSER_RENDERING_API_TOKEN,
      );
      await crawlService.recoverStaleCrawl(resource.id, project.id);
    }

    const pages = await resourceService.getCrawledPages(
      resource.id,
      project.id,
    );
    return c.json(pages);
  })
  .get(
    "/api/projects/:id/resources/:resourceId/pages/:pageId/content",
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const db = c.get("db");
      const projectService = new ProjectService(db);
      const project = await projectService.getProjectById(c.req.param("id"));
      if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
        return c.json({ error: "Not found" }, 404);
      }

      const resourceService = new ResourceService(db, c.env.UPLOADS);
      const content = await resourceService.getCrawledPageContent(
        c.req.param("pageId"),
        c.req.param("resourceId"),
        project.id,
      );
      if (content === null) return c.json({ error: "Not found" }, 404);
      return c.json({ content });
    },
  )
  .put("/api/projects/:id/resources/:resourceId/pages/:pageId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = validate(updateCrawledPageContentSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const resourceService = new ResourceService(db, c.env.UPLOADS);
    const updated = await resourceService.updateCrawledPageContent(
      c.req.param("pageId"),
      c.req.param("resourceId"),
      project.id,
      parsed.data.content,
    );
    if (!updated) return c.json({ error: "Not found" }, 404);
    c.executionCtx.waitUntil(
      triggerAutoRagSync(c.env, "crawled_page.update"),
    );
    return c.json({ ok: true });
  })
  .delete(
    "/api/projects/:id/resources/:resourceId/pages/:pageId",
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const db = c.get("db");
      const projectService = new ProjectService(db);
      const project = await projectService.getProjectById(c.req.param("id"));
      if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
        return c.json({ error: "Not found" }, 404);
      }

      const resourceService = new ResourceService(db, c.env.UPLOADS);
      const deleted = await resourceService.deleteCrawledPage(
        c.req.param("pageId"),
        c.req.param("resourceId"),
        project.id,
      );
      if (!deleted) return c.json({ error: "Not found" }, 404);
      c.executionCtx.waitUntil(
        triggerAutoRagSync(c.env, "crawled_page.delete"),
      );
      return c.json({ ok: true });
    },
  )
  .post(
    "/api/projects/:id/resources/:resourceId/pages/:pageId/refresh",
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const db = c.get("db");
      const projectService = new ProjectService(db);
      const project = await projectService.getProjectById(c.req.param("id"));
      if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
        return c.json({ error: "Not found" }, 404);
      }

      const resourceService = new ResourceService(db, c.env.UPLOADS);
      c.executionCtx.waitUntil(
        (async () => {
          await resourceService.refreshCrawledPage(
            c.req.param("pageId"),
            c.req.param("resourceId"),
            project.id,
            c.env.CF_ACCOUNT_ID,
            c.env.BROWSER_RENDERING_API_TOKEN,
          );
          await triggerAutoRagSync(c.env, "crawled_page.refresh");
        })(),
      );

      return c.json({ ok: true, message: "Refresh started" });
    },
  )

  // ─── Help Center (Dashboard) ────────────────────────────────────────────────
  .get("/api/projects/:id/help/categories", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    const [categories, counts] = await Promise.all([
      service.listCategories(project.id),
      service.getArticleCountsByCategory(project.id),
    ]);
    const enriched = categories.map((cat) => ({
      ...cat,
      articleCount: counts.get(cat.id) ?? 0,
    }));
    return c.json(enriched);
  })
  .post("/api/projects/:id/help/categories", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createHelpCategorySchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    try {
      const created = await service.createCategory(parsed.data, project.id);
      scheduleHelpPageCachePurge(c.executionCtx, project.id);
      return c.json(created, 201);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create category";
      return c.json({ error: message }, 400);
    }
  })
  .post("/api/projects/:id/help/categories/reorder", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(reorderHelpItemsSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    await service.reorderCategories(project.id, parsed.data.items);
    scheduleHelpPageCachePurge(c.executionCtx, project.id);
    return c.json({ ok: true });
  })
  .patch("/api/projects/:id/help/categories/:catId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateHelpCategorySchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    try {
      const updated = await service.updateCategory(
        c.req.param("catId"),
        project.id,
        parsed.data,
      );
      if (!updated) return c.json({ error: "Not found" }, 404);
      scheduleHelpPageCachePurge(c.executionCtx, project.id);
      return c.json(updated);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update category";
      return c.json({ error: message }, 400);
    }
  })
  .delete("/api/projects/:id/help/categories/:catId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    // Content groups are archived (soft), never hard-deleted.
    const archived = await service.archiveCategory(
      c.req.param("catId"),
      project.id,
    );
    if (!archived) return c.json({ error: "Not found" }, 404);
    scheduleHelpPageCachePurge(c.executionCtx, project.id);
    c.executionCtx.waitUntil(
      triggerAutoRagSync(c.env, "helpdesk.category.archive"),
    );
    return c.json({ ok: true });
  })
  .get("/api/projects/:id/help/articles", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const categoryId = c.req.query("categoryId") ?? undefined;
    const statusParam = c.req.query("status");
    const status =
      statusParam === "draft" || statusParam === "published"
        ? statusParam
        : undefined;

    const service = new HelpdeskService(db, c.env.UPLOADS);
    const [articles, mirrors] = await Promise.all([
      service.listArticles(project.id, { categoryId, status }),
      db
        .select({
          articleId: resourcesTable.sourceArticleId,
          status: resourcesTable.status,
          lastIndexedAt: resourcesTable.lastIndexedAt,
        })
        .from(resourcesTable)
        .where(
          and(
            eq(resourcesTable.projectId, project.id),
            isNotNull(resourcesTable.sourceArticleId),
          ),
        ),
    ]);
    const mirrorByArticle = new Map(mirrors.map((m) => [m.articleId, m]));
    return c.json(
      articles.map((a) => {
        const mirror = mirrorByArticle.get(a.id);
        return {
          ...a,
          indexing: mirror
            ? { status: mirror.status, lastIndexedAt: mirror.lastIndexedAt }
            : null,
        };
      }),
    );
  })
  .post("/api/projects/:id/help/articles/reorder", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const reorderSchema = reorderHelpItemsSchema.extend({
      categoryId: createHelpArticleSchema.shape.categoryId,
    });
    const parsed = validate(reorderSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    await service.reorderArticles(
      project.id,
      parsed.data.categoryId,
      parsed.data.items,
    );
    scheduleHelpPageCachePurge(c.executionCtx, project.id);
    return c.json({ ok: true });
  })
  .post("/api/projects/:id/help/articles/preview", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(previewHelpArticleSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    const widgetService = new WidgetService(db);
    const [widgetConfigRow, settings, categories, allPublished] =
      await Promise.all([
        widgetService.getWidgetConfig(project.id),
        projectService.getSettings(project.id),
        service.listCategories(project.id),
        service.listPublishedArticleNav(project.id),
      ]);

    const now = new Date();
    let category = parsed.data.categoryId
      ? await service.getCategoryById(parsed.data.categoryId, project.id)
      : null;
    if (!category) category = categories[0] ?? null;
    if (!category) {
      category = {
        id: "preview-category",
        projectId: project.id,
        name: "Uncategorized",
        slug: "preview",
        description: null,
        icon: null,
        sortOrder: 0,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    }
    // Ensure the active category is present in the sidebar even when it has no
    // published articles yet (e.g. previewing the first draft in a category).
    const categoriesForRender = categories.some((c) => c.id === category!.id)
      ? categories
      : [...categories, category];

    const title = parsed.data.title.trim() || "Untitled article";
    const content = parsed.data.content;
    const seo = applyHelpArticleSeoDefaults({
      excerpt: parsed.data.excerpt,
      ogImageUrl: parsed.data.ogImageUrl,
      content,
    });
    const article: HelpArticleRow = {
      id: "preview",
      projectId: project.id,
      categoryId: category.id,
      title,
      slug: parsed.data.slug?.trim() || "preview",
      excerpt: seo.excerpt,
      ogImageUrl: seo.ogImageUrl,
      content,
      status: "draft",
      sortOrder: 0,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    // Prev/next mirror the live page: derived from published siblings. When the
    // draft shares a slug with an existing published article, surround it.
    const siblings = allPublished.filter(
      (article) => article.categoryId === category.id,
    );
    const currentIndex = siblings.findIndex((a) => a.slug === article.slug);
    const prevArticle = currentIndex > 0 ? siblings[currentIndex - 1] : null;
    const nextArticle =
      currentIndex >= 0 && currentIndex < siblings.length - 1
        ? siblings[currentIndex + 1]
        : null;

    const { html: bodyHtml, toc } = await renderMarkdown(
      ensureArticleTitle(article.content ?? "", article.title),
      {
        projectSlug: project.slug,
        customUrl: resolveHelpCustomUrl(project.slug, settings?.helpCustomUrl),
      },
    );

    const articlesByCategory = groupArticlesByCategory(allPublished);
    const topNav = parseHelpTopNav(settings?.helpTopNav);

    const html = renderHelpArticle({
      project,
      category,
      categories: categoriesForRender,
      articlesByCategory,
      article,
      bodyHtml,
      toc,
      prevArticle,
      nextArticle,
      widgetConfig: widgetConfigRow,
      helpCustomUrl: resolveHelpCustomUrl(project.slug, settings?.helpCustomUrl),
      topNav,
      customCss: settings?.helpCustomCss ?? null,
      analytics: [],
      themeDefault: sanitizeHelpThemeDefault(settings?.helpThemeDefault),
    });
    return c.html(`<!doctype html>${html.toString()}`, 200, {
      "Cache-Control": "no-store",
    });
  })
  .post("/api/projects/:id/help/articles", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createHelpArticleSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    try {
      const created = await service.createArticle(
        parsed.data,
        project.id,
        project.slug,
      );
      if (created.status === "published") {
        scheduleHelpPageCachePurge(c.executionCtx, project.id);
        c.executionCtx.waitUntil(
          triggerAutoRagSync(c.env, "helpdesk.article.create"),
        );
      }
      return c.json(created, 201);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create article";
      return c.json({ error: message }, 400);
    }
  })
  .get("/api/projects/:id/help/articles/:artId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    const article = await service.getArticleById(
      c.req.param("artId"),
      project.id,
    );
    if (!article) return c.json({ error: "Not found" }, 404);
    return c.json(article);
  })
  .patch("/api/projects/:id/help/articles/:artId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateHelpArticleSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    try {
      const existing = await service.getArticleById(
        c.req.param("artId"),
        project.id,
      );
      const { expectedUpdatedAt, ...rest } = parsed.data;
      const updated = await service.updateArticle(
        c.req.param("artId"),
        project.id,
        {
          ...rest,
          expectedUpdatedAt: expectedUpdatedAt
            ? new Date(expectedUpdatedAt)
            : undefined,
        },
        project.slug,
      );
      if (!updated) return c.json({ error: "Not found" }, 404);
      if (
        publicHelpHtmlChanged({
          beforeStatus: existing?.status,
          afterStatus: updated.status,
        })
      ) {
        scheduleHelpPageCachePurge(c.executionCtx, project.id);
      }
      c.executionCtx.waitUntil(
        triggerAutoRagSync(c.env, "helpdesk.article.update"),
      );
      return c.json(updated);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message =
        err instanceof Error ? err.message : "Failed to update article";
      if (code === "slug_conflict" || code === "stale_article") {
        return c.json({ error: message, code }, 409);
      }
      return c.json({ error: message }, 400);
    }
  })
  .delete("/api/projects/:id/help/articles/:artId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    const deleted = await service.deleteArticle(
      c.req.param("artId"),
      project.id,
    );
    if (!deleted) return c.json({ error: "Not found" }, 404);
    if (deleted.status === "published") {
      scheduleHelpPageCachePurge(c.executionCtx, project.id);
    }
    c.executionCtx.waitUntil(
      triggerAutoRagSync(c.env, "helpdesk.article.delete"),
    );
    return c.json({ ok: true });
  })
  .post("/api/projects/:id/help/articles/:artId/publish", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    const updated = await service.updateArticle(
      c.req.param("artId"),
      project.id,
      { status: "published" },
      project.slug,
    );
    if (!updated) return c.json({ error: "Not found" }, 404);
    scheduleHelpPageCachePurge(c.executionCtx, project.id);
    c.executionCtx.waitUntil(
      triggerAutoRagSync(c.env, "helpdesk.article.publish"),
    );
    return c.json(updated);
  })
  .post("/api/projects/:id/help/articles/:artId/unpublish", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new HelpdeskService(db, c.env.UPLOADS);
    const updated = await service.updateArticle(
      c.req.param("artId"),
      project.id,
      { status: "draft" },
      project.slug,
    );
    if (!updated) return c.json({ error: "Not found" }, 404);
    scheduleHelpPageCachePurge(c.executionCtx, project.id);
    c.executionCtx.waitUntil(
      triggerAutoRagSync(c.env, "helpdesk.article.unpublish"),
    );
    return c.json(updated);
  })
  .post("/api/projects/:id/help/test-proxy", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    if (!checkRateLimit(`help-proxy:${user.id}`, 10, 60_000)) {
      return c.json({ error: "Too many requests" }, 429);
    }

    const body = await c.req.json();
    const parsed = validate(helpTestProxySchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const candidateUrl = normalizeHelpCustomUrl(parsed.data.customUrl);
    try {
      const response = await fetch(candidateUrl, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "ReplyMaven-HelpProxyTest/1.0" },
        signal: AbortSignal.timeout(5_000),
      });
      const text = await readBodyCapped(response, 16_384);
      const expectedMarker = `<meta name="replymaven:help" content="${project.slug}">`;
      const altMarker = `<meta content="${project.slug}" name="replymaven:help">`;
      if (text.includes(expectedMarker) || text.includes(altMarker)) {
        return c.json({ ok: true, status: response.status });
      }
      const snippet = text
        .slice(0, 300)
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1F\x7F-\xFF]/g, "");
      return c.json({
        ok: false,
        status: response.status,
        snippet,
        error:
          "Marker not found. Make sure your reverse proxy forwards the request to https://replymaven.com/help/" +
          project.slug +
          " with header X-ReplyMaven-Help-Proxy: 1 and returns the response body unchanged.",
      });
    } catch (err) {
      const isAbort =
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError");
      return c.json({
        ok: false,
        status: 0,
        error: isAbort
          ? "Timed out"
          : err instanceof Error
            ? err.message
            : "Failed to reach the proxied URL",
      });
    }
  })

  // ─── Conversations (Dashboard) ──────────────────────────────────────────────
  .get("/api/projects/:id/conversations", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const statusFilter =
      (c.req.query("status") as "open" | "closed" | "all") ?? "all";
    const inboxFilter = parsePublicInboxFilter(c.req.query("filter"));
    const limit = Math.min(
      parseInt(c.req.query("limit") ?? "25", 10) || 25,
      100,
    );
    const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
    const searchQuery = c.req.query("q")?.trim() || undefined;
    const agentStore = new AgentPublicConversationStore({ db, env: c.env });
    const requestedSort = c.req.query("sort");
    const sort = requestedSort === "oldest" ||
        requestedSort === "priority" || requestedSort === "botMessages"
      ? requestedSort
      : "newest";
    const page = await agentStore.getDashboardConversationPage(project.id, {
      filter: inboxFilter,
      status: inboxFilter ? undefined : statusFilter,
      sort,
      search: searchQuery,
      cursor: c.req.query("cursor") || undefined,
      offset,
      limit,
    });
    return c.json({
      conversations: page.conversations.map(({ conversation, lastMessage }) => ({
        ...toLegacyConversationDto(conversation),
        lastMessage: lastMessage
          ? toLegacyLastMessagePreviewDto(lastMessage)
          : null,
      })),
      counts: page.counts,
      hasMore: page.nextCursor !== null,
      nextCursor: page.nextCursor,
      serverTime: Date.now(),
    });
  })
  .get("/api/projects/:id/needs-review-updates", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }
    const since = parseInt(c.req.query("since") ?? "0", 10) || 0;
    const rows = await createPublicConversationStore({ db, env: c.env }).getNeedsReviewSince(project.id, since);
    const items = rows.map((row) => {
      let meta: Record<string, unknown> = {};
      try {
        const parsed = row.metadata;
        meta = typeof parsed === "object" && parsed !== null ? parsed : {};
      } catch { /* ignore */ }
      return {
        id: row.id,
        visitorName: row.visitorName,
        visitorEmail: row.visitorEmail,
        summary: typeof meta.teamRequestSummary === "string" ? meta.teamRequestSummary : null,
        summaryMessageId:
          typeof meta.reviewSummaryMessageId === "string" ? meta.reviewSummaryMessageId : null,
        updatedAt: row.updatedAt,
      };
    });
    return c.json({ serverTime: Date.now(), items });
  })
  .get("/api/projects/:id/conversations/:convId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    // Wave 1: conversation row + settings in parallel.
    const chatService = createPublicConversationStore({ db, env: c.env });
    const [conversation, settings] = await Promise.all([
      chatService.getConversationById(c.req.param("convId"), project.id),
      projectService.getSettings(project.id),
    ]);
    if (!conversation) {
      return c.json({ error: "Not found" }, 404);
    }

    // Defer the stale-close check off the hot path. The user reads the live
    // conversation immediately; the WS broadcast pushes the closed status
    // moments later if it flips.
    if (
      !conversation.archivedAt &&
      conversation.status !== "closed" &&
      settings?.autoCloseMinutes &&
      isConversationStale(conversation, settings.autoCloseMinutes)
    ) {
      c.executionCtx.waitUntil(
        (async () => {
          try {
            await chatService.updateConversationStatus(
              conversation.id,
              project.id,
              "closed",
              "ended",
            );
          } catch {
            // best-effort
          }
        })(),
      );
    }

    // Wave 2: paginated messages + ban status, in parallel.
    const toolService = new ToolService(db);
    const banService = new VisitorBanService(db);
    const [{ messages: msgs, hasMore }, ban] = await Promise.all([
      chatService.getRecentMessages(project.id, conversation.id, 25),
      banService.isVisitorBanned(
        project.id,
        conversation.visitorId,
        conversation.visitorEmail,
      ),
    ]);

    // Wave 3: tool executions only for messages we're returning.
    const toolExecs = await toolService.getExecutionsByMessageIds(
      msgs.map((m) => m.id),
    );

    // Group tool executions by messageId and attach to corresponding messages
    const execsByMessageId = new Map<string, typeof toolExecs>();
    for (const exec of toolExecs) {
      const key = exec.messageId ?? "__unlinked__";
      const arr = execsByMessageId.get(key) ?? [];
      arr.push(exec);
      execsByMessageId.set(key, arr);
    }

    const messagesWithTools = msgs.map((msg) => ({
      ...toLegacyMessageDto(msg),
      toolExecutions:
        execsByMessageId.get(msg.id)?.map((ex) => ({
          id: ex.id,
          toolName: ex.toolName,
          displayName: ex.displayName,
          method: ex.method,
          input: ex.input ? JSON.parse(ex.input) : null,
          output: ex.output ? JSON.parse(ex.output) : null,
          status: ex.status,
          httpStatus: ex.httpStatus,
          duration: ex.duration,
          errorMessage: ex.errorMessage,
          createdAt: ex.createdAt,
        })) ?? [],
    }));

    return c.json({
      conversation: {
        ...toLegacyConversationDto(conversation),
        visitorBlocked: !!ban,
      },
      messages: messagesWithTools,
      hasMore,
      botName: settings?.botName ?? null,
      agentName: settings?.agentName ?? null,
    });
  })
  .get("/api/projects/:id/conversations/:convId/messages", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const beforeParam = c.req.query("before");
    const limit = Math.min(
      parseInt(c.req.query("limit") ?? "30", 10) || 30,
      100,
    );
    const before = beforeParam ? new Date(beforeParam) : null;
    if (!before || isNaN(before.getTime())) {
      return c.json({ error: "before query param is required (ISO date)" }, 400);
    }

    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.getConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) return c.json({ error: "Not found" }, 404);

    const { messages: msgs, hasMore } = await chatService.getMessagesBefore({
      projectId: project.id,
      conversationId: conversation.id,
      beforeCreatedAt: before.getTime(),
      limit,
    });

    const toolService = new ToolService(db);
    const toolExecs = await toolService.getExecutionsByMessageIds(
      msgs.map((m) => m.id),
    );
    const execsByMessageId = new Map<string, typeof toolExecs>();
    for (const exec of toolExecs) {
      const key = exec.messageId ?? "__unlinked__";
      const arr = execsByMessageId.get(key) ?? [];
      arr.push(exec);
      execsByMessageId.set(key, arr);
    }

    const messagesWithTools = msgs.map((msg) => ({
      ...toLegacyMessageDto(msg),
      toolExecutions:
        execsByMessageId.get(msg.id)?.map((ex) => ({
          id: ex.id,
          toolName: ex.toolName,
          displayName: ex.displayName,
          method: ex.method,
          input: ex.input ? JSON.parse(ex.input) : null,
          output: ex.output ? JSON.parse(ex.output) : null,
          status: ex.status,
          httpStatus: ex.httpStatus,
          duration: ex.duration,
          errorMessage: ex.errorMessage,
          createdAt: ex.createdAt,
        })) ?? [],
    }));

    return c.json({ messages: messagesWithTools, hasMore });
  })
  .post("/api/projects/:id/conversations/:convId/reply", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(agentReplySchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.getOperationalConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Not found" }, 404);
    }

    const replyImageUrls = parsed.data.imageUrls?.length
      ? parsed.data.imageUrls
      : parsed.data.imageUrl
        ? [parsed.data.imageUrl]
        : [];
    if (replyImageUrls.some((imageUrl) => !isConversationUploadUrl(
      imageUrl,
      project.id,
      conversation.id,
    ))) {
      return c.json({ error: "Invalid image URL" }, 400);
    }

    // Fetch full user profile for sender info
    const userProfile = await db
      .select({
        profilePicture: users.profilePicture,
        image: users.image,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const avatar =
      userProfile[0]?.profilePicture ?? userProfile[0]?.image ?? null;

    // Reopen closed conversations before adding the message
    const replyContent = parsed.data.content?.trim() ?? "";
    if (replyContent && replyImageUrls.length === 0) {
      const projectSettings = await projectService.getSettings(project.id);
      const command = await executeChannelBotNameCommand({
        text: replyContent,
        botName: projectSettings?.botName,
        actorName: user.name,
        commandId: `dashboard:${project.id}:${user.id}:${
          c.req.header("idempotency-key") ?? crypto.randomUUID()
        }`,
        now: Date.now(),
        projectId: project.id,
        conversation: {
          id: conversation.id,
          visitorId: conversation.visitorId,
          visitorEmail: conversation.visitorEmail,
          metadata: conversation.metadata,
        },
        chatService,
        db,
        env: c.env,
        projectSettings,
        projectName: project.name,
        actorUserId: user.id,
        origin: "dashboard",
      });
      if (command.handled) {
        return c.json({
          ok: true,
          command: true,
          confirmation: command.confirmation,
        });
      }
    }

    if (conversation.status === "closed") {
      await chatService.reopenConversation(conversation.id, project.id);
    }

    const replyIds = dashboardReplyIdentity({
      projectId: project.id,
      conversationId: conversation.id,
      userId: user.id,
      requestId: c.req.header("idempotency-key"),
    });
    const message = await chatService.appendHuman({
      projectId: project.id,
      conversationId: conversation.id,
      content:
        parsed.data.content?.trim() ||
        (replyImageUrls.length > 1
          ? "Sent images"
          : replyImageUrls.length
            ? "Sent an image"
            : ""),
      imageUrls: replyImageUrls,
      userId: user.id,
      senderName: user.name,
      senderAvatar: avatar,
      id: replyIds.id,
      idempotencyKey: replyIds.idempotencyKey,
      origin: "dashboard",
    }).catch(() => null);
    if (!message) return c.json({ error: "Conversation not found" }, 404);

    return c.json(toLegacyMessageDto(message), 201);
  })
  .post("/api/projects/:id/conversations/:convId/send-email", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(sendMessageAsEmailSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.getOperationalConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    if (!conversation.visitorEmail) {
      return c.json({ error: "No visitor email address" }, 400);
    }

    const message = await chatService.getMessage(
      project.id,
      conversation.id,
      parsed.data.messageId,
    );
    if (!message || message.conversationId !== conversation.id) {
      return c.json({ error: "Message not found" }, 404);
    }

    if (message.author !== "agent" && message.author !== "bot") {
      return c.json({ error: "Only agent or bot messages can be emailed" }, 400);
    }

    if (message.emailedAt) {
      return c.json({ error: "Message already emailed" }, 400);
    }

    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    if (!checkRateLimit(`email:${ip}`, 20, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const widgetService = new WidgetService(db);
    const widgetCfg = await widgetService.getWidgetConfig(project.id);

    const emailService = new EmailService(c.env.RESEND_API_KEY);
    try {
      const delivery = await runWithConversationExternalAction(
        chatService,
        project.id,
        conversation.id,
        async () => {
          await emailService.sendAgentMessageEmail({
            to: conversation.visitorEmail!,
            projectSlug: project.slug,
            projectName: project.name,
            conversationId: conversation.id,
            messageId: message.id,
            agentName: message.senderName ?? user.name ?? "Support",
            agentAvatar: message.senderAvatar ?? null,
            messageContent: message.content,
            imageUrls: message.imageUrls,
            dashboardUrl: `https://replymaven.com/app/projects/${project.id}/conversations/${conversation.id}`,
            accentColor: widgetCfg?.primaryColor ?? null,
          });
          await chatService.markEmailed({
            projectId: project.id,
            conversationId: conversation.id,
            messageId: message.id,
          });
        },
      );
      if (!delivery.executed) {
        return c.json({ error: "Conversation changed. Try again." }, 409);
      }
    } catch (err) {
      // Leave emailedAt unset so the message can be re-sent after a failure.
      console.error("[SendAsEmail] Send failed:", err);
      return c.json({ error: "Failed to send email" }, 500);
    }

    return c.json({ ok: true, emailedAt: new Date().toISOString() });
  })
  // ─── Delete an agent message ──────────────────────────────────────────────
  .delete(
    "/api/projects/:id/conversations/:convId/messages/:messageId",
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const db = c.get("db");
      const projectService = new ProjectService(db);
      const project = await projectService.getProjectById(c.req.param("id"));
      if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
        return c.json({ error: "Not found" }, 404);
      }

      const convId = c.req.param("convId");
      const messageId = c.req.param("messageId");

      const chatService = createPublicConversationStore({ db, env: c.env });
      const conversation = await chatService.getOperationalConversationById(
        convId,
        project.id,
      );
      if (!conversation) return c.json({ error: "Not found" }, 404);

      const result = await chatService.deleteHumanMessage(
        project.id,
        convId,
        messageId,
      );
      if (!result.deleted) {
        if (result.reason === "not_agent") {
          return c.json(
            { error: "Only agent messages can be deleted" },
            400,
          );
        }
        if (result.reason === "not_found") {
          // Idempotent: already deleted (likely by a teammate). Don't flip
          // the optimistic UI back, and don't re-broadcast.
          return c.json({ ok: true, alreadyDeleted: true });
        }
        return c.json({ error: "Not found" }, 404);
      }

      return c.json({ ok: true });
    },
  )
  .post("/api/projects/:id/conversations/bulk", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const parsed = validate(bulkConversationActionSchema, await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    if (parsed.data.action === "assign") {
      const assignable = await getAssignableUsers(db, project.id);
      if (!isAllowedAssignee(parsed.data.assigneeId, assignable)) {
        return c.json(
          { error: "Assignee is not a member of this project's team" },
          400,
        );
      }
    }

    const chatService = createPublicConversationStore({ db, env: c.env });
    const actionAt = new Date();
    const result = await chatService.bulkUpdateConversations(
      project.id,
      parsed.data.conversationIds,
      parsed.data,
      actionAt,
    );

    if (parsed.data.action === "archive") {
      for (const conversationId of result.updatedIds) {
        try {
          const parent = await getAgentByName(
            c.env.MAVEN_PROJECT_AGENT,
            project.id,
          );
          await parent.enforceSidechatArchive(conversationId);
        } catch {
          console.error("Native Sidechat archive enforcement failed");
        }
      }
    }

    if (
      parsed.data.action === "assign" &&
      isMavenAssignee(parsed.data.assigneeId)
    ) {
      const settings = await projectService.getSettings(project.id);
      await Promise.all(result.updatedIds.map(async (conversationId) => {
        const target = await chatService.getOperationalConversationById(
          conversationId,
          project.id,
        );
        if (target && canHandConversationToMaven(target)) {
          await chatService.transitionOwnership({
            projectId: project.id,
            conversationId,
            event: "ai_handed_back",
          });
        }
        await recordMavenAssignment({
          chatService,
          conversationId,
          projectId: project.id,
          botName: settings?.botName,
          actorName: user.name,
          reason: "manual",
        });
      }));
    }

    if (parsed.data.action === "snooze") {
      const until = parsed.data.until ? new Date(parsed.data.until) : null;
      const content = until
        ? `Snoozed until ${until.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}`
        : "Snooze ended";
      await Promise.all(result.updatedIds.map((conversationId) =>
        chatService.addPublicSystemMessage(
          conversationId,
          until ? "snoozed" : "snooze_ended",
          content,
          undefined,
          project.id,
        )
      ));
    }

    return c.json(result);
  })
  .post("/api/projects/:id/conversations/:convId/close", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.getOperationalConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Not found" }, 404);
    }

    // Parse optional close reason from body
    let closeReason: "resolved" | "ended" | "spam" | undefined;
    try {
      const body = await c.req.json();
      if (
        body.closeReason &&
        ["resolved", "ended", "spam"].includes(body.closeReason)
      ) {
        closeReason = body.closeReason;
      }
    } catch {
      // No body or invalid JSON is fine — defaults to no reason
    }

    // Close the conversation
    await chatService.updateConversationStatus(
      conversation.id,
      project.id,
      "closed",
      closeReason,
    );

    return c.json({ ok: true });
  })
  .post("/api/projects/:id/conversations/:convId/reopen", async (c) => {
    // Un-resolve / un-flag: bring a closed conversation back to active.
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id))
      return c.json({ error: "Not found" }, 404);
    const chatService = createPublicConversationStore({ db, env: c.env });
    const reopened = await chatService.reopenConversation(
      c.req.param("convId"),
      project.id,
    );
    if (!reopened) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  })
  .post("/api/projects/:id/conversations/:convId/unblock", async (c) => {
    // Toggle-off for the Block button: lift the active ban on this
    // conversation's visitor. We don't have the ban id on the client (the
    // detail endpoint only exposes a boolean), so resolve it here from the
    // conversation's visitor identifiers. Idempotent — no ban is a no-op.
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id))
      return c.json({ error: "Not found" }, 404);
    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.getOperationalConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) return c.json({ error: "Not found" }, 404);
    const banService = new VisitorBanService(db);
    const ban = await banService.isVisitorBanned(
      project.id,
      conversation.visitorId,
      conversation.visitorEmail,
    );
    if (ban) await banService.unbanVisitor(ban.id, project.id);
    return c.json({ ok: true });
  })
  .post("/api/projects/:id/conversations/:convId/snooze", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id))
      return c.json({ error: "Not found" }, 404);
    const parsed = validate(snoozeSchema, await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error }, 400);
    const chatService = createPublicConversationStore({ db, env: c.env });
    const convId = c.req.param("convId");
    const conversation = await chatService.getOperationalConversationById(
      convId,
      project.id,
    );
    if (!conversation) return c.json({ error: "Not found" }, 404);
    const until = parsed.data.until ? new Date(parsed.data.until) : null;
    await chatService.setSnooze(convId, project.id, until);
    if (until) {
      await chatService.addPublicSystemMessage(convId, "snoozed",
        `Snoozed until ${until.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
        undefined,
        project.id);
    } else {
      await chatService.addPublicSystemMessage(
        convId,
        "snooze_ended",
        "Snooze ended",
        undefined,
        project.id,
      );
    }
    return c.json({ ok: true });
  })
  .patch("/api/projects/:id/conversations/:convId/priority", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id))
      return c.json({ error: "Not found" }, 404);
    const parsed = validate(prioritySchema, await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error }, 400);
    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.getOperationalConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) return c.json({ error: "Not found" }, 404);
    await chatService.setPriority(conversation.id, project.id, parsed.data.priority);
    return c.json({ ok: true });
  })
  .patch("/api/projects/:id/conversations/:convId/assign", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id))
      return c.json({ error: "Not found" }, 404);
    const parsed = validate(assignSchema, await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error }, 400);
    const chatService = createPublicConversationStore({ db, env: c.env });
    const conversation = await chatService.getOperationalConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) return c.json({ error: "Not found" }, 404);

    const assignable = await getAssignableUsers(db, project.id);
    if (!isAllowedAssignee(parsed.data.assigneeId, assignable)) {
      return c.json(
        { error: "Assignee is not a member of this project's team" },
        400,
      );
    }

    if (isMavenAssignee(parsed.data.assigneeId)) {
      if (isMavenAssignee(conversation.assigneeId)) {
        return c.json({ ok: true });
      }
      if (canHandConversationToMaven(conversation)) {
        await chatService.transitionOwnership({
          projectId: project.id,
          conversationId: conversation.id,
          event: "ai_handed_back",
        });
      }
      const settings = await projectService.getSettings(project.id);
      await recordMavenAssignment({
        chatService,
        conversationId: conversation.id,
        projectId: project.id,
        botName: settings?.botName,
        actorName: user.name,
        reason: "manual",
      });
      return c.json({ ok: true });
    }

    await chatService.setAssignee(
      conversation.id,
      project.id,
      parsed.data.assigneeId,
    );
    return c.json({ ok: true });
  })
  .get("/api/projects/:id/inbox-counts", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id))
      return c.json({ error: "Not found" }, 404);
    return c.json(await createPublicConversationStore({ db, env: c.env }).getInboxCounts(project.id));
  })

  // ─── Visitor Bans ──────────────────────────────────────────────────────────
  .post("/api/projects/:id/visitors/ban", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = validate(banVisitorSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const chatService = createPublicConversationStore({ db, env: c.env });
    if (parsed.data.conversationId) {
      const conversation = await chatService.getOperationalConversationById(
        parsed.data.conversationId,
        project.id,
      );
      if (!conversation) return c.json({ error: "Not found" }, 404);
    }

    const banService = new VisitorBanService(db);
    const existing = await banService.isVisitorBanned(
      project.id,
      parsed.data.visitorId,
      parsed.data.visitorEmail,
    );
    if (existing) {
      return c.json({ error: "Visitor is already banned" }, 409);
    }

    // Close the named conversation as spam (even if it was already closed —
    // the Flagged tab is where a blocked visitor's thread belongs), then sweep
    // ALL of the visitor's other open conversations too: the ban 403s the
    // visitor, so any leftovers would sit in Needs You forever.
    const closedIds = new Set<string>();
    if (parsed.data.conversationId) {
      await chatService.updateConversationStatus(
        parsed.data.conversationId,
        project.id,
        "closed",
        "spam",
      );
      closedIds.add(parsed.data.conversationId);
    }
    const sweptIds = await chatService.closeOpenConversationsAsSpam(
      project.id,
      parsed.data.visitorId,
      parsed.data.visitorEmail ?? null,
    );
    for (const id of sweptIds) closedIds.add(id);

    const ban = await banService.banVisitor({
      projectId: project.id,
      visitorId: parsed.data.visitorId,
      visitorEmail: parsed.data.visitorEmail ?? null,
      reason: parsed.data.reason ?? null,
      bannedBy: "dashboard",
      bannedFromConversationId: parsed.data.conversationId ?? null,
      expiresAt: parsed.data.expiresAt
        ? new Date(parsed.data.expiresAt)
        : null,
    });

    return c.json(ban, 201);
  })
  .get("/api/projects/:id/visitors/banned", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const limit = Math.min(
      parseInt(c.req.query("limit") ?? "50", 10) || 50,
      100,
    );
    const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;

    const banService = new VisitorBanService(db);
    const bans = await banService.getBannedVisitors(project.id, limit, offset);
    const total = await banService.getBanCount(project.id);

    return c.json({ bans, total });
  })
  .delete("/api/projects/:id/visitors/ban/:banId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const banService = new VisitorBanService(db);
    const deleted = await banService.unbanVisitor(
      c.req.param("banId"),
      project.id,
    );
    if (!deleted) return c.json({ error: "Ban not found" }, 404);

    return c.json({ ok: true });
  })

  // ─── Guidelines (SOPs) ──────────────────────────────────────────────────────
  .get("/api/projects/:id/guidelines", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new GuidelineService(db);
    const guidelines = await service.getByProject(project.id);
    return c.json(guidelines);
  })
  .post("/api/projects/:id/guidelines", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createGuidelineSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new GuidelineService(db);

    // Enforce limit of 50 guidelines per project
    const count = await service.countByProject(project.id);
    if (count >= 50) {
      return c.json(
        {
          error:
            "Maximum 50 guidelines per project. Delete an existing one first.",
        },
        400,
      );
    }

    const guideline = await service.create({
      projectId: project.id,
      condition: parsed.data.condition,
      instruction: parsed.data.instruction,
      enabled: parsed.data.enabled ?? true,
    });

    return c.json(guideline, 201);
  })
  .patch("/api/projects/:id/guidelines/:gId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateGuidelineSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new GuidelineService(db);
    const updated = await service.update(
      c.req.param("gId"),
      project.id,
      parsed.data,
    );
    if (!updated) return c.json({ error: "Not found" }, 404);

    return c.json(updated);
  })
  .delete("/api/projects/:id/guidelines/:gId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new GuidelineService(db);
    const deleted = await service.delete(c.req.param("gId"), project.id);
    if (!deleted) return c.json({ error: "Not found" }, 404);

    return c.json({ ok: true });
  })

  // ─── Telegram Config ───────────────────────────────────────────────────────
  .get("/api/projects/:id/telegram", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const settings = await projectService.getSettings(project.id);
    return c.json({
      telegramBotToken: settings?.telegramBotToken ? "••••••••" : null,
      telegramChatId: settings?.telegramChatId ?? null,
    });
  })
  .put("/api/projects/:id/telegram", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // Feature gate: telegram
    const planLimits = c.get("planLimits");
    if (planLimits && !planLimits.telegram) {
      return c.json(
        {
          error: "Telegram integration is available on Pro and Business plans.",
          code: "feature_not_available",
        },
        403,
      );
    }

    const body = await c.req.json();
    const parsed = validate(updateTelegramSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const storedBotToken = parsed.data.telegramBotToken
      ? await encryptTelegramToken(
        parsed.data.telegramBotToken,
        c.env.ENCRYPTION_KEY,
      )
      : undefined;
    await projectService.updateSettings(project.id, {
      ...parsed.data,
      ...(storedBotToken ? { telegramBotToken: storedBotToken } : {}),
    });

    // Registering the webhook is also what arms the secret Telegram echoes on
    // every update, so a new token is trusted from its first message.
    if (storedBotToken) {
      const telegramService = new TelegramService(db, c.env.ENCRYPTION_KEY);
      const webhookUrl = `${c.env.BETTER_AUTH_URL}/api/telegram/webhook/${project.id}`;
      await telegramService.setWebhook(
        storedBotToken,
        webhookUrl,
        await deriveTelegramWebhookSecret(project.id, c.env.ENCRYPTION_KEY),
      );
    }

    return c.json({ ok: true });
  })
  .post("/api/projects/:id/telegram/test", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const settings = await projectService.getSettings(project.id);
    if (!settings?.telegramBotToken || !settings?.telegramChatId) {
      return c.json({ error: "Telegram not configured" }, 400);
    }

    const telegramService = new TelegramService(db, c.env.ENCRYPTION_KEY);
    const success = await telegramService.testConnection(
      settings.telegramBotToken,
      settings.telegramChatId,
    );

    return c.json({ ok: success });
  })

  .get("/api/projects/:id/slack", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const settings = await projectService.getSettings(project.id);
    return c.json({
      slackBotToken: settings?.slackBotToken ? "••••••••" : null,
      slackSigningSecret: settings?.slackSigningSecret ? "••••••••" : null,
      slackChannelId: settings?.slackChannelId ?? null,
    });
  })
  .put("/api/projects/:id/slack", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const planLimits = c.get("planLimits");
    if (planLimits && !planLimits.slack) {
      return c.json(
        {
          error: "Slack integration is available on Pro and Business plans.",
          code: "feature_not_available",
        },
        403,
      );
    }

    const body = await c.req.json();
    const parsed = validate(updateSlackSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const storedBotToken = parsed.data.slackBotToken
      ? await encryptSlackSecret(parsed.data.slackBotToken, c.env.ENCRYPTION_KEY)
      : undefined;
    const storedSigningSecret = parsed.data.slackSigningSecret
      ? await encryptSlackSecret(
          parsed.data.slackSigningSecret,
          c.env.ENCRYPTION_KEY,
        )
      : undefined;
    await projectService.updateSettings(project.id, {
      ...parsed.data,
      ...(storedBotToken ? { slackBotToken: storedBotToken } : {}),
      ...(storedSigningSecret
        ? { slackSigningSecret: storedSigningSecret }
        : {}),
    });

    return c.json({ ok: true });
  })
  .post("/api/projects/:id/slack/test", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const settings = await projectService.getSettings(project.id);
    if (!settings?.slackBotToken || !settings.slackChannelId) {
      return c.json({ error: "Slack not configured" }, 400);
    }

    const slackService = new SlackService(db, c.env.ENCRYPTION_KEY);
    const success = await slackService.testConnection(
      settings.slackBotToken,
      settings.slackChannelId,
    );

    return c.json({ ok: success });
  })

  // ─── Widget Bundle Upload to R2 ─────────────────────────────────────────────
  .post("/api/admin/upload-widget", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const formData = await c.req.parseBody();
    const file = formData["file"];
    if (!file || typeof file === "string") {
      return c.json({ error: "No file provided" }, 400);
    }

    const fileObj = file as File;
    if (!fileObj.name.endsWith(".js")) {
      return c.json({ error: "Only .js files allowed" }, 400);
    }

    const buffer = await fileObj.arrayBuffer();
    await c.env.WIDGET_BUCKET.put("widget-embed.js", buffer, {
      httpMetadata: { contentType: "application/javascript" },
    });

    return c.json({
      ok: true,
      message: "Widget bundle uploaded successfully",
      size: fileObj.size,
    });
  })

  // ─── File Upload ────────────────────────────────────────────────────────────
  .post("/api/upload", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const formData = await c.req.parseBody();
    const file = formData["file"];
    if (!file || typeof file === "string") {
      return c.json({ error: "No file provided" }, 400);
    }

    const fileObj = file as File;

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/svg+xml",
    ];
    if (!allowedTypes.includes(fileObj.type)) {
      return c.json({ error: "Invalid file type" }, 400);
    }

    // Max 10MB
    if (fileObj.size > 10 * 1024 * 1024) {
      return c.json({ error: "File too large (max 10MB)" }, 400);
    }

    const ext = uploadExtensionFor(fileObj.type, fileObj.name);
    const requestedProjectId = formData["projectId"];
    const requestedConversationId = formData["conversationId"];
    let uploadKey: string;
    let customMetadata: Record<string, string>;
    if (
      typeof requestedProjectId === "string" &&
      requestedProjectId &&
      typeof requestedConversationId === "string" &&
      requestedConversationId
    ) {
      const db = c.get("db");
      const projectService = new ProjectService(db);
      const project = await projectService.getProjectById(requestedProjectId);
      if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
        return c.json({ error: "Not found" }, 404);
      }
      const chatService = createPublicConversationStore({ db, env: c.env });
      const conversation = await chatService.getOperationalConversationById(
        requestedConversationId,
        project.id,
      );
      if (!conversation) return c.json({ error: "Not found" }, 404);

      uploadKey = `${project.id}/conversation-attachments/${conversation.id}/${crypto.randomUUID()}.${ext}`;
      customMetadata = {
        ownerType: "conversation",
        ownerId: conversation.id,
        projectId: project.id,
      };
    } else if (
      requestedProjectId !== undefined ||
      requestedConversationId !== undefined
    ) {
      return c.json({ error: "Project and conversation are required" }, 400);
    } else {
      uploadKey = `${user.id}/${crypto.randomUUID()}.${ext}`;
      customMetadata = { ownerType: "user", ownerId: user.id };
    }
    const buffer = await fileObj.arrayBuffer();

    await c.env.UPLOADS.put(uploadKey, buffer, {
      httpMetadata: { contentType: fileObj.type },
      customMetadata,
    });

    return c.json({ key: uploadKey, url: publicUploadUrl(uploadKey) }, 201);
  })

  // ─── Serve Uploads ──────────────────────────────────────────────────────────
  .get("/api/uploads/:key{.+}", async (c) => {
    const key = c.req.param("key");
    const obj = await c.env.UPLOADS.get(key);
    if (!obj) return c.json({ error: "Not found" }, 404);

    const headers = new Headers();
    headers.set(
      "Content-Type",
      obj.httpMetadata?.contentType ?? "application/octet-stream",
    );
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
    return new Response(obj.body, { headers });
  });

// ─── Queue Consumer ───────────────────────────────────────────────────────────

// After this many delivery attempts a page is marked failed instead of
// retried, so a flaky page can never leave the resource stuck in "crawling".
const MAX_CRAWL_ATTEMPTS = 3;

async function handleQueue(
  batch: MessageBatch<CrawlMessage>,
  env: AppEnv,
): Promise<void> {
  const db = drizzle(env.DB);

  for (const message of batch.messages) {
    const crawlService = new CrawlService(
      db,
      env.UPLOADS,
      env.CF_ACCOUNT_ID,
      env.BROWSER_RENDERING_API_TOKEN,
    );

    try {
      await crawlService.processUrl(message.body, env.CRAWL_QUEUE);
      message.ack();
    } catch (err) {
      console.error(
        `Queue message processing failed for ${message.body.url} (attempt ${message.attempts}):`,
        err,
      );

      if (message.attempts >= MAX_CRAWL_ATTEMPTS) {
        // Out of retries — fail the page and finalize the resource rather
        // than dropping the message and leaving the page "pending" forever.
        try {
          await crawlService.failPage(message.body);
        } catch (failErr) {
          console.error(
            `Failed to finalize page ${message.body.url} after retries:`,
            failErr,
          );
        }
        message.ack();
      } else {
        // Back off so rate-limited Browser Rendering calls aren't hammered
        message.retry({ delaySeconds: 20 * message.attempts });
      }
    }
  }
}

// ─── Scheduled Retention ─────────────────────────────────────────────────────

async function runArchivedConversationRetention(env: AppEnv): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();
  const batchSize = 50;
  const maxBatches = 10;
  let claimed = 0;
  let deleted = 0;
  let failed = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await purgeExpiredArchivedConversations(
      createPublicConversationStore({ db, env }),
      env.UPLOADS,
      now,
      batchSize,
    );
    claimed += result.claimed;
    deleted += result.deleted;
    failed += result.failed;
    if (result.claimed < batchSize) break;
  }

  console.log("Archived conversation retention completed", {
    claimed,
    deleted,
    failed,
  });
}

async function runTelegramSecretMigration(env: AppEnv): Promise<void> {
  const db = drizzle(env.DB);
  const telegramService = new TelegramService(db, env.ENCRYPTION_KEY);
  const result = await migrateTelegramSecrets({
    encryptionKey: env.ENCRYPTION_KEY,
    listProjects: async () =>
      db
        .select({
          projectId: projectSettingsTable.projectId,
          telegramBotToken: projectSettingsTable.telegramBotToken,
        })
        .from(projectSettingsTable),
    storeToken: async (projectId, encrypted) => {
      await db
        .update(projectSettingsTable)
        .set({ telegramBotToken: encrypted })
        .where(eq(projectSettingsTable.projectId, projectId));
    },
    registerWebhook: ({ projectId, storedBotToken, secret }) =>
      telegramService.setWebhook(
        storedBotToken,
        `${env.BETTER_AUTH_URL}/api/telegram/webhook/${projectId}`,
        secret,
      ),
    onFailure: (projectId, error) => {
      logError("telegram.secret_migration_failed", error, { projectId });
    },
  });
  console.log("Telegram secret migration completed", result);
}

function handleScheduled(
  _controller: ScheduledController,
  env: AppEnv,
  ctx: ExecutionContext,
): void {
  ctx.waitUntil(runArchivedConversationRetention(env));
  ctx.waitUntil(runTelegramSecretMigration(env));
}

// ─── Own docs re-dispatch ───────────────────────────────────────────────────
const OWN_DOCS_HELP_PREFIX = "/help/replymaven";

function serveOwnDocs(c: Context<HonoAppContext>): Response | Promise<Response> {
  const url = new URL(c.req.url);
  const suffix = url.pathname.replace(/\/+$/, "").slice("/docs".length);
  url.pathname = `${OWN_DOCS_HELP_PREFIX}${suffix}`;
  const headers = new Headers(c.req.raw.headers);
  headers.set(OWN_DOCS_DISPATCH_HEADER, "1");
  return app.fetch(
    new Request(url.toString(), {
      method: c.req.raw.method,
      headers,
      redirect: c.req.raw.redirect,
    }),
    c.env,
    c.executionCtx,
  );
}

async function beginPublicHelpRequest(c: Context<HonoAppContext>): Promise<
  | { ok: true; page: PublicHelpPageContext; noindex: boolean }
  | { ok: false; response: Response }
> {
  const ip = getClientIp(c);
  if (!checkRateLimit(`help:${ip}`, 200, 60_000)) {
    return {
      ok: false,
      response: c.text("Rate limit exceeded", 429, helpUncachedHeaders()),
    };
  }
  const page = await loadPublicHelpPage(
    drizzle(c.env.DB),
    c.env.UPLOADS,
    c.req.param("projectSlug"),
  );
  if (!page) {
    return {
      ok: false,
      response: c.text("Not found", 404, helpNotFoundCacheHeaders()),
    };
  }

  const ownDocsDispatch = isOwnDocsDispatch(c.req.raw, page.project.slug);
  const proxyPass = isHelpProxyPass(c.req.raw, page.helpCustomUrl);
  if (!ownDocsDispatch && page.helpCustomUrl && !proxyPass) {
    return {
      ok: false,
      response: new Response(null, {
        status: 301,
        headers: {
          Location: hostedHelpRedirectUrl({
            requestUrl: c.req.url,
            projectSlug: page.project.slug,
            customUrl: page.helpCustomUrl,
          }),
          "Cache-Control": "no-store",
        },
      }),
    };
  }

  return {
    ok: true,
    page,
    noindex: hostedHelpShouldNoindex({
      ownDocsDispatch,
      proxyPass,
      helpCustomUrl: page.helpCustomUrl,
    }),
  };
}

export class HelpPages extends WorkerEntrypoint<AppEnv> {
  fetch(request: Request): Response | Promise<Response> {
    return app.fetch(stripOwnDocsDispatchHeader(request), this.env, this.ctx);
  }

  invalidate(projectId: string): Promise<void> {
    return invalidateHelpPageCache(this.ctx, projectId);
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────
export default {
  fetch(
    request: Request,
    env: AppEnv,
    ctx: ExecutionContext,
  ): Response | Promise<Response> {
    const incoming = stripOwnDocsDispatchHeader(request);
    if (isPublicHelpPath(new URL(incoming.url).pathname)) {
      return dispatchPublicHelp(incoming, env, ctx, app.fetch);
    }
    return app.fetch(incoming, env, ctx);
  },
  queue: handleQueue,
  scheduled: handleScheduled,
};
