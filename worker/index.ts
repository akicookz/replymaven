import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { except } from "hono/combine";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "./db/auth.schema";
import {
  helpArticles,
  helpCategories,
  type HelpArticleRow,
  type HelpCategoryRow,
} from "./db/schema";
import { createAuth } from "./auth";
import { type HonoAppContext, type Plan } from "./types";
import { ProjectService } from "./services/project-service";
import { WidgetService } from "./services/widget-service";
import { getAssignableUsers } from "./services/assignable-users";
import { ContactFormService } from "./services/contact-form-service";
import { ChatService, type InboxFilter } from "./services/chat-service";
import { ResourceService, type FaqPair } from "./services/resource-service";
import { triggerAutoRagSync } from "./services/autorag-sync";
import { FAQ_SET_MAX_CHARS } from "../shared/faq-limits";
import { AiService } from "./services/ai-service";
import { TelegramService } from "./services/telegram-service";
import { KnowledgeSuggestionService } from "./services/knowledge-suggestion-service";
import { DashboardService } from "./services/dashboard-service";
import { CrawlService, type CrawlMessage } from "./services/crawl-service";
import { EmailService, parseEmailMessageId } from "./services/email-service";
import { ToolService } from "./services/tool-service";
import { GuidelineService } from "./services/guideline-service";
import { HelpdeskService } from "./services/helpdesk-service";
import { renderHelpIndex } from "./helpdesk-render/render-help-index";
import { renderHelpCategory } from "./helpdesk-render/render-help-category";
import { renderHelpArticle } from "./helpdesk-render/render-help-article";
import {
  renderHelpSearch,
  type HelpSearchResult,
} from "./helpdesk-render/render-help-search";
import { renderSitemap } from "./helpdesk-render/render-sitemap";
import { renderRobots } from "./helpdesk-render/render-robots";
import {
  renderMarkdown,
  ensureArticleTitle,
} from "./helpdesk-render/render-markdown";
import { normalizeHelpCustomUrl } from "./helpdesk-render/build-help-url";
import { groupArticlesByCategory } from "./helpdesk-render/group-articles";
import {
  encryptHeaders,
  decryptHeaders,
  maskHeaders,
  isEncrypted,
} from "./services/encryption-service";
import { BillingService } from "./services/billing-service";
import { TeamService } from "./services/team-service";
import {
  getTeamContext,
  invalidateTeamContext,
} from "./services/team-context";
import { VisitorBanService } from "./services/visitor-ban-service";
import { handleWidgetMessageTurn } from "./chat-runtime/orchestration/handle-widget-message-turn";
import { triggerAutoRefinementIfEnabled } from "./chat-runtime/post-turn/auto-refine";
import { buildToolRegistry } from "./chat-runtime/tools/build-tool-registry";
import { toToolDefinition } from "./chat-runtime/types";
import {
  createLanguageModel,
  createModelRuntimeState,
  runWithModelFallback,
} from "./chat-runtime/llm/create-language-model";
import { composeAgentDraft } from "./chat-runtime/llm/compose-agent-draft";
import { logError, logInfo, logWarn } from "./observability";
import { slugify } from "./lib/slugify";
import { parseHelpTopNav } from "./lib/help-top-nav";
import {
  broadcastClosed,
  broadcastMessageDeleted,
  broadcastMessageNew,
  broadcastStatusChange,
  broadcastMessageStatus,
} from "./realtime/broadcast";
import {
  handleDashboardWsUpgrade,
  handleWidgetWsUpgrade,
} from "./realtime/upgrade";
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
export { ConversationDO } from "./durable-objects/conversation-do";
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
  sendMessageSchema,
  agentReplySchema,
  updateTelegramSchema,
  onboardingStep1Schema,
  onboardingContextSchema,
  onboardingWidgetSchema,
  updateVisitorEmailSchema,
  updateConversationPublicSchema,
  updateTicketConfigSchema,
  submitContactFormSchema,
  createToolSchema,
  updateToolSchema,
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
  composeDraftSchema,
  snoozeSchema,
  prioritySchema,
  assignSchema,
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

// ─── Help search result resolver ──────────────────────────────────────────────
function resolveHelpSearchResults(
  response: unknown,
  articles: HelpArticleRow[],
  categories: HelpCategoryRow[],
  projectId: string,
): HelpSearchResult[] {
  if (typeof response !== "object" || response === null) return [];
  const articlesById = new Map(articles.map((a) => [a.id, a]));
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const filenames: Array<{ filename: string; score: number | null }> = [];

  const record = response as Record<string, unknown>;
  const result =
    typeof record.result === "object" && record.result !== null
      ? (record.result as Record<string, unknown>)
      : null;

  const collectFromArray = (arr: unknown[]): void => {
    for (const entry of arr) {
      if (typeof entry !== "object" || entry === null) continue;
      const r = entry as Record<string, unknown>;
      const item =
        typeof r.item === "object" && r.item !== null
          ? (r.item as Record<string, unknown>)
          : null;
      const filename =
        typeof r.filename === "string"
          ? r.filename
          : typeof item?.key === "string"
            ? (item.key as string)
            : null;
      if (!filename) continue;
      const score = typeof r.score === "number" ? r.score : null;
      filenames.push({ filename, score });
    }
  };

  if (result && Array.isArray(result.chunks)) {
    collectFromArray(result.chunks);
  } else if (Array.isArray(record.chunks)) {
    collectFromArray(record.chunks);
  } else if (Array.isArray(record.data)) {
    collectFromArray(record.data);
  }

  const prefix = `${projectId}/articles/`;
  const bestByArticleId = new Map<
    string,
    { article: HelpArticleRow; score: number | null }
  >();
  for (const { filename, score } of filenames) {
    if (!filename.startsWith(prefix)) continue;
    const tail = filename.slice(prefix.length);
    const articleId = tail.endsWith(".md") ? tail.slice(0, -3) : tail;
    const article = articlesById.get(articleId);
    if (!article) continue;
    const existing = bestByArticleId.get(articleId);
    if (!existing) {
      bestByArticleId.set(articleId, { article, score });
    } else if (
      score !== null &&
      (existing.score === null || score > existing.score)
    ) {
      bestByArticleId.set(articleId, { article, score });
    }
  }

  const results: HelpSearchResult[] = [];
  for (const { article, score } of bestByArticleId.values()) {
    const category = categoriesById.get(article.categoryId);
    if (!category) continue;
    results.push({ article, category, score });
  }
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return results;
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

function isConversationStale(
  conv: { status: string; lastActivityAt: Date | null; createdAt: Date },
  autoCloseMinutes: number,
): boolean {
  if (conv.status === "closed") return false;
  // Flagged-for-review conversations stay in Needs You until a human acts
  // (mirrors the guard in ChatService.checkAndCloseStale).
  if (conv.status === "waiting_agent") return false;
  const last =
    conv.lastActivityAt?.getTime() ?? conv.createdAt.getTime();
  return last < Date.now() - autoCloseMinutes * 60_000;
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function extractFormEmail(formData: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(formData)) {
    if (!/email/i.test(key)) continue;
    if (isLikelyEmail(value)) return value.trim();
  }

  return null;
}

function extractFormName(formData: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(formData)) {
    const normalizedKey = key.trim().toLowerCase();
    if (normalizedKey.includes("company")) continue;
    if (!normalizedKey.includes("name")) continue;

    const trimmedValue = value.trim();
    if (!trimmedValue) continue;
    return trimmedValue.slice(0, 100);
  }

  return null;
}

