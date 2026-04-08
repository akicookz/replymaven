import { Hono } from "hono";
import { cors } from "hono/cors";
import { except } from "hono/combine";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { users } from "./db/auth.schema";
import { conversations, cannedResponses } from "./db/schema";
import { createAuth } from "./auth";
import { type HonoAppContext, type Plan } from "./types";
import { ProjectService } from "./services/project-service";
import { WidgetService } from "./services/widget-service";
import { ChatService } from "./services/chat-service";
import { ResourceService } from "./services/resource-service";
import { AiService } from "./services/ai-service";
import { TelegramService } from "./services/telegram-service";
import { CannedResponseService } from "./services/canned-response-service";
import { DashboardService } from "./services/dashboard-service";
import { CrawlService, type CrawlMessage } from "./services/crawl-service";
import { EmailService } from "./services/email-service";
import { ToolService } from "./services/tool-service";
import { GuidelineService } from "./services/guideline-service";
import {
  encryptHeaders,
  decryptHeaders,
  maskHeaders,
  isEncrypted,
} from "./services/encryption-service";
import { BillingService } from "./services/billing-service";
import { TeamService } from "./services/team-service";
import { handleWidgetMessageTurn } from "./chat-runtime/orchestration/handle-widget-message-turn";
import { triggerAutoDraftIfEnabled } from "./chat-runtime/post-turn/auto-draft";
import { buildToolRegistry } from "./chat-runtime/tools/build-tool-registry";
import { toToolDefinition } from "./chat-runtime/types";
import { logError, logInfo } from "./observability";
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
  updateCrawledPageContentSchema,
  createConversationSchema,
  sendMessageSchema,
  agentReplySchema,
  createCannedResponseSchema,
  updateCannedResponseSchema,
  suggestCannedResponseSchema,
  updateTelegramSchema,
  onboardingStep1Schema,
  onboardingContextSchema,
  onboardingWidgetSchema,
  updateVisitorEmailSchema,
  updateConversationPublicSchema,
  updateInquiryConfigSchema,
  submitInquirySchema,
  updateInquiryStatusSchema,
  bulkUpdateInquiryStatusSchema,
  createToolSchema,
  updateToolSchema,
  testToolSchema,
  createCheckoutSchema,
  inviteTeamMemberSchema,
  updateTeamMemberRoleSchema,
  updateProfileSchema,
  requestEmailChangeSchema,
  verifyEmailChangeSchema,
  createGuidelineSchema,
  updateGuidelineSchema,
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

