import { Hono } from "hono";
import { cors } from "hono/cors";
import { except } from "hono/combine";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "./db/auth.schema";
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
  updateTelegramSchema,
  onboardingStep1Schema,
  onboardingContextSchema,
  onboardingWidgetSchema,
  updateVisitorEmailSchema,
  updateConversationPublicSchema,
  updateContactFormConfigSchema,
  submitContactFormSchema,
  createToolSchema,
  updateToolSchema,
  testToolSchema,
  createCheckoutSchema,
  inviteTeamMemberSchema,
  updateTeamMemberRoleSchema,
  updateProfileSchema,
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

function parseConversationMetadata(
  rawMetadata: string | null | undefined,
): Record<string, unknown> {
  if (!rawMetadata) return {};

  try {
    const parsed = JSON.parse(rawMetadata) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed metadata
  }

  return {};
}

function formatTeamRequestTranscript(
  conversationHistory: Array<{ role: string; content: string }>,
): string {
  return conversationHistory
    .filter((message) => message.content.trim())
    .slice(-12)
    .map((message) => `${capitalizeRole(message.role)}: ${message.content.trim()}`)
    .join("\n\n")
    .slice(0, 5000);
}

function capitalizeRole(role: string): string {
  if (!role) return "Unknown";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatSubmissionValue(value: string | null | undefined): string {
  return value?.trim() || "Not provided";
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function extractContactFormEmail(
  formData: Record<string, string>,
): string | null {
  for (const [key, value] of Object.entries(formData)) {
    if (!/email/i.test(key)) continue;
    if (isLikelyEmail(value)) return value.trim();
  }

  return null;
}

function extractContactFormName(
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

function buildContactFormConversationMessage(
  formData: Record<string, string>,
): string {
  const lines = ["Contact form submission"];

  for (const [key, value] of Object.entries(formData)) {
    const trimmedValue = value.trim();
    if (!trimmedValue) continue;
    lines.push(`${key}: ${trimmedValue}`);
  }

  return lines.join("\n");
}

function buildContactFormRecord(
  formData: Record<string, string>,
  visitorName: string | null,
  visitorEmail: string | null,
): Record<string, string> {
  const enrichedData = { ...formData };

  if (visitorName && !extractContactFormName(enrichedData)) {
    enrichedData["Visitor name"] = visitorName;
  }

  if (visitorEmail && !extractContactFormEmail(enrichedData)) {
    enrichedData["Visitor email"] = visitorEmail;
  }

  return enrichedData;
}

async function createTeamRequestSubmission(params: {
  aiService: AiService;
  chatService: ChatService;
  widgetService: WidgetService;
  projectService: ProjectService;
  telegramService?: TelegramService;
  project: { id: string; name: string };
  conversation: {
    id: string;
    visitorId: string | null;
    visitorName: string | null;
    visitorEmail: string | null;
  };
  conversationHistory: Array<{ role: string; content: string }>;
  summary: string | null;
  email: string;
  settings: {
    companyName?: string | null;
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
  } | null;
  env: {
    BETTER_AUTH_URL: string;
    RESEND_API_KEY?: string;
  };
  executionCtx: ExecutionContext;
}): Promise<{ submissionId: string; summary: string }> {
  const summary =
    params.summary?.trim() ||
    (await params.aiService.summarizeTeamRequest(params.conversationHistory)) ||
    "Visitor asked for team follow-up.";
  const transcript =
    formatTeamRequestTranscript(params.conversationHistory) ||
    "No recent chat history available.";

  const formData = {
    Type: "AI team request",
    "Conversation ID": params.conversation.id,
    "Requester name": formatSubmissionValue(params.conversation.visitorName),
    "Requester email": params.email,
    "Request summary": summary,
    "Recent chat": transcript,
  };

  const submission = await params.widgetService.createContactFormSubmission(
    params.project.id,
    params.conversation.visitorId ?? undefined,
    formData,
  );

  await params.chatService.updateConversation(
    params.conversation.id,
    params.project.id,
    {
      metadata: JSON.stringify({
        teamRequestPending: false,
        teamRequestSubmittedAt: new Date().toISOString(),
        teamRequestSubmissionId: submission.id,
        teamRequestSummary: summary,
      }),
    },
  );

  if (
    params.telegramService &&
    params.settings?.telegramBotToken &&
    params.settings?.telegramChatId
  ) {
    params.executionCtx.waitUntil(
      params.telegramService
        .notifyContactForm(
          params.settings.telegramBotToken,
          params.settings.telegramChatId,
          formData,
          params.env.BETTER_AUTH_URL,
          params.project.id,
        )
        .catch(() => {
          // Silently ignore Telegram errors
        }),
    );
  }

  if (params.env.RESEND_API_KEY) {
    const emailService = new EmailService(params.env.RESEND_API_KEY);
    const ownerEmail = await params.projectService.getOwnerEmail(params.project.id);
    if (ownerEmail) {
      const projectName = params.settings?.companyName ?? params.project.name;
      const dashboardUrl = `${params.env.BETTER_AUTH_URL}/app/projects/${params.project.id}/contact-form`;
      params.executionCtx.waitUntil(
        emailService
          .sendContactFormNotification({
            ownerEmail,
            projectName,
            formData,
            dashboardUrl,
          })
          .catch((err) => {
            console.error("Team request email failed:", err);
          }),
      );
    }
  }

  return { submissionId: submission.id, summary };
}

// ─── Auto-draft canned response helper ────────────────────────────────────────
async function triggerAutoDraftIfEnabled(opts: {
  projectId: string;
  conversationId: string;
  db: import("drizzle-orm/d1").DrizzleD1Database<Record<string, unknown>>;
  env: { AI_MODEL: string; GEMINI_API_KEY: string; OPENAI_API_KEY: string };
  kv: KVNamespace;
}): Promise<void> {
  const projectService = new ProjectService(opts.db);
  const settings = await projectService.getSettings(opts.projectId);
  if (!settings?.autoCannedDraft) return;

  const chatService = new ChatService(opts.db, opts.kv);
  const msgs = await chatService.getMessages(opts.conversationId);
  if (msgs.length < 2) return;

  const aiService = new AiService({
    model: opts.env.AI_MODEL,
    geminiApiKey: opts.env.GEMINI_API_KEY,
    openaiApiKey: opts.env.OPENAI_API_KEY,
  });

  aiService
    .generateCannedDraft(
      msgs.map((m) => ({ role: m.role, content: m.content })),
    )
    .then(async (draft) => {
      if (draft) {
        const cannedService = new CannedResponseService(opts.db);
        await cannedService.createDraft(
          opts.projectId,
          draft.trigger,
          draft.response,
          opts.conversationId,
        );
      }
    })
    .catch(() => {
      // Silently ignore auto-draft errors
    });
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

// ─── RAG Retrieval Helpers ────────────────────────────────────────────────────
interface PreparedRagChunk {
  key: string;
  score: number;
  text: string;
}

const RAG_MAX_CONTEXT_CHARS = 12_000;
const RAG_MAX_CHUNKS = 6;
const RAG_MAX_CHUNKS_PER_SOURCE = 2;
const RAG_MAX_CHUNK_CHARS = 1_600;
const RAG_HARD_MIN_SCORE = 0.2;
const RAG_PREFERRED_MIN_SCORE = 0.35;

function prepareRagChunks(
  chunks: Array<{ item?: { key?: string }; score?: number; text?: string }>,
  projectId: string,
): { chunks: PreparedRagChunk[]; droppedCrossTenant: number } {
  const projectPrefix = `${projectId}/`;
  const normalized: PreparedRagChunk[] = [];

  for (const chunk of chunks) {
    const key = chunk.item?.key;
    const text = (chunk.text ?? "").trim();
    if (!key || !text) continue;
    normalized.push({
      key,
      score: chunk.score ?? 0,
      text,
    });
  }

  const tenantChunks: PreparedRagChunk[] = [];
  for (const chunk of normalized) {
    if (chunk.key.startsWith(projectPrefix)) {
      tenantChunks.push(chunk);
    }
  }
  const droppedCrossTenant = normalized.length - tenantChunks.length;

  // Prefer markdown sources to avoid duplicate/competing PDF raw extraction chunks.
  const nonPdfChunks = tenantChunks.filter(
    (chunk) => !chunk.key.endsWith(".pdf"),
  );
  const preferredChunks = nonPdfChunks.length > 0 ? nonPdfChunks : tenantChunks;
  preferredChunks.sort((a, b) => b.score - a.score);

  return { chunks: preferredChunks, droppedCrossTenant };
}

function buildRagContext(chunks: PreparedRagChunk[]): {
  context: string;
  topScore: number;
  filenames: string[];
} {
  const selected: Array<{ key: string; score: number; text: string }> = [];
  const sourceCounts = new Map<string, number>();
  const seenText = new Set<string>();
  const sourceFilenames = new Set<string>();
  let contextChars = 0;

  for (const chunk of chunks) {
    if (selected.length >= RAG_MAX_CHUNKS) break;
    if (chunk.score < RAG_HARD_MIN_SCORE) continue;
    if (selected.length >= 2 && chunk.score < RAG_PREFERRED_MIN_SCORE) continue;

    const perSource = sourceCounts.get(chunk.key) ?? 0;
    if (perSource >= RAG_MAX_CHUNKS_PER_SOURCE) continue;

    const normalizedPrefix = chunk.text.slice(0, 220).toLowerCase();
    const dedupeKey = `${chunk.key}:${normalizedPrefix}`;
    if (seenText.has(dedupeKey)) continue;

    const clippedText =
      chunk.text.length > RAG_MAX_CHUNK_CHARS
        ? `${chunk.text.slice(0, RAG_MAX_CHUNK_CHARS)}...`
        : chunk.text;

    if (contextChars >= RAG_MAX_CONTEXT_CHARS) break;
    let finalText = clippedText;
    if (contextChars + finalText.length > RAG_MAX_CONTEXT_CHARS) {
      const remaining = RAG_MAX_CONTEXT_CHARS - contextChars;
      if (remaining < 250) break;
      finalText = `${finalText.slice(0, remaining)}...`;
    }

    selected.push({
      key: chunk.key,
      score: chunk.score,
      text: finalText,
    });
    sourceCounts.set(chunk.key, perSource + 1);
    seenText.add(dedupeKey);
    contextChars += finalText.length;

    if (chunk.score >= 0.45) {
      sourceFilenames.add(chunk.key);
    }
  }

  if (selected.length === 0) {
    return { context: "", topScore: 0, filenames: [] };
  }

  const context = selected
    .map((chunk) => {
      const relevance = (chunk.score * 100).toFixed(0);
      return `<source file="${chunk.key}" relevance="${relevance}%">\n${chunk.text}\n</source>`;
    })
    .join("\n\n");

  return {
    context,
    topScore: selected[0]?.score ?? 0,
    filenames: [...sourceFilenames],
  };
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
    return c.json(config);
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
    const conversation = await chatService.getConversationById(
      conversationId,
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
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

    // Check subscription + message limits for the project owner
    const billingService = new BillingService(db, c.env);
    const ownerSub = await billingService.getSubscriptionByUserId(
      project.userId,
    );
    if (!ownerSub || !billingService.isSubscriptionActive(ownerSub)) {
      return c.json(
        {
          error:
            "This chatbot is currently unavailable. Please contact the site owner.",
          code: "subscription_inactive",
        },
        503,
      );
    }

    const messageCheck = await billingService.checkMessageLimit(project.userId);
    if (!messageCheck.allowed) {
      return c.json(
        {
          error: "Message limit reached. Please contact the site owner.",
          code: "message_limit_reached",
        },
        429,
      );
    }

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
    const conversation = await chatService.getConversationById(
      conversationId,
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    // Store visitor message (with optional image)
    const imageUrl = parsed.data.imageUrl ?? null;
    await chatService.addMessage(
      {
        conversationId,
        role: "visitor",
        content: parsed.data.content,
        imageUrl,
      },
      project.id,
    );

    // ─── Agent Mode: bypass AI when agent is handling ───────────────────────
    if (
      conversation.status === "waiting_agent" ||
      conversation.status === "agent_replied"
    ) {
      // Forward to Telegram in background if configured
      const agentSettings = await projectService.getSettings(project.id);
      if (agentSettings?.telegramBotToken && agentSettings?.telegramChatId) {
        const telegramService = new TelegramService(db);
        c.executionCtx.waitUntil(
          telegramService
            .forwardVisitorMessage(
              agentSettings.telegramBotToken,
              agentSettings.telegramChatId,
              conversation.visitorName,
              parsed.data.content,
              conversation.id,
              conversation.telegramThreadId
                ? parseInt(conversation.telegramThreadId, 10)
                : undefined,
            )
            .catch((err) => {
              console.error("Telegram forward failed:", err);
            }),
        );
      }

      return c.json({ ok: true, agentMode: true });
    }

    // If visitor attached an image, fetch it from R2 and base64-encode for Gemini
    let imageBase64: string | null = null;
    let imageMimeType: string | null = null;
    if (imageUrl) {
      try {
        // imageUrl is like /api/uploads/{key} — extract the R2 key
        const r2Key = imageUrl.replace("/api/uploads/", "");
        const obj = await c.env.UPLOADS.get(r2Key);
        if (obj) {
          imageMimeType = obj.httpMetadata?.contentType ?? "image/jpeg";
          const arrayBuffer = await obj.arrayBuffer();
          // Convert to base64
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          imageBase64 = btoa(binary);
        }
      } catch (err) {
        console.error("Failed to fetch image for Gemini:", err);
      }
    }

    // Get project settings for tone and context
    const settings = await projectService.getSettings(project.id);

    // Get conversation history from cache or DB
    const history =
      (await chatService.getFromCache(conversationId, project.id)) ??
      (await chatService.getMessages(conversationId));

    const conversationHistory = history
      .filter((m) => m.role !== "bot" || m.content)
      .slice(-20) // Last 20 messages for context
      .map((m) => ({
        role: m.role as "visitor" | "bot" | "agent",
        content: m.content,
      }));

    // Notify via Telegram on first visitor message (new conversation)
    const visitorMessages = history.filter((m) => m.role === "visitor");
    if (
      visitorMessages.length === 1 &&
      settings?.telegramBotToken &&
      settings?.telegramChatId
    ) {
      const telegramService = new TelegramService(db);
      c.executionCtx.waitUntil(
        telegramService
          .notifyNewConversation(
            settings.telegramBotToken,
            settings.telegramChatId,
            conversationId,
            conversation.visitorName,
            conversation.visitorEmail,
            parsed.data.content,
            c.env.BETTER_AUTH_URL,
            project.id,
            settings.botName,
          )
          .then(async (messageId) => {
            if (messageId) {
              await chatService.updateTelegramThreadId(
                conversationId,
                project.id,
                String(messageId),
              );
            }
          })
          .catch((err) => {
            console.error("New conversation Telegram notification failed:", err);
          }),
      );
    }

    // Reformulate the visitor's message into a standalone search query and
    // generate a conversation summary (for multi-turn conversations) in parallel.
    const aiService = new AiService({
      model: c.env.AI_MODEL,
      geminiApiKey: c.env.GEMINI_API_KEY,
      openaiApiKey: c.env.OPENAI_API_KEY,
    });
    const [searchQuery, conversationSummary] = await Promise.all([
      aiService.reformulateQuery(conversationHistory, parsed.data.content),
      aiService.summarizeConversation(conversationHistory),
    ]);
    const isMultiTurnConversation = conversationHistory.length > 1;

    // Query AI Search for relevant context with improved retrieval settings
    let ragContext = "";
    const ragFilenames: string[] = [];
    try {
      const searchResults = await c.env.AI.aiSearch()
        .get("supportbot")
        .search({
          messages: [{ role: "user", content: searchQuery }],
          ai_search_options: {
            retrieval: {
              retrieval_type: "hybrid",
              filters: {
                type: "eq",
                key: "folder",
                value: `${project.id}/`,
              },
              max_num_results: 12,
              match_threshold: 0.2,
            },
            query_rewrite: {
              // Avoid double rewriting in multi-turn chats since we already reformulate.
              enabled: !isMultiTurnConversation,
            },
            reranking: {
              enabled: true,
              model: "@cf/baai/bge-reranker-base",
            },
          },
        });

      const prepared = prepareRagChunks(
        searchResults?.chunks ?? [],
        project.id,
      );
      if (prepared.droppedCrossTenant > 0) {
        console.warn(
          `Dropped ${prepared.droppedCrossTenant} cross-tenant retrieval chunks for project ${project.id}`,
        );
      }

      const ragSelection = buildRagContext(prepared.chunks);
      if (ragSelection.context) {
        // Track the top result score for confidence assessment
        const topScore = ragSelection.topScore;
        const ragConfident = topScore >= 0.6;

        ragContext = ragSelection.context;
        ragFilenames.push(...ragSelection.filenames);

        // Warn the model when results may not be directly relevant
        if (!ragConfident) {
          ragContext = `NOTE: The following knowledge base results may not be directly relevant to the visitor's question. Only use them if they genuinely answer what the visitor asked. If none are relevant, tell the visitor you don't have that information.\n\n${ragContext}`;
        }
        console.log("Search Query:", searchQuery);
        console.log("RAG Context:", ragContext);
      }
    } catch (err) {
      console.error("AI Search query failed:", err);
    }

    // Check canned responses
    const cannedMatch = await chatService.findCannedResponse(
      project.id,
      parsed.data.content,
    );

    // Load enabled tools and guidelines in parallel
    const toolService = new ToolService(db);
    const guidelineService = new GuidelineService(db);
    const [enabledTools, enabledGuidelines] = await Promise.all([
      toolService.getEnabledTools(project.id),
      guidelineService.getEnabledByProject(project.id),
    ]);

    // Per-project rate limit for tool-enabled conversations (100 tool-bearing messages per minute)
    if (enabledTools.length > 0) {
      if (!checkRateLimit(`toolmsg:${project.id}`, 100, 60_000)) {
        return c.json(
          {
            error:
              "Tool execution rate limit exceeded. Please try again shortly.",
          },
          429,
        );
      }

      // Decrypt encrypted headers before passing to Gemini tool execution
      for (const t of enabledTools) {
        if (t.headers && isEncrypted(t.headers)) {
          try {
            const decrypted = await decryptHeaders(
              t.headers,
              c.env.ENCRYPTION_KEY,
            );
            t.headers = JSON.stringify(decrypted);
          } catch {
            // If decryption fails, clear headers to prevent passing corrupted data
            t.headers = null;
          }
        }
      }
    }

    // Extract agent handback instructions from conversation metadata
    const conversationMetadata = parseConversationMetadata(conversation.metadata);
    const agentHandbackInstructions =
      typeof conversationMetadata.agentHandbackInstructions === "string"
        ? conversationMetadata.agentHandbackInstructions
        : null;

    // Build system prompt and stream response
    const systemPrompt = aiService.buildSystemPrompt(
      settings ?? {
        toneOfVoice: "professional",
        customTonePrompt: null,
        companyContext: null,
        botName: null,
        agentName: null,
      },
      project.name,
      ragContext,
      cannedMatch ? cannedMatch.response : null,
      conversationSummary,
      {
        hasTools: enabledTools.length > 0,
        guidelines: enabledGuidelines.map((g) => ({
          condition: g.condition,
          instruction: g.instruction,
        })),
        agentHandbackInstructions,
        pageContext: parsed.data.pageContext,
      },
    );

    // Stream via SSE using Vercel AI SDK
    const streamResult = aiService.streamChat({
      systemPrompt,
      conversationHistory,
      userMessage: parsed.data.content,
      image:
        imageBase64 && imageMimeType
          ? { base64: imageBase64, mimeType: imageMimeType }
          : null,
      tools: enabledTools.length > 0 ? enabledTools : undefined,
      onToolCallStart: (info) => {
        console.log(`Tool call started: ${info.toolName}`, info.input);
      },
      onToolCallFinish: (info) => {
        // Log tool execution asynchronously (fire-and-forget)
        const matchedTool = enabledTools.find((t) => t.name === info.toolName);
        if (matchedTool) {
          toolService
            .logExecution({
              toolId: matchedTool.id,
              conversationId,
              input: (info.input as Record<string, unknown>) ?? {},
              output: info.output,
              status: info.success ? "success" : "error",
              duration: info.durationMs,
              errorMessage: info.error ? String(info.error) : null,
            })
            .catch((err) =>
              console.error("Failed to log tool execution:", err),
            );
        }
      },
    });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let fullResponse = "";
        const emittedToolCalls = new Set<string>(); // Deduplicate across retry steps
        let hadToolCalls = false;

        let lastToolOutput: unknown = null;
        let lastToolError: string | null = null;
        let stepCount = 0;

        // Track tool call start times for client-side duration calculation
        const toolCallStartTimes = new Map<string, number>();

        try {
          // Use fullStream to get all event types (text, tool-call, tool-result, etc.)
          for await (const part of streamResult.fullStream) {
            if (part.type === "text-delta") {
              fullResponse += part.text;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ text: part.text })}\n\n`,
                ),
              );
            } else if (part.type === "tool-call") {
              hadToolCalls = true;
              // Track start time for duration calculation in tool-result
              toolCallStartTimes.set(part.toolCallId, Date.now());
              // Only emit the first call per tool name (skip retries from multi-step loops)
              if (!emittedToolCalls.has(part.toolName)) {
                emittedToolCalls.add(part.toolName);
                // Extract input args — static tools use `args`, dynamic use `input`
                const toolCallPart = part as Record<string, unknown>;
                const toolArgs = toolCallPart.args ?? toolCallPart.input ?? {};
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      toolCall: {
                        name: part.toolName,
                        args: toolArgs,
                      },
                    })}\n\n`,
                  ),
                );
              }
            } else if (part.type === "tool-result") {
              const output = part.output as Record<string, unknown> | null;
              const hasError = !!output?.error;
              const errorMessage = hasError ? String(output!.error) : null;

              // Calculate duration from tracked start time
              const startTime = toolCallStartTimes.get(part.toolCallId);
              const duration = startTime ? Date.now() - startTime : null;

              // Extract httpStatus from tool output if available
              const httpStatus = output?.httpStatus as number | undefined;

              // Track last tool output/error for fallback diagnostics
              lastToolOutput = output;
              lastToolError = errorMessage;

              // Emit tool result with full details (output, status, duration)
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    toolResult: {
                      name: part.toolName,
                      success: !hasError,
                      ...(errorMessage ? { errorMessage } : {}),
                      output: output ?? null,
                      ...(httpStatus ? { httpStatus } : {}),
                      ...(duration != null ? { duration } : {}),
                    },
                  })}\n\n`,
                ),
              );
            } else if (part.type === "finish-step") {
              stepCount++;
              console.log(
                `[Tool Debug] Step ${stepCount} finished — reason: ${part.finishReason}, text so far: ${fullResponse.length} chars, tool calls: ${hadToolCalls}`,
              );
            }
          }

          // If the model exhausted all steps on tool calls without producing text, add a fallback
          if (hadToolCalls && !fullResponse.trim()) {
            console.log(
              `[Tool Debug] Fallback triggered — steps: ${stepCount}, lastToolError: ${lastToolError}, lastToolOutput: ${JSON.stringify(lastToolOutput)?.slice(0, 500)}`,
            );

            // If the tool itself errored, show that to the user via SSE
            if (lastToolError) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    toolError: {
                      message:
                        "The tool encountered an error while processing your request.",
                      detail: lastToolError,
                    },
                  })}\n\n`,
                ),
              );
              fullResponse =
                "I tried to look that up but the tool encountered an error. Could you try again?";
            } else {
              fullResponse =
                "I found some information but had trouble processing it. Could you try rephrasing your question?";
            }
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ text: fullResponse })}\n\n`,
              ),
            );
          }

          // Check if handoff was requested
          if (fullResponse.includes("[HANDOFF_REQUESTED]")) {
            await chatService.updateConversationStatus(
              conversationId,
              project.id,
              "waiting_agent",
            );

            // Notify via Telegram if configured
            if (settings?.telegramBotToken && settings?.telegramChatId) {
              const telegramService = new TelegramService(db);
              const threadId = await telegramService.notifyHandoff(
                settings.telegramBotToken,
                settings.telegramChatId,
                conversationId,
                conversation.visitorName,
                parsed.data.content,
                conversationHistory,
                c.env.BETTER_AUTH_URL,
                project.id,
                settings.botName,
              );
              if (threadId) {
                await chatService.updateTelegramThreadId(
                  conversationId,
                  project.id,
                  String(threadId),
                );
              }
            }

            // Notify project owner via email if configured
            if (c.env.RESEND_API_KEY) {
              const emailService = new EmailService(c.env.RESEND_API_KEY);
              const ownerEmail = await projectService.getOwnerEmail(project.id);
              if (ownerEmail) {
                const projectName = settings?.companyName ?? project.name;
                const dashboardUrl = `${c.env.BETTER_AUTH_URL}/app/projects/${project.id}/conversations/${conversationId}`;
                c.executionCtx.waitUntil(
                  emailService
                    .sendHandoffNotification({
                      ownerEmail,
                      projectName,
                      visitorName: conversation.visitorName,
                      visitorMessage: parsed.data.content,
                      dashboardUrl,
                    })
                    .catch((err) => {
                      console.error("Handoff email failed:", err);
                    }),
                );
              }
            }

            // Strip the [HANDOFF_REQUESTED] token — the AI now says its own
            // natural message before it (e.g. "Let me connect you with...")
            fullResponse = fullResponse.replace("[HANDOFF_REQUESTED]", "").trim();
            if (!fullResponse) {
              const agentLabel = settings?.agentName ?? "a team member";
              fullResponse = `I'll connect you with ${agentLabel}. They'll be with you shortly!`;
            }

            // Send handoff event to widget with visitor email for smart handoff UX
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  handoff: true,
                  visitorEmail: conversation.visitorEmail ?? null,
                })}\n\n`,
              ),
            );
          }

          // Check if the visitor approved a team review request
          if (fullResponse.includes("[TEAM_REQUEST_APPROVED]")) {
            const existingSubmissionId =
              typeof conversationMetadata.teamRequestSubmissionId === "string"
                ? conversationMetadata.teamRequestSubmissionId
                : null;
            const existingSummary =
              typeof conversationMetadata.teamRequestSummary === "string"
                ? conversationMetadata.teamRequestSummary
                : null;
            const cleanedResponse = fullResponse
              .replace("[TEAM_REQUEST_APPROVED]", "")
              .trim();
            const teamRequestSummary =
              existingSummary ||
              (await aiService.summarizeTeamRequest(conversationHistory));

            fullResponse =
              cleanedResponse ||
              "I’ve passed this along for the team to review.";

            if (existingSubmissionId) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    teamRequest: {
                      submitted: true,
                      needsEmail: false,
                      visitorEmail: conversation.visitorEmail ?? null,
                    },
                  })}\n\n`,
                ),
              );
            } else if (conversation.visitorEmail) {
              const telegramService =
                settings?.telegramBotToken && settings?.telegramChatId
                  ? new TelegramService(db)
                  : undefined;
              const submission = await createTeamRequestSubmission({
                aiService,
                chatService,
                widgetService: new WidgetService(db),
                projectService,
                telegramService,
                project,
                conversation,
                conversationHistory,
                summary: teamRequestSummary,
                email: conversation.visitorEmail,
                settings,
                env: {
                  BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
                  RESEND_API_KEY: c.env.RESEND_API_KEY,
                },
                executionCtx: c.executionCtx,
              });

              conversationMetadata.teamRequestPending = false;
              conversationMetadata.teamRequestSubmissionId =
                submission.submissionId;
              conversationMetadata.teamRequestSummary = submission.summary;
              conversationMetadata.teamRequestSubmittedAt =
                new Date().toISOString();

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    teamRequest: {
                      submitted: true,
                      needsEmail: false,
                      visitorEmail: conversation.visitorEmail,
                    },
                  })}\n\n`,
                ),
              );
            } else {
              await chatService.updateConversation(conversationId, project.id, {
                metadata: JSON.stringify({
                  teamRequestPending: true,
                  teamRequestSummary,
                  teamRequestRequestedAt: new Date().toISOString(),
                }),
              });

              conversationMetadata.teamRequestPending = true;
              conversationMetadata.teamRequestSummary = teamRequestSummary;
              conversationMetadata.teamRequestRequestedAt =
                new Date().toISOString();

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    teamRequest: {
                      submitted: false,
                      needsEmail: true,
                      visitorEmail: null,
                    },
                  })}\n\n`,
                ),
              );
            }
          }

          // Check if conversation was resolved by the bot
          if (fullResponse.includes("[RESOLVED]")) {
            await chatService.updateConversationStatus(
              conversationId,
              project.id,
              "closed",
              "bot_resolved",
            );

            fullResponse = fullResponse.replace(
              "[RESOLVED]",
              "Glad I could help! Feel free to reach out anytime if you have more questions.",
            );

            // Send resolved event to widget
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ resolved: true })}\n\n`,
              ),
            );

            // Auto-draft canned response in background
            triggerAutoDraftIfEnabled({
              projectId: project.id,
              conversationId,
              db,
              env: c.env,
              kv: c.env.CONVERSATIONS_CACHE,
            });
          }

          // Resolve source references from AI Search filenames
          let sourceReferences: Array<{
            title: string;
            url: string | null;
            type: "webpage" | "pdf" | "faq";
          }> = [];
          if (ragFilenames.length > 0) {
            try {
              const resourceService = new ResourceService(db, c.env.UPLOADS);
              sourceReferences =
                await resourceService.resolveSourcesFromFilenames(
                  project.id,
                  ragFilenames,
                );
            } catch (err) {
              console.error("Source resolution failed:", err);
            }
          }

          // Store bot message in DB with structured sources
          const botMsg = await chatService.addMessage(
            {
              conversationId,
              role: "bot",
              content: fullResponse,
              sources:
                sourceReferences.length > 0
                  ? JSON.stringify(sourceReferences)
                  : null,
            },
            project.id,
          );

          // Increment message usage counter for billing
          try {
            await billingService.incrementMessageUsage(project.userId);
          } catch (err) {
            console.error("Failed to increment message usage:", err);
          }

          // Link any unlinked tool executions from this stream to the bot message
          if (hadToolCalls) {
            toolService
              .linkExecutionsToMessage(conversationId, botMsg.id)
              .catch((err) =>
                console.error("Failed to link tool executions to message:", err),
              );
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                done: true,
                messageId: botMsg.id,
                sources:
                  sourceReferences.length > 0 ? sourceReferences : undefined,
              })}\n\n`,
            ),
          );
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: errorMessage })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
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

    const metadata = parseConversationMetadata(conversation.metadata);
    const shouldSubmitTeamRequest =
      metadata.teamRequestPending === true &&
      typeof metadata.teamRequestSubmissionId !== "string";

    if (shouldSubmitTeamRequest) {
      const history = await chatService.getMessages(conversationId);
      const conversationHistory = history
        .filter((message) => message.role !== "bot" || message.content)
        .slice(-20)
        .map((message) => ({
          role: message.role as "visitor" | "bot" | "agent",
          content: message.content,
        }));
      const settings = await projectService.getSettings(project.id);
      const aiService = new AiService({
        model: c.env.AI_MODEL,
        geminiApiKey: c.env.GEMINI_API_KEY,
        openaiApiKey: c.env.OPENAI_API_KEY,
      });
      const telegramService =
        settings?.telegramBotToken && settings?.telegramChatId
          ? new TelegramService(db)
          : undefined;
      const summary =
        typeof metadata.teamRequestSummary === "string"
          ? metadata.teamRequestSummary
          : null;

      const submission = await createTeamRequestSubmission({
        aiService,
        chatService,
        widgetService: new WidgetService(db),
        projectService,
        telegramService,
        project,
        conversation: {
          id: conversation.id,
          visitorId: conversation.visitorId,
          visitorName: conversation.visitorName,
          visitorEmail: parsed.data.email,
        },
        conversationHistory,
        summary,
        email: parsed.data.email,
        settings,
        env: {
          BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
          RESEND_API_KEY: c.env.RESEND_API_KEY,
        },
        executionCtx: c.executionCtx,
      });

      return c.json({
        ok: true,
        teamRequestSubmitted: true,
        submissionId: submission.submissionId,
      });
    }

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

  // ─── Contact Form Submit (public) ────────────────────────────────────────
  .post("/api/widget/:projectSlug/contact-form", async (c) => {
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

    const widgetService = new WidgetService(db);
    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);

    // Verify contact form is enabled
    const formConfig = await widgetService.getContactFormConfig(project.id);
    if (!formConfig?.enabled) {
      return c.json({ error: "Contact form is not enabled" }, 400);
    }

    const visitorId = parsed.data.visitorId ?? crypto.randomUUID();
    const visitorEmail =
      parsed.data.visitorEmail ?? extractContactFormEmail(parsed.data.data);
    const visitorName =
      parsed.data.visitorName ?? extractContactFormName(parsed.data.data);
    const contactFormData = buildContactFormRecord(
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
        source: "contact_form",
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

    const submission = await widgetService.createContactFormSubmission(
      project.id,
      visitorId,
      contactFormData,
    );

    const contactFormMessage = buildContactFormConversationMessage(contactFormData);

    await chatService.addMessage(
      {
        conversationId: conversation.id,
        role: "visitor",
        content: contactFormMessage,
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
              contactFormMessage,
              conversation.id,
              conversation.telegramThreadId
                ? parseInt(conversation.telegramThreadId, 10)
                : undefined,
            )
          : telegramService.notifyContactForm(
              settings.telegramBotToken,
              settings.telegramChatId,
              contactFormData,
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
        const dashboardUrl = `${c.env.BETTER_AUTH_URL}/app/projects/${project.id}/contact-form`;
        c.executionCtx.waitUntil(
          emailService
            .sendContactFormNotification({
              ownerEmail,
              projectName,
              formData: contactFormData,
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
          triggerAutoDraftIfEnabled({
            projectId,
            conversationId,
            db,
            env: c.env,
            kv: c.env.CONVERSATIONS_CACHE,
          });

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
            { conversationId, role: "bot", content: responseText },
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

  // ─── Widget Embed JS ───────────────────────────────────────────────────────
  .get("/api/widget-embed.js", async (c) => {
    // In local dev, serve widget from Vite dev server assets (public/ dir)
    // instead of R2, so you can test widget changes without deploying.
    // Run `bun run widget:build` to update the local bundle.
    const isLocal = c.env.BETTER_AUTH_URL?.includes("localhost");
    if (isLocal) {
      try {
        const res = await c.env.ASSETS.fetch(
          new Request("http://localhost/widget-embed.js"),
        );
        if (res.ok) {
          const body = await res.text();
          return c.text(body, 200, {
            "Content-Type": "application/javascript",
            "Cache-Control": "no-cache",
          });
        }
      } catch {
        // fall through to R2
      }
    }

    const obj = await c.env.UPLOADS.get("widget-embed.js");
    if (!obj) {
      return c.text(
        '// ReplyMaven widget not deployed yet. Run: bun run widget:deploy\nconsole.warn("[ReplyMaven] Widget bundle not found. Deploy it with: bun run widget:deploy");',
        200,
        { "Content-Type": "application/javascript" },
      );
    }

    const body = await obj.text();
    return c.text(body, 200, {
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=3600",
    });
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
    const currentUsage = await billingService.getUsage(effectiveUserId);
    const seatCount = await teamService.getSeatCount(effectiveUserId);
    const membership = await teamService.getTeamMembership(user.id);

    if (!subscription) {
      return c.json({
        subscription: null,
        usage: { messagesUsed: 0 },
        limits: null,
        seats: { current: 1, max: 0 },
        role: "owner",
      });
    }

    const limits = BillingService.getPlanLimits(subscription.plan as Plan);

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

    // Enforce max 1 contact_form action per project
    if (parsed.data.type === "contact_form") {
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

    // Use AiService's HTTP execution logic via a test harness
    const aiService = new AiService({
      model: c.env.AI_MODEL,
      geminiApiKey: c.env.GEMINI_API_KEY,
      openaiApiKey: c.env.OPENAI_API_KEY,
    });
    const toolSet = aiService.buildToolSet([toolDef]);
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

  // ─── Contact Form Config (Dashboard) ─────────────────────────────────────
  .get("/api/projects/:id/contact-form", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const config = await widgetService.getContactFormConfig(project.id);
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
  .put("/api/projects/:id/contact-form", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateContactFormConfigSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const config = await widgetService.upsertContactFormConfig(
      project.id,
      parsed.data,
    );
    return c.json({
      enabled: config.enabled,
      description: config.description,
      fields: JSON.parse(config.fields || "[]"),
    });
  })
  .get("/api/projects/:id/contact-form/submissions", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const submissions = await widgetService.getContactFormSubmissions(
      project.id,
    );
    return c.json(
      submissions.map((s) => ({
        ...s,
        data: JSON.parse(s.data || "{}"),
      })),
    );
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

    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
    const convos = await chatService.getConversationsByProject(project.id);
    return c.json(convos);
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
    const conversation = await chatService.getConversationById(
      c.req.param("convId"),
      project.id,
    );
    if (!conversation) {
      return c.json({ error: "Not found" }, 404);
    }

    const toolService = new ToolService(db);
    const [msgs, toolExecs] = await Promise.all([
      chatService.getMessages(conversation.id),
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

    const settings = await projectService.getSettings(project.id);

    return c.json({
      conversation,
      messages: messagesWithTools,
      botName: settings?.botName ?? null,
      agentName: settings?.agentName ?? null,
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

    const message = await chatService.addMessage(
      {
        conversationId: conversation.id,
        role: "agent",
        content: parsed.data.content,
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
    triggerAutoDraftIfEnabled({
      projectId: project.id,
      conversationId: conversation.id,
      db,
      env: c.env,
      kv: c.env.CONVERSATIONS_CACHE,
    });

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
    const cr = await service.create({
      projectId: project.id,
      trigger: parsed.data.trigger,
      response: parsed.data.response,
      status: "approved",
    });
    return c.json(cr, 201);
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
    const cr = await service.update(
      c.req.param("crId"),
      project.id,
      parsed.data,
    );
    if (!cr) return c.json({ error: "Not found" }, 404);
    return c.json(cr);
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
    const approved = await service.approve(c.req.param("crId"), project.id);
    if (!approved) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
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
    const deleted = await service.delete(c.req.param("crId"), project.id);
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
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
    await c.env.UPLOADS.put("widget-embed.js", buffer, {
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

// ─── Export ───────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,
  queue: handleQueue,
};