// Contact-form submissions become the visitor's first message in the
// conversation thread — enrich with name/email lines (mirrors what
// buildTicketRecord used to persist onto the now-removed ticket row) so the
// team still sees them even when the form itself didn't collect them.
function buildContactFormMessage(
  formData: Record<string, string>,
  visitorName: string | null,
  visitorEmail: string | null,
): string {
  const enrichedData = { ...formData };

  if (visitorName && !extractFormName(enrichedData)) {
    enrichedData["Visitor name"] = visitorName;
  }

  if (visitorEmail && !extractFormEmail(enrichedData)) {
    enrichedData["Visitor email"] = visitorEmail;
  }

  const lines = ["Contact form submission"];
  for (const [key, value] of Object.entries(enrichedData)) {
    const trimmedValue = value.trim();
    if (!trimmedValue) continue;
    lines.push(`${key}: ${trimmedValue}`);
  }

  return lines.join("\n");
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
  env: Env,
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
  // ─── Static SPA fallback ───────────────────────────────────────────────────
  // /help/* is reserved for the helpdesk feature (see helpdesk-render/).
  // Excluding it here lets the public help routes registered below intercept
  // those paths before the SPA fallback fires.
  .use(
    "*",
    except(["/api/*", "/help/*", "/.well-known/*"], async (c) => {
      return c.env.ASSETS.fetch(c.req.raw);
    }),
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
    return c.json({ ...config, projectName: project.name });
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

    const banService = new VisitorBanService(db);
    const ban = await banService.isVisitorBanned(
      project.id,
      parsed.data.visitorId,
      parsed.data.visitorEmail,
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

    const chatService = new ChatService(db);
    const conversation = await chatService.createConversation({
      projectId: project.id,
      visitorId: parsed.data.visitorId,
      visitorName: parsed.data.visitorName,
      visitorEmail: parsed.data.visitorEmail,
      metadata: JSON.stringify(geoMeta),
    });

    return c.json(conversation, 201);
  })

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

    const chatService = new ChatService(db);
    const conversation = await chatService.getActiveConversationByVisitor(
      project.id,
      visitorId,
    );
    if (!conversation) return c.json({ conversation: null });
    return c.json({ conversation });
  })

  // ─── Get Conversation Messages ──────────────────────────────────────────────
  .get("/api/widget/:projectSlug/conversations/:id/messages", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`getmsg:${ip}`, 60, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const conversationId = c.req.param("id");
    const db = drizzle(c.env.DB);

    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const chatService = new ChatService(db);
    let conversation = await chatService.getConversationById(
      conversationId,
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    // ─── Lazy auto-close check ──────────────────────────────────────────────
    if (conversation.status !== "closed") {
      const settings = await projectService.getSettings(project.id);
      if (settings?.autoCloseMinutes) {
        const result = await chatService.checkAndCloseStale(
          conversationId,
          project.id,
          settings.autoCloseMinutes,
        );
        if (result.closed && result.conversation) {
          conversation = result.conversation;
          c.executionCtx.waitUntil(
            triggerAutoRefinementIfEnabled({
              projectId: project.id,
              conversationId,
              db,
              env: c.env,
              kv: c.env.CONVERSATIONS_CACHE,
              source: "stale_auto_close",
            }),
          );
        }
      }
    }

    // Support ?since=<timestamp> for polling
    const sinceParam = c.req.query("since");
    if (sinceParam) {
      const sinceTs = parseInt(sinceParam, 10);
      if (!isNaN(sinceTs)) {
        const newMessages = await chatService.getMessagesSince(
          conversationId,
          sinceTs,
        );
        return c.json({
          messages: newMessages,
          status: conversation.status,
        });
      }
    }

    const msgs = await chatService.getMessages(conversationId);
    return c.json({
      messages: msgs,
      status: conversation.status,
    });
  })

  // ─── Widget WebSocket Upgrade ──────────────────────────────────────────────
  .get("/api/widget/:projectSlug/conversations/:id/ws", (c) =>
    handleWidgetWsUpgrade(c),
  )

  // ─── Visitor Heartbeat ───────────────────────────────────────────────────────
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

    const chatService = new ChatService(db);
    const conversation = await chatService.updateVisitorLastSeen(
      conversationId,
      project.id,
      presence,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    if (deliveredUpTo) {
      const ids = await chatService.markDeliveredUpTo(conversationId, deliveredUpTo);
      broadcastMessageStatus(c.env, c.executionCtx, conversationId, "delivered", ids);
    }
    if (readUpTo) {
      const ids = await chatService.markReadUpTo(conversationId, readUpTo);
      broadcastMessageStatus(c.env, c.executionCtx, conversationId, "read", ids);
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

    const ext = fileObj.name.split(".").pop() ?? "jpg";
    const uploadKey = `${project.id}/chat-images/${crypto.randomUUID()}.${ext}`;
    const buffer = await fileObj.arrayBuffer();

    await c.env.UPLOADS.put(uploadKey, buffer, {
      httpMetadata: { contentType: fileObj.type },
    });

    return c.json({ url: `/api/uploads/${uploadKey}` }, 201);
  })

  // ─── Send Message (SSE streaming response) ─────────────────────────────────
  .post("/api/widget/:projectSlug/conversations/:id/messages", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`msg:${ip}`, 30, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const conversationId = c.req.param("id");
    const db = drizzle(c.env.DB);

    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const chatServiceForBan = new ChatService(db);
    const convForBan = await chatServiceForBan.getConversationById(
      conversationId,
      project.id,
    );
    if (convForBan) {
      const banService = new VisitorBanService(db);
      const ban = await banService.isVisitorBanned(
        project.id,
        convForBan.visitorId,
        convForBan.visitorEmail,
      );
      if (ban) {
        return c.json({ banned: true, reason: ban.reason }, 403);
      }
    }

    const body = await c.req.json();
    const parsed = validate(sendMessageSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);
    return handleWidgetMessageTurn({
      db,
      env: c.env,
      executionCtx: c.executionCtx,
      checkRateLimit,
      project: {
        id: project.id,
        userId: project.userId,
        name: project.name,
      },
      conversationId,
      payload: {
        content: parsed.data.content,
        imageUrl: parsed.data.imageUrl,
        pageContext: parsed.data.pageContext,
        history: parsed.data.history,
      },
    });
  })

  // ─── Update Visitor Email (for handoff flow) ─────────────────────────────────
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

    const chatService = new ChatService(db);
    const conversation = await chatService.getConversationById(
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

    const chatService = new ChatService(db);
    const conversation = await chatService.getConversationById(
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
    const chatService = new ChatService(db);

    // Verify contact form is enabled
    const formConfig = await contactFormService.getConfig(project.id);
    if (!formConfig?.enabled) {
      return c.json({ error: "Contact form is not enabled" }, 400);
    }

    const visitorId = parsed.data.visitorId ?? crypto.randomUUID();
    const visitorEmail =
      parsed.data.visitorEmail ?? extractFormEmail(parsed.data.data);
    const visitorName =
      parsed.data.visitorName ?? extractFormName(parsed.data.data);

    let conversation = await chatService.getActiveConversationByVisitor(
      project.id,
      visitorId,
    );

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
        visitorId,
        visitorName: visitorName ?? null,
        visitorEmail: visitorEmail ?? null,
        metadata: JSON.stringify(metadata),
      });
    }

    const formMessage = buildContactFormMessage(
      parsed.data.data,
      visitorName,
      visitorEmail,
    );

    const formVisitorMessage = await chatService.addMessage({
      conversationId: conversation.id,
      role: "visitor",
      content: formMessage,
      imageUrl: null,
      sources: null,
    });
    broadcastMessageNew(
      c.env,
      c.executionCtx,
      conversation.id,
      formVisitorMessage,
    );

    // Contact-form submissions are a direct line to the team → Needs You.
    const wasAlreadyWithTeam =
      conversation.status === "waiting_agent" ||
      conversation.status === "agent_replied";
    if (conversation.status !== "waiting_agent") {
      await chatService.updateConversationStatus(
        conversation.id,
        project.id,
        "waiting_agent",
      );
      broadcastStatusChange(c.env, c.executionCtx, conversation.id, "waiting_agent");
    }

    // Notify via Telegram if configured
    const settings = await projectService.getSettings(project.id);
    if (settings?.telegramBotToken && settings?.telegramChatId) {
      const telegramService = new TelegramService(db);
      c.executionCtx.waitUntil(
        (wasAlreadyWithTeam
          ? telegramService.forwardVisitorMessage(
              settings.telegramBotToken,
              settings.telegramChatId,
              conversation.visitorName,
              formMessage,
              conversation.id,
              conversation.telegramThreadId
                ? parseInt(conversation.telegramThreadId, 10)
                : undefined,
            )
          : telegramService.notifyEscalation(
              settings.telegramBotToken,
              settings.telegramChatId,
              {
                visitorName: conversation.visitorName,
                visitorEmail: conversation.visitorEmail,
                summary: formMessage,
                conversationUrl: `${c.env.BETTER_AUTH_URL}/app/projects/${project.id}/conversations?filter=needs-you&id=${conversation.id}`,
                isUpdate: false,
              },
            )
        ).catch(() => {
          // Silently ignore Telegram errors
        }),
      );
    }

    // Notify project owner via email
    if (c.env.RESEND_API_KEY) {
      const emailService = new EmailService(c.env.RESEND_API_KEY);
      const ownerEmail = await projectService.getOwnerEmail(project.id);
      if (ownerEmail) {
        const projectName = settings?.companyName ?? project.name;
        const conversationUrl = `${c.env.BETTER_AUTH_URL}/app/projects/${project.id}/conversations?filter=needs-you&id=${conversation.id}`;
        c.executionCtx.waitUntil(
          emailService
            .sendEscalationNotification({
              ownerEmail,
              projectName,
              visitorName,
              visitorEmail,
              visitorId,
              summary: formMessage,
              conversationUrl,
              accentColor: null,
            })
            .catch((err) => {
              console.error("Escalation notification email failed:", err);
            }),
        );
      }
    }

    return c.json(
      {
        id: conversation.id,
        created: true,
        conversationId: conversation.id,
        conversationStatus: "waiting_agent",
        visitorEmail: visitorEmail ?? null,
        visitorName: visitorName ?? null,
      },
      201,
    );
  })

  // ─── Telegram Detect Chat ID ─────────────────────────────────────────────────
  .post("/api/telegram/detect-chat-id", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`tg-detect:${ip}`, 10, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const body = await c.req.json<{ botToken?: string }>();
    if (!body.botToken || typeof body.botToken !== "string") {
      return c.json({ error: "botToken is required" }, 400);
    }

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${body.botToken}/getUpdates?limit=20&allowed_updates=["message"]`,
      );
      const data = await res.json<{
        ok: boolean;
        result?: Array<{
          message?: {
            chat: {
              id: number;
              type: string;
              title?: string;
              first_name?: string;
            };
          };
        }>;
        description?: string;
      }>();

      if (!data.ok) {
        return c.json({ error: data.description ?? "Invalid bot token" }, 400);
      }

      const seen = new Set<number>();
      const chats: Array<{ id: string; type: string; title: string }> = [];

      for (const update of data.result ?? []) {
        const chat = update.message?.chat;
        if (!chat || seen.has(chat.id)) continue;
        seen.add(chat.id);
        chats.push({
          id: String(chat.id),
          type: chat.type,
          title: chat.title ?? chat.first_name ?? `Chat ${chat.id}`,
        });
      }

      return c.json({ chats });
    } catch {
      return c.json({ error: "Failed to connect to Telegram API" }, 500);
    }
  })

  // ─── Telegram Webhook ───────────────────────────────────────────────────────
  .post("/api/telegram/webhook/:projectId", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`tg:${ip}`, 60, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const projectId = c.req.param("projectId");
    const db = drizzle(c.env.DB);

    const telegramService = new TelegramService(db);
    const tgSettings = await telegramService.getTelegramSettings(projectId);
    if (!tgSettings?.telegramBotToken || !tgSettings?.telegramChatId) {
      return c.json({ error: "Telegram not configured" }, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await c.req.json()) as { message?: any };
    const message = body.message;
    if (!message?.text) {
      return c.json({ ok: true });
    }

    const chatService = new ChatService(db);
    const projectService = new ProjectService(db);
    const projectSettings = await projectService.getSettings(projectId);
    const botName = projectSettings?.botName;

    // ─── Resolve conversation from message context ────────────────────────────
    let conversationId: string | null = null;

    // Try extracting conversation ID from the replied-to message
    if (message.reply_to_message) {
      const originalText = message.reply_to_message.text ?? "";
      const convMatch = originalText.match(/Conversation:\s*(\S+)/);
      if (convMatch) {
        conversationId = convMatch[1];
      }
    }

    // Fallback for standalone @BotName messages (no reply) or replies to
    // messages that don't contain a conversation ID
    if (!conversationId && botName) {
      const mentionPrefix = `@${botName}`;
      if (message.text.toLowerCase().startsWith(mentionPrefix.toLowerCase())) {
        const agentConvs =
          await chatService.getAgentModeConversations(projectId);
        if (agentConvs.length === 1) {
          conversationId = agentConvs[0].id;
        } else if (agentConvs.length > 1) {
          // Ambiguous — tell the agent how to target a specific conversation
          await telegramService.sendMessage(
            tgSettings.telegramBotToken,
            tgSettings.telegramChatId,
            `Multiple active conversations. Please reply directly to a forwarded visitor message or notification to use @${botName} commands.`,
            message.message_id,
          );
          return c.json({ ok: true });
        }
      }
    }

    // If we still don't have a conversation and there's no reply, ignore
    if (!conversationId) {
      if (!message.reply_to_message) return c.json({ ok: true });
      // Had a reply_to_message but no conversation ID found — ignore
      return c.json({ ok: true });
    }

    const conversation = await chatService.getConversationById(
      conversationId,
      projectId,
    );
    if (!conversation) {
      return c.json({ ok: true });
    }

    // Check if message is an @botName command
    if (botName) {
      const mentionPrefix = `@${botName}`;
      if (message.text.toLowerCase().startsWith(mentionPrefix.toLowerCase())) {
        const commandText = message.text.slice(mentionPrefix.length).trim();

        if (!commandText) {
          // Simple handback — @BotName with no text
          await chatService.updateConversationStatus(
            conversationId,
            projectId,
            "active",
          );
          // Clear any existing handback instructions
          await chatService.updateConversation(conversationId, projectId, {
            metadata: JSON.stringify({ agentHandbackInstructions: null }),
          });
          broadcastStatusChange(c.env, c.executionCtx, conversationId, "active");
          await telegramService.sendMessage(
            tgSettings.telegramBotToken,
            tgSettings.telegramChatId,
            "Bot resumed.",
            message.message_id,
          );
          return c.json({ ok: true });
        }

        // Use AI to classify: close vs handback with instructions
        const aiService = new AiService({
          model: c.env.AI_MODEL,
          geminiApiKey: c.env.GEMINI_API_KEY,
          openaiApiKey: c.env.OPENAI_API_KEY,
        });

        const result = await aiService.classifyAgentCommand(commandText);

        if (result.action === "close") {
          await chatService.updateConversationStatus(
            conversationId,
            projectId,
            "closed",
            "resolved",
          );
          broadcastStatusChange(c.env, c.executionCtx, conversationId, "closed");
          broadcastClosed(c.env, c.executionCtx, conversationId, "resolved");

          // Auto-draft canned response in background
          c.executionCtx.waitUntil(
            triggerAutoRefinementIfEnabled({
              projectId,
              conversationId,
              db,
              env: c.env,
              kv: c.env.CONVERSATIONS_CACHE,
              source: "telegram_agent_close",
            }),
          );

          await telegramService.sendMessage(
            tgSettings.telegramBotToken,
            tgSettings.telegramChatId,
            "Conversation closed.",
            message.message_id,
          );
        } else if (result.action === "ban") {
          const banService = new VisitorBanService(db);
          await banService.banVisitor({
            projectId,
            visitorId: conversation.visitorId,
            visitorEmail: conversation.visitorEmail ?? null,
            reason: result.reason,
            bannedBy: "agent",
            bannedFromConversationId: conversationId,
            expiresAt: null,
          });

          await chatService.updateConversationStatus(
            conversationId,
            projectId,
            "closed",
            "spam",
          );
          broadcastStatusChange(c.env, c.executionCtx, conversationId, "closed");
          broadcastClosed(c.env, c.executionCtx, conversationId, "spam");

          await telegramService.sendMessage(
            tgSettings.telegramBotToken,
            tgSettings.telegramChatId,
            `Visitor banned and conversation closed.${result.reason ? ` Reason: ${result.reason}` : ""}`,
            message.message_id,
          );
        } else if (result.action === "respond") {
          // Bot should immediately respond to the visitor
          await chatService.updateConversationStatus(
            conversationId,
            projectId,
            "active",
          );

          // Store instructions in metadata (persist for future messages too)
          await chatService.updateConversation(conversationId, projectId, {
            metadata: JSON.stringify({
              agentHandbackInstructions: result.instructions,
            }),
          });

          // Generate a bot response using the agent's instruction
          const msgs = await chatService.getMessages(conversationId);
          const history = msgs
            .filter((m) => m.role !== "bot" || m.content)
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.content }));

          const defaultSettings = {
            toneOfVoice: "professional" as const,
            customTonePrompt: null,
            companyContext: null,
            botName: null,
            agentName: null,
          };
          const project = await projectService.getProjectById(projectId);
          const responseText = await aiService.generateDirectedResponse(
            projectSettings ?? defaultSettings,
            project?.name ?? "Support",
            history,
            result.instructions,
          );

          // Store the bot response as a message
          const botMessage = await chatService.addMessage({
            conversationId,
            role: "bot",
            content: responseText,
            senderName: projectSettings?.botName ?? null,
          });
          broadcastStatusChange(c.env, c.executionCtx, conversationId, "active");
          broadcastMessageNew(c.env, c.executionCtx, conversationId, botMessage);

          await telegramService.sendMessage(
            tgSettings.telegramBotToken,
            tgSettings.telegramChatId,
            "Bot responded.",
            message.message_id,
          );
        } else {
          // Handback — silent instructions for future messages
          await chatService.updateConversationStatus(
            conversationId,
            projectId,
            "active",
          );
          broadcastStatusChange(c.env, c.executionCtx, conversationId, "active");

          if (result.instructions) {
            await chatService.updateConversation(conversationId, projectId, {
              metadata: JSON.stringify({
                agentHandbackInstructions: result.instructions,
              }),
            });
          } else {
            await chatService.updateConversation(conversationId, projectId, {
              metadata: JSON.stringify({ agentHandbackInstructions: null }),
            });
          }

          const confirmText = result.instructions
            ? "Bot resumed with instructions."
            : "Bot resumed.";
          await telegramService.sendMessage(
            tgSettings.telegramBotToken,
            tgSettings.telegramChatId,
            confirmText,
            message.message_id,
          );
        }

        return c.json({ ok: true });
      }
    }

    // Normal agent reply — store and forward to visitor
    const agentMessage = await chatService.addMessage({
      conversationId,
      role: "agent",
      content: message.text,
      senderName: message.from?.first_name ?? null,
    });

    await chatService.updateConversationStatus(
      conversationId,
      projectId,
      "agent_replied",
    );

    broadcastMessageNew(c.env, c.executionCtx, conversationId, agentMessage);
    broadcastStatusChange(
      c.env,
      c.executionCtx,
      conversationId,
      "agent_replied",
    );

    return c.json({ ok: true });
  })

  // ─── Widget Embed JS (redirect to R2 custom domain) ────────────────────────
  .get("/api/widget-embed.js", (c) => {
    return c.redirect("https://widget.replymaven.com/widget-embed.js", 301);
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC HELP CENTER (HTML, no auth)
  // ═══════════════════════════════════════════════════════════════════════════
  .get("/help/:projectSlug/sitemap.xml", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`help:${ip}`, 200, 60_000)) {
      return c.text("Rate limit exceeded", 429);
    }
    const slug = c.req.param("projectSlug");
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.text("Not found", 404);

    const helpService = new HelpdeskService(db, c.env.UPLOADS);
    const settings = await projectService.getSettings(project.id);
    const categories = await helpService.listCategories(project.id);
    const articles = await helpService.listArticles(project.id, {
      status: "published",
    });

    const xml = renderSitemap({
      project,
      categories,
      articles,
      helpCustomUrl: settings?.helpCustomUrl ?? null,
    });
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  })
  .get("/help/:projectSlug/robots.txt", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`help:${ip}`, 200, 60_000)) {
      return c.text("Rate limit exceeded", 429);
    }
    const slug = c.req.param("projectSlug");
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.text("Not found", 404);

    const settings = await projectService.getSettings(project.id);
    const body = renderRobots({
      projectSlug: project.slug,
      helpCustomUrl: settings?.helpCustomUrl ?? null,
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  })
  .get("/help/:projectSlug/:categorySlug/:articleSlug", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`help:${ip}`, 200, 60_000)) {
      return c.text("Rate limit exceeded", 429);
    }
    const projectSlug = c.req.param("projectSlug");
    const categorySlug = c.req.param("categorySlug");
    const articleSlug = c.req.param("articleSlug");
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(projectSlug);
    if (!project) return c.text("Not found", 404);

    const helpService = new HelpdeskService(db, c.env.UPLOADS);
    const match = await helpService.getArticleBySlug(
      project.id,
      categorySlug,
      articleSlug,
    );
    if (!match || match.article.status !== "published") {
      return c.text("Not found", 404);
    }

    const widgetService = new WidgetService(db);
    const [
      widgetConfigRow,
      settings,
      siblings,
      categories,
      allPublished,
    ] = await Promise.all([
      widgetService.getWidgetConfig(project.id),
      projectService.getSettings(project.id),
      helpService.listArticles(project.id, {
        categoryId: match.category.id,
        status: "published",
      }),
      helpService.listCategories(project.id),
      helpService.listAllPublishedArticles(project.id),
    ]);

    const orderedIds = siblings.map((a) => a.id);
    const currentIndex = orderedIds.indexOf(match.article.id);
    const prevArticle = currentIndex > 0 ? siblings[currentIndex - 1] : null;
    const nextArticle =
      currentIndex >= 0 && currentIndex < siblings.length - 1
        ? siblings[currentIndex + 1]
        : null;

    const bodyHtml = await renderMarkdown(
      ensureArticleTitle(match.article.content ?? "", match.article.title),
      {
        projectSlug: project.slug,
        customUrl: settings?.helpCustomUrl ?? null,
      },
    );

    const articlesByCategory = groupArticlesByCategory(allPublished);
    const topNav = parseHelpTopNav(settings?.helpTopNav);

    const html = renderHelpArticle({
      project,
      category: match.category,
      categories,
      articlesByCategory,
      article: match.article,
      bodyHtml,
      prevArticle,
      nextArticle,
      widgetConfig: widgetConfigRow,
      helpCustomUrl: settings?.helpCustomUrl ?? null,
      topNav,
    });
    return c.html(`<!doctype html>${html.toString()}`, 200, {
      "Cache-Control": "public, max-age=120, s-maxage=120",
    });
  })
  .get("/help/:projectSlug/search", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`help:${ip}`, 200, 60_000)) {
      return c.text("Rate limit exceeded", 429);
    }
    const projectSlug = c.req.param("projectSlug");
    const query = (c.req.query("q") ?? "").trim().slice(0, 200);
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(projectSlug);
    if (!project) return c.text("Not found", 404);

    const helpService = new HelpdeskService(db, c.env.UPLOADS);
    const widgetService = new WidgetService(db);
    const [widgetConfigRow, settings, categories, allPublished] =
      await Promise.all([
        widgetService.getWidgetConfig(project.id),
        projectService.getSettings(project.id),
        helpService.listCategories(project.id),
        helpService.listAllPublishedArticles(project.id),
      ]);

    let results: HelpSearchResult[] = [];
    if (query.length > 0) {
      try {
        const response = await c.env.AI.aiSearch()
          .get("supportbot")
          .search({
            messages: [{ role: "user", content: query }],
            ai_search_options: {
              retrieval: {
                retrieval_type: "vector",
                filters: {
                  // Help articles live in the `articles/` subfolder. AutoRAG's
                  // folder $eq matches a folder exactly (not recursively), so
                  // filtering on `${project.id}/` misses every article.
                  folder: { $eq: `${project.id}/articles/` },
                } as never,
                max_num_results: 12,
                match_threshold: 0.2,
              },
              query_rewrite: { enabled: false },
              reranking: {
                enabled: true,
                model: "@cf/baai/bge-reranker-base",
              },
            },
          });
        results = resolveHelpSearchResults(
          response,
          allPublished,
          categories,
          project.id,
        );
      } catch (err) {
        logWarn("help_search.failed", {
          projectId: project.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const articlesByCategory = groupArticlesByCategory(allPublished);
    const topNav = parseHelpTopNav(settings?.helpTopNav);

    const html = renderHelpSearch({
      project,
      query,
      results,
      categories,
      articlesByCategory,
      widgetConfig: widgetConfigRow,
      helpCustomUrl: settings?.helpCustomUrl ?? null,
      topNav,
    });
    return c.html(`<!doctype html>${html.toString()}`, 200, {
      "Cache-Control": "no-store",
    });
  })
  .get("/help/:projectSlug/:categorySlug", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`help:${ip}`, 200, 60_000)) {
      return c.text("Rate limit exceeded", 429);
    }
    const projectSlug = c.req.param("projectSlug");
    const categorySlug = c.req.param("categorySlug");
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(projectSlug);
    if (!project) return c.text("Not found", 404);

    const helpService = new HelpdeskService(db, c.env.UPLOADS);
    const category = await helpService.getCategoryBySlug(
      project.id,
      categorySlug,
    );
    if (!category) return c.text("Not found", 404);

    const widgetService = new WidgetService(db);
    const [
      widgetConfigRow,
      settings,
      articles,
      categories,
      allPublished,
    ] = await Promise.all([
      widgetService.getWidgetConfig(project.id),
      projectService.getSettings(project.id),
      helpService.listArticles(project.id, {
        categoryId: category.id,
        status: "published",
      }),
      helpService.listCategories(project.id),
      helpService.listAllPublishedArticles(project.id),
    ]);

    const articlesByCategory = groupArticlesByCategory(allPublished);
    const topNav = parseHelpTopNav(settings?.helpTopNav);

    const html = renderHelpCategory({
      project,
      category,
      categories,
      articles,
      articlesByCategory,
      widgetConfig: widgetConfigRow,
      helpCustomUrl: settings?.helpCustomUrl ?? null,
      topNav,
    });
    return c.html(`<!doctype html>${html.toString()}`, 200, {
      "Cache-Control": "public, max-age=120, s-maxage=120",
    });
  })
  .get("/help/:projectSlug", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`help:${ip}`, 200, 60_000)) {
      return c.text("Rate limit exceeded", 429);
    }
    const projectSlug = c.req.param("projectSlug");
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(projectSlug);
    if (!project) return c.text("Not found", 404);

    const helpService = new HelpdeskService(db, c.env.UPLOADS);
    const widgetService = new WidgetService(db);
    const [
      widgetConfigRow,
      settings,
      categories,
      counts,
      allPublished,
      recentlyPublished,
    ] = await Promise.all([
      widgetService.getWidgetConfig(project.id),
      projectService.getSettings(project.id),
      helpService.listCategories(project.id),
      helpService.getArticleCountsByCategory(project.id),
      helpService.listAllPublishedArticles(project.id),
      helpService.listRecentlyPublishedArticles(project.id),
    ]);

    const enriched = categories.map((cat) => ({
      ...cat,
      articleCount: counts.get(cat.id) ?? 0,
    }));

    const categoryById = new Map(categories.map((cat) => [cat.id, cat]));
    const popularArticles = recentlyPublished
      .map((article) => {
        const category = categoryById.get(article.categoryId);
        if (!category) return null;
        return { article, category };
      })
      .filter(
        (entry): entry is { article: HelpArticleRow; category: HelpCategoryRow } =>
          entry !== null,
      );

    const articlesByCategory = groupArticlesByCategory(allPublished);
    const topNav = parseHelpTopNav(settings?.helpTopNav);

    const html = renderHelpIndex({
      project,
      categories: enriched,
      articlesByCategory,
      popularArticles,
      widgetConfig: widgetConfigRow,
      helpCustomUrl: settings?.helpCustomUrl ?? null,
      topNav,
    });
    return c.html(`<!doctype html>${html.toString()}`, 200, {
      "Cache-Control": "public, max-age=120, s-maxage=120",
    });
  })

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

    // Extract project slug from to address ({slug}@updates.replymaven.com)
    let projectSlug: string | null = null;
    for (const addr of toAddresses) {
      const match = addr.match(/^([^@]+)@updates\.replymaven\.com$/i);
      if (match) {
        projectSlug = match[1];
        break;
      }
    }

    if (!projectSlug || projectSlug === "noreply") {
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
        console.error(
          `[InboundEmail] Failed to fetch email content: ${emailRes.status}`,
        );
        return c.json({ ok: true });
      }
    } catch (err) {
      console.error("[InboundEmail] Error fetching email content:", err);
      return c.json({ ok: true });
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
    const chatService = new ChatService(db);
    const referencedMessageId =
      parseEmailMessageId(inReplyToHeader) ??
      parseEmailMessageId(referencesHeader, { source: "references" });
    let conversation = null as Awaited<
      ReturnType<typeof chatService.getRecentConversationByVisitorEmail>
    > | null;
    let referencedAgentUserId: string | null = null;
    if (referencedMessageId) {
      const sourceMessage = await chatService.getMessageById(referencedMessageId);
      if (sourceMessage) {
        const conv = await chatService.getConversationById(
          sourceMessage.conversationId,
          project.id,
        );
        if (conv) {
          conversation = conv;
          referencedAgentUserId = sourceMessage.userId ?? null;
        }
      }
    }
    if (!conversation) {
      conversation = await chatService.getRecentConversationByVisitorEmail(
        project.id,
        senderEmail,
      );
    }
    if (!conversation) {
      console.error(
        `[InboundEmail] No conversation found for email: ${senderEmail} in project: ${project.id}`,
      );
      return c.json({ ok: true });
    }

    // Per-conversation duplicate-content guard (defends against retries that
    // bypass the KV check, e.g. a different email_id with identical content).
    const existingMessages = await chatService.getMessagesSince(
      conversation.id,
      Date.now() - 5 * 60 * 1000,
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
      broadcastStatusChange(c.env, c.executionCtx, conversation.id, "active");
    }

    const widgetService = new WidgetService(db);
    const widgetCfgForReply = await widgetService.getWidgetConfig(project.id);

    if (isVisitor) {
      // ─── Visitor reply branch ─────────────────────────────────────────
      const inboundEmailMessage = await chatService.addMessage({
        conversationId: conversation.id,
        role: "visitor",
        content: cleanedText,
        sources: null,
      });
      broadcastMessageNew(
        c.env,
        c.executionCtx,
        conversation.id,
        inboundEmailMessage,
      );

      // Forward to Telegram if conversation is in agent mode
      if (
        conversation.status === "waiting_agent" ||
        conversation.status === "agent_replied"
      ) {
        try {
          const telegramService = new TelegramService(db);
          const tgSettings = await telegramService.getTelegramSettings(
            project.id,
          );
          if (tgSettings?.telegramBotToken && tgSettings?.telegramChatId) {
            const replyTo = conversation.telegramThreadId
              ? parseInt(conversation.telegramThreadId, 10)
              : undefined;
            await telegramService.forwardVisitorMessage(
              tgSettings.telegramBotToken,
              tgSettings.telegramChatId,
              conversation.visitorName ?? senderEmail,
              `[via email] ${cleanedText}`,
              conversation.id,
              replyTo,
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
          await chatService.getLatestEmailedAgentMessage(conversation.id);
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
            emailService
              .sendVisitorReplyToAgentEmail({
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
              })
              .catch((err) => {
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
      const agentMessage = await chatService.addMessage({
        conversationId: conversation.id,
        role: "agent",
        content: cleanedText,
        userId: agentUser.id,
        senderName: agentUser.name,
        senderAvatar: agentUser.avatar,
        sources: null,
      });
      await chatService.markMessageAsEmailed(agentMessage.id);
      await chatService.updateConversationStatus(
        conversation.id,
        project.id,
        "agent_replied",
      );
      broadcastMessageNew(c.env, c.executionCtx, conversation.id, agentMessage);
      broadcastStatusChange(
        c.env,
        c.executionCtx,
        conversation.id,
        "agent_replied",
      );

      // Send the visitor an email with the agent's reply so the round-trip
      // continues over email. Skip if the conversation has no visitorEmail —
      // the message still lands in the dashboard.
      if (conversation.visitorEmail && c.env.RESEND_API_KEY) {
        const emailService = new EmailService(c.env.RESEND_API_KEY);
        const dashboardUrl = `${c.env.BETTER_AUTH_URL}/app/projects/${project.id}/conversations/${conversation.id}`;
        c.executionCtx.waitUntil(
          emailService
            .sendAgentMessageEmail({
              to: conversation.visitorEmail,
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
            })
            .catch((err) => {
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

  // ─── MCP OAuth + Server ───────────────────────────────────────────────────
  .post("/api/mcp/register", handleMcpClientRegistration)
  .get("/api/mcp/authorize", handleMcpAuthorizeGet)
  .post("/api/mcp/authorize", handleMcpAuthorizePost)
  .post("/api/mcp/token", handleMcpToken)
  .post("/api/mcp/revoke", handleMcpTokenRevocation)
  .all("/api/mcp", async (c) => handleMcpRequest(c))

  // ═══════════════════════════════════════════════════════════════════════════
  // ONBOARDING ENDPOINTS (session-authenticated)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Step 1: Create project with company info ──────────────────────────────
  .post("/api/onboarding", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

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

    // Resolve to owner's id so team members see/create projects on the owner's
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
    const { buildOtpEmailHtml } = await import("./services/email-service");
    const { Resend } = await import("resend");
    const resend = new Resend(c.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "ReplyMaven <noreply@updates.replymaven.com>",
      to: normalizedEmail,
      subject: `${otp} is your ReplyMaven verification code`,
      html: buildOtpEmailHtml(otp),
    });

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

    // Per-member project scope is only meaningful to (and only managed by)
    // owners and admins of the active team — don't expose it to regular members.
    const activeRole = c.get("activeRole");
    const isPrivileged = activeRole === "owner" || activeRole === "admin";
    const projectMap = isPrivileged
      ? await teamService.getMemberProjectMap(effectiveUserId)
      : {};
    const membersWithProjects = members.map((m) => ({
      ...m,
      projectIds: projectMap[m.id] ?? [],
    }));
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

    const dashboardService = new DashboardService(db);
    const stats = await dashboardService.getStats(effectiveUserId, projectId);
    return c.json(stats);
  })

  // ─── Per-project access enforcement (scoped team members) ────────────────────
  .use("/api/projects/:id", projectAccessMiddleware)
  .use("/api/projects/:id/*", projectAccessMiddleware)

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
    return c.json(project);
  })
  .delete("/api/projects/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const effectiveUserId = c.get("effectiveUserId") ?? user.id;
    const db = c.get("db");
    const service = new ProjectService(db);
    const deleted = await service.deleteProject(
      c.req.param("id"),
      effectiveUserId,
    );
    if (!deleted) return c.json({ error: "Not found" }, 404);
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
      return c.json({
        ...settings,
        telegramBotToken: settings.telegramBotToken ? "••••••••" : null,
        helpTopNav: parseHelpTopNav(settings.helpTopNav),
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

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const { helpTopNav, ...rest } = parsed.data;
    const updatePayload: Parameters<typeof projectService.updateSettings>[1] = {
      ...rest,
    };
    if (helpTopNav !== undefined) {
      updatePayload.helpTopNav =
        helpTopNav === null ? null : JSON.stringify(helpTopNav);
    }

    const settings = await projectService.updateSettings(
      project.id,
      updatePayload,
    );
    return c.json(settings);
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

    // Feature gate: custom CSS
    const planLimits = c.get("planLimits");
    if (parsed.data.customCss && planLimits && !planLimits.customCss) {
      return c.json(
        {
          error: "Custom CSS is available on the Business plan.",
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

    const widgetService = new WidgetService(db);
    const config = await widgetService.updateWidgetConfig(
      project.id,
      parsed.data,
    );
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

    // Decrypt and mask headers for each tool (never expose raw secrets)
    const toolsWithMaskedHeaders = await Promise.all(
      projectTools.map(async (t) => {
        let maskedHeaders: Record<string, string> | null = null;
        if (t.headers) {
          try {
            const decrypted = isEncrypted(t.headers)
              ? await decryptHeaders(t.headers, c.env.ENCRYPTION_KEY)
              : (JSON.parse(t.headers) as Record<string, string>);
            maskedHeaders = maskHeaders(decrypted);
          } catch {
            maskedHeaders = null;
          }
        }
        return {
          ...t,
          parameters: JSON.parse(t.parameters),
          headers: maskedHeaders,
          responseMapping: t.responseMapping
            ? JSON.parse(t.responseMapping)
            : null,
        };
      }),
    );

    return c.json(toolsWithMaskedHeaders);
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
    const parsed = validate(createToolSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const toolService = new ToolService(db);

    // Enforce max 20 tools per project
    const count = await toolService.getToolCount(project.id);
    if (count >= 20) {
      return c.json({ error: "Maximum 20 tools per project" }, 400);
    }

    // Check for duplicate name
    const existing = await toolService.getToolByName(
      parsed.data.name,
      project.id,
    );
    if (existing) {
      return c.json({ error: "A tool with this name already exists" }, 400);
    }

    // Encrypt headers if provided (contains auth tokens, API keys)
    let encryptedHeaders: string | null = null;
    if (parsed.data.headers && Object.keys(parsed.data.headers).length > 0) {
      encryptedHeaders = await encryptHeaders(
        parsed.data.headers,
        c.env.ENCRYPTION_KEY,
      );
    }

    const created = await toolService.createTool({
      projectId: project.id,
      name: parsed.data.name,
      displayName: parsed.data.displayName,
      description: parsed.data.description,
      endpoint: parsed.data.endpoint,
      method: parsed.data.method,
      headers: encryptedHeaders,
      parameters: JSON.stringify(parsed.data.parameters),
      responseMapping: parsed.data.responseMapping
        ? JSON.stringify(parsed.data.responseMapping)
        : null,
      enabled: parsed.data.enabled,
      timeout: parsed.data.timeout,
    });

    // Return masked headers to frontend (never expose raw values)
    const maskedHeaders =
      parsed.data.headers && Object.keys(parsed.data.headers).length > 0
        ? maskHeaders(parsed.data.headers)
        : null;

    return c.json(
      {
        ...created,
        parameters: JSON.parse(created.parameters),
        headers: maskedHeaders,
        responseMapping: created.responseMapping
          ? JSON.parse(created.responseMapping)
          : null,
      },
      201,
    );
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
    const parsed = validate(updateToolSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const toolService = new ToolService(db);

    // Build the update object, JSON-stringifying complex fields
    const updates: Record<string, unknown> = {};
    if (parsed.data.displayName !== undefined)
      updates.displayName = parsed.data.displayName;
    if (parsed.data.description !== undefined)
      updates.description = parsed.data.description;
    if (parsed.data.endpoint !== undefined)
      updates.endpoint = parsed.data.endpoint;
    if (parsed.data.method !== undefined) updates.method = parsed.data.method;
    if (parsed.data.headers !== undefined) {
      if (parsed.data.headers && Object.keys(parsed.data.headers).length > 0) {
        updates.headers = await encryptHeaders(
          parsed.data.headers,
          c.env.ENCRYPTION_KEY,
        );
      } else {
        updates.headers = null;
      }
    }
    if (parsed.data.parameters !== undefined) {
      updates.parameters = JSON.stringify(parsed.data.parameters);
    }
    if (parsed.data.responseMapping !== undefined) {
      updates.responseMapping = parsed.data.responseMapping
        ? JSON.stringify(parsed.data.responseMapping)
        : null;
    }
    if (parsed.data.enabled !== undefined)
      updates.enabled = parsed.data.enabled;
    if (parsed.data.timeout !== undefined)
      updates.timeout = parsed.data.timeout;
    if (parsed.data.sortOrder !== undefined)
      updates.sortOrder = parsed.data.sortOrder;

    const updated = await toolService.updateTool(
      c.req.param("toolId"),
      project.id,
      updates,
    );
    if (!updated) return c.json({ error: "Not found" }, 404);

    // Decrypt headers for masking in the response
    let maskedResponseHeaders: Record<string, string> | null = null;
    if (updated.headers) {
      try {
        const decrypted = isEncrypted(updated.headers)
          ? await decryptHeaders(updated.headers, c.env.ENCRYPTION_KEY)
          : (JSON.parse(updated.headers) as Record<string, string>);
        maskedResponseHeaders = maskHeaders(decrypted);
      } catch {
        maskedResponseHeaders = null;
      }
    }

    return c.json({
      ...updated,
      parameters: JSON.parse(updated.parameters),
      headers: maskedResponseHeaders,
      responseMapping: updated.responseMapping
        ? JSON.parse(updated.responseMapping)
        : null,
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

    const assignable = await getAssignableUsers(db, project.id);
    return c.json(assignable);
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
    let [resources, counts, articleBridge] = await Promise.all([
      resourceService.getResourcesByProject(project.id),
      resourceService.getCrawledPageCountsByResource(project.id),
      db
        .select({
          articleId: helpArticles.id,
          title: helpArticles.title,
          articleSlug: helpArticles.slug,
          categorySlug: helpCategories.slug,
        })
        .from(helpArticles)
        .innerJoin(
          helpCategories,
          eq(helpArticles.categoryId, helpCategories.id),
        )
        .where(eq(helpArticles.projectId, project.id)),
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

    const articleById = new Map(
      articleBridge.map((a) => [a.articleId, a]),
    );

    const enriched = resources.map((r) => {
      const base =
        r.type === "webpage"
          ? { ...r, pageCount: counts.get(r.id) ?? 0 }
          : r;
      if (r.sourceArticleId) {
        const article = articleById.get(r.sourceArticleId);
        if (article) {
          return {
            ...base,
            sourceArticle: {
              id: article.articleId,
              title: article.title,
              categorySlug: article.categorySlug,
              articleSlug: article.articleSlug,
            },
          };
        }
      }
      return base;
    });
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
    const deleted = await resourceService.deleteResource(
      c.req.param("resourceId"),
      project.id,
    );
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
    const articles = await service.listArticles(project.id, {
      categoryId,
      status,
    });
    return c.json(articles);
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
        service.listAllPublishedArticles(project.id),
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
    const article: HelpArticleRow = {
      id: "preview",
      projectId: project.id,
      categoryId: category.id,
      title,
      slug: parsed.data.slug?.trim() || "preview",
      excerpt: parsed.data.excerpt ?? null,
      content: parsed.data.content,
      status: "draft",
      sortOrder: 0,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    // Prev/next mirror the live page: derived from published siblings. When the
    // draft shares a slug with an existing published article, surround it.
    const siblings = await service.listArticles(project.id, {
      categoryId: category.id,
      status: "published",
    });
    const currentIndex = siblings.findIndex((a) => a.slug === article.slug);
    const prevArticle = currentIndex > 0 ? siblings[currentIndex - 1] : null;
    const nextArticle =
      currentIndex >= 0 && currentIndex < siblings.length - 1
        ? siblings[currentIndex + 1]
        : null;

    const bodyHtml = await renderMarkdown(
      ensureArticleTitle(article.content ?? "", article.title),
      {
        projectSlug: project.slug,
        customUrl: settings?.helpCustomUrl ?? null,
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
      prevArticle,
      nextArticle,
      widgetConfig: widgetConfigRow,
      helpCustomUrl: settings?.helpCustomUrl ?? null,
      topNav,
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
      const updated = await service.updateArticle(
        c.req.param("artId"),
        project.id,
        parsed.data,
        project.slug,
      );
      if (!updated) return c.json({ error: "Not found" }, 404);
      c.executionCtx.waitUntil(
        triggerAutoRagSync(c.env, "helpdesk.article.update"),
      );
      return c.json(updated);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message =
        err instanceof Error ? err.message : "Failed to update article";
      if (code === "slug_conflict") {
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
          " and returns the response body unchanged.",
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
    const inboxFilter = c.req.query("filter") as InboxFilter | undefined;
    const limit = Math.min(
      parseInt(c.req.query("limit") ?? "25", 10) || 25,
      100,
    );
    const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
    const searchQuery = c.req.query("q")?.trim() || undefined;
    const chatService = new ChatService(db);

    // Lazy auto-close stale conversations (single query, no double fetch)
    const settings = await projectService.getSettings(project.id);
    let convos = await chatService.getConversationsByProject(
      project.id,
      limit,
      offset,
      statusFilter,
      searchQuery,
      inboxFilter,
    );
    if (settings?.autoCloseMinutes && statusFilter !== "closed" && inboxFilter !== "resolved") {
      const closedIds = await chatService.checkAndCloseStaleForProject(
        convos,
        settings.autoCloseMinutes,
      );
      if (closedIds.length > 0) {
        convos = convos.map((c) =>
          closedIds.includes(c.id) ? { ...c, status: "closed" as const } : c,
        );
        if (statusFilter === "open") {
          convos = convos.filter((c) => c.status !== "closed");
        }
      }
    }
    const [counts, lastMsgMap] = await Promise.all([
      chatService.getInboxCounts(project.id),
      chatService.getLastMessagesByConversationIds(convos.map((c) => c.id)),
    ]);
    const conversationsWithPreview = convos.map((c) => ({
      ...c,
      lastMessage: lastMsgMap.get(c.id) ?? null,
    }));
    return c.json({
      conversations: conversationsWithPreview,
      counts,
      hasMore: convos.length === limit,
      serverTime: Date.now(),
    });
  })
  .get("/api/projects/:id/conversations/updates", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const sinceParam = c.req.query("since");
    const since = sinceParam ? parseInt(sinceParam, 10) : 0;
    if (!Number.isFinite(since) || since < 0) {
      return c.json({ error: "Invalid since parameter" }, 400);
    }

    const chatService = new ChatService(db);
    const serverTime = Date.now();

    // If no since timestamp provided, return empty updates plus current counts.
    // The client should establish its baseline using the main list query.
    if (since === 0) {
      const counts = await chatService.getConversationCounts(project.id);
      return c.json({ updates: [], counts, serverTime });
    }

    const [updates, counts] = await Promise.all([
      chatService.getConversationUpdatesSince(project.id, new Date(since)),
      chatService.getConversationCounts(project.id),
    ]);
    const lastMsgMap = await chatService.getLastMessagesByConversationIds(
      updates.map((u) => u.id),
    );
    const updatesWithPreview = updates.map((u) => ({
      ...u,
      lastMessage: lastMsgMap.get(u.id) ?? null,
    }));

    return c.json({ updates: updatesWithPreview, counts, serverTime });
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
    const rows = await new ChatService(db).getNeedsReviewSince(project.id, since);
    const items = rows.map((row) => {
      let meta: Record<string, unknown> = {};
      try {
        const parsed = row.metadata ? JSON.parse(row.metadata) : {};
        meta = typeof parsed === "object" && parsed !== null ? parsed : {};
      } catch { /* ignore */ }
      return {
        id: row.id,
        visitorName: row.visitorName,
        visitorEmail: row.visitorEmail,
        summary: typeof meta.teamRequestSummary === "string" ? meta.teamRequestSummary : null,
        summaryMessageId:
          typeof meta.reviewSummaryMessageId === "string" ? meta.reviewSummaryMessageId : null,
        updatedAt: row.updatedAt.getTime(),
      };
    });
    return c.json({ serverTime: Date.now(), items });
  })
  .get("/api/projects/:id/conversations/:convId/ws", (c) =>
    handleDashboardWsUpgrade(c),
  )
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
    const chatService = new ChatService(db);
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
            broadcastStatusChange(
              c.env,
              c.executionCtx,
              conversation.id,
              "closed",
            );
            broadcastClosed(
              c.env,
              c.executionCtx,
              conversation.id,
              "ended",
            );
            await triggerAutoRefinementIfEnabled({
              projectId: project.id,
              conversationId: conversation.id,
              db,
              env: c.env,
              kv: c.env.CONVERSATIONS_CACHE,
              source: "stale_auto_close",
            });
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
      chatService.getRecentMessages(conversation.id, 25),
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
      ...msg,
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
      conversation: { ...conversation, visitorBlocked: !!ban },
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

    const chatService = new ChatService(db);
    const conversation = await chatService.getConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) return c.json({ error: "Not found" }, 404);

    const { messages: msgs, hasMore } = await chatService.getMessagesBefore(
      conversation.id,
      before,
      limit,
    );

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
      ...msg,
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

    const chatService = new ChatService(db);
    const conversation = await chatService.getConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Not found" }, 404);
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
    if (conversation.status === "closed") {
      await chatService.reopenConversation(conversation.id, project.id);
    }

    const message = await chatService.addMessage({
      conversationId: conversation.id,
      role: "agent",
      content: parsed.data.content?.trim() || (parsed.data.imageUrl ? "Sent an image" : ""),
      imageUrl: parsed.data.imageUrl ?? null,
      userId: user.id,
      senderName: user.name,
      senderAvatar: avatar,
    });

    // Emit "joined" once — only when picking up an escalated conversation for the first time
    if (conversation.status === "waiting_agent") {
      await chatService.addSystemMessage(
        conversation.id,
        "joined",
        `${user.name} joined the conversation`,
      ).catch(() => {});
    }

    await chatService.updateConversationStatus(
      conversation.id,
      project.id,
      "agent_replied",
    );

    broadcastMessageNew(c.env, c.executionCtx, conversation.id, message, {
      excludeSubjectId: user.id,
    });
    broadcastStatusChange(
      c.env,
      c.executionCtx,
      conversation.id,
      "agent_replied",
    );

    return c.json(message, 201);
  })
  // ─── Compose draft: turn an agent's shorthand instruction into a
  // tone-matched, visitor-language chat reply (no persistence, no RAG) ───────
  .post("/api/projects/:id/conversations/:convId/compose-draft", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const ip = getClientIp(c);
    if (
      !checkRateLimit(
        `compose-draft:${c.req.param("id")}:${user.id}:${ip}`,
        30,
        60_000,
      )
    ) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const body = await c.req.json();
    const parsed = validate(composeDraftSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const chatService = new ChatService(db);
    const conversation = await chatService.getConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Not found" }, 404);
    }

    const [settings, { messages: msgs }] = await Promise.all([
      projectService.getSettings(project.id),
      chatService.getRecentMessages(conversation.id, 20),
    ]);

    const runtime = createModelRuntimeState({
      model: c.env.AI_MODEL,
      geminiApiKey: c.env.GEMINI_API_KEY,
      openaiApiKey: c.env.OPENAI_API_KEY,
    });

    try {
      const message = await runWithModelFallback({
        runtime,
        stage: "compose_agent_draft",
        logContext: { projectId: project.id, conversationId: conversation.id },
        operation: (activeConfig) =>
          composeAgentDraft(
            createLanguageModel(activeConfig),
            {
              instruction: parsed.data.instruction,
              conversationHistory: msgs.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              settings,
            },
            { throwOnModelError: true },
          ),
      });
      if (!message) return c.json({ error: "compose_failed" }, 502);
      return c.json({ message });
    } catch (error) {
      logError("compose_draft.failed", error, {
        projectId: project.id,
        conversationId: conversation.id,
      });
      return c.json({ error: "compose_failed" }, 502);
    }
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

    const chatService = new ChatService(db);
    const conversation = await chatService.getConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    if (!conversation.visitorEmail) {
      return c.json({ error: "No visitor email address" }, 400);
    }

    const message = await chatService.getMessageById(parsed.data.messageId);
    if (!message || message.conversationId !== conversation.id) {
      return c.json({ error: "Message not found" }, 404);
    }

    if (message.role !== "agent" && message.role !== "bot") {
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
    await emailService.sendAgentMessageEmail({
      to: conversation.visitorEmail,
      projectSlug: project.slug,
      projectName: project.name,
      conversationId: conversation.id,
      messageId: message.id,
      agentName: message.senderName ?? user.name ?? "Support",
      agentAvatar: message.senderAvatar ?? null,
      messageContent: message.content,
      dashboardUrl: `https://replymaven.com/app/projects/${project.id}/conversations/${conversation.id}`,
      accentColor: widgetCfg?.primaryColor ?? null,
    });

    await chatService.markMessageAsEmailed(message.id);

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

      const chatService = new ChatService(db);
      const conversation = await chatService.getConversationById(
        convId,
        project.id,
      );
      if (!conversation) return c.json({ error: "Not found" }, 404);

      const result = await chatService.deleteAgentMessage(convId, messageId);
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

      broadcastMessageDeleted(c.env, c.executionCtx, convId, messageId, {
        excludeSubjectId: user.id,
      });

      return c.json({ ok: true });
    },
  )
  .post("/api/projects/:id/conversations/:convId/close", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const chatService = new ChatService(db);
    const conversation = await chatService.getConversationById(
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
    broadcastStatusChange(c.env, c.executionCtx, conversation.id, "closed");
    broadcastClosed(c.env, c.executionCtx, conversation.id, closeReason ?? null);

    // Auto-draft canned response in background — but never for spam: a spam
    // close is a silent triage action, not a real resolution to learn from.
    if (closeReason !== "spam") {
      c.executionCtx.waitUntil(
        triggerAutoRefinementIfEnabled({
          projectId: project.id,
          conversationId: conversation.id,
          db,
          env: c.env,
          kv: c.env.CONVERSATIONS_CACHE,
          source: "manual_close",
        }),
      );
    }

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
    const chatService = new ChatService(db);
    const reopened = await chatService.reopenConversation(
      c.req.param("convId"),
      project.id,
    );
    if (!reopened) return c.json({ error: "Not found" }, 404);
    broadcastStatusChange(c.env, c.executionCtx, reopened.id, "active");
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
    const chatService = new ChatService(db);
    const conversation = await chatService.getConversationById(
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
    const chatService = new ChatService(db);
    const convId = c.req.param("convId");
    const conversation = await chatService.getConversationById(convId, project.id);
    if (!conversation) return c.json({ error: "Not found" }, 404);
    const until = parsed.data.until ? new Date(parsed.data.until) : null;
    await chatService.setSnooze(convId, project.id, until);
    if (until) {
      await chatService.addSystemMessage(convId, "snoozed",
        `Snoozed until ${until.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
    } else {
      await chatService.addSystemMessage(convId, "snooze_ended", "Snooze ended");
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
    const chatService = new ChatService(db);
    const conversation = await chatService.getConversationById(c.req.param("convId"), project.id);
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
    const chatService = new ChatService(db);
    const conversation = await chatService.getConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) return c.json({ error: "Not found" }, 404);

    // Validate the assignee belongs to the owner's assignable users (owner +
    // accepted team members with access to this project).
    if (parsed.data.assigneeId) {
      const assignable = await getAssignableUsers(db, project.id);
      if (!assignable.some((u) => u.id === parsed.data.assigneeId)) {
        return c.json(
          { error: "Assignee is not a member of this project's team" },
          400,
        );
      }
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
    return c.json(await new ChatService(db).getInboxCounts(project.id));
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

    const banService = new VisitorBanService(db);
    const existing = await banService.isVisitorBanned(
      project.id,
      parsed.data.visitorId,
      parsed.data.visitorEmail,
    );
    if (existing) {
      return c.json({ error: "Visitor is already banned" }, 409);
    }

    const chatService = new ChatService(db);
    if (parsed.data.conversationId) {
      await chatService.updateConversationStatus(
        parsed.data.conversationId,
        project.id,
        "closed",
        "spam",
      );
      broadcastStatusChange(
        c.env,
        c.executionCtx,
        parsed.data.conversationId,
        "closed",
      );
      broadcastClosed(
        c.env,
        c.executionCtx,
        parsed.data.conversationId,
        "spam",
      );
    }

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

  // ─── Knowledge Suggestions ──────────────────────────────────────────────────
  .get("/api/projects/:id/knowledge-suggestions", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    // Support both single type and multiple types (comma-separated)
    const typeParam = c.req.query("type");
    let typeFilter:
      | Array<
          | "new_faq"
          | "add_faq_pair"
          | "refine_faq_pair"
          | "new_sop"
          | "add_sop"
          | "refine_sop"
          | "update_pdf"
          | "update_webpage"
          | "update_context"
        >
      | undefined;

    if (typeParam) {
      typeFilter = typeParam.split(",") as typeof typeFilter;
    }

    const service = new KnowledgeSuggestionService(db);
    const suggestions = await service.getPendingByProject(
      project.id,
      typeFilter,
    );
    return c.json(suggestions);
  })
  .get("/api/projects/:id/knowledge-suggestions/counts", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new KnowledgeSuggestionService(db);
    const counts = await service.getPendingCountsByProject(project.id);
    return c.json(counts);
  })
  .post("/api/projects/:id/knowledge-suggestions/:sugId/approve", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new KnowledgeSuggestionService(db);
    try {
      const result = await service.approve(
        c.req.param("sugId"),
        project.id,
        c.env.UPLOADS,
      );
      if (!result.success) {
        return c.json(
          { error: result.error },
          result.error === "Not found" ? 404 : 400,
        );
      }
      logInfo("knowledge_suggestion.approved", {
        projectId: project.id,
        suggestionId: c.req.param("sugId"),
      });
      return c.json({ ok: true });
    } catch (error) {
      logError("knowledge_suggestion.approve_failed", error, {
        projectId: project.id,
        suggestionId: c.req.param("sugId"),
      });
      throw error;
    }
  })
  .post("/api/projects/:id/knowledge-suggestions/:sugId/reject", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new KnowledgeSuggestionService(db);
    try {
      const rejected = await service.reject(c.req.param("sugId"), project.id);
      if (!rejected) return c.json({ error: "Not found" }, 404);
      logInfo("knowledge_suggestion.rejected", {
        projectId: project.id,
        suggestionId: c.req.param("sugId"),
      });
      return c.json({ ok: true });
    } catch (error) {
      logError("knowledge_suggestion.reject_failed", error, {
        projectId: project.id,
        suggestionId: c.req.param("sugId"),
      });
      throw error;
    }
  })
  .post("/api/projects/:id/knowledge-suggestions/bulk-approve", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json({ error: "Invalid ids array" }, 400);
    }

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new KnowledgeSuggestionService(db);
    try {
      const result = await service.bulkApprove(
        body.ids,
        project.id,
        c.env.UPLOADS,
      );
      logInfo("knowledge_suggestion.bulk_approved", {
        projectId: project.id,
        succeeded: result.succeeded.length,
        failed: result.failed.length,
      });
      return c.json(result);
    } catch (error) {
      logError("knowledge_suggestion.bulk_approve_failed", error, {
        projectId: project.id,
        ids: body.ids,
      });
      throw error;
    }
  })
  .post("/api/projects/:id/knowledge-suggestions/bulk-reject", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json({ error: "Invalid ids array" }, 400);
    }

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new KnowledgeSuggestionService(db);
    try {
      const result = await service.bulkReject(body.ids, project.id);
      logInfo("knowledge_suggestion.bulk_rejected", {
        projectId: project.id,
        succeeded: result.succeeded.length,
        failed: result.failed.length,
      });
      return c.json(result);
    } catch (error) {
      logError("knowledge_suggestion.bulk_reject_failed", error, {
        projectId: project.id,
        ids: body.ids,
      });
      throw error;
    }
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

    await projectService.updateSettings(project.id, parsed.data);

    // Set webhook if bot token is provided
    if (parsed.data.telegramBotToken) {
      const telegramService = new TelegramService(db);
      const webhookUrl = `${c.env.BETTER_AUTH_URL}/api/telegram/webhook/${project.id}`;
      await telegramService.setWebhook(
        parsed.data.telegramBotToken,
        webhookUrl,
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

    const telegramService = new TelegramService(db);
    const success = await telegramService.testConnection(
      settings.telegramBotToken,
      settings.telegramChatId,
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

    const ext = fileObj.name.split(".").pop() ?? "bin";
    const uploadKey = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const buffer = await fileObj.arrayBuffer();

    await c.env.UPLOADS.put(uploadKey, buffer, {
      httpMetadata: { contentType: fileObj.type },
    });

    return c.json({ key: uploadKey, url: `/api/uploads/${uploadKey}` }, 201);
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
  env: Env,
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

// ─── Export ───────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,
  queue: handleQueue,
};
