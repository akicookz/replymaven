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
import { AiService } from "./services/ai-service";
import { TelegramService } from "./services/telegram-service";
import { CannedResponseService } from "./services/canned-response-service";
import { DashboardService } from "./services/dashboard-service";
import { CrawlService, type CrawlMessage } from "./services/crawl-service";
import { BookingService } from "./services/booking-service";
import { EmailService } from "./services/email-service";
import { ToolService } from "./services/tool-service";
import {
  encryptHeaders,
  decryptHeaders,
  maskHeaders,
  isEncrypted,
} from "./services/encryption-service";
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
  updateBookingConfigSchema,
  setAvailabilityRulesSchema,
  createBookingSchema,
  createToolSchema,
  updateToolSchema,
  testToolSchema,
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

    // Query AI Search for relevant context with improved retrieval settings
    let ragContext = "";
    const ragFilenames: string[] = [];
    try {
      const searchResults = await c.env.AI.aiSearch.get("supportbot").search({
        messages: [{ role: "user", content: searchQuery }],
        ai_search_options: {
          retrieval: {
            filters: {
              type: "eq",
              key: "folder",
              value: `${project.id}/`,
            },
            max_num_results: 8,
            match_threshold: 0.3,
          },
          query_rewrite: {
            enabled: true,
          },
          reranking: {
            enabled: true,
            model: "@cf/baai/bge-reranker-base",
          },
        },
      });

      if (searchResults?.chunks?.length > 0) {
        // Track the top result score for confidence assessment
        const topScore =
          (searchResults.chunks[0] as { score?: number }).score ?? 0;
        const ragConfident = topScore >= 0.6;

        ragContext = searchResults.chunks
          .map(
            (item: {
              item?: { key?: string };
              score?: number;
              text?: string;
            }) => {
              const filename = item.item?.key;
              // Collect filenames for source citations from relevant results
              if (filename && (item.score ?? 0) >= 0.45) {
                ragFilenames.push(filename);
              }
              const relevance = ((item.score ?? 0) * 100).toFixed(0);
              return `<source file="${filename}" relevance="${relevance}%">\n${item.text ?? ""}\n</source>`;
            },
          )
          .join("\n\n");

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

    // Check if booking is enabled and load enabled tools in parallel
    const bookingService = new BookingService(db);
    const toolService = new ToolService(db);
    const [bookingCfg, enabledTools] = await Promise.all([
      bookingService.getBookingConfig(project.id),
      toolService.getEnabledTools(project.id),
    ]);
    const bookingEnabled = bookingCfg?.enabled ?? false;

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

    // Build system prompt and stream response
    const systemPrompt = aiService.buildSystemPrompt(
      settings ?? {
        toneOfVoice: "professional",
        customTonePrompt: null,
        companyContext: null,
      },
      project.name,
      ragContext,
      cannedMatch ? cannedMatch.response : null,
      conversationSummary,
      { bookingEnabled, hasTools: enabledTools.length > 0 },
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
              // Only emit the first call per tool name (skip retries from multi-step loops)
              if (!emittedToolCalls.has(part.toolName)) {
                emittedToolCalls.add(part.toolName);
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      toolCall: { name: part.toolName },
                    })}\n\n`,
                  ),
                );
              }
            } else if (part.type === "tool-result") {
              const output = part.output as Record<string, unknown> | null;
              const hasError = !!output?.error;
              const errorMessage = hasError ? String(output!.error) : null;

              // Track last tool output/error for fallback diagnostics
              lastToolOutput = output;
              lastToolError = errorMessage;

              // Emit tool result with error details when applicable
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    toolResult: {
                      name: part.toolName,
                      success: !hasError,
                      ...(errorMessage ? { errorMessage } : {}),
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

          // Check if booking was requested
          if (fullResponse.includes("[BOOKING_REQUESTED]")) {
            fullResponse = fullResponse.replace(
              "[BOOKING_REQUESTED]",
              "I'd be happy to help you schedule a meeting! Let me open our booking calendar for you.",
            );

            // Send booking event to widget
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ booking: true })}\n\n`),
            );
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
        telegramService
          .sendMessage(
            settings.telegramBotToken,
            settings.telegramChatId,
            `New contact form submission:\n\n${fields}`,
          )
          .catch(() => {
            // Silently ignore Telegram errors
          }),
      );
    }

    return c.json(submission, 201);
  })

  // ─── Booking Config (public - for widget) ──────────────────────────────────
  .get("/api/widget/:projectSlug/booking/config", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`bconf:${ip}`, 30, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const bookingService = new BookingService(db);
    const config = await bookingService.getBookingConfig(project.id);

    if (!config || !config.enabled) {
      return c.json({ enabled: false });
    }

    return c.json({
      enabled: true,
      timezone: config.timezone,
      slotDuration: config.slotDuration,
      bookingWindowDays: config.bookingWindowDays,
    });
  })

  // ─── Available Slots (public - for widget) ────────────────────────────────
  .get("/api/widget/:projectSlug/booking/slots", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`bslots:${ip}`, 60, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const date = c.req.query("date"); // YYYY-MM-DD
    const visitorTimezone = c.req.query("timezone") ?? "America/New_York";

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json(
        { error: "Valid date parameter required (YYYY-MM-DD)" },
        400,
      );
    }

    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const bookingService = new BookingService(db);
    const slots = await bookingService.getAvailableSlots(
      project.id,
      date,
      visitorTimezone,
    );

    return c.json({ slots });
  })

  // ─── Create Booking (public - from widget) ────────────────────────────────
  .post("/api/widget/:projectSlug/booking", async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(`book:${ip}`, 5, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const slug = c.req.param("projectSlug");
    const db = drizzle(c.env.DB);
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectBySlugPublic(slug);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json();
    const parsed = validate(createBookingSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const bookingService = new BookingService(db);

    let booking;
    try {
      booking = await bookingService.createBooking({
        projectId: project.id,
        visitorName: parsed.data.visitorName,
        visitorEmail: parsed.data.visitorEmail,
        visitorPhone: parsed.data.visitorPhone,
        notes: parsed.data.notes,
        startTime: parsed.data.startTime,
        timezone: parsed.data.timezone,
        conversationId: parsed.data.conversationId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Booking failed";
      return c.json({ error: message }, 409);
    }

    // Send confirmation emails in background
    if (c.env.RESEND_API_KEY) {
      const emailService = new EmailService(c.env.RESEND_API_KEY);
      const bookingConfig = await bookingService.getBookingConfig(project.id);
      const settings = await projectService.getSettings(project.id);

      // Get project owner email
      const ownerEmail = await projectService.getOwnerEmail(project.id);

      c.executionCtx.waitUntil(
        Promise.all([
          emailService.sendBookingConfirmation({
            visitorName: booking.visitorName,
            visitorEmail: booking.visitorEmail,
            visitorPhone: booking.visitorPhone,
            notes: booking.notes,
            startTime: new Date(booking.startTime),
            endTime: new Date(booking.endTime),
            timezone: booking.timezone,
            projectName: settings?.companyName ?? project.name,
          }),
          emailService.sendBookingNotification({
            visitorName: booking.visitorName,
            visitorEmail: booking.visitorEmail,
            visitorPhone: booking.visitorPhone,
            notes: booking.notes,
            startTime: new Date(booking.startTime),
            endTime: new Date(booking.endTime),
            timezone: booking.timezone,
            projectName: settings?.companyName ?? project.name,
            ownerEmail: ownerEmail ?? undefined,
            ownerTimezone: bookingConfig?.timezone,
          }),
        ]).catch((err) => {
          console.error("Booking email failed:", err);
        }),
      );
    }

    return c.json(booking, 201);
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
    const conversation = await chatService.getConversationById(
      conversationId,
      projectId,
    );
    if (!conversation) {
      return c.json({ ok: true });
    }

    // Store agent reply
    await chatService.addMessage(
      {
        conversationId,
        role: "agent",
        content: message.text,
      },
      projectId,
    );

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

    const auth = createAuth(c.env, c.req.raw.cf as CfProperties);
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

    // Enforce max 1 contact_form and max 1 booking action per project
    if (parsed.data.type === "contact_form" || parsed.data.type === "booking") {
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
    } else if (resource.type === "pdf" && resource.r2Key) {
      // Re-put the existing R2 object to trigger AI Search re-indexing
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const obj = await c.env.UPLOADS.get(resource.r2Key!);
            if (!obj) {
              await resourceService.updateResourceStatus(
                resource.id,
                project.id,
                "failed",
              );
              return;
            }
            const body = await obj.arrayBuffer();
            await c.env.UPLOADS.put(resource.r2Key!, body, {
              httpMetadata: { contentType: "application/pdf" },
              customMetadata: {
                context: `PDF document: ${resource.title}`,
              },
            });
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

    // Close the conversation
    await chatService.updateConversationStatus(
      conversation.id,
      project.id,
      "closed",
    );

    // Auto-draft canned response if enabled
    const settings = await projectService.getSettings(project.id);
    if (settings?.autoCannedDraft) {
      // Run in background -- don't block the response
      const msgs = await chatService.getMessages(conversation.id);
      if (msgs.length >= 2) {
        const aiService = new AiService({
          model: c.env.AI_MODEL,
          geminiApiKey: c.env.GEMINI_API_KEY,
          openaiApiKey: c.env.OPENAI_API_KEY,
        });
        aiService
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

  // ─── Booking Config (Dashboard) ──────────────────────────────────────────────
  .get("/api/projects/:id/booking/config", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const bookingService = new BookingService(db);
    const [config, rules] = await Promise.all([
      bookingService.getBookingConfig(project.id),
      bookingService.getAvailabilityRules(project.id),
    ]);

    return c.json({
      config: config ?? {
        enabled: false,
        timezone: "America/New_York",
        slotDuration: 30,
        bufferTime: 0,
        bookingWindowDays: 14,
        minAdvanceHours: 1,
      },
      rules,
    });
  })
  .put("/api/projects/:id/booking/config", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updateBookingConfigSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const bookingService = new BookingService(db);
    const config = await bookingService.upsertBookingConfig(
      project.id,
      parsed.data,
    );
    return c.json(config);
  })

  // ─── Availability Rules (Dashboard) ────────────────────────────────────────
  .put("/api/projects/:id/booking/availability", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(setAvailabilityRulesSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const bookingService = new BookingService(db);
    const rules = await bookingService.setAvailabilityRules(
      project.id,
      parsed.data.rules,
    );
    return c.json(rules);
  })

  // ─── Bookings List (Dashboard) ─────────────────────────────────────────────
  .get("/api/projects/:id/bookings", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const status = c.req.query("status");
    const bookingService = new BookingService(db);
    const bookings = await bookingService.getBookings(project.id, {
      status: status || undefined,
    });
    return c.json(bookings);
  })

  // ─── Cancel Booking (Dashboard) ────────────────────────────────────────────
  .patch("/api/projects/:id/bookings/:bookingId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(c.req.param("id"));
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const bookingService = new BookingService(db);
    const booking = await bookingService.cancelBooking(
      c.req.param("bookingId"),
      project.id,
    );
    if (!booking) return c.json({ error: "Not found" }, 404);
    return c.json(booking);
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
