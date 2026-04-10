import {
  createLanguageModel,
  createModelRuntimeState,
} from "../llm/create-language-model";
import {
  // isVagueIssueReport,
  summarizeConversation,
} from "../llm/auxiliary-calls";
import { runPlannerLoop } from "../executor/run-planner-loop";
import { buildCompiledFaqContext } from "../prompt/build-compiled-faq-context";
import { triggerAutoRefinementIfEnabled } from "../post-turn/auto-refine";
import { buildUnsupportedFallback } from "../workflows/verify-answer";
import {
  type RetrievalResult,
} from "../retrieval/run-ai-search";
import { classifyTaskScope } from "../workflows/classify-task-scope";
import {
  clarificationWasAskedBefore,
  normalizeClarificationQuestion,
  runFastPaths,
} from "../workflows/fast-paths";
import { routeIntent } from "../llm/intent-router";
import { createWidgetSseResponse } from "../streaming/create-widget-sse-response";
import {
  createInitialAgentEventState,
  emitSseEvent,
  emitStatusEvent,
} from "../streaming/map-agent-events-to-sse";
import {
  type ConversationChatState,
  type RouterDecision,
  type SupportIntent,
  type SupportTurnPlan,
  type TurnTelemetry,
  type WidgetMessageTurnContext,
  parseChatStateFromMetadata,
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

function visitorExplicitlyRequestedHuman(
  history: Array<{ role: "visitor" | "bot" | "agent"; content: string }>,
  latestMessage: string,
): boolean {
  const candidateMessages = [
    latestMessage,
    ...history
      .filter((message) => message.role === "visitor")
      .slice(-4)
      .map((message) => message.content),
  ];

  return candidateMessages.some((message) => {
    const normalized = message.toLowerCase();
    const wantsHuman =
      /\b(human|person|agent|engineer|support team|team member|representative|someone)\b/.test(
        normalized,
      );
    const asksForContact =
      /\b(help|talk|speak|contact|reach|connect|escalate|handoff|hand off|follow up)\b/.test(
        normalized,
      );

    return wantsHuman && asksForContact;
  });
}

function hasFocusedClarifyingQuestion(
  history: Array<{ role: "visitor" | "bot" | "agent"; content: string }>,
): boolean {
  return history.some((message) => {
    if (message.role !== "bot" && message.role !== "agent") {
      return false;
    }

    if (!message.content.includes("?")) {
      return false;
    }

    return /\b(exact|feature|page|step|error|code|setting|configuration|config|integration|url|link|screenshot|what happens|which)\b/i.test(
      message.content,
    );
  });
}

function getExistingTeamRequestSubmissionId(
  conversation: { metadata: string | null | undefined },
): string | null {
  const metadata = parseConversationMetadata(conversation.metadata);
  const submissionId = metadata.teamRequestSubmissionId;

  return typeof submissionId === "string" && submissionId.trim()
    ? submissionId.trim()
    : null;
}

function shouldAllowTeamRequest(options: {
  conversation: {
    status: string;
    metadata: string | null | undefined;
  };
  conversationHistory: Array<{
    role: "visitor" | "bot" | "agent";
    content: string;
  }>;
  latestMessage: string;
  turnIntent: string | null;
  retrievalAttempted: boolean;
  hadToolCalls: boolean;
}): { allowed: boolean; reason: string } {
  if (getExistingTeamRequestSubmissionId(options.conversation)) {
    return { allowed: false, reason: "existing_submission" };
  }

  if (isAgentRequestedStatus(options.conversation.status)) {
    return { allowed: false, reason: "already_in_agent_mode" };
  }

  if (
    options.turnIntent === "handoff" ||
    visitorExplicitlyRequestedHuman(
      options.conversationHistory,
      options.latestMessage,
    )
  ) {
    return { allowed: true, reason: "explicit_human_request" };
  }

  // if (isVagueIssueReport(options.latestMessage)) {
  //   return { allowed: false, reason: "latest_issue_report_still_vague" };
  // }

  if (!options.retrievalAttempted && !options.hadToolCalls) {
    return { allowed: false, reason: "no_resolution_attempts" };
  }

  if (!hasFocusedClarifyingQuestion(options.conversationHistory)) {
    return { allowed: false, reason: "no_focused_clarifying_question" };
  }

  return { allowed: true, reason: "troubleshooting_exhausted" };
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

  let chatState: ConversationChatState = parseChatStateFromMetadata(
    conversation.metadata,
  );

  const [settings, enabledTools, enabledGuidelines, allResources] =
    await Promise.all([
      projectService.getSettings(context.project.id),
      toolService.getEnabledTools(context.project.id),
      guidelineService.getEnabledByProject(context.project.id),
      resourceService.getResourcesByProject(context.project.id),
    ]);
  const compiledFaqContext = buildCompiledFaqContext(
    allResources
      .filter((resource) => resource.type === "faq")
      .sort((left, right) => left.title.localeCompare(right.title))
      .map((resource) => ({
        title: resource.title,
        content: resource.content,
      })),
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
  const prefetchedHistory = requestedAgent
    ? ((await chatService.getFromCache(
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
      emitSseEvent(controller, encoder, { finalText: fullResponse });

      currentStage = "save_bot_message";
      const botMessage = await chatService.addMessage(
        {
          conversationId: context.conversationId,
          role: "bot",
          content: fullResponse,
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
        }),
      );
    }

    emitStatus("Thinking", "thinking");

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
      const history =
        (await chatService.getFromCache(context.conversationId, context.project.id)) ??
        prefetchedHistory ??
        (await chatService.getMessages(context.conversationId));
      const conversationHistory = history
        .filter((message) => message.role !== "bot" || message.content)
        .slice(-20)
        .map((message) => ({
          role: message.role as "visitor" | "bot" | "agent",
          content: message.content,
        }));
      logInfo(
        "widget_turn.history_loaded",
        buildWidgetTurnLogContext(context, turnId, {
          historyCount: conversationHistory.length,
          requestedAgent,
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

      currentStage = "fast_path";
      const isFirstVisitorMessage =
        conversationHistory.filter((m) => m.role === "visitor").length === 1;
      const fastPath = runFastPaths({
        message: context.payload.content,
        chatState,
        botName: settings?.botName ?? null,
        agentName: settings?.agentName ?? null,
        projectName: context.project.name,
        isFirstVisitorMessage,
      });
      if (fastPath.kind !== "none" && fastPath.response) {
        turnIntent = fastPath.kind;
        executionPath = "fast_path";
        retrievalMode = "none";
        logInfo(
          "widget_turn.fast_path_matched",
          buildWidgetTurnLogContext(context, turnId, {
            kind: fastPath.kind,
            reason: fastPath.reason,
            escalate: Boolean(fastPath.escalate),
          }),
        );
        if (fastPath.stripClarificationState) {
          chatState = {
            ...chatState,
            askedClarifications: [],
            clarificationAttempts: 0,
            lastBotQuestion: null,
          };
        }
        if (fastPath.escalate) {
          chatState = {
            ...chatState,
            state: "escalating",
            pendingHandoffReason:
              fastPath.escalationReason ?? fastPath.reason ?? null,
            lastIntent: fastPath.kind,
          };
        } else {
          chatState = {
            ...chatState,
            lastIntent: fastPath.kind,
          };
        }
        await emitAndSaveImmediateResponse(fastPath.response);
        return;
      }

      currentStage = "route_intent";
      let conversationSummary: string | null = null;
      let routerDecision: RouterDecision;
      try {
        routerDecision = await routeIntent({
          modelRuntime,
          conversationHistory,
          currentMessage: context.payload.content,
          chatState,
          pageContext: context.payload.pageContext,
          projectName: context.project.name,
          throwOnModelError: true,
        });
      } catch {
        routerDecision = await routeIntent({
          modelRuntime,
          conversationHistory,
          currentMessage: context.payload.content,
          chatState,
          pageContext: context.payload.pageContext,
          projectName: context.project.name,
        });
        logWarn(
          "widget_turn.router_heuristic_fallback_used",
          buildWidgetTurnLogContext(context, turnId),
        );
      }

      // Dedupe clarifying questions: if the router proposes a question we've
      // already asked, force escalation instead of looping.
      if (
        routerDecision.intent === "clarify" &&
        routerDecision.suggestedClarification &&
        clarificationWasAskedBefore(
          chatState,
          routerDecision.suggestedClarification,
        )
      ) {
        routerDecision = {
          ...routerDecision,
          intent: "handoff",
          escalate: true,
          escalationReason:
            routerDecision.escalationReason ?? "duplicate_clarification",
          suggestedClarification: null,
          canAnswerDirectly: false,
          needsRetrieval: false,
          isRepeatedClarification: true,
        };
        logWarn(
          "widget_turn.duplicate_clarification_escalated",
          buildWidgetTurnLogContext(context, turnId),
        );
      }

      const mappedIntent: SupportIntent =
        routerDecision.intent === "greeting" ||
        routerDecision.intent === "resolved" ||
        routerDecision.intent === "chit_chat" ||
        routerDecision.intent === "out_of_scope"
          ? "how_to"
          : (routerDecision.intent as SupportIntent);

      const turnPlan: SupportTurnPlan = {
        intent: mappedIntent,
        summary: routerDecision.summary,
        retrievalQueries: routerDecision.needsRetrieval
          ? routerDecision.retrievalQueries
          : [],
        broaderQueries: [],
        followUpQuestion:
          routerDecision.intent === "clarify"
            ? routerDecision.suggestedClarification
            : null,
      };

      if (routerDecision.needsRetrieval) {
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
      executionPath = routerDecision.escalate ? "router_handoff" : "agentic_loop";
      retrievalMode = routerDecision.needsRetrieval
        ? "bounded_actions"
        : "none";

      logInfo(
        "widget_turn.router_decided",
        buildWidgetTurnLogContext(context, turnId, {
          intent: routerDecision.intent,
          confidence: routerDecision.confidence,
          escalate: routerDecision.escalate,
          needsRetrieval: routerDecision.needsRetrieval,
          canAnswerDirectly: routerDecision.canAnswerDirectly,
          retrievalQueryCount: routerDecision.retrievalQueries.length,
        }),
      );

      // Track clarify attempts + question history so anti-loop can fire next turn.
      if (
        routerDecision.intent === "clarify" &&
        routerDecision.suggestedClarification
      ) {
        const normalized = normalizeClarificationQuestion(
          routerDecision.suggestedClarification,
        );
        const alreadyTracked = chatState.askedClarifications.some(
          (prior) => normalizeClarificationQuestion(prior) === normalized,
        );
        chatState = {
          ...chatState,
          state: "clarifying",
          clarificationAttempts: chatState.clarificationAttempts + 1,
          askedClarifications: alreadyTracked
            ? chatState.askedClarifications
            : [
                ...chatState.askedClarifications,
                routerDecision.suggestedClarification,
              ],
          lastBotQuestion: routerDecision.suggestedClarification,
          lastIntent: routerDecision.intent,
        };
      } else if (routerDecision.escalate) {
        chatState = {
          ...chatState,
          state: "escalating",
          pendingHandoffReason:
            routerDecision.escalationReason ?? routerDecision.intent,
          lastIntent: routerDecision.intent,
        };
      } else {
        chatState = {
          ...chatState,
          state: "answering",
          lastIntent: routerDecision.intent,
        };
      }
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
        agentHandbackInstructions,
        image,
        emitStatus,
        shouldAllowTeamRequest: ({ retrievalAttempted, hadToolCalls }) =>
          shouldAllowTeamRequest({
            conversation,
            conversationHistory,
            latestMessage: context.payload.content,
            turnIntent,
            retrievalAttempted,
            hadToolCalls,
          }),
        closeSafeAiReplayWindow,
        buildLogContext: (extra = {}) =>
          buildWidgetTurnLogContext(context, turnId, extra),
      });
      retrieval = loopResult.retrieval;
      eventState = {
        fullResponse: loopResult.fullResponse,
        hadToolCalls: loopResult.hadToolCalls,
        lastToolOutput: loopResult.lastToolOutput,
        lastToolError: loopResult.lastToolError,
        stepCount: loopResult.stepCount,
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

      if (
        retrieval.retrievalAttempted &&
        retrieval.groundingConfidence === "none" &&
        !eventState.hadToolCalls &&
        ![
          "ask_user",
          "offer_handoff",
          "collect_contact",
          "create_inquiry",
        ].includes(loopResult.terminationAction) &&
        !fullResponse.includes("[RESOLVED]")
      ) {
        const unsupportedFallback = buildUnsupportedFallback(
          context.payload.content,
          turnPlan.intent,
        );

        if (unsupportedFallback.trim() !== fullResponse.trim()) {
          fullResponse = unsupportedFallback.trim();
          logWarn(
            "widget_turn.no_grounding_fallback_applied",
            buildWidgetTurnLogContext(context, turnId, {
              executionPath,
              turnIntent,
            }),
          );
          emitSseEvent(controller, encoder, { finalText: fullResponse });
        }
      }

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

      if (fullResponse.includes("[RESOLVED]")) {
        currentStage = "close_conversation";
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

      emitSseEvent(controller, encoder, {
        done: true,
        messageId: botMessage.id,
        sources:
          retrieval.sourceReferences.length > 0
            ? retrieval.sourceReferences
            : undefined,
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
