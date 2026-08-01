import {
  createLanguageModel,
  createModelRuntimeState,
  runWithModelFallback,
  type ModelRuntimeState,
} from "../llm/create-language-model";
import {
  fallbackRenderContactTimingMessage,
  renderContactTimingMessage,
} from "../llm/render-contact-timing-message";
import { runAgenticTurn } from "./run-agentic-pipeline";
import { prepareTurnRouting } from "./prepare-turn-routing";
import { normalizeConversationHistory } from "./normalize-history";
import {
  type RetrievalResult,
} from "../retrieval/run-ai-search";
import { classifyTaskScope } from "../workflows/classify-task-scope";
import { createWidgetSseResponse } from "../streaming/create-widget-sse-response";
import {
  createInitialAgentEventState,
  emitCompletedEvent,
  emitSseEvent,
  emitStatusEvent,
  type WidgetCompletedPayload,
} from "../streaming/map-agent-events-to-sse";
import { stripInternalTokens } from "../streaming/internal-tokens";
import {
  broadcastClosed,
  broadcastMessageNew,
  broadcastStatusChange,
} from "../../realtime/broadcast";
import {
  type ConversationChatState,
  type TurnTelemetry,
  type WidgetMessageTurnContext,
  applyChatOwnershipEvent,
  canPersistAiOutput,
  fallbackAiParticipationForStatus,
  isChatOwnershipSnapshotCurrent,
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
import { decryptEnabledToolHeaders } from "../../services/encryption-service";
import {
  identifyFastPath,
  identifyHardGate,
  parseVisitorAiInvocation,
} from "../routing/identify-fast-path";
import { findBestFaqMatch } from "../prompt/build-compiled-faq-context";
import { buildSupportTurnOpening } from "../prompt/sections";
import { buildContactFallbackMessage } from "../contact-support/contact-support";
import { persistGuardedAiOutput } from "../executor/run-planner-loop";

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

function getMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function resolveSupportTurnOpening(options: {
  turnContext: { kind: "standard" | "contact_support"; isFirstVisitorTurn: boolean };
  visitorInfo: { name: string | null; email: string | null };
  settings: {
    workingHours: string | null;
    avgResponseTime: string | null;
    companyContext: string | null;
  };
  conversationMetadata: Record<string, unknown>;
  currentMessage: string;
  modelRuntime: ModelRuntimeState;
  logContext: Record<string, unknown>;
}): Promise<string> {
  const baseOpening = buildSupportTurnOpening(
    options.turnContext,
    options.visitorInfo,
  );
  if (options.turnContext.kind !== "contact_support") return baseOpening;

  let timingMessage = fallbackRenderContactTimingMessage();
  if (options.settings.avgResponseTime?.trim()) {
    try {
      timingMessage = await runWithModelFallback({
        runtime: options.modelRuntime,
        stage: "render_contact_timing",
        operation: async (config) =>
          renderContactTimingMessage(
            createLanguageModel(config),
            {
              nowMs: Date.now(),
              currentMessage: options.currentMessage,
              workingHours: options.settings.workingHours,
              avgResponseTime: options.settings.avgResponseTime,
              companyContext: options.settings.companyContext,
              visitorLocation: {
                timezone: getMetadataString(
                  options.conversationMetadata,
                  "timezone",
                ),
                city: getMetadataString(options.conversationMetadata, "city"),
                region: getMetadataString(
                  options.conversationMetadata,
                  "region",
                ),
                country: getMetadataString(
                  options.conversationMetadata,
                  "country",
                ),
              },
            },
            { throwOnModelError: true },
          ),
        logContext: options.logContext,
      });
    } catch (error) {
      logWarn("widget_turn.contact_timing_fallback", {
        ...options.logContext,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return `${baseOpening}${timingMessage}\n\n`;
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
    topScore: 0,
  };
}

function isAgentRequestedStatus(status: string): boolean {
  return status === "waiting_agent" || status === "agent_replied";
}

function shouldAllowEscalation(options: {
  conversation: {
    status: string;
  };
}): { allowed: boolean; reason: string } {
  if (isAgentRequestedStatus(options.conversation.status)) {
    return { allowed: false, reason: "already_in_agent_mode" };
  }

  return { allowed: true, reason: "planner_decided" };
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
  const chatService = new ChatService(context.db);
  const toolService = new ToolService(context.db);
  const guidelineService = new GuidelineService(context.db);
  const resourceService = new ResourceService(context.db, context.env.UPLOADS);

  const startedAt = context.routeStartedAt;
  const stageTimings: Record<string, number> = {};
  function markStage(name: string): void {
    stageTimings[name] = Date.now() - startedAt;
  }
  logInfo(
    "widget_turn.started",
    buildWidgetTurnLogContext(context, turnId, {
      model: context.env.AI_MODEL,
      messageLength: context.payload.content.length,
      hasImage: Boolean(context.payload.imageUrl),
      pageContextKeys: Object.keys(context.payload.pageContext ?? {}),
    }),
  );

  // Keep the first read wave minimal. AI-only configuration, resources, and
  // history are loaded only after muted and human-agent turns have exited.
  const [ownerSub, conversationLookup, settings] = await Promise.all([
    billingService.getSubscriptionByUserId(context.project.userId),
    chatService.getOperationalConversationById(
      context.conversationId,
      context.project.id,
    ),
    projectService.getSettings(context.project.id),
  ]);
  markStage("parallel_prefetch_done");

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
    ownerSub,
  );
  markStage("message_limit_checked");
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

  let conversation = conversationLookup;
  if (!conversation) {
    logWarn(
      "widget_turn.blocked",
      buildWidgetTurnLogContext(context, turnId, {
        reason: "conversation_not_found",
      }),
    );
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Capture for use inside SSE closures where TS loses narrowing on the
  // mutable `conversation` reassignments.
  const visitorIdForBroadcast = conversation.visitorId;
  let conversationStatusForTurn = conversation.status;

  let chatState: ConversationChatState = parseChatState(
    conversation.chatState,
    {
      fallbackAiParticipation: fallbackAiParticipationForStatus(
        conversation.status,
      ),
    },
  );
  const participationAtTurnStart = chatState.aiParticipation;

  // Spam-flagged conversations are "muted": never reopen them (reopening would
  // clear the spam flag and pull the thread back into the active inbox). They
  // stay closed/spam under the Flagged view; the visitor's message is still
  // recorded below so it reaches the agent there — it just won't notify,
  // escalate, or spend a bot turn.
  const isSpam = conversation.closeReason === "spam";
  if (conversation.status === "closed" && !isSpam) {
    const reopened = await chatService.reopenConversation(
      context.conversationId,
      context.project.id,
      chatState.aiParticipation === "human_only"
        ? "agent_replied"
        : "active",
    );
    if (reopened) {
      conversation = reopened;
      conversationStatusForTurn = reopened.status;
      logInfo(
        "widget_turn.reopened_conversation",
        buildWidgetTurnLogContext(context, turnId),
      );
    }
  }
  const ownershipSnapshotAtTurnStart = {
    status: conversation.status,
    chatState: conversation.chatState,
  };

  const imageUrl = context.payload.imageUrl ?? null;
  let isFirstVisitorTurn = context.isFirstVisitorTurn ?? false;
  if (!context.visitorMessageAlreadySaved) {
    const visitorResult = await chatService.addVisitorMessageWithFirstTurn(
      {
        conversationId: context.conversationId,
        content: context.payload.content,
        imageUrl,
      },
      context.project.id,
    );
    if (!visitorResult) {
      return Response.json(
        { error: "Conversation archived" },
        { status: 410 },
      );
    }
    const visitorMessage = visitorResult.message;
    isFirstVisitorTurn = visitorResult.isFirstVisitorTurn;
    markStage("visitor_message_saved");

    // Broadcast visitor message to dashboard agents watching this conversation.
    // Exclude the originating visitor (they already see it locally). This still
    // fires for spam so the message reaches the agent under the Flagged view.
    broadcastMessageNew(
      context.env,
      context.executionCtx,
      context.conversationId,
      visitorMessage,
      { excludeSubjectId: conversation.visitorId },
    );
  } else {
    markStage("visitor_message_previously_saved");
  }

  const aiInvocation = parseVisitorAiInvocation(
    context.payload.content,
    settings?.botName,
  );
  const aiMessageContent = aiInvocation.invoked
    ? aiInvocation.content
    : context.payload.content;

  async function getAiOutputPermission(
    resolvedByThisTurn = false,
  ): Promise<{
    allowed: boolean;
    status: WidgetCompletedPayload["conversationStatus"];
    chatState: string | null;
  }> {
    const latestConversation = await chatService.getOperationalConversationById(
      context.conversationId,
      context.project.id,
    );
    if (!latestConversation) {
      return { allowed: false, status: "closed", chatState: null };
    }
    const latestState = parseChatState(latestConversation.chatState, {
      fallbackAiParticipation: fallbackAiParticipationForStatus(
        latestConversation.status,
      ),
    });
    const isInvokedHumanOnlyTurn =
      participationAtTurnStart === "human_only" && aiInvocation.invoked;
    const startingOwnershipStillCurrent =
      !isInvokedHumanOnlyTurn ||
      isChatOwnershipSnapshotCurrent(ownershipSnapshotAtTurnStart, {
        status: latestConversation.status,
        chatState: latestConversation.chatState,
      });
    return {
      allowed:
        startingOwnershipStillCurrent &&
        canPersistAiOutput({
          participationAtTurnStart,
          currentParticipation: latestState.aiParticipation,
          currentStatus: latestConversation.status,
          aiInvoked: aiInvocation.invoked,
          resolvedByThisTurn,
        }),
      status: latestConversation.status,
      chatState: isInvokedHumanOnlyTurn
        ? ownershipSnapshotAtTurnStart.chatState
        : latestConversation.chatState,
    };
  }

  if (
    isAgentRequestedStatus(conversation.status) &&
    !context.suppressAgentForward &&
    settings?.telegramBotToken &&
    settings.telegramChatId
  ) {
    const telegramService = new TelegramService(context.db);
    const telegramBotToken = settings.telegramBotToken;
    const telegramChatId = settings.telegramChatId;
    context.executionCtx.waitUntil(
      (async () => {
        const operational = await chatService.getOperationalConversationById(
          conversation.id,
          context.project.id,
        );
        if (!operational) return;
        await telegramService.forwardVisitorMessage(
          telegramBotToken,
          telegramChatId,
          conversation.visitorName,
          context.payload.content,
          conversation.id,
          conversation.telegramThreadId
            ? Number.parseInt(conversation.telegramThreadId, 10)
            : undefined,
        );
      })().catch((error) => {
        logError(
          "widget_turn.telegram_forward_failed",
          error,
          buildWidgetTurnLogContext(context, turnId),
        );
      }),
    );
  }

  const hardGate = identifyHardGate({
    status: conversation.status,
    closeReason: conversation.closeReason,
    aiParticipation: chatState.aiParticipation,
    aiInvoked: aiInvocation.invoked,
  });

  // Muted (spam) thread: the message is now recorded and broadcast, but we stop
  // here — no Telegram forward, no agent escalation, no bot reply. Silent.
  if (hardGate === "muted") {
    logInfo(
      "widget_turn.spam_muted",
      buildWidgetTurnLogContext(context, turnId),
    );
    return Response.json({ ok: true, muted: true });
  }

  if (hardGate === "agent_mode") {
    logInfo(
      "widget_turn.agent_mode_bypassed",
      buildWidgetTurnLogContext(context, turnId, {
        conversationStatus: conversation.status,
        modelCallCount: 0,
      }),
    );
    return Response.json({ ok: true, agentMode: true });
  }

  const [enabledTools, enabledGuidelines, allResources, recentHistory] =
    await Promise.all([
      toolService.getEnabledTools(context.project.id),
      guidelineService.getEnabledByProject(context.project.id),
      resourceService.getResourcesByProject(context.project.id),
      chatService.getRecentMessages(context.conversationId, 11),
    ]);
  const parallelPrefetchedHistory = recentHistory.messages;
  markStage("ai_prefetch_done");

  const conversationHistory = normalizeConversationHistory({
    rawHistory: parallelPrefetchedHistory,
    currentMessage: aiMessageContent,
    persistedCurrentMessage: context.payload.content,
  });
  const turnContext = {
    kind: context.turnKind ?? "standard",
    isFirstVisitorTurn,
  } as const;
  const scopeDecision = classifyTaskScope({
    message: aiMessageContent,
    pageContext: context.payload.pageContext,
  });
  const sortedFaqResources = allResources
    .filter((resource) => resource.type === "faq")
    .sort((left, right) => left.title.localeCompare(right.title));
  const faqMatch = findBestFaqMatch(
    sortedFaqResources.map((resource) => ({
      title: resource.title,
      content: resource.content,
    })),
    aiMessageContent,
  );
  const conversationMetadata = parseConversationMetadata(conversation.metadata);
  const agentHandbackInstructions =
    typeof conversationMetadata.agentHandbackInstructions === "string"
      ? conversationMetadata.agentHandbackInstructions
      : null;
  const fastPathDecision = identifyFastPath({
    message: aiMessageContent,
    scopeDecision,
    faqMatch,
    hasPendingWorkflow:
      chatState.awaitingHandoffConfirmation ||
      chatState.awaitingContactFields.length > 0,
    hasImage: Boolean(context.payload.imageUrl),
    hasPriorityInstructions:
      enabledGuidelines.length > 0 || Boolean(agentHandbackInstructions),
  });
  const hasIndexedResources = allResources.some(
    (resource) => resource.status === "indexed",
  );

  logInfo(
    "widget_turn.fast_path_evaluated",
    buildWidgetTurnLogContext(context, turnId, {
      selected: fastPathDecision?.kind ?? null,
      reason: fastPathDecision?.reason ?? null,
      faqScore: faqMatch?.score ?? null,
      faqPrecision: faqMatch?.precision ?? null,
      faqRecall: faqMatch?.recall ?? null,
      faqMargin: faqMatch?.margin ?? null,
    }),
  );

  if (!fastPathDecision && enabledTools.length > 0) {
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

    await decryptEnabledToolHeaders(
      enabledTools,
      context.env.ENCRYPTION_KEY,
      (row) => {
        logWarn(
          "widget_turn.tool_headers_decrypt_failed",
          buildWidgetTurnLogContext(context, turnId, {
            toolId: row.id,
            toolName: row.name,
          }),
        );
      },
    );
  }
  const availableTools = fastPathDecision
    ? []
    : enabledTools.map(toToolDefinition);
  const modelConfig = {
    model: context.env.AI_MODEL,
    geminiApiKey: context.env.GEMINI_API_KEY,
    openaiApiKey: context.env.OPENAI_API_KEY,
  };
  const modelRuntime = createModelRuntimeState(modelConfig);
  const responseOpening = await resolveSupportTurnOpening({
    turnContext,
    visitorInfo: {
      name: conversation.visitorName,
      email: conversation.visitorEmail,
    },
    settings: settings ?? {
      workingHours: null,
      avgResponseTime: null,
      companyContext: null,
    },
    conversationMetadata,
    currentMessage: aiMessageContent,
    modelRuntime,
    logContext: buildWidgetTurnLogContext(context, turnId),
  });
  if (context.contactAccepted) {
    context.contactAccepted.fallbackMessage =
      buildContactFallbackMessage(responseOpening);
  }

  return createWidgetSseResponse(async (controller, encoder) => {
    const telemetry: TurnTelemetry = {
      startedAt,
      routeStartedAt: startedAt,
      fastPathSelected: fastPathDecision?.kind ?? null,
    };

    if (context.contactAccepted) {
      emitSseEvent(controller, encoder, {
        contactAccepted: context.contactAccepted,
      });
    }

    // Deterministic routes have already been selected before the SSE stream
    // opens, so describe the remaining composer work accurately instead of
    // showing a misleading reasoning phase.
    if (fastPathDecision) {
      emitStatus("Writing the reply...", "compose");
    } else {
      emitStatus("Thinking", "thinking");
    }

    let currentStage = "load_message_image";
    let retrieval = createEmptyRetrievalResult();
    let eventState = createInitialAgentEventState();
    let turnIntent: string | null = null;
    let executionPath: string | null = null;
    let retrievalMode: string | null = null;
    let safeAiReplayWindowClosed = false;
    let persistedAiMessage = false;

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

    async function emitAndSaveImmediateResponse(
      fullResponse: string,
    ): Promise<void> {
      const cleanResponse = `${responseOpening}${stripInternalTokens(fullResponse)}`;
      const outputPermission = await getAiOutputPermission();
      if (!outputPermission.allowed) {
        if (context.streamProtocolVersion === 2) {
          emitCompletedEvent(controller, encoder, {
            protocolVersion: 2,
            messageId: null,
            finalText: "",
            conversationStatus: outputPermission.status,
          });
        } else {
          emitSseEvent(controller, encoder, { done: true });
        }
        return;
      }
      currentStage = "save_bot_message";
      const botMessage = await chatService.addBotMessageIfOwnershipMatches(
        {
          conversationId: context.conversationId,
          content: cleanResponse,
          sources: null,
          senderName: settings?.botName ?? null,
        },
        context.project.id,
        {
          status: outputPermission.status,
          chatState: outputPermission.chatState,
        },
      );
      if (!botMessage) {
        const latestPermission = await getAiOutputPermission();
        if (context.streamProtocolVersion === 2) {
          emitCompletedEvent(controller, encoder, {
            protocolVersion: 2,
            messageId: null,
            finalText: "",
            conversationStatus: latestPermission.status,
          });
        } else {
          emitSseEvent(controller, encoder, { done: true });
        }
        return;
      }
      persistedAiMessage = true;
      if (context.streamProtocolVersion === 1) {
        emitSseEvent(controller, encoder, { finalText: cleanResponse });
      }

      // Broadcast to dashboard subscribers; exclude originator (gets it via SSE).
      broadcastMessageNew(
        context.env,
        context.executionCtx,
        context.conversationId,
        botMessage,
        { excludeSubjectId: visitorIdForBroadcast },
      );

      if (context.streamProtocolVersion === 2) {
        emitCompletedEvent(controller, encoder, {
          protocolVersion: 2,
          messageId: botMessage.id,
          finalText: cleanResponse,
          conversationStatus:
            conversationStatusForTurn === "waiting_agent" ||
            conversationStatusForTurn === "agent_replied"
              ? conversationStatusForTurn
              : "active",
        });
      } else {
        emitSseEvent(controller, encoder, {
          done: true,
          messageId: botMessage.id,
        });
      }

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
          modelCallCount: modelRuntime.modelCallCount,
          modelCallsByStage: modelRuntime.modelCallsByStage,
        }),
      );
    }

    markStage("sse_stream_opened");
    logInfo(
      "widget_turn.pipeline_started",
      buildWidgetTurnLogContext(context, turnId, {
        conversationStatus: conversation.status,
        availableToolNames: getToolNames(availableTools),
        guidelineCount: enabledGuidelines.length,
        stageTimings,
      }),
    );

    try {
      const image = await loadMessageImage({
        imageUrl,
        uploads: context.env.UPLOADS,
      });

      logInfo(
        "widget_turn.history_loaded",
        buildWidgetTurnLogContext(context, turnId, {
          historyCount: conversationHistory.length,
          source: "server",
        }),
      );

      const scopeDecision = classifyTaskScope({
        message: aiMessageContent,
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

      currentStage = "classify_turn";
      if (!fastPathDecision) {
        emitStatus("Understanding your message...", "thinking");
      }
      const routing =
        fastPathDecision?.kind === "small_talk" ||
        fastPathDecision?.kind === "authoritative_faq"
          ? {
              conversationSummary: null,
              compiledFaqContext:
                fastPathDecision.kind === "authoritative_faq"
                  ? `<source type="faq-match" score="${fastPathDecision.faq.score.toFixed(2)}">\nQ: ${fastPathDecision.faq.question}\nA: ${fastPathDecision.faq.answer}\n</source>`
                  : "",
              faqMatchHint:
                fastPathDecision.kind === "authoritative_faq"
                  ? faqMatch
                  : null,
              selectedFaqSetIds: [],
              selectorOutcome: "fast_path" as const,
              sortedFaqResources,
              hasIndexedResources,
            }
          : await prepareTurnRouting({
              modelRuntime,
              conversationHistory,
              currentMessage: aiMessageContent,
              pageContext: context.payload.pageContext,
              sortedFaqResources,
              faqMatchHint: faqMatch,
              hasIndexedResources,
              kv: context.env.CONVERSATIONS_CACHE,
              projectId: context.project.id,
              executionCtx: context.executionCtx,
              onRouterFinished: (ms) => {
                telemetry.routerMs = ms;
              },
              buildLogContext: (extra = {}) =>
                buildWidgetTurnLogContext(context, turnId, extra),
            });
      const {
        conversationSummary,
        compiledFaqContext,
        faqMatchHint,
        selectedFaqSetIds,
        selectorOutcome,
      } = routing;
      const selectedTitles = sortedFaqResources
        .filter((r) => selectedFaqSetIds.includes(r.id))
        .map((r) => r.title);
      logInfo(
        "widget_turn.faq_sets_selected",
        buildWidgetTurnLogContext(context, turnId, {
          totalFaqSets: sortedFaqResources.length,
          selectorOutcome,
          selectedIds: selectedFaqSetIds,
          selectedTitles,
          compiledFaqChars: compiledFaqContext.length,
          faqHintFired: Boolean(faqMatchHint),
          faqHintQuestion: faqMatchHint?.question ?? null,
          faqHintScore: faqMatchHint?.score ?? null,
        }),
      );

      executionPath = fastPathDecision
        ? `fast_path:${fastPathDecision.kind}`
        : "agentic_loop";

      chatState = {
        ...chatState,
        state: "answering",
      };

      currentStage = "planner_loop";
      logInfo(
        "widget_turn.loop_started",
        buildWidgetTurnLogContext(context, turnId, {
          availableTools: getToolNames(availableTools),
          hasImage: Boolean(image),
        }),
      );

      const loopResult = await runAgenticTurn({
        controller,
        encoder,
        modelRuntime,
        telemetry,
        currentMessage: aiMessageContent,
        pageContext: context.payload.pageContext,
        conversationHistory,
        conversationSummary,
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
          workingHours: null,
          avgResponseTime: null,
        },
        guidelines: enabledGuidelines.map((guideline) => ({
          condition: guideline.condition,
          instruction: guideline.instruction,
        })),
        compiledFaqContext,
        hasIndexedResources,
        visitorInfo: {
          name: conversation.visitorName,
          email: conversation.visitorEmail,
        },
        turnContext,
        aiParticipation: chatState.aiParticipation,
        responseOpening,
        persistedContactState: {
          awaitingContactFields: chatState.awaitingContactFields,
          awaitingHandoffConfirmation: chatState.awaitingHandoffConfirmation,
          contactDeclined: chatState.contactDeclined,
        },
        persistedClarifyState: {
          clarificationAttempts: chatState.clarificationAttempts,
          lastBotQuestion: chatState.lastBotQuestion,
        },
        agentHandbackInstructions,
        image,
        faqMatchHint,
        fastPathDecision,
        streamProtocolVersion: context.streamProtocolVersion,
        emitStatus,
        shouldAllowEscalation: () => shouldAllowEscalation({ conversation }),
        closeSafeAiReplayWindow,
        buildLogContext: (extra = {}) =>
          buildWidgetTurnLogContext(context, turnId, extra),
        // buildSystemPrompt omitted → planner falls back to the visitor-facing
        // `buildSupportSystemPrompt` (byte-identical to pre-refactor behavior).
      });
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

      turnIntent = loopResult.turnIntent;
      retrievalMode = loopResult.retrieval.retrievalAttempted
        ? "bounded_actions"
        : "none";

      // Persist escalation continuity so the next turn resumes the handoff
      // without regex-matching the bot's own (now LLM-rendered) wording.
      chatState = {
        ...chatState,
        lastIntent: loopResult.turnIntent ?? chatState.lastIntent,
        awaitingContactFields: loopResult.awaitingContactFields,
        awaitingHandoffConfirmation: loopResult.awaitingHandoffConfirmation,
        contactDeclined: loopResult.contactDeclined,
        clarificationAttempts:
          loopResult.terminationAction === "ask_user"
            ? chatState.clarificationAttempts + 1
            : 0,
        lastBotQuestion:
          loopResult.terminationAction === "ask_user"
            ? loopResult.fullResponse
            : null,
      };
      if (loopResult.terminationAction === "escalate") {
        chatState = applyChatOwnershipEvent(chatState, "team_requested");
      }

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
      if (loopResult.capabilityFallbackApplied) {
        logWarn(
          "widget_turn.unavailable_capability_claim_blocked",
          buildWidgetTurnLogContext(context, turnId, {
            executionPath,
            turnIntent,
          }),
        );
      }

      const flaggedForReview = chatState.aiParticipation === "human_only";
      let finalConversationStatus: WidgetCompletedPayload["conversationStatus"] =
        loopResult.terminationAction === "escalate"
          ? "waiting_agent"
          : conversation.status === "waiting_agent" ||
              conversation.status === "agent_replied"
            ? conversation.status
            : "active";
      let resolvedByThisTurn = false;
      if (
        loopResult.detectedInternalTokens.includes("[RESOLVED]") &&
        !flaggedForReview
      ) {
        currentStage = "close_conversation";
        resolvedByThisTurn = await chatService.resolveConversationByAi(
          context.conversationId,
          context.project.id,
        );
        if (resolvedByThisTurn) {
          chatState = applyChatOwnershipEvent(chatState, "ai_handed_back");
        }
        // The model writes its own goodbye (visitor's language, configured
        // voice); the English string is only the empty-output fallback.
        fullResponse =
          resolvedByThisTurn
            ? fullResponse.trim() ||
              "Glad I could help! Feel free to reach out anytime if you have more questions."
            : "";
        finalConversationStatus = resolvedByThisTurn ? "closed" : "agent_replied";
        logInfo(
          resolvedByThisTurn
            ? "widget_turn.conversation_resolved"
            : "widget_turn.ai_resolution_blocked_by_human_takeover",
          buildWidgetTurnLogContext(context, turnId),
        );
      }

      const outputPermission = await getAiOutputPermission(resolvedByThisTurn);
      if (!outputPermission.allowed) {
        fullResponse = "";
        finalConversationStatus = outputPermission.status;
      }

      // Task 3 guard fallout: on an escalated / waiting_agent conversation the
      // model can emit ONLY [RESOLVED], which strips to empty text AND has its
      // resolved-close branch suppressed above (flaggedForReview). Persisting +
      // streaming that empty response would paint a blank bubble in the widget
      // and a blank row in the inbox. A human is already handling the thread, so
      // the bot has nothing to add — skip the empty message entirely (no message
      // beats an empty bubble) while still emitting `done` so the widget
      // finalizes, and still persisting chat state.
      if (!fullResponse.trim()) {
        logInfo(
          "widget_turn.empty_bot_message_skipped",
          buildWidgetTurnLogContext(context, turnId, { flaggedForReview }),
        );
        if (context.streamProtocolVersion === 2) {
          emitCompletedEvent(controller, encoder, {
            protocolVersion: 2,
            messageId: null,
            finalText: "",
            conversationStatus: finalConversationStatus,
          });
        } else {
          emitSseEvent(controller, encoder, { done: true });
        }
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
        return;
      }

      currentStage = "save_bot_message";
      const botMessage = await persistGuardedAiOutput({
        controller,
        encoder,
        streamProtocolVersion: context.streamProtocolVersion,
        finalText: fullResponse,
        persist: async () =>
          chatService.addBotMessageIfOwnershipMatches(
            {
              conversationId: context.conversationId,
              content: fullResponse,
              sources:
                retrieval.sourceReferences.length > 0
                  ? JSON.stringify(retrieval.sourceReferences)
                  : null,
              senderName: settings?.botName ?? null,
            },
            context.project.id,
            {
              status: outputPermission.status,
              chatState: outputPermission.chatState,
            },
          ),
        getConversationStatusAfterFailure: async () =>
          (await getAiOutputPermission()).status,
        onPersisted: () => {
          persistedAiMessage = true;
          if (context.streamProtocolVersion !== 1) return;
          if (loopResult.terminationAction === "escalate") {
            emitSseEvent(controller, encoder, { inquiry: true });
          }
          if (resolvedByThisTurn) {
            emitSseEvent(controller, encoder, { resolved: true });
          }
        },
      });
      if (!botMessage) return;

      if (resolvedByThisTurn) {
        broadcastStatusChange(
          context.env,
          context.executionCtx,
          context.conversationId,
          "closed",
        );
        broadcastClosed(
          context.env,
          context.executionCtx,
          context.conversationId,
          "bot_resolved",
        );
        if (settings?.telegramBotToken && settings.telegramChatId) {
          const telegramService = new TelegramService(context.db);
          const telegramBotToken = settings.telegramBotToken;
          const telegramChatId = settings.telegramChatId;
          context.executionCtx.waitUntil(
            (async () => {
              const operational = await chatService.getOperationalConversationById(
                context.conversationId,
                context.project.id,
              );
              if (!operational) return;
              await telegramService.notifyBotResolved(
                telegramBotToken,
                telegramChatId,
                settings.botName,
                context.conversationId,
                conversation.telegramThreadId
                  ? Number.parseInt(conversation.telegramThreadId, 10)
                  : undefined,
              );
            })().catch((error) => {
              logError(
                "widget_turn.telegram_resolution_update_failed",
                error,
                buildWidgetTurnLogContext(context, turnId),
              );
            }),
          );
        }
      }

      // Broadcast to dashboard subscribers; exclude originator (gets it via SSE).
      broadcastMessageNew(
        context.env,
        context.executionCtx,
        context.conversationId,
        botMessage,
        { excludeSubjectId: visitorIdForBroadcast },
      );

      const MAX_SOURCES = 3;
      const cappedSources = retrieval.sourceReferences.slice(0, MAX_SOURCES);

      if (context.streamProtocolVersion === 2) {
        emitCompletedEvent(controller, encoder, {
          protocolVersion: 2,
          messageId: botMessage.id,
          finalText: fullResponse,
          conversationStatus: finalConversationStatus,
          sources: cappedSources.length > 0 ? cappedSources : undefined,
        });
      } else {
        emitSseEvent(controller, encoder, {
          done: true,
          messageId: botMessage.id,
          sources: cappedSources.length > 0 ? cappedSources : undefined,
        });
      }

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
          modelCallCount: modelRuntime.modelCallCount,
          modelCallsByStage: modelRuntime.modelCallsByStage,
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

      if (context.contactAccepted && !persistedAiMessage) {
        try {
          const outputPermission = await getAiOutputPermission();
          if (outputPermission.allowed) {
            const fallbackMessage = context.contactAccepted.fallbackMessage;
            const botMessage = await chatService.addBotMessageIfOwnershipMatches(
              {
                conversationId: context.conversationId,
                content: fallbackMessage,
                sources: null,
                senderName: settings?.botName ?? null,
              },
              context.project.id,
              {
                status: outputPermission.status,
                chatState: outputPermission.chatState,
              },
            );
            if (!botMessage) {
              const latestPermission = await getAiOutputPermission();
              if (context.streamProtocolVersion === 2) {
                emitCompletedEvent(controller, encoder, {
                  protocolVersion: 2,
                  messageId: null,
                  finalText: "",
                  conversationStatus: latestPermission.status,
                });
              } else {
                emitSseEvent(controller, encoder, { done: true });
              }
              return;
            }
            persistedAiMessage = true;
            broadcastMessageNew(
              context.env,
              context.executionCtx,
              context.conversationId,
              botMessage,
              { excludeSubjectId: visitorIdForBroadcast },
            );

            if (context.streamProtocolVersion === 2) {
              emitCompletedEvent(controller, encoder, {
                protocolVersion: 2,
                messageId: botMessage.id,
                finalText: fallbackMessage,
                conversationStatus: outputPermission.status,
              });
            } else {
              emitSseEvent(controller, encoder, {
                finalText: fallbackMessage,
              });
              emitSseEvent(controller, encoder, {
                done: true,
                messageId: botMessage.id,
              });
            }
            return;
          }
        } catch (fallbackError) {
          logError(
            "widget_turn.contact_fallback_failed",
            fallbackError,
            buildWidgetTurnLogContext(context, turnId),
          );
        }
      }

      emitSseEvent(controller, encoder, { error: errorMessage });
    }
  });
}
