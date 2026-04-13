import {
  createLanguageModel,
  createModelRuntimeState,
} from "../llm/create-language-model";
import {
  classifySupportTurn,
  summarizeConversation,
} from "../llm/auxiliary-calls";
import { runPlannerLoop } from "../executor/run-planner-loop";
import {
  findBestFaqMatch,
  getOrBuildCompiledFaqContext,
} from "../prompt/build-compiled-faq-context";
import { triggerAutoRefinementIfEnabled } from "../post-turn/auto-refine";
import {
  type RetrievalResult,
} from "../retrieval/run-ai-search";
import { classifyTaskScope } from "../workflows/classify-task-scope";
import {
  classifyInquiryRefinement,
  type InquiryRefinementDecision,
} from "../workflows/classify-inquiry-refinement";
import { createWidgetSseResponse } from "../streaming/create-widget-sse-response";
import {
  createInitialAgentEventState,
  emitSseEvent,
  emitStatusEvent,
} from "../streaming/map-agent-events-to-sse";
import { stripInternalTokens } from "../streaming/internal-tokens";
import {
  type ConversationChatState,
  type TurnTelemetry,
  type WidgetMessageTurnContext,
  parseChatState,
  toToolDefinition,
} from "../types";
import { BillingService } from "../../services/billing-service";
import { ChatService } from "../../services/chat-service";
import { GuidelineService } from "../../services/guideline-service";
import { logError, logInfo, logWarn } from "../../observability";
import { ProjectService } from "../../services/project-service";
import { ResourceService } from "../../services/resource-service";
import { TelegramService } from "../../services/telegram-service";
import { ToolService } from "../../services/tool-service";
import {
  WidgetService,
  parseInquiryData,
} from "../../services/widget-service";
import { type InquiryFieldSpec } from "../types";
import { isEncrypted, decryptHeaders } from "../../services/encryption-service";

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

function createEmptyRetrievalResult(): RetrievalResult {
  return {
    ragContext: "",
    faqContext: "",
    knowledgeBaseContext: "",
    sourceReferences: [],
    groundingConfidence: "none",
    unresolvedKeys: [],
    droppedCrossTenant: 0,
    retrievalAttempted: false,
    broaderSearchAttempted: false,
  };
}

function isAgentRequestedStatus(status: string): boolean {
  return status === "waiting_agent" || status === "agent_replied";
}

function getLastTeamMessageRole(
  history: Array<{ role: string }>,
): "bot" | "agent" | null {
  for (let index = history.length - 1; index >= 0; index--) {
    const role = history[index]?.role;
    if (role === "bot" || role === "agent") {
      return role;
    }
  }

  return null;
}

function shouldAllowTeamRequest(options: {
  conversation: {
    status: string;
  };
}): { allowed: boolean; reason: string } {
  if (isAgentRequestedStatus(options.conversation.status)) {
    return { allowed: false, reason: "already_in_agent_mode" };
  }

  return { allowed: true, reason: "planner_decided" };
}

function claimsUnavailableCapabilities(response: string): boolean {
  if (!response.trim()) {
    return false;
  }

  return (
    /\b(i|i've|i have|i was able to)\b[^.!?\n]{0,100}\b(search(?:ed)?|browse(?:d)?|looked up|found|checked)\b[^.!?\n]{0,100}\b(web|internet|online|google|browser)\b/i.test(
      response,
    ) ||
    /\baccording to google\b/i.test(response) ||
    /\bi found (this|that|it) online\b/i.test(response) ||
    /\bi checked the internet\b/i.test(response)
  );
}

function buildWidgetTurnLogContext(
  context: WidgetMessageTurnContext,
  turnId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    turnId,
    projectId: context.project.id,
    conversationId: context.conversationId,
    ...extra,
  };
}

function getToolNames(tools: Array<{ name: string }>): string[] {
  return tools.map((tool) => tool.name);
}

