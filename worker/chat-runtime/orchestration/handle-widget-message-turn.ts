import { buildSupportSystemPrompt } from "../prompt/build-support-system-prompt";
import { createLanguageModel } from "../llm/create-language-model";
import {
  extractContactInfo,
  reformulateQuery,
  summarizeConversation,
  summarizeTeamRequest,
} from "../llm/auxiliary-calls";
import { streamSupportAgent } from "../agents/support-agent";
import { triggerAutoDraftIfEnabled } from "../post-turn/auto-draft";
import { createTeamRequestSubmission } from "../post-turn/team-request";
import { verifyAnswer } from "../workflows/verify-answer";
import { buildRetrievalQueries } from "../retrieval/build-retrieval-queries";
import { runAiSearch } from "../retrieval/run-ai-search";
import { createWidgetSseResponse } from "../streaming/create-widget-sse-response";
import {
  createInitialAgentEventState,
  emitSseEvent,
  emitStatusEvent,
  mapAgentStreamPartToSse,
} from "../streaming/map-agent-events-to-sse";
import {
  type TurnTelemetry,
  type WidgetMessageTurnContext,
  toToolDefinition,
} from "../types";
import { BillingService } from "../../services/billing-service";
import { ChatService } from "../../services/chat-service";
import { GuidelineService } from "../../services/guideline-service";
import { ProjectService } from "../../services/project-service";
import { TelegramService } from "../../services/telegram-service";
import { ToolService } from "../../services/tool-service";
import { WidgetService } from "../../services/widget-service";
import { isEncrypted, decryptHeaders } from "../../services/encryption-service";
import { EmailService } from "../../services/email-service";

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
    // Ignore malformed metadata.
  }

  return {};
}

async function loadMessageImage(options: {
  imageUrl: string | null;
  uploads: R2Bucket;
}): Promise<{ base64: string; mimeType: string } | null> {
  if (!options.imageUrl) return null;

  try {
    const r2Key = options.imageUrl.replace("/api/uploads/", "");
    const obj = await options.uploads.get(r2Key);
    if (!obj) return null;

    const mimeType = obj.httpMetadata?.contentType ?? "image/jpeg";
    const arrayBuffer = await obj.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return {
      base64: btoa(binary),
      mimeType,
    };
  } catch (err) {
    console.error("Failed to fetch image for chat runtime:", err);
    return null;
  }
}

function shouldVerifyAnswer(options: {
  userMessage: string;
  fullResponse: string;
  groundingConfidence: "high" | "low" | "none";
  hadToolCalls: boolean;
}): boolean {
  if (!options.fullResponse.trim()) return false;
  if (options.fullResponse.includes("[NEW_INQUIRY]")) return false;
  if (options.fullResponse.includes("[RESOLVED]")) return false;

  const looksLikeLookup =
    /(how|why|can|does|where|pricing|policy|refund|billing|setup|configure|integration|api|error|issue|problem|plan)/i.test(
      options.userMessage,
    );
  const draftedAnswerHasSpecificClaims =
    /(\$|\b\d+\b|%|\bdays?\b|\bhours?\b|\bminutes?\b|\bmonths?\b|\byears?\b|\bgo to\b|\bclick\b|\bopen\b|\bselect\b|\benable\b|\bdisable\b|\bupgrade\b|\bcancel\b|\brefund\b)/i.test(
      options.fullResponse,
    ) || /(^|\n)(-|\d+\.)\s/.test(options.fullResponse);

  return (
    (looksLikeLookup || draftedAnswerHasSpecificClaims) &&
    (
      options.groundingConfidence !== "high" ||
      options.hadToolCalls ||
      draftedAnswerHasSpecificClaims
    )
  );
}