function buildInquiryConversationMessage(
  formData: Record<string, string>,
): string {
  const lines = ["Inquiry submission"];

  for (const [key, value] of Object.entries(formData)) {
    const trimmedValue = value.trim();
    if (!trimmedValue) continue;
    lines.push(`${key}: ${trimmedValue}`);
  }

  return lines.join("\n");
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function extractInquiryEmail(
  formData: Record<string, string>,
): string | null {
  for (const [key, value] of Object.entries(formData)) {
    if (!/email/i.test(key)) continue;
    if (isLikelyEmail(value)) return value.trim();
  }

  return null;
}

function extractInquiryName(
  formData: Record<string, string>,
): string | null {
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

function buildInquiryRecord(
  formData: Record<string, string>,
  visitorName: string | null,
  visitorEmail: string | null,
): Record<string, string> {
  const enrichedData = { ...formData };

  if (visitorName && !extractInquiryName(enrichedData)) {
    enrichedData["Visitor name"] = visitorName;
  }

  if (visitorEmail && !extractInquiryEmail(enrichedData)) {
    enrichedData["Visitor email"] = visitorEmail;
  }

  return enrichedData;
}

// ─── Slug generator ──────────────────────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
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
  .use(
    "*",
    except(["/api/*"], async (c) => {
      return c.env.ASSETS.fetch(c.req.raw);
    }),
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

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
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

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
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

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
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
            triggerAutoDraftIfEnabled({
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

    // Try KV cache first
    const cached = await chatService.getFromCache(conversationId, project.id);
    if (cached) {
      return c.json({
        messages: cached,
        status: conversation.status,
      });
    }

    const msgs = await chatService.getMessages(conversationId);
    return c.json({
      messages: msgs,
      status: conversation.status,
    });
  })

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
    try {
      const body = await c.req.json();
      if (body.presence === "background") presence = "background";
    } catch {
      // No body or invalid JSON — default to active
    }

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
    const conversation = await chatService.updateVisitorLastSeen(
      conversationId,
      project.id,
      presence,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
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

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
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

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
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

  // ─── Inquiry Submit (public) ──────────────────────────────────────────────
  .post("/api/widget/:projectSlug/inquiries", async (c) => {
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
    const parsed = validate(submitInquirySchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const widgetService = new WidgetService(db);
    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);

    // Verify inquiry form is enabled
    const formConfig = await widgetService.getInquiryConfig(project.id);
    if (!formConfig?.enabled) {
      return c.json({ error: "Inquiry form is not enabled" }, 400);
    }

    const visitorId = parsed.data.visitorId ?? crypto.randomUUID();
    const visitorEmail =
      parsed.data.visitorEmail ?? extractInquiryEmail(parsed.data.data);
    const visitorName =
      parsed.data.visitorName ?? extractInquiryName(parsed.data.data);
    const inquiryData = buildInquiryRecord(
      parsed.data.data,
      visitorName,
      visitorEmail,
    );

    let conversation =
      await chatService.getActiveConversationByVisitor(project.id, visitorId);

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

    const submission = await widgetService.createInquiry(
      project.id,
      visitorId,
      inquiryData,
    );

    const inquiryMessage = buildInquiryConversationMessage(inquiryData);

    await chatService.addMessage(
      {
        conversationId: conversation.id,
        role: "visitor",
        content: inquiryMessage,
        imageUrl: null,
        sources: null,
      },
      project.id,
    );

    // Notify via Telegram if configured
    const settings = await projectService.getSettings(project.id);
    if (settings?.telegramBotToken && settings?.telegramChatId) {
      const telegramService = new TelegramService(db);
      c.executionCtx.waitUntil(
        (conversation.status === "waiting_agent" ||
        conversation.status === "agent_replied"
          ? telegramService.forwardVisitorMessage(
              settings.telegramBotToken,
              settings.telegramChatId,
              conversation.visitorName,
              inquiryMessage,
              conversation.id,
              conversation.telegramThreadId
                ? parseInt(conversation.telegramThreadId, 10)
                : undefined,
            )
          : telegramService.notifyInquiry(
              settings.telegramBotToken,
              settings.telegramChatId,
              inquiryData,
              c.env.BETTER_AUTH_URL,
              project.id,
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
        const dashboardUrl = `${c.env.BETTER_AUTH_URL}/app/projects/${project.id}/inquiries`;
        c.executionCtx.waitUntil(
          emailService
            .sendInquiryNotification({
              ownerEmail,
              projectName,
              formData: inquiryData,
              dashboardUrl,
            })
            .catch((err) => {
              console.error("Contact form email failed:", err);
            }),
        );
      }
    }

    return c.json(
      {
        ...submission,
        conversationId: conversation.id,
        conversationStatus: conversation.status,
        visitorEmail,
        visitorName,
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
            chat: { id: number; type: string; title?: string; first_name?: string };
          };
        }>;
        description?: string;
      }>();

      if (!data.ok) {
        return c.json(
          { error: data.description ?? "Invalid bot token" },
          400,
        );
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

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
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

          // Auto-draft canned response in background
          c.executionCtx.waitUntil(
            triggerAutoDraftIfEnabled({
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
          await chatService.addMessage(
            {
              conversationId,
              role: "bot",
              content: responseText,
              senderName: projectSettings?.botName ?? null,
            },
            projectId,
          );

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
    await chatService.addMessage(
      {
        conversationId,
        role: "agent",
        content: message.text,
        senderName: message.from?.first_name ?? null,
      },
      projectId,
    );

    await chatService.updateConversationStatus(
      conversationId,
      projectId,
      "agent_replied",
    );

    return c.json({ ok: true });
  })

  // ─── Widget Embed JS (redirect to R2 custom domain) ────────────────────────
  .get("/api/widget-embed.js", (c) => {
    return c.redirect("https://widget.replymaven.com/widget-embed.js", 301);
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

    // Set billing context defaults
    c.set("subscription", null);
    c.set("planLimits", null);
    c.set("effectiveUserId", null);

    // Resolve subscription + team membership for authenticated users
    if (session?.user) {
      const teamService = new TeamService(db);
      const effectiveUserId = await teamService.getEffectiveUserId(
        session.user.id,
      );
      c.set("effectiveUserId", effectiveUserId);

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

    // Generate slug from website name
    const baseSlug = slugify(parsed.data.websiteName);

    // Extract domain from URL
    let domain: string | undefined;
    try {
      domain = new URL(parsed.data.websiteUrl).hostname;
    } catch {
      domain = undefined;
    }

    // Check if this user already has a project with this slug (idempotent re-entry)
    const existing = await projectService.getProjectBySlug(user.id, baseSlug);
    if (existing) {
      // Reuse the existing project — update its settings and return it
      await projectService.updateSettings(existing.id, {
        companyName: parsed.data.companyName,
        companyUrl: parsed.data.websiteUrl,
        industry: parsed.data.industry,
      });
      return c.json({ projectId: existing.id, slug: existing.slug }, 200);
    }

    // Generate a unique slug (appends -2, -3, etc. if needed)
    const slug = await projectService.generateUniqueSlug(user.id, baseSlug);

    // Create the project
    const project = await projectService.createProject({
      userId: user.id,
      name: parsed.data.websiteName,
      slug,
      domain,
    });

    // Update settings with company info
    await projectService.updateSettings(project.id, {
      companyName: parsed.data.companyName,
      companyUrl: parsed.data.websiteUrl,
      industry: parsed.data.industry,
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
    if (!project || project.userId !== user.id) {
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

      // Summarize via AI
      const aiService = new AiService({
        model: c.env.AI_MODEL,
        geminiApiKey: c.env.GEMINI_API_KEY,
        openaiApiKey: c.env.OPENAI_API_KEY,
      });
      const context = await aiService.summarizeWebsite(rawText);

      if (!context) {
        return c.json({ context: "", scraped: false });
      }

      // Save the summary to project settings
      await projectService.updateSettings(project.id, {
        companyContext: context,
      });

      return c.json({ context, scraped: true });
    } catch {
      return c.json({ context: "", scraped: false });
    }
  })

  // ─── Step 2 fallback: Manually set context ────────────────────────────────
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
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    await projectService.updateSettings(project.id, {
      companyContext: parsed.data.companyContext,
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    const currentUsage = await billingService.getUsage(effectiveUserId, subscription);
    const seatCount = await teamService.getSeatCount(effectiveUserId);
    const membership = await teamService.getTeamMembership(user.id);

    if (!subscription) {
      return c.json({
        subscription: null,
        usage: { messagesUsed: 0 },
        usagePeriodStart: null,
        usagePeriodEnd: null,
        limits: null,
        seats: { current: 1, max: 0 },
        role: "owner",
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
      role: membership ? membership.role : "owner",
    });
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
    if (parsed.data.workTitle !== undefined) updates.workTitle = parsed.data.workTitle;
    if (parsed.data.profilePicture !== undefined) updates.profilePicture = parsed.data.profilePicture;

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
      return c.json({ error: "New email is the same as your current email" }, 400);
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
      createVerificationOTP: (opts: { body: { email: string; type: string } }) => Promise<string>;
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
    const intentRaw = await c.env.CONVERSATIONS_CACHE.get(`email-change:${user.id}`);
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
        { error: "Too many incorrect attempts. Please request a new code.", code: "too_many_attempts" },
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
          error: remaining > 0
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
    return c.json({ members, ownerId: effectiveUserId });
  })

  // ─── Invite Team Member ─────────────────────────────────────────────────────
  .post("/api/team/invite", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // Only owner and admin can invite
    const db = c.get("db");
    const teamService = new TeamService(db);
    const membership = await teamService.getTeamMembership(user.id);
    if (membership && membership.role === "member") {
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

    try {
      const member = await teamService.inviteMember(
        effectiveUserId,
        parsed.data.email,
        parsed.data.role,
      );
      return c.json(member);
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

    // Only owner can change roles
    const db = c.get("db");
    const teamService = new TeamService(db);
    const membership = await teamService.getTeamMembership(user.id);
    if (membership) {
      return c.json({ error: "Only the account owner can change roles" }, 403);
    }

    const body = await c.req.json();
    const parsed = validate(updateTeamMemberRoleSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    try {
      const member = await teamService.updateMemberRole(
        user.id,
        c.req.param("memberId"),
        parsed.data.role,
      );
      return c.json(member);
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

    // Owner and admin can remove members
    const db = c.get("db");
    const teamService = new TeamService(db);
    const membership = await teamService.getTeamMembership(user.id);
    if (membership && membership.role === "member") {
      return c.json(
        { error: "Only owners and admins can remove members" },
        403,
      );
    }

    const effectiveUserId = c.get("effectiveUserId") ?? user.id;

    try {
      await teamService.revokeMember(effectiveUserId, c.req.param("memberId"));
      return c.json({ ok: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to remove member";
      return c.json({ error: message }, 400);
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD ENDPOINTS (session-authenticated)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Dashboard Stats ────────────────────────────────────────────────────────
  .get("/api/dashboard", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectId = c.req.query("projectId");
    const dashboardService = new DashboardService(db);
    const stats = await dashboardService.getStats(user.id, projectId);
    return c.json(stats);
  })

  // ─── Projects CRUD ──────────────────────────────────────────────────────────
  .get("/api/projects", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const service = new ProjectService(db);
    const projects = await service.getProjectsByUserId(user.id);
    return c.json(projects);
  })
  .get("/api/projects/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const service = new ProjectService(db);
    const project = await service.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
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
    const slug = await service.generateUniqueSlug(user.id, baseSlug);
    const project = await service.createProject({
      userId: user.id,
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

    const db = c.get("db");
    const service = new ProjectService(db);
    const project = await service.updateProject(
      c.req.param("id"),
      user.id,
      parsed.data,
    );
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  })
  .delete("/api/projects/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const service = new ProjectService(db);
    const deleted = await service.deleteProject(c.req.param("id"), user.id);
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
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const settings = await projectService.getSettings(project.id);
    // Don't expose encrypted keys to frontend
    if (settings) {
      return c.json({
        ...settings,
        telegramBotToken: settings.telegramBotToken ? "••••••••" : null,
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
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const settings = await projectService.updateSettings(
      project.id,
      parsed.data,
    );
    return c.json(settings);
  })
  .post("/api/projects/:id/context/refresh", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);

    // Enforce max 1 inquiry action per project
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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

  // ─── Tools (Dashboard) ───────────────────────────────────────────────────
  .get("/api/projects/:id/tools", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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

  // ─── Inquiry Config (Dashboard) ───────────────────────────────────────────
  .get("/api/projects/:id/inquiries", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const config = await widgetService.getInquiryConfig(project.id);
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
  .put("/api/projects/:id/inquiries", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateInquiryConfigSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const config = await widgetService.upsertInquiryConfig(
      project.id,
      parsed.data,
    );
    return c.json({
      enabled: config.enabled,
      description: config.description,
      fields: JSON.parse(config.fields || "[]"),
    });
  })
  .get("/api/projects/:id/inquiries/submissions", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const submissions = await widgetService.getInquiries(
      project.id,
    );
    return c.json(
      submissions.map((s) => ({
        ...s,
        data: JSON.parse(s.data || "{}"),
      })),
    );
  })

  // ─── Update Inquiry Status ──────────────────────────────────────────────────
  // ─── Bulk Update Inquiry Status ───────────────────────────────────────────
  .patch("/api/projects/:id/inquiries/bulk-status", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(bulkUpdateInquiryStatusSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const updated = await widgetService.bulkUpdateInquiryStatus(
      parsed.data.ids,
      project.id,
      parsed.data.status,
    );
    return c.json({ updated });
  })

  .patch("/api/projects/:id/inquiries/:inquiryId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateInquiryStatusSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const inquiry = await widgetService.updateInquiryStatus(
      c.req.param("inquiryId"),
      project.id,
      parsed.data.status,
    );
    if (!inquiry) return c.json({ error: "Not found" }, 404);
    return c.json({ ...inquiry, data: JSON.parse(inquiry.data || "{}") });
  })

  // ─── Compose Inquiry Reply ─────────────────────────────────────────────────
  .post("/api/projects/:id/inquiries/:inquiryId/compose", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const inquiry = await widgetService.getInquiryById(
      c.req.param("inquiryId"),
      project.id,
    );
    if (!inquiry) return c.json({ error: "Not found" }, 404);

    const settings = await projectService.getSettings(project.id);
    const aiService = new AiService({
      model: c.env.AI_MODEL,
      geminiApiKey: c.env.GEMINI_API_KEY,
      openaiApiKey: c.env.OPENAI_API_KEY,
    });
    const inquiryData = JSON.parse(inquiry.data || "{}") as Record<string, string>;

    // Fetch user's work title for email signature
    const [userProfile] = await db
      .select({ workTitle: users.workTitle })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    // Find best matching canned response
    const cannedService = new CannedResponseService(db);
    const allApproved = (await cannedService.getByProject(project.id)).filter(
      (cr) => cr.status === "approved",
    );

    let topCannedMatch: { trigger: string; response: string } | null = null;
    if (allApproved.length > 0) {
      const queryText = Object.values(inquiryData).join(" ");
      const ranked = await aiService.rankCannedResponses(
        queryText,
        allApproved.map((cr) => ({ id: cr.id, trigger: cr.trigger, response: cr.response })),
      );
      if (ranked.length > 0 && ranked[0].score > 0.5) {
        topCannedMatch = { trigger: ranked[0].trigger, response: ranked[0].response };
      }
    }

    const reply = await aiService.composeInquiryReply(
      {
        toneOfVoice: settings?.toneOfVoice,
        customTonePrompt: settings?.customTonePrompt,
        companyContext: settings?.companyContext,
        companyName: settings?.companyName,
      },
      settings?.companyName ?? project.name,
      inquiryData,
      { name: user.name, email: user.email, workTitle: userProfile?.workTitle },
      topCannedMatch,
    );

    return c.json(reply);
  })

  // ─── Resources ─────────────────────────────────────────────────────────────
  .get("/api/projects/:id/resources", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const resourceService = new ResourceService(db, c.env.UPLOADS);
    const resources = await resourceService.getResourcesByProject(project.id);
    return c.json(resources);
  })
  .post("/api/projects/:id/resources", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
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
        resourceService.ingestPdf(
          project.id,
          resource.id,
          buffer,
          title.trim(),
        ),
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
        content: JSON.stringify(parsed.data.pairs),
      });

      c.executionCtx.waitUntil(
        resourceService.ingestFaqFromPairs(
          project.id,
          resource.id,
          parsed.data.title,
          parsed.data.pairs,
        ),
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
        resourceService.ingestWebpage(
          project.id,
          resource.id,
          parsed.data.url,
          parsed.data.title,
          c.env.CRAWL_QUEUE,
          c.env.CF_ACCOUNT_ID,
          c.env.BROWSER_RENDERING_API_TOKEN,
        ),
      );
    } else if (parsed.data.type === "faq" && parsed.data.content) {
      c.executionCtx.waitUntil(
        resourceService.ingestFaq(
          project.id,
          resource.id,
          parsed.data.title,
          parsed.data.content,
        ),
      );
    }

    return c.json(resource, 201);
  })
  .delete("/api/projects/:id/resources/:resourceId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const resourceService = new ResourceService(db, c.env.UPLOADS);
    const deleted = await resourceService.deleteResource(
      c.req.param("resourceId"),
      project.id,
    );
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  })
  .post("/api/projects/:id/resources/:resourceId/reindex", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
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

    // Re-trigger ingestion (use waitUntil to keep isolate alive)
    if (resource.type === "webpage" && resource.url) {
      c.executionCtx.waitUntil(
        resourceService.ingestWebpage(
          project.id,
          resource.id,
          resource.url,
          resource.title,
          c.env.CRAWL_QUEUE,
          c.env.CF_ACCOUNT_ID,
          c.env.BROWSER_RENDERING_API_TOKEN,
        ),
      );
    } else if (resource.type === "faq" && resource.content) {
      c.executionCtx.waitUntil(
        resourceService.ingestFaq(
          project.id,
          resource.id,
          resource.title,
          resource.content,
        ),
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
      );
      if (!updated) return c.json({ error: "Update failed" }, 500);
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
    return c.json(updated);
  })

  // ─── Crawled Pages ──────────────────────────────────────────────────────────
  .get("/api/projects/:id/resources/:resourceId/pages", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
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
      if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
      if (!project || project.userId !== user.id) {
        return c.json({ error: "Not found" }, 404);
      }

      const resourceService = new ResourceService(db, c.env.UPLOADS);
      const deleted = await resourceService.deleteCrawledPage(
        c.req.param("pageId"),
        c.req.param("resourceId"),
        project.id,
      );
      if (!deleted) return c.json({ error: "Not found" }, 404);
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
      if (!project || project.userId !== user.id) {
        return c.json({ error: "Not found" }, 404);
      }

      const resourceService = new ResourceService(db, c.env.UPLOADS);
      c.executionCtx.waitUntil(
        resourceService.refreshCrawledPage(
          c.req.param("pageId"),
          c.req.param("resourceId"),
          project.id,
          c.env.CF_ACCOUNT_ID,
          c.env.BROWSER_RENDERING_API_TOKEN,
        ),
      );

      return c.json({ ok: true, message: "Refresh started" });
    },
  )

  // ─── Conversations (Dashboard) ──────────────────────────────────────────────
  .get("/api/projects/:id/conversations", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const statusFilter = (c.req.query("status") as "open" | "closed" | "all") ?? "all";
    const limit = Math.min(parseInt(c.req.query("limit") ?? "25", 10) || 25, 100);
    const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);

    // Lazy auto-close stale conversations (single query, no double fetch)
    const settings = await projectService.getSettings(project.id);
    let convos = await chatService.getConversationsByProject(project.id, limit, offset, statusFilter);
    if (settings?.autoCloseMinutes && statusFilter !== "closed") {
      const closedIds = await chatService.checkAndCloseStaleForProject(convos, settings.autoCloseMinutes);
      if (closedIds.length > 0) {
        convos = convos.map((c) => closedIds.includes(c.id) ? { ...c, status: "closed" as const } : c);
        if (statusFilter === "open") {
          convos = convos.filter((c) => c.status !== "closed");
        }
      }
    }
    const counts = await chatService.getConversationCounts(project.id);
    return c.json({ conversations: convos, counts, hasMore: convos.length === limit });
  })
  .get("/api/projects/:id/conversations/:convId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
    let conversation = await chatService.getConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Not found" }, 404);
    }

    // Fetch settings once (used for auto-close check + botName/agentName)
    const settings = await projectService.getSettings(project.id);

    // Lazy auto-close check
    if (conversation.status !== "closed") {
      if (settings?.autoCloseMinutes) {
        const result = await chatService.checkAndCloseStale(
          conversation.id,
          project.id,
          settings.autoCloseMinutes,
        );
        if (result.closed && result.conversation) {
          conversation = result.conversation;
          c.executionCtx.waitUntil(
            triggerAutoDraftIfEnabled({
              projectId: project.id,
              conversationId: conversation.id,
              db,
              env: c.env,
              kv: c.env.CONVERSATIONS_CACHE,
              source: "stale_auto_close",
            }),
          );
        }
      }
    }

    const toolService = new ToolService(db);
    // Try KV cache first for messages, fall back to D1
    const cachedMsgs = await chatService.getFromCache(conversation.id, project.id);
    const [msgs, toolExecs] = await Promise.all([
      cachedMsgs ? Promise.resolve(cachedMsgs) : chatService.getMessages(conversation.id),
      toolService.getExecutionsByConversation(conversation.id),
    ]);

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
      toolExecutions: execsByMessageId.get(msg.id)?.map((ex) => ({
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

    // Fetch associated inquiry if one was created from this conversation
    let inquiry: {
      id: string;
      data: Record<string, string>;
      status: string;
      createdAt: number | Date;
    } | null = null;
    try {
      const metadata = conversation.metadata
        ? JSON.parse(conversation.metadata as string)
        : {};
      if (metadata.teamRequestSubmissionId) {
        const widgetService = new WidgetService(db);
        const inq = await widgetService.getInquiryById(
          metadata.teamRequestSubmissionId,
          project.id,
        );
        if (inq) {
          inquiry = {
            id: inq.id,
            data: inq.data ? JSON.parse(inq.data as string) : {},
            status: inq.status,
            createdAt: inq.createdAt,
          };
        }
      }
    } catch {
      // Ignore metadata parsing errors
    }

    return c.json({
      conversation,
      messages: messagesWithTools,
      botName: settings?.botName ?? null,
      agentName: settings?.agentName ?? null,
      inquiry,
    });
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
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
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
    const avatar = userProfile[0]?.profilePicture ?? userProfile[0]?.image ?? null;

    // Reopen closed conversations before adding the message
    if (conversation.status === "closed") {
      await chatService.reopenConversation(conversation.id, project.id);
    }

    const message = await chatService.addMessage(
      {
        conversationId: conversation.id,
        role: "agent",
        content: parsed.data.content,
        userId: user.id,
        senderName: user.name,
        senderAvatar: avatar,
      },
      project.id,
    );

    await chatService.updateConversationStatus(
      conversation.id,
      project.id,
      "agent_replied",
    );

    return c.json(message, 201);
  })
  .post("/api/projects/:id/conversations/:convId/close", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
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

    // Auto-draft canned response in background
    c.executionCtx.waitUntil(
      triggerAutoDraftIfEnabled({
        projectId: project.id,
        conversationId: conversation.id,
        db,
        env: c.env,
        kv: c.env.CONVERSATIONS_CACHE,
        source: "manual_close",
      }),
    );

    return c.json({ ok: true });
  })

  // ─── Canned Responses ───────────────────────────────────────────────────────
  .get("/api/projects/:id/canned-responses", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new CannedResponseService(db);
    const responses = await service.getByProject(project.id);
    return c.json(responses);
  })
  .post("/api/projects/:id/canned-responses", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createCannedResponseSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new CannedResponseService(db);
    try {
      const cr = await service.create({
        projectId: project.id,
        trigger: parsed.data.trigger,
        response: parsed.data.response,
        status: "approved",
      });
      logInfo("canned_response.created", {
        projectId: project.id,
        cannedResponseId: cr.id,
        source: "dashboard_manual",
        triggerLength: parsed.data.trigger.length,
        responseLength: parsed.data.response.length,
      });
      return c.json(cr, 201);
    } catch (error) {
      logError("canned_response.create_failed", error, {
        projectId: project.id,
        source: "dashboard_manual",
      });
      throw error;
    }
  })
  .patch("/api/projects/:id/canned-responses/:crId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateCannedResponseSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new CannedResponseService(db);
    try {
      const cr = await service.update(
        c.req.param("crId"),
        project.id,
        parsed.data,
      );
      if (!cr) return c.json({ error: "Not found" }, 404);
      logInfo("canned_response.updated", {
        projectId: project.id,
        cannedResponseId: cr.id,
        fieldsUpdated: Object.keys(parsed.data),
      });
      return c.json(cr);
    } catch (error) {
      logError("canned_response.update_failed", error, {
        projectId: project.id,
        cannedResponseId: c.req.param("crId"),
      });
      throw error;
    }
  })
  .post("/api/projects/:id/canned-responses/:crId/approve", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new CannedResponseService(db);
    try {
      const approved = await service.approve(c.req.param("crId"), project.id);
      if (!approved) return c.json({ error: "Not found" }, 404);
      logInfo("canned_response.approved", {
        projectId: project.id,
        cannedResponseId: c.req.param("crId"),
      });
      return c.json({ ok: true });
    } catch (error) {
      logError("canned_response.approve_failed", error, {
        projectId: project.id,
        cannedResponseId: c.req.param("crId"),
      });
      throw error;
    }
  })
  .delete("/api/projects/:id/canned-responses/:crId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new CannedResponseService(db);
    try {
      const deleted = await service.delete(c.req.param("crId"), project.id);
      if (!deleted) return c.json({ error: "Not found" }, 404);
      logInfo("canned_response.deleted", {
        projectId: project.id,
        cannedResponseId: c.req.param("crId"),
      });
      return c.json({ ok: true });
    } catch (error) {
      logError("canned_response.delete_failed", error, {
        projectId: project.id,
        cannedResponseId: c.req.param("crId"),
      });
      throw error;
    }
  })
  .post("/api/projects/:id/canned-responses/suggest", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(suggestCannedResponseSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const cannedService = new CannedResponseService(db);
    const allResponses = await cannedService.getByProject(project.id);
    const approved = allResponses.filter((cr) => cr.status === "approved");

    if (approved.length === 0) {
      return c.json({ suggestions: [] });
    }

    const aiService = new AiService({
      model: c.env.AI_MODEL,
      geminiApiKey: c.env.GEMINI_API_KEY,
      openaiApiKey: c.env.OPENAI_API_KEY,
    });
    logInfo("canned_response.suggest_started", {
      projectId: project.id,
      approvedCount: approved.length,
      queryLength: parsed.data.query.length,
      model: c.env.AI_MODEL,
    });

    try {
      const suggestions = await aiService.rankCannedResponses(
        parsed.data.query,
        approved.map((cr) => ({
          id: cr.id,
          trigger: cr.trigger,
          response: cr.response,
        })),
      );

      logInfo("canned_response.suggest_completed", {
        projectId: project.id,
        approvedCount: approved.length,
        suggestionCount: suggestions.length,
      });

      return c.json({ suggestions });
    } catch (error) {
      logError("canned_response.suggest_failed", error, {
        projectId: project.id,
        approvedCount: approved.length,
        model: c.env.AI_MODEL,
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const service = new GuidelineService(db);

    // Enforce limit of 50 guidelines per project
    const count = await service.countByProject(project.id);
    if (count >= 50) {
      return c.json(
        { error: "Maximum 50 guidelines per project. Delete an existing one first." },
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    if (!project || project.userId !== user.id) {
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
    return new Response(obj.body, { headers });
  });

// ─── Queue Consumer ───────────────────────────────────────────────────────────

async function handleQueue(
  batch: MessageBatch<CrawlMessage>,
  env: Env,
): Promise<void> {
  const db = drizzle(env.DB);

  for (const message of batch.messages) {
    try {
      const crawlService = new CrawlService(
        db,
        env.UPLOADS,
        env.CF_ACCOUNT_ID,
        env.BROWSER_RENDERING_API_TOKEN,
      );

      await crawlService.processUrl(message.body, env.CRAWL_QUEUE);
      message.ack();
    } catch (err) {
      console.error(
        `Queue message processing failed for ${message.body.url}:`,
        err,
      );
      message.retry();
    }
  }
}

// ─── Scheduled (Cron) ─────────────────────────────────────────────────────────

async function handleScheduled(
  _event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const db = drizzle(env.DB);

  // Find closed conversations that have no linked canned response draft
  const unprocessed = await db
    .select({
      id: conversations.id,
      projectId: conversations.projectId,
    })
    .from(conversations)
    .where(
      sql`${conversations.status} = 'closed'
        AND ${conversations.id} NOT IN (
          SELECT ${cannedResponses.sourceConversationId}
          FROM ${cannedResponses}
          WHERE ${cannedResponses.sourceConversationId} IS NOT NULL
        )`,
    )
    .limit(50);

  if (unprocessed.length === 0) return;

  // Group by project to check settings once per project
  const byProject = new Map<string, string[]>();
  for (const row of unprocessed) {
    const list = byProject.get(row.projectId) ?? [];
    list.push(row.id);
    byProject.set(row.projectId, list);
  }

  logInfo("auto_draft.cron_dispatch_started", {
    conversationCount: unprocessed.length,
    projectCount: byProject.size,
  });

  for (const [projectId, conversationIds] of byProject) {
    for (const conversationId of conversationIds) {
      ctx.waitUntil(
        triggerAutoDraftIfEnabled({
          projectId,
          conversationId,
          db,
          env,
          kv: env.CONVERSATIONS_CACHE,
          source: "scheduled_cron",
        }).catch((err) => {
          logError("auto_draft.cron_dispatch_failed", err, {
            projectId,
            conversationId,
          });
        }),
      );
    }
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,
  queue: handleQueue,
  scheduled: handleScheduled,
};
