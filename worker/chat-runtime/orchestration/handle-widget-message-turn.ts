import { createModelRuntimeState } from "../llm/create-language-model";
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
  emitSseEvent,
  emitStatusEvent,
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
import { type MessageRow } from "../../db";
import { decryptEnabledToolHeaders } from "../../services/encryption-service";

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
    topScore: 0,
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

  const startedAt = Date.now();
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

  const clientSuppliedHistory =
    Array.isArray(context.payload.history) &&
    context.payload.history.length > 0;

  // Fire every independent read in a single parallel wave so we only pay one
  // D1/KV round-trip for all setup data. Subscription gating still runs first
  // conceptually via the `ownerSub`/`messageCheck` results; denied requests
  // pay for a few extra reads, which is fine — those branches are rare.
  const [
    ownerSub,
    conversationLookup,
    settings,
    enabledTools,
    enabledGuidelines,
    allResources,
    parallelPrefetchedHistory,
  ] = await Promise.all([
    billingService.getSubscriptionByUserId(context.project.userId),
    chatService.getConversationById(
      context.conversationId,
      context.project.id,
    ),
    projectService.getSettings(context.project.id),
    toolService.getEnabledTools(context.project.id),
    guidelineService.getEnabledByProject(context.project.id),
    resourceService.getResourcesByProject(context.project.id),
    clientSuppliedHistory
      ? Promise.resolve<MessageRow[] | null>(null)
      : chatService.getMessages(context.conversationId),
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

  let chatState: ConversationChatState = parseChatState(
    conversation.chatState,
  );

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
  const availableTools = enabledTools.map(toToolDefinition);

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
  const visitorMessage = await chatService.addMessage({
    conversationId: context.conversationId,
    role: "visitor",
    content: context.payload.content,
    imageUrl,
  });
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

  // Muted (spam) thread: the message is now recorded and broadcast, but we stop
  // here — no Telegram forward, no agent escalation, no bot reply. Silent.
  if (isSpam) {
    logInfo(
      "widget_turn.spam_muted",
      buildWidgetTurnLogContext(context, turnId),
    );
    return Response.json({ ok: true, muted: true });
  }

  const requestedAgent = isAgentRequestedStatus(conversation.status);
  // This is a pre-visitor-insert snapshot of the conversation — sufficient
  // for agent-mode silence detection because we only inspect the last
  // bot/agent role via `getLastTeamMessageRole`. Reuse the parallel prefetch
  // when populated; otherwise fetch now for the client-supplied-history +
  // requestedAgent edge case.
  const prefetchedHistory = requestedAgent
    ? (parallelPrefetchedHistory ??
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
      const botMessage = await chatService.addMessage({
        conversationId: context.conversationId,
        role: "bot",
        content: cleanResponse,
        sources: null,
        senderName: settings?.botName ?? null,
      });

      // Broadcast to dashboard subscribers; exclude originator (gets it via SSE).
      broadcastMessageNew(
        context.env,
        context.executionCtx,
        context.conversationId,
        botMessage,
        { excludeSubjectId: visitorIdForBroadcast },
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

      currentStage = "load_history";
      const clientHistory = context.payload.history;
      const usedClientHistory =
        Array.isArray(clientHistory) && clientHistory.length > 0;
      const rawHistory = usedClientHistory
        ? clientHistory
        : (parallelPrefetchedHistory ??
          prefetchedHistory ??
          (await chatService.getMessages(context.conversationId)));
      // Prior turns only. The current visitor message travels separately as
      // `currentMessage` everywhere downstream — see normalize-history.ts.
      const conversationHistory = normalizeConversationHistory({
        rawHistory,
        currentMessage: context.payload.content,
      });
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

      currentStage = "classify_turn";
      emitStatus("Understanding your message...", "thinking");
      const routing = await prepareTurnRouting({
        modelRuntime,
        conversationHistory,
        currentMessage: context.payload.content,
        pageContext: context.payload.pageContext,
        resources: allResources,
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
        sortedFaqResources,
        hasIndexedResources,
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

      executionPath = "agentic_loop";

      chatState = {
        ...chatState,
        state: "answering",
      };

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

      const loopResult = await runAgenticTurn({
        controller,
        encoder,
        modelRuntime,
        telemetry,
        currentMessage: context.payload.content,
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

      const flaggedForReview =
        conversation.status === "waiting_agent" ||
        loopResult.terminationAction === "escalate";
      if (loopResult.detectedInternalTokens.includes("[RESOLVED]") && !flaggedForReview) {
        currentStage = "close_conversation";
        await chatService.updateConversationStatus(
          context.conversationId,
          context.project.id,
          "closed",
          "bot_resolved",
        );
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
        // The model writes its own goodbye (visitor's language, configured
        // voice); the English string is only the empty-output fallback.
        fullResponse =
          fullResponse.trim() ||
          "Glad I could help! Feel free to reach out anytime if you have more questions.";
        emitSseEvent(controller, encoder, { resolved: true });
        emitSseEvent(controller, encoder, { finalText: fullResponse });
        logInfo(
          "widget_turn.conversation_resolved",
          buildWidgetTurnLogContext(context, turnId),
        );
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
        emitSseEvent(controller, encoder, { done: true });
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
      const botMessage = await chatService.addMessage({
        conversationId: context.conversationId,
        role: "bot",
        content: fullResponse,
        sources:
          retrieval.sourceReferences.length > 0
            ? JSON.stringify(retrieval.sourceReferences)
            : null,
        senderName: settings?.botName ?? null,
      });

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