export async function handleWidgetMessageTurn(
  context: WidgetMessageTurnContext,
): Promise<Response> {
  const turnId = crypto.randomUUID();
  const projectService = new ProjectService(context.db);
  const billingService = new BillingService(context.db, context.env);
  const chatService = new ChatService(
    context.db,
    context.env.CONVERSATIONS_CACHE,
  );
  const toolService = new ToolService(context.db);
  const guidelineService = new GuidelineService(context.db);
  const resourceService = new ResourceService(context.db, context.env.UPLOADS);
  const widgetService = new WidgetService(context.db);

  logInfo(
    "widget_turn.started",
    buildWidgetTurnLogContext(context, turnId, {
      model: context.env.AI_MODEL,
      messageLength: context.payload.content.length,
      hasImage: Boolean(context.payload.imageUrl),
      pageContextKeys: Object.keys(context.payload.pageContext ?? {}),
    }),
  );

  const ownerSub = await billingService.getSubscriptionByUserId(
    context.project.userId,
  );
  if (!ownerSub || !billingService.isSubscriptionActive(ownerSub)) {
    logWarn(
      "widget_turn.blocked",
      buildWidgetTurnLogContext(context, turnId, {
        reason: "subscription_inactive",
      }),
    );
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
    logWarn(
      "widget_turn.blocked",
      buildWidgetTurnLogContext(context, turnId, {
        reason: "message_limit_reached",
      }),
    );
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
    logWarn(
      "widget_turn.blocked",
      buildWidgetTurnLogContext(context, turnId, {
        reason: "conversation_not_found",
      }),
    );
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  let chatState: ConversationChatState = parseChatState(
    conversation.chatState,
  );

  // When the frontend ships its own last-N turns we skip the server-side
  // prefetch entirely. Otherwise we fetch KV/D1 history in parallel with the
  // other setup fetches so the serial `load_history` stage inside the SSE
  // callback becomes a no-op lookup on the already-resolved value. This
  // shaves one round-trip off the happy path without changing the fallback
  // order (KV -> D1) that the load_history branch already relied on.
  const clientSuppliedHistory =
    Array.isArray(context.payload.history) &&
    context.payload.history.length > 0;

  const [
    settings,
    enabledTools,
    enabledGuidelines,
    allResources,
    existingInquiryRow,
    inquiryConfigRow,
    parallelPrefetchedHistory,
  ] = await Promise.all([
    projectService.getSettings(context.project.id),
    toolService.getEnabledTools(context.project.id),
    guidelineService.getEnabledByProject(context.project.id),
    resourceService.getResourcesByProject(context.project.id),
    widgetService.getInquiryByConversationId(
      context.project.id,
      context.conversationId,
    ),
    widgetService.getInquiryConfig(context.project.id),
    clientSuppliedHistory
      ? Promise.resolve(
          null as Awaited<ReturnType<typeof chatService.getMessages>> | null,
        )
      : chatService
          .getFromCache(context.conversationId, context.project.id)
          .then(
            (
              cached,
            ):
              | Promise<Awaited<ReturnType<typeof chatService.getMessages>>>
              | Awaited<ReturnType<typeof chatService.getMessages>> =>
              cached ?? chatService.getMessages(context.conversationId),
          ),
  ]);
  const sortedFaqResources = allResources
    .filter((resource) => resource.type === "faq")
    .sort((left, right) => left.title.localeCompare(right.title));
  // Cache the compiled FAQ context per (project, fingerprint) in KV for 5
  // minutes. Fingerprint is derived from each FAQ resource's id + updatedAt,
  // so the cache invalidates automatically whenever any FAQ is edited. KV
  // read/write failures fall through to the synchronous build.
  const compiledFaqContext = await getOrBuildCompiledFaqContext({
    kv: context.env.CONVERSATIONS_CACHE,
    projectId: context.project.id,
    fingerprintResources: sortedFaqResources.map((resource) => ({
      id: resource.id,
      updatedAt: resource.updatedAt,
    })),
    faqResources: sortedFaqResources.map((resource) => ({
      title: resource.title,
      content: resource.content,
    })),
  });

  const faqMatchHint = findBestFaqMatch(
    sortedFaqResources.map((resource) => ({
      title: resource.title,
      content: resource.content,
    })),
    context.payload.content,
  );

  const existingInquiry: Record<string, string> | null = existingInquiryRow
    ? parseInquiryData(existingInquiryRow.data)
    : null;
  let inquiryFields: InquiryFieldSpec[] | null = null;
  if (inquiryConfigRow?.fields) {
    try {
      const parsed = JSON.parse(inquiryConfigRow.fields) as unknown;
      if (Array.isArray(parsed)) {
        inquiryFields = parsed
          .filter(
            (entry): entry is InquiryFieldSpec =>
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as { label?: unknown }).label === "string" &&
              typeof (entry as { type?: unknown }).type === "string" &&
              typeof (entry as { required?: unknown }).required === "boolean",
          );
      }
    } catch {
      inquiryFields = null;
    }
  }

  if (enabledTools.length > 0) {
    if (!context.checkRateLimit(`toolmsg:${context.project.id}`, 100, 60_000)) {
      logWarn(
        "widget_turn.blocked",
        buildWidgetTurnLogContext(context, turnId, {
          reason: "tool_rate_limit_exceeded",
        }),
      );
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
          logWarn(
            "widget_turn.tool_headers_decrypt_failed",
            buildWidgetTurnLogContext(context, turnId, {
              toolId: tool.id,
              toolName: tool.name,
            }),
          );
          tool.headers = null;
        }
      }
    }
  }
  const availableTools = enabledTools.map(toToolDefinition);

  if (conversation.status === "closed") {
    const reopened = await chatService.reopenConversation(
      context.conversationId,
      context.project.id,
    );
    if (reopened) {
      conversation = reopened;
      logInfo(
        "widget_turn.reopened_conversation",
        buildWidgetTurnLogContext(context, turnId),
      );
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

  const requestedAgent = isAgentRequestedStatus(conversation.status);
  // Agent-mode silence detection needs an authoritative server copy of the
  // conversation (client-shipped history may be trimmed). Reuse the parallel
  // prefetch whenever it's populated; otherwise fetch now for the client-
  // supplied-history + requestedAgent edge case.
  const prefetchedHistory = requestedAgent
    ? (parallelPrefetchedHistory ??
      (await chatService.getFromCache(
        context.conversationId,
        context.project.id,
      )) ??
      (await chatService.getMessages(context.conversationId)))
    : null;
  const shouldSilenceForAgent =
    requestedAgent && getLastTeamMessageRole(prefetchedHistory ?? []) === "agent";

  if (requestedAgent && settings?.telegramBotToken && settings?.telegramChatId) {
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
          logError(
            "widget_turn.telegram_forward_failed",
            err,
            buildWidgetTurnLogContext(context, turnId),
          );
        }),
    );
  }

  if (shouldSilenceForAgent) {
    logInfo(
      "widget_turn.agent_mode_bypassed",
      buildWidgetTurnLogContext(context, turnId, {
        conversationStatus: conversation.status,
      }),
    );
    return Response.json({ ok: true, agentMode: true });
  }

  return createWidgetSseResponse(async (controller, encoder) => {
    const telemetry: TurnTelemetry = { startedAt: Date.now() };

    // Emit the first status event before any other work so the widget can
    // replace its optimistic local typing indicator with the real backend
    // phase immediately after the SSE connection opens. Status events are
    // cheap (one SSE frame) and function declarations below are hoisted,
    // so calling emitStatus here is safe.
    emitStatus("Thinking", "thinking");

    let currentStage = "load_message_image";
    let retrieval = createEmptyRetrievalResult();
    let eventState = createInitialAgentEventState();
    let turnIntent: string | null = null;
    let executionPath: string | null = null;
    let retrievalMode: string | null = null;
    const modelConfig = {
      model: context.env.AI_MODEL,
      geminiApiKey: context.env.GEMINI_API_KEY,
      openaiApiKey: context.env.OPENAI_API_KEY,
    };
    const modelRuntime = createModelRuntimeState(modelConfig);
    let safeAiReplayWindowClosed = false;

    function emitStatus(
      message: string,
      phase: "thinking" | "retrieval" | "tool" | "verify" | "compose",
    ): void {
      if (!telemetry.firstStatusAt) {
        telemetry.firstStatusAt = Date.now();
      }
      emitStatusEvent(controller, encoder, { phase, message });
    }

    function closeSafeAiReplayWindow(reason: string): void {
      if (safeAiReplayWindowClosed) return;
      safeAiReplayWindowClosed = true;
      logInfo(
        "widget_turn.safe_ai_replay_closed",
        buildWidgetTurnLogContext(context, turnId, {
          reason,
          activeModel: modelRuntime.activeConfig.model,
        }),
      );
    }

    async function emitAndSaveImmediateResponse(fullResponse: string): Promise<void> {
      const cleanResponse = stripInternalTokens(fullResponse);
      emitSseEvent(controller, encoder, { finalText: cleanResponse });

      currentStage = "save_bot_message";
      const botMessage = await chatService.addMessage(
        {
          conversationId: context.conversationId,
          role: "bot",
          content: cleanResponse,
          sources: null,
          senderName: settings?.botName ?? null,
        },
        context.project.id,
      );

      emitSseEvent(controller, encoder, {
        done: true,
        messageId: botMessage.id,
      });

      context.executionCtx.waitUntil(
        chatService
          .saveChatState(context.conversationId, context.project.id, chatState)
          .catch((err) => {
            logError(
              "widget_turn.save_chat_state_failed",
              err,
              buildWidgetTurnLogContext(context, turnId),
            );
          }),
      );

      context.executionCtx.waitUntil(
        billingService
          .incrementMessageUsage(context.project.userId, ownerSub)
          .catch((err) => {
            logError(
              "widget_turn.message_usage_increment_failed",
              err,
              buildWidgetTurnLogContext(context, turnId, {
                messageId: botMessage.id,
              }),
            );
          }),
      );

      logInfo(
        "widget_turn.completed",
        buildWidgetTurnLogContext(context, turnId, {
          messageId: botMessage.id,
          sourceCount: 0,
          statusLatencyMs: telemetry.firstStatusAt
            ? telemetry.firstStatusAt - telemetry.startedAt
            : null,
          firstTextLatencyMs: telemetry.firstTextAt
            ? telemetry.firstTextAt - telemetry.startedAt
            : null,
          verifierRan: telemetry.verifierRan ?? false,
          verifierVerdict: telemetry.verifierVerdict ?? null,
          hadToolCalls: false,
          stepCount: 0,
          routerMs: telemetry.routerMs ?? null,
          loopMs: telemetry.loopMs ?? null,
          composeMs: telemetry.composeMs ?? null,
          verifierMs: telemetry.verifierMs ?? null,
          plannerStepMs: telemetry.plannerStepMs ?? null,
          retrievalMs: telemetry.retrievalMs ?? null,
          toolCallMs: telemetry.toolCallMs ?? null,
        }),
      );
    }

    logInfo(
      "widget_turn.pipeline_started",
      buildWidgetTurnLogContext(context, turnId, {
        conversationStatus: conversation.status,
        availableToolNames: getToolNames(availableTools),
        guidelineCount: enabledGuidelines.length,
      }),
    );

    try {
      const image = await loadMessageImage({
        imageUrl,
        uploads: context.env.UPLOADS,
      });

      currentStage = "load_history";
      const clientHistory = context.payload.history;
      const usedClientHistory =
        Array.isArray(clientHistory) && clientHistory.length > 0;
      let conversationHistory: Array<{
        role: "visitor" | "bot" | "agent";
        content: string;
      }>;
      if (usedClientHistory) {
        // Frontend-supplied history does NOT include the just-received visitor
        // message, so append it here for shape parity with the DB/KV path where
        // the visitor message is persisted before SSE opens.
        const normalized = clientHistory
          .filter((message) => message.role !== "bot" || message.content)
          .map((message) => ({
            role: message.role as "visitor" | "bot" | "agent",
            content: message.content,
          }));
        normalized.push({
          role: "visitor",
          content: context.payload.content,
        });
        conversationHistory = normalized.slice(-10);
      } else {
        // `parallelPrefetchedHistory` already ran `getFromCache` -> `getMessages`
        // concurrently with the other setup fetches. Prefer it; fall back only
        // if somehow absent (defensive — should never happen on the server-side
        // branch since we only resolve to null when client shipped history).
        const history =
          parallelPrefetchedHistory ??
          prefetchedHistory ??
          (await chatService.getFromCache(
            context.conversationId,
            context.project.id,
          )) ??
          (await chatService.getMessages(context.conversationId));
        conversationHistory = history
          .filter((message) => message.role !== "bot" || message.content)
          .slice(-10)
          .map((message) => ({
            role: message.role as "visitor" | "bot" | "agent",
            content: message.content,
          }));
      }
      logInfo(
        "widget_turn.history_loaded",
        buildWidgetTurnLogContext(context, turnId, {
          historyCount: conversationHistory.length,
          requestedAgent,
          source: usedClientHistory ? "client" : "server",
        }),
      );

      const scopeDecision = classifyTaskScope({
        message: context.payload.content,
        pageContext: context.payload.pageContext,
      });
      if (scopeDecision.kind !== "in_scope_support") {
        turnIntent = scopeDecision.kind;
        executionPath = "scope_blocked";
        retrievalMode = "none";
        currentStage = "scope_gate";
        logWarn(
          "widget_turn.scope_blocked",
          buildWidgetTurnLogContext(context, turnId, {
            decision: scopeDecision.kind,
            reason: scopeDecision.reason,
          }),
        );
        await emitAndSaveImmediateResponse(
          scopeDecision.response ??
            "I can only help with this product, website, and support-related questions here.",
        );
        return;
      }

      const inquiryRefinementDecision: InquiryRefinementDecision | null =
        existingInquiry && inquiryFields && inquiryFields.length > 0
          ? classifyInquiryRefinement({
              message: context.payload.content,
              inquiryFields,
              existingData: existingInquiry,
              hasExistingInquiry: true,
            })
          : null;
      if (inquiryRefinementDecision?.isRefinement) {
        logInfo(
          "widget_turn.inquiry_refinement_detected",
          buildWidgetTurnLogContext(context, turnId, {
            signals: inquiryRefinementDecision.signals,
            extractedKeys: Object.keys(inquiryRefinementDecision.extracted),
            reason: inquiryRefinementDecision.reason,
          }),
        );
      }

      currentStage = "classify_turn";
      emitStatus("Understanding your message...", "thinking");
      let conversationSummary: string | null = null;
      const classifyStartedAt = Date.now();
      const turnPlan = await classifySupportTurn(
        createLanguageModel(modelRuntime.activeConfig),
        conversationHistory,
        context.payload.content,
        context.payload.pageContext,
      );
      telemetry.routerMs = Date.now() - classifyStartedAt;

      if (turnPlan.retrievalQueries.length > 0) {
        emitStatus("Searching docs...", "retrieval");
        try {
          conversationSummary = await summarizeConversation(
            createLanguageModel(modelRuntime.activeConfig),
            conversationHistory,
          );
        } catch {
          conversationSummary = null;
        }
      }

      turnIntent = turnPlan.intent;
      executionPath = "agentic_loop";
      retrievalMode = turnPlan.retrievalQueries.length > 0
        ? "bounded_actions"
        : "none";

      chatState = {
        ...chatState,
        state: "answering",
        lastIntent: turnPlan.intent,
      };
      logInfo(
        "widget_turn.plan_computed",
        buildWidgetTurnLogContext(context, turnId, {
          intent: turnPlan.intent,
          executionPath,
          retrievalMode,
          hasConversationSummary: Boolean(conversationSummary),
          hasFollowUpQuestion: Boolean(turnPlan.followUpQuestion),
          allowedTools: getToolNames(availableTools),
        }),
      );

      const conversationMetadata = parseConversationMetadata(conversation.metadata);
      const agentHandbackInstructions =
        typeof conversationMetadata.agentHandbackInstructions === "string"
          ? conversationMetadata.agentHandbackInstructions
          : null;
      currentStage = "planner_loop";
      logInfo(
        "widget_turn.loop_started",
        buildWidgetTurnLogContext(context, turnId, {
          availableTools: getToolNames(availableTools),
          hasImage: Boolean(image),
        }),
      );

      const loopStartedAt = Date.now();
      const loopResult = await runPlannerLoop({
        controller,
        encoder,
        modelRuntime,
        telemetry,
        currentMessage: context.payload.content,
        pageContext: context.payload.pageContext,
        conversationHistory,
        conversationSummary,
        turnPlan,
        inquiryRefinementDecision,
        availableTools,
        enabledToolRows: enabledTools,
        toolService,
        chatService,
        projectService,
        db: context.db,
        env: context.env,
        executionCtx: context.executionCtx,
        project: context.project,
        conversation: {
          id: context.conversationId,
          visitorId: conversation.visitorId,
          visitorName: conversation.visitorName,
          visitorEmail: conversation.visitorEmail,
          status: conversation.status,
          metadata: conversation.metadata,
          telegramThreadId: conversation.telegramThreadId ?? null,
        },
        settings: settings ?? {
          toneOfVoice: "professional",
          customTonePrompt: null,
          companyContext: null,
          botName: null,
          agentName: null,
        },
        guidelines: enabledGuidelines.map((guideline) => ({
          condition: guideline.condition,
          instruction: guideline.instruction,
        })),
        compiledFaqContext,
        visitorInfo: {
          name: conversation.visitorName,
          email: conversation.visitorEmail,
        },
        existingInquiry,
        inquiryFields,
        agentHandbackInstructions,
        image,
        faqMatchHint,
        emitStatus,
        shouldAllowTeamRequest: () =>
          shouldAllowTeamRequest({
            conversation,
          }),
        closeSafeAiReplayWindow,
        buildLogContext: (extra = {}) =>
          buildWidgetTurnLogContext(context, turnId, extra),
      });
      telemetry.loopMs = Date.now() - loopStartedAt;
      retrieval = loopResult.retrieval;
      eventState = {
        ...createInitialAgentEventState(),
        fullResponse: loopResult.fullResponse,
        hadToolCalls: loopResult.hadToolCalls,
        lastToolOutput: loopResult.lastToolOutput,
        lastToolError: loopResult.lastToolError,
        stepCount: loopResult.stepCount,
        detectedInternalTokens: loopResult.detectedInternalTokens,
      };

      logInfo(
        "widget_turn.loop_completed",
        buildWidgetTurnLogContext(context, turnId, {
          textLength: eventState.fullResponse.length,
          hadToolCalls: eventState.hadToolCalls,
          stepCount: eventState.stepCount,
          terminationAction: loopResult.terminationAction,
        }),
      );

      if (retrieval.droppedCrossTenant > 0) {
        logWarn(
          "widget_turn.retrieval_cross_tenant_dropped",
          buildWidgetTurnLogContext(context, turnId, {
            droppedCrossTenant: retrieval.droppedCrossTenant,
          }),
        );
      }
      if (retrieval.unresolvedKeys.length > 0) {
        logWarn(
          "widget_turn.retrieval_unresolved_sources",
          buildWidgetTurnLogContext(context, turnId, {
            unresolvedSourceCount: retrieval.unresolvedKeys.length,
          }),
        );
      }
      logInfo(
        "widget_turn.retrieval_completed",
        buildWidgetTurnLogContext(context, turnId, {
          groundingConfidence: retrieval.groundingConfidence,
          sourceCount: retrieval.sourceReferences.length,
          retrievalAttempted: retrieval.retrievalAttempted,
          broaderSearchAttempted: retrieval.broaderSearchAttempted,
          unresolvedSourceCount: retrieval.unresolvedKeys.length,
          droppedCrossTenant: retrieval.droppedCrossTenant,
        }),
      );

      let fullResponse = eventState.fullResponse;

      if (claimsUnavailableCapabilities(fullResponse)) {
        const capabilityFallback =
          "I can't browse the web or use unassigned tools here. I can only help with this product or website using the provided documentation and any assigned support tools.";

        if (capabilityFallback !== fullResponse.trim()) {
          fullResponse = capabilityFallback;
          logWarn(
            "widget_turn.unavailable_capability_claim_blocked",
            buildWidgetTurnLogContext(context, turnId, {
              executionPath,
              turnIntent,
            }),
          );
          emitSseEvent(controller, encoder, { finalText: fullResponse });
        }
      }

      if (loopResult.detectedInternalTokens.includes("[RESOLVED]")) {
        currentStage = "close_conversation";
        await chatService.updateConversationStatus(
          context.conversationId,
          context.project.id,
          "closed",
          "bot_resolved",
        );
        const resolvedMessage =
          "Glad I could help! Feel free to reach out anytime if you have more questions.";
        fullResponse = fullResponse.trim()
          ? `${fullResponse.trim()}\n\n${resolvedMessage}`
          : resolvedMessage;
        emitSseEvent(controller, encoder, { resolved: true });
        emitSseEvent(controller, encoder, { finalText: fullResponse });
        logInfo(
          "widget_turn.conversation_resolved",
          buildWidgetTurnLogContext(context, turnId),
        );
        context.executionCtx.waitUntil(
          triggerAutoRefinementIfEnabled({
            projectId: context.project.id,
            conversationId: context.conversationId,
            db: context.db,
            env: context.env,
            kv: context.env.CONVERSATIONS_CACHE,
            source: "bot_resolved",
          }),
        );
      }

      currentStage = "save_bot_message";
      const botMessage = await chatService.addMessage(
        {
          conversationId: context.conversationId,
          role: "bot",
          content: fullResponse,
          sources:
            retrieval.sourceReferences.length > 0
              ? JSON.stringify(retrieval.sourceReferences)
              : null,
          senderName: settings?.botName ?? null,
        },
        context.project.id,
      );

      const MAX_SOURCES = 3;
      const cappedSources = retrieval.sourceReferences.slice(0, MAX_SOURCES);

      emitSseEvent(controller, encoder, {
        done: true,
        messageId: botMessage.id,
        sources: cappedSources.length > 0 ? cappedSources : undefined,
      });

      context.executionCtx.waitUntil(
        chatService
          .saveChatState(context.conversationId, context.project.id, chatState)
          .catch((err) => {
            logError(
              "widget_turn.save_chat_state_failed",
              err,
              buildWidgetTurnLogContext(context, turnId, {
                messageId: botMessage.id,
              }),
            );
          }),
      );

      context.executionCtx.waitUntil(
        billingService
          .incrementMessageUsage(context.project.userId, ownerSub)
          .catch((err) => {
            logError(
              "widget_turn.message_usage_increment_failed",
              err,
              buildWidgetTurnLogContext(context, turnId, {
                messageId: botMessage.id,
              }),
            );
          }),
      );

      if (eventState.hadToolCalls) {
        toolService
          .linkExecutionsToMessage(context.conversationId, botMessage.id)
          .catch((err) => {
            logError(
              "widget_turn.link_tool_executions_failed",
              err,
              buildWidgetTurnLogContext(context, turnId, {
                messageId: botMessage.id,
              }),
            );
          });
      }

      logInfo(
        "widget_turn.completed",
        buildWidgetTurnLogContext(context, turnId, {
          messageId: botMessage.id,
          sourceCount: retrieval.sourceReferences.length,
          statusLatencyMs: telemetry.firstStatusAt
            ? telemetry.firstStatusAt - telemetry.startedAt
            : null,
          firstTextLatencyMs: telemetry.firstTextAt
            ? telemetry.firstTextAt - telemetry.startedAt
            : null,
          verifierRan: telemetry.verifierRan ?? false,
          verifierVerdict: telemetry.verifierVerdict ?? null,
          hadToolCalls: eventState.hadToolCalls,
          stepCount: eventState.stepCount,
          routerMs: telemetry.routerMs ?? null,
          loopMs: telemetry.loopMs ?? null,
          composeMs: telemetry.composeMs ?? null,
          verifierMs: telemetry.verifierMs ?? null,
          plannerStepMs: telemetry.plannerStepMs ?? null,
          retrievalMs: telemetry.retrievalMs ?? null,
          toolCallMs: telemetry.toolCallMs ?? null,
        }),
      );
    } catch (err) {
      logError(
        "widget_turn.failed",
        err,
        buildWidgetTurnLogContext(context, turnId, {
          stage: currentStage,
          configuredModel: context.env.AI_MODEL,
          activeModel: modelRuntime.activeConfig.model,
          intent: turnIntent,
          executionPath,
          retrievalMode,
          retrievalAttempted: retrieval.retrievalAttempted,
          broaderSearchAttempted: retrieval.broaderSearchAttempted,
          groundingConfidence: retrieval.groundingConfidence,
          sourceCount: retrieval.sourceReferences.length,
          hadToolCalls: eventState.hadToolCalls,
          stepCount: eventState.stepCount,
          verifierRan: telemetry.verifierRan ?? false,
          verifierVerdict: telemetry.verifierVerdict ?? null,
          safeAiReplayWindowClosed,
        }),
      );
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      emitSseEvent(controller, encoder, { error: errorMessage });
    }
  });
}