export async function handleWidgetMessageTurn(
  context: WidgetMessageTurnContext,
): Promise<Response> {
  const projectService = new ProjectService(context.db);
  const billingService = new BillingService(context.db, context.env);
  const chatService = new ChatService(
    context.db,
    context.env.CONVERSATIONS_CACHE,
  );
  const toolService = new ToolService(context.db);
  const guidelineService = new GuidelineService(context.db);

  const ownerSub = await billingService.getSubscriptionByUserId(
    context.project.userId,
  );
  if (!ownerSub || !billingService.isSubscriptionActive(ownerSub)) {
    return Response.json(
      {
        error:
          "This chatbot is currently unavailable. Please contact the site owner.",
        code: "subscription_inactive",
      },
      { status: 503 },
    );
  }

  const messageCheck = await billingService.checkMessageLimit(
    context.project.userId,
  );
  if (!messageCheck.allowed) {
    return Response.json(
      {
        error: "Message limit reached. Please contact the site owner.",
        code: "message_limit_reached",
      },
      { status: 429 },
    );
  }

  let conversation = await chatService.getConversationById(
    context.conversationId,
    context.project.id,
  );
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const settings = await projectService.getSettings(context.project.id);
  const enabledTools = await toolService.getEnabledTools(context.project.id);
  const enabledGuidelines = await guidelineService.getEnabledByProject(
    context.project.id,
  );

  if (enabledTools.length > 0) {
    if (!context.checkRateLimit(`toolmsg:${context.project.id}`, 100, 60_000)) {
      return Response.json(
        {
          error: "Tool execution rate limit exceeded. Please try again shortly.",
        },
        { status: 429 },
      );
    }

    for (const tool of enabledTools) {
      if (tool.headers && isEncrypted(tool.headers)) {
        try {
          const decrypted = await decryptHeaders(
            tool.headers,
            context.env.ENCRYPTION_KEY,
          );
          tool.headers = JSON.stringify(decrypted);
        } catch {
          tool.headers = null;
        }
      }
    }
  }

  if (conversation.status === "closed") {
    const reopened = await chatService.reopenConversation(
      context.conversationId,
      context.project.id,
    );
    if (reopened) {
      conversation = reopened;
      if (settings?.telegramBotToken && settings?.telegramChatId) {
        const telegramService = new TelegramService(context.db);
        context.executionCtx.waitUntil(
          telegramService
            .sendMessage(
              settings.telegramBotToken,
              settings.telegramChatId,
              `🔄 Visitor ${conversation.visitorName ?? conversation.visitorId} reopened a closed conversation.`,
              conversation.telegramThreadId
                ? parseInt(conversation.telegramThreadId, 10)
                : undefined,
            )
            .catch((err) => {
              console.error("Telegram reopen notification failed:", err);
            }),
        );
      }
    }
  }

  const imageUrl = context.payload.imageUrl ?? null;
  await chatService.addMessage(
    {
      conversationId: context.conversationId,
      role: "visitor",
      content: context.payload.content,
      imageUrl,
    },
    context.project.id,
  );

  if (
    conversation.status === "waiting_agent" ||
    conversation.status === "agent_replied"
  ) {
    if (settings?.telegramBotToken && settings?.telegramChatId) {
      const telegramService = new TelegramService(context.db);
      context.executionCtx.waitUntil(
        telegramService
          .forwardVisitorMessage(
            settings.telegramBotToken,
            settings.telegramChatId,
            conversation.visitorName,
            context.payload.content,
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

    return Response.json({ ok: true, agentMode: true });
  }

  return createWidgetSseResponse(async (controller, encoder) => {
    const telemetry: TurnTelemetry = { startedAt: Date.now() };
    function emitStatus(message: string, phase: "retrieval" | "tool" | "verify" | "compose"): void {
      if (!telemetry.firstStatusAt) {
        telemetry.firstStatusAt = Date.now();
      }
      emitStatusEvent(controller, encoder, { phase, message });
    }

    try {
      const image = await loadMessageImage({
        imageUrl,
        uploads: context.env.UPLOADS,
      });

      emitStatus("Searching docs...", "retrieval");

      const history =
        (await chatService.getFromCache(context.conversationId, context.project.id)) ??
        (await chatService.getMessages(context.conversationId));
      const conversationHistory = history
        .filter((message) => message.role !== "bot" || message.content)
        .slice(-20)
        .map((message) => ({
          role: message.role as "visitor" | "bot" | "agent",
          content: message.content,
        }));

      const visitorMessages = history.filter((message) => message.role === "visitor");
      if (
        visitorMessages.length === 1 &&
        settings?.telegramBotToken &&
        settings?.telegramChatId
      ) {
        const telegramService = new TelegramService(context.db);
        context.executionCtx.waitUntil(
          telegramService
            .notifyNewConversation(
              settings.telegramBotToken,
              settings.telegramChatId,
              context.conversationId,
              conversation.visitorName,
              conversation.visitorEmail,
              context.payload.content,
              context.env.BETTER_AUTH_URL,
              context.project.id,
              settings.botName,
            )
            .then(async (messageId) => {
              if (messageId) {
                await chatService.updateTelegramThreadId(
                  context.conversationId,
                  context.project.id,
                  String(messageId),
                );
              }
            })
            .catch((err) => {
              console.error("New conversation Telegram notification failed:", err);
            }),
        );
      }

      const modelConfig = {
        model: context.env.AI_MODEL,
        geminiApiKey: context.env.GEMINI_API_KEY,
        openaiApiKey: context.env.OPENAI_API_KEY,
      };
      const model = createLanguageModel(modelConfig);

      const [searchQuery, conversationSummary] = await Promise.all([
        reformulateQuery(model, conversationHistory, context.payload.content),
        summarizeConversation(model, conversationHistory),
      ]);
      const retrievalQueries = buildRetrievalQueries(
        context.payload.content,
        searchQuery,
      );

      const retrieval = await runAiSearch({
        env: context.env,
        db: context.db,
        projectId: context.project.id,
        queries: retrievalQueries,
      });
      if (retrieval.droppedCrossTenant > 0) {
        console.warn(
          `Dropped ${retrieval.droppedCrossTenant} cross-tenant retrieval chunks for project ${context.project.id}`,
        );
      }
      if (retrieval.unresolvedKeys.length > 0) {
        console.warn(
          `Could not resolve ${retrieval.unresolvedKeys.length} RAG source keys for project ${context.project.id}`,
        );
      }

      const cannedMatch = await chatService.findCannedResponse(
        context.project.id,
        context.payload.content,
      );

      const conversationMetadata = parseConversationMetadata(conversation.metadata);
      const agentHandbackInstructions =
        typeof conversationMetadata.agentHandbackInstructions === "string"
          ? conversationMetadata.agentHandbackInstructions
          : null;

      const systemPrompt = buildSupportSystemPrompt(
        settings ?? {
          toneOfVoice: "professional",
          customTonePrompt: null,
          companyContext: null,
          botName: null,
          agentName: null,
        },
        context.project.name,
        retrieval.ragContext,
        cannedMatch ? cannedMatch.response : null,
        conversationSummary,
        {
          hasTools: enabledTools.length > 0,
          guidelines: enabledGuidelines.map((guideline) => ({
            condition: guideline.condition,
            instruction: guideline.instruction,
          })),
          agentHandbackInstructions,
          pageContext: context.payload.pageContext,
          visitorInfo: {
            name: conversation.visitorName,
            email: conversation.visitorEmail,
          },
          groundingConfidence: retrieval.groundingConfidence,
        },
      );

      emitStatus("Writing the reply...", "compose");

      const supportAgent = await streamSupportAgent(
        { modelConfig },
        {
          systemPrompt,
          conversationHistory,
          userMessage: context.payload.content,
          image,
          tools: enabledTools.map(toToolDefinition),
          onToolCallStart: (info) => {
            console.log(`Tool call started: ${info.toolName}`, info.input);
            emitStatus("Checking connected systems...", "tool");
          },
          onToolCallFinish: (info) => {
            const matchedTool = enabledTools.find((tool) => tool.name === info.toolName);
            if (matchedTool) {
              toolService
                .logExecution({
                  toolId: matchedTool.id,
                  conversationId: context.conversationId,
                  input: info.input ?? {},
                  output: info.output,
                  status: info.success ? "success" : "error",
                  duration: info.durationMs,
                  errorMessage: info.error ? String(info.error) : null,
                })
                .catch((err) => {
                  console.error("Failed to log tool execution:", err);
                });
            }
          },
        },
      );

      let eventState = createInitialAgentEventState();
      const emittedToolCalls = new Set<string>();
      const toolCallStartTimes = new Map<string, number>();

      for await (const part of supportAgent.fullStream) {
        if (!telemetry.firstTextAt && part.type === "text-delta") {
          telemetry.firstTextAt = Date.now();
        }

        eventState = mapAgentStreamPartToSse({
          part,
          controller,
          encoder,
          emittedToolCalls,
          toolCallStartTimes,
          state: eventState,
        });

        if (part.type === "tool-result" && !eventState.lastToolError) {
          emitStatus("Writing the reply...", "compose");
        }
      }

      let fullResponse = eventState.fullResponse;

      if (eventState.hadToolCalls && !fullResponse.trim()) {
        if (eventState.lastToolError) {
          emitSseEvent(controller, encoder, {
            toolError: {
              message:
                "The tool encountered an error while processing your request.",
              detail: eventState.lastToolError,
            },
          });
          fullResponse =
            "I tried to look that up but the tool encountered an error. Could you try again?";
        } else {
          fullResponse =
            "I found some information but had trouble processing it. Could you try rephrasing your question?";
        }

        emitSseEvent(controller, encoder, { text: fullResponse });
      }

      if (
        shouldVerifyAnswer({
          userMessage: context.payload.content,
          fullResponse,
          groundingConfidence: retrieval.groundingConfidence,
          hadToolCalls: eventState.hadToolCalls,
        })
      ) {
        telemetry.verifierRan = true;
        emitStatus("Checking factual claims against docs...", "verify");

        const verification = await verifyAnswer({
          model,
          userMessage: context.payload.content,
          draftedAnswer: fullResponse,
          ragContext: retrieval.ragContext,
          lastToolOutput: eventState.lastToolOutput,
        });
        telemetry.verifierVerdict = verification.verdict;
        console.log("Claim verification result", {
          projectId: context.project.id,
          conversationId: context.conversationId,
          verdict: verification.verdict,
          claimsChecked: verification.claims.length,
          unsupportedClaims: verification.claims.filter(
            (claim) => claim.status === "unsupported",
          ).length,
          partialClaims: verification.claims.filter(
            (claim) => claim.status === "partial",
          ).length,
          summary: verification.summary ?? null,
        });

        if (
          verification.verdict !== "supported" &&
          verification.answer.trim() &&
          verification.answer.trim() !== fullResponse.trim()
        ) {
          fullResponse = verification.answer.trim();
          emitSseEvent(controller, encoder, { finalText: fullResponse });
        }
      }

      if (fullResponse.includes("[NEW_INQUIRY]")) {
        const contactInfo = await extractContactInfo(model, conversationHistory);
        const visitorName = conversation.visitorName ?? contactInfo.name ?? null;
        const visitorEmail = conversation.visitorEmail ?? contactInfo.email ?? null;

        if (contactInfo.name || contactInfo.email) {
          await chatService.updateConversation(context.conversationId, context.project.id, {
            visitorName: visitorName ?? undefined,
            visitorEmail: visitorEmail ?? undefined,
          });
        }

        await chatService.updateConversationStatus(
          context.conversationId,
          context.project.id,
          "waiting_agent",
        );

        const summary = await summarizeTeamRequest(model, conversationHistory);
        const telegramService =
          settings?.telegramBotToken && settings?.telegramChatId
            ? new TelegramService(context.db)
            : undefined;

        const submission = await createTeamRequestSubmission({
          chatService,
          widgetService: new WidgetService(context.db),
          projectService,
          telegramService,
          project: context.project,
          conversation: {
            ...conversation,
            visitorName,
            visitorEmail,
          },
          conversationHistory,
          summary,
          email: visitorEmail ?? "not provided",
          settings,
          env: {
            BETTER_AUTH_URL: context.env.BETTER_AUTH_URL,
            RESEND_API_KEY: context.env.RESEND_API_KEY,
          },
          executionCtx: context.executionCtx,
        });

        if (
          telegramService &&
          settings?.telegramBotToken &&
          settings?.telegramChatId
        ) {
          const threadId = await telegramService.notifyHandoff(
            settings.telegramBotToken,
            settings.telegramChatId,
            context.conversationId,
            visitorName,
            context.payload.content,
            conversationHistory,
            context.env.BETTER_AUTH_URL,
            context.project.id,
            settings.botName,
          );
          if (threadId) {
            await chatService.updateTelegramThreadId(
              context.conversationId,
              context.project.id,
              String(threadId),
            );
          }
        }

        if (context.env.RESEND_API_KEY) {
          const emailService = new EmailService(context.env.RESEND_API_KEY);
          const ownerEmail = await projectService.getOwnerEmail(context.project.id);
          if (ownerEmail) {
            const projectName = settings?.companyName ?? context.project.name;
            const dashboardUrl = `${context.env.BETTER_AUTH_URL}/app/projects/${context.project.id}/conversations/${context.conversationId}`;
            context.executionCtx.waitUntil(
              emailService
                .sendHandoffNotification({
                  ownerEmail,
                  projectName,
                  visitorName,
                  visitorMessage: context.payload.content,
                  dashboardUrl,
                })
                .catch((err) => {
                  console.error("Inquiry email notification failed:", err);
                }),
            );
          }
        }

        void submission;
        fullResponse = fullResponse.replace("[NEW_INQUIRY]", "").trim();
        if (!fullResponse) {
          const agentLabel = settings?.agentName ?? "a team member";
          fullResponse = `I've forwarded this to the team. ${agentLabel} will follow up shortly!`;
        }
        emitSseEvent(controller, encoder, { inquiry: true });
        emitSseEvent(controller, encoder, { finalText: fullResponse });
      }

      if (fullResponse.includes("[RESOLVED]")) {
        await chatService.updateConversationStatus(
          context.conversationId,
          context.project.id,
          "closed",
          "bot_resolved",
        );
        fullResponse = fullResponse.replace(
          "[RESOLVED]",
          "Glad I could help! Feel free to reach out anytime if you have more questions.",
        );
        emitSseEvent(controller, encoder, { resolved: true });
        emitSseEvent(controller, encoder, { finalText: fullResponse });
        triggerAutoDraftIfEnabled({
          projectId: context.project.id,
          conversationId: context.conversationId,
          db: context.db,
          env: context.env,
          kv: context.env.CONVERSATIONS_CACHE,
        });
      }

      const botMessage = await chatService.addMessage(
        {
          conversationId: context.conversationId,
          role: "bot",
          content: fullResponse,
          sources:
            retrieval.sourceReferences.length > 0
              ? JSON.stringify(retrieval.sourceReferences)
              : null,
        },
        context.project.id,
      );

      try {
        await billingService.incrementMessageUsage(context.project.userId);
      } catch (err) {
        console.error("Failed to increment message usage:", err);
      }

      if (eventState.hadToolCalls) {
        toolService
          .linkExecutionsToMessage(context.conversationId, botMessage.id)
          .catch((err) => {
            console.error("Failed to link tool executions to message:", err);
          });
      }

      console.log("Chat runtime telemetry", {
        projectId: context.project.id,
        conversationId: context.conversationId,
        statusLatencyMs: telemetry.firstStatusAt
          ? telemetry.firstStatusAt - telemetry.startedAt
          : null,
        firstTextLatencyMs: telemetry.firstTextAt
          ? telemetry.firstTextAt - telemetry.startedAt
          : null,
        verifierRan: telemetry.verifierRan ?? false,
        verifierVerdict: telemetry.verifierVerdict ?? null,
      });

      emitSseEvent(controller, encoder, {
        done: true,
        messageId: botMessage.id,
        sources:
          retrieval.sourceReferences.length > 0
            ? retrieval.sourceReferences
            : undefined,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      emitSseEvent(controller, encoder, { error: errorMessage });
    }
  });
}
