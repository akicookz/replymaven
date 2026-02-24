import { Hono } from "hono";
import { cors } from "hono/cors";
import { except } from "hono/combine";
import { drizzle } from "drizzle-orm/d1";
import { createAuth } from "./auth";
import { type HonoAppContext } from "./types";
import { ProjectService } from "./services/project-service";
import { WidgetService } from "./services/widget-service";
import { ChatService } from "./services/chat-service";
import { ResourceService } from "./services/resource-service";
import { GeminiService } from "./services/gemini-service";
import { TelegramService } from "./services/telegram-service";
import { CannedResponseService } from "./services/canned-response-service";
import { DashboardService } from "./services/dashboard-service";
import { CrawlService, type CrawlMessage } from "./services/crawl-service";
import {
  createProjectSchema,
  updateProjectSchema,
  updateProjectSettingsSchema,
  updateWidgetConfigSchema,
  createQuickActionSchema,
  createQuickTopicSchema,
  createHomeLinkSchema,
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
  updateContactFormConfigSchema,
  submitContactFormSchema,
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

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
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

// ─── Slug generator ──────────────────────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
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
    const auth = createAuth(
      c.env,
      c.req.raw.cf as CfProperties,
    );
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

  // ─── Get Conversation Messages ──────────────────────────────────────────────
  .get(
    "/api/widget/:projectSlug/conversations/:id/messages",
    async (c) => {
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
      const conversation = await chatService.getConversationById(conversationId, project.id);
      if (!conversation) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      // Try KV cache first
      const cached = await chatService.getFromCache(conversationId, project.id);
      if (cached) return c.json(cached);

      const messages = await chatService.getMessages(conversationId);
      return c.json(messages);
    },
  )

  // ─── Send Message (SSE streaming response) ─────────────────────────────────
  .post(
    "/api/widget/:projectSlug/conversations/:id/messages",
    async (c) => {
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

      const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
      const conversation = await chatService.getConversationById(conversationId, project.id);
      if (!conversation) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      // Store visitor message
      await chatService.addMessage({
        conversationId,
        role: "visitor",
        content: parsed.data.content,
      }, project.id);

      // Get project settings for tone and context
      const settings = await projectService.getSettings(project.id);

      // Get conversation history from cache or DB
      const history =
        (await chatService.getFromCache(conversationId, project.id)) ??
        (await chatService.getMessages(conversationId));

      // Query AI Search for relevant context
      let ragContext = "";
      const ragFilenames: string[] = [];
      try {
        const searchResults = await c.env.AI.autorag("supportbot").search({
          query: parsed.data.content,
          filters: {
            type: "eq",
            key: "folder",
            value: `${project.id}/`,
          },
          max_num_results: 5,
          ranking_options: { score_threshold: 0.3 },
        });

        if (searchResults?.data?.length > 0) {
          ragContext = searchResults.data
            .map(
              (item: { filename?: string; content?: Array<{ text?: string }> }) => {
                if (item.filename) ragFilenames.push(item.filename);
                return `<source file="${item.filename}">\n${item.content
                  ?.map((chunk) => chunk.text)
                  .join("\n")}\n</source>`;
              },
            )
            .join("\n\n");
        }
      } catch (err) {
        console.error("AI Search query failed:", err);
      }

      // Check canned responses
      const cannedMatch = await chatService.findCannedResponse(
        project.id,
        parsed.data.content,
      );

      // Build system prompt and stream response
      const geminiService = new GeminiService(c.env.GEMINI_API_KEY);
      const systemPrompt = geminiService.buildSystemPrompt(
        settings ?? { toneOfVoice: "professional", customTonePrompt: null, companyContext: null },
        ragContext,
        cannedMatch ? cannedMatch.response : null,
      );

      const conversationHistory = history
        .filter((m) => m.role !== "bot" || m.content)
        .slice(-20) // Last 20 messages for context
        .map((m) => ({
          role: m.role as "visitor" | "bot" | "agent",
          content: m.content,
        }));

      // Stream via SSE
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          let fullResponse = "";

          try {
            for await (const chunk of geminiService.streamChat(
              systemPrompt,
              conversationHistory,
              parsed.data.content,
            )) {
              fullResponse += chunk;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`),
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
                await telegramService.notifyHandoff(
                  settings.telegramBotToken,
                  settings.telegramChatId,
                  conversationId,
                  conversation.visitorName,
                  parsed.data.content,
                );
              }

              fullResponse = fullResponse.replace(
                "[HANDOFF_REQUESTED]",
                "I'll connect you with a human agent right away. They'll be with you shortly!",
              );

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

            // Resolve source references from AI Search filenames
            let sourceReferences: Array<{ title: string; url: string }> = [];
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
            await chatService.addMessage({
              conversationId,
              role: "bot",
              content: fullResponse,
              sources:
                sourceReferences.length > 0
                  ? JSON.stringify(sourceReferences)
                  : null,
            }, project.id);

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  done: true,
                  sources:
                    sourceReferences.length > 0
                      ? sourceReferences
                      : undefined,
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
    },
  )

  // ─── Update Visitor Email (for handoff flow) ─────────────────────────────────
  .post(
    "/api/widget/:projectSlug/conversations/:id/email",
    async (c) => {
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
      const conversation = await chatService.getConversationById(conversationId, project.id);
      if (!conversation) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      await chatService.updateConversationEmail(conversationId, project.id, parsed.data.email);
      return c.json({ ok: true });
    },
  )

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

    // Verify contact form is enabled
    const formConfig = await widgetService.getContactFormConfig(project.id);
    if (!formConfig?.enabled) {
      return c.json({ error: "Contact form is not enabled" }, 400);
    }

    const submission = await widgetService.createContactFormSubmission(
      project.id,
      parsed.data.visitorId,
      parsed.data.data,
    );

    // Notify via Telegram if configured
    const settings = await projectService.getSettings(project.id);
    if (settings?.telegramBotToken && settings?.telegramChatId) {
      const telegramService = new TelegramService(db);
      const fields = Object.entries(parsed.data.data)
        .map(([key, val]) => `${key}: ${val}`)
        .join("\n");
      c.executionCtx.waitUntil(
        telegramService.sendMessage(
          settings.telegramBotToken,
          settings.telegramChatId,
          `New contact form submission:\n\n${fields}`,
        ).catch(() => {
          // Silently ignore Telegram errors
        }),
      );
    }

    return c.json(submission, 201);
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
    const settings = await telegramService.getTelegramSettings(projectId);
    if (!settings?.telegramBotToken || !settings?.telegramChatId) {
      return c.json({ error: "Telegram not configured" }, 400);
    }

    const body = (await c.req.json()) as { message?: any };
    const message = body.message;
    if (!message?.text || !message?.reply_to_message) {
      return c.json({ ok: true }); // Ignore non-reply messages
    }

    // Extract conversation ID from the original bot message
    const originalText = message.reply_to_message.text ?? "";
    const convMatch = originalText.match(/Conversation:\s*(\S+)/);
    if (!convMatch) return c.json({ ok: true });

    const conversationId = convMatch[1];
    const chatService = new ChatService(db, c.env.CONVERSATIONS_CACHE);
    const conversation = await chatService.getConversationById(conversationId, projectId);
    if (!conversation) {
      return c.json({ ok: true });
    }

    // Store agent reply
    await chatService.addMessage({
      conversationId,
      role: "agent",
      content: message.text,
    }, projectId);

    // Update conversation status
    await chatService.updateConversationStatus(
      conversationId,
      projectId,
      "agent_replied",
    );

    return c.json({ ok: true });
  })

  // ─── Widget Embed JS ───────────────────────────────────────────────────────
  .get("/api/widget-embed.js", async (c) => {
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
  // SESSION MIDDLEWARE (sets user, session, db on context)
  // ═══════════════════════════════════════════════════════════════════════════
  .use("/api/*", async (c, next) => {
    const db = drizzle(c.env.DB);
    c.set("db", db);

    const auth = createAuth(
      c.env,
      c.req.raw.cf as CfProperties,
    );
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    c.set("user", session?.user ?? null);
    c.set("session", session?.session ?? null);

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
    const project = await projectService.getProjectById(c.req.param("projectId"));
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

      // Summarize via Gemini
      const geminiService = new GeminiService(c.env.GEMINI_API_KEY);
      const context = await geminiService.summarizeWebsite(rawText);

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
    const project = await projectService.getProjectById(c.req.param("projectId"));
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
    const project = await projectService.getProjectById(c.req.param("projectId"));
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
    const project = await projectService.getProjectById(c.req.param("projectId"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const settings = await projectService.getSettings(project.id);
    const context = settings?.companyContext ?? `${project.name} website`;

    const geminiService = new GeminiService(c.env.GEMINI_API_KEY);
    const question = await geminiService.generateSampleQuestion(context);

    return c.json({ question });
  })

  // ─── Step 4: Mark onboarding complete ─────────────────────────────────────
  .post("/api/onboarding/:projectId/complete", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("projectId"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    await projectService.markOnboarded(project.id);

    return c.json({ ok: true });
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

    const body = await c.req.json();
    const parsed = validate(createProjectSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
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
    const action = await widgetService.createQuickAction({
      projectId: project.id,
      ...parsed.data,
    });
    return c.json(action, 201);
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

  // ─── Quick Topics ───────────────────────────────────────────────────────────
  .get("/api/projects/:id/quick-topics", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const topics = await widgetService.getQuickTopics(project.id);
    return c.json(topics);
  })
  .post("/api/projects/:id/quick-topics", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createQuickTopicSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const topic = await widgetService.createQuickTopic({
      projectId: project.id,
      ...parsed.data,
    });
    return c.json(topic, 201);
  })
  .delete("/api/projects/:id/quick-topics/:topicId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const deleted = await widgetService.deleteQuickTopic(
      c.req.param("topicId"),
      project.id,
    );
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  })

  // ─── Home Links ─────────────────────────────────────────────────────────────
  .get("/api/projects/:id/home-links", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const links = await widgetService.getHomeLinks(project.id);
    return c.json(links);
  })
  .post("/api/projects/:id/home-links", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = validate(createHomeLinkSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const widgetService = new WidgetService(db);

    // Enforce max 5 home links
    const existing = await widgetService.getHomeLinks(project.id);
    if (existing.length >= 5) {
      return c.json({ error: "Maximum of 5 home links allowed" }, 400);
    }

    const link = await widgetService.createHomeLink({
      projectId: project.id,
      ...parsed.data,
    });
    return c.json(link, 201);
  })
  .delete("/api/projects/:id/home-links/:linkId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const widgetService = new WidgetService(db);
    const deleted = await widgetService.deleteHomeLink(
      c.req.param("linkId"),
      project.id,
    );
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
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
    await resourceService.updateResourceStatus(resource.id, project.id, "pending");

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
    } else if (resource.type === "pdf" && resource.r2Key) {
      // Re-put the existing R2 object to trigger AI Search re-indexing
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const obj = await c.env.UPLOADS.get(resource.r2Key!);
            if (!obj) {
              await resourceService.updateResourceStatus(resource.id, project.id, "failed");
              return;
            }
            const body = await obj.arrayBuffer();
            await c.env.UPLOADS.put(resource.r2Key!, body, {
              httpMetadata: { contentType: "application/pdf" },
              customMetadata: {
                context: `PDF document: ${resource.title}`,
              },
            });
            await resourceService.updateResourceStatus(resource.id, project.id, "indexed");
          } catch (err) {
            console.error(`PDF reindex failed for resource ${resource.id}:`, err);
            await resourceService.updateResourceStatus(resource.id, project.id, "failed");
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

    const pages = await resourceService.getCrawledPages(resource.id, project.id);
    return c.json(pages);
  })
  .get("/api/projects/:id/resources/:resourceId/pages/:pageId/content", async (c) => {
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
  })
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
  .delete("/api/projects/:id/resources/:resourceId/pages/:pageId", async (c) => {
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
  })
  .post("/api/projects/:id/resources/:resourceId/pages/:pageId/refresh", async (c) => {
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
  })

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

    const msgs = await chatService.getMessages(conversation.id);
    return c.json({ conversation, messages: msgs });
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

    const message = await chatService.addMessage({
      conversationId: conversation.id,
      role: "agent",
      content: parsed.data.content,
    }, project.id);

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

    // Close the conversation
    await chatService.updateConversationStatus(conversation.id, project.id, "closed");

    // Auto-draft canned response if enabled
    const settings = await projectService.getSettings(project.id);
    if (settings?.autoCannedDraft) {
      // Run in background -- don't block the response
      const msgs = await chatService.getMessages(conversation.id);
      if (msgs.length >= 2) {
        const geminiService = new GeminiService(c.env.GEMINI_API_KEY);
        geminiService
          .generateCannedDraft(
            msgs.map((m) => ({ role: m.role, content: m.content })),
          )
          .then(async (draft) => {
            if (draft) {
              const cannedService = new CannedResponseService(db);
              await cannedService.createDraft(
                project.id,
                draft.trigger,
                draft.response,
                conversation.id,
              );
            }
          })
          .catch(() => {
            // Silently ignore auto-draft errors
          });
      }
    }

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
      console.error(`Queue message processing failed for ${message.body.url}:`, err);
      message.retry();
    }
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,
  queue: handleQueue,
};
