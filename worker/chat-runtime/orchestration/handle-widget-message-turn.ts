import { buildSupportSystemPrompt } from "../prompt/build-support-system-prompt";
import {
  createLanguageModel,
  createModelRuntimeState,
  runWithModelFallback,
} from "../llm/create-language-model";
import {
  classifySupportTurn,
  extractContactInfo,
  fallbackClassifySupportTurn,
  fallbackExtractContactInfo,
  fallbackSummarizeTeamRequest,
  reformulateQuery,
  summarizeConversation,
  summarizeTeamRequest,
} from "../llm/auxiliary-calls";
import { streamSupportAgent } from "../agents/support-agent";
import { triggerAutoDraftIfEnabled } from "../post-turn/auto-draft";
import { createTeamRequestSubmission } from "../post-turn/team-request";
import {
  fallbackVerificationResult,
  type VerificationResult,
  verifyAnswer,
} from "../workflows/verify-answer";
import { buildRetrievalQueries } from "../retrieval/build-retrieval-queries";
import {
  runAiSearch,
  type RetrievalResult,
} from "../retrieval/run-ai-search";
import { decideExecutionPath } from "../workflows/decide-execution-path";
import { createWidgetSseResponse } from "../streaming/create-widget-sse-response";
import {
  createInitialAgentEventState,
  emitSseEvent,
  emitStatusEvent,
  mapAgentStreamPartToSse,
} from "../streaming/map-agent-events-to-sse";
import {
  type SupportTurnPlan,
  type TurnTelemetry,
  type WidgetMessageTurnContext,
  toToolDefinition,
} from "../types";
import { BillingService } from "../../services/billing-service";
import { ChatService } from "../../services/chat-service";
import { GuidelineService } from "../../services/guideline-service";
import { logError, logInfo, logWarn } from "../../observability";
import { ProjectService } from "../../services/project-service";
import { TelegramService } from "../../services/telegram-service";
import { ToolService } from "../../services/tool-service";
import { WidgetService } from "../../services/widget-service";
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

function shouldVerifyAnswer(options: {
  userMessage: string;
  fullResponse: string;
  groundingConfidence: "high" | "low" | "none";
  hadToolCalls: boolean;
  hasEvidence: boolean;
}): boolean {
  if (!options.hasEvidence) return false;
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

function createEmptyRetrievalResult(): RetrievalResult {
  return {
    ragContext: "",
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

  const settings = await projectService.getSettings(context.project.id);
  const enabledTools = await toolService.getEnabledTools(context.project.id);
  const enabledGuidelines = await guidelineService.getEnabledByProject(
    context.project.id,
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

    function emitStatus(message: string, phase: "retrieval" | "tool" | "verify" | "compose"): void {
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

      currentStage = "classify_turn";
      let conversationSummary: string | null = null;
      let turnPlan: SupportTurnPlan;
      try {
        turnPlan = await runWithModelFallback({
          runtime: modelRuntime,
          stage: "classify_turn",
          logContext: buildWidgetTurnLogContext(context, turnId),
          operation: async (activeConfig) => {
            const activeModel = createLanguageModel(activeConfig);
            return classifySupportTurn(
              activeModel,
              conversationHistory,
              context.payload.content,
              context.payload.pageContext,
              { throwOnModelError: true },
            );
          },
        });
      } catch {
        turnPlan = fallbackClassifySupportTurn(context.payload.content);
        logWarn(
          "widget_turn.plan_heuristic_fallback_used",
          buildWidgetTurnLogContext(context, turnId),
        );
      }
      conversationSummary = await summarizeConversation(
        createLanguageModel(modelRuntime.activeConfig),
        conversationHistory,
      );
      const executionPlan = decideExecutionPath({
        intent: turnPlan.intent,
        userMessage: context.payload.content,
        enabledTools: availableTools,
      });
      turnIntent = turnPlan.intent;
      executionPath = executionPlan.path;
      retrievalMode = executionPlan.retrievalMode;
      logInfo(
        "widget_turn.plan_computed",
        buildWidgetTurnLogContext(context, turnId, {
          intent: turnPlan.intent,
          executionPath: executionPlan.path,
          retrievalMode: executionPlan.retrievalMode,
          hasConversationSummary: Boolean(conversationSummary),
          hasFollowUpQuestion: Boolean(turnPlan.followUpQuestion),
          allowedTools: getToolNames(executionPlan.allowedTools),
          toolChoice:
            typeof executionPlan.toolChoice === "string"
              ? executionPlan.toolChoice
              : executionPlan.toolChoice.toolName,
        }),
      );

      if (executionPlan.retrievalMode !== "none") {
        currentStage = "retrieval";
        emitStatus("Searching docs...", "retrieval");
        let searchQuery = context.payload.content;
        try {
          searchQuery = await runWithModelFallback({
            runtime: modelRuntime,
            stage: "reformulate_query",
            logContext: buildWidgetTurnLogContext(context, turnId),
            operation: async (activeConfig) => {
              const activeModel = createLanguageModel(activeConfig);
              return reformulateQuery(
                activeModel,
                conversationHistory,
                context.payload.content,
                { throwOnModelError: true },
              );
            },
          });
        } catch {
          logWarn(
            "widget_turn.reformulate_query_fallback_used",
            buildWidgetTurnLogContext(context, turnId),
          );
        }
        const retrievalQueries =
          executionPlan.retrievalMode === "light"
            ? turnPlan.retrievalQueries.length > 0
              ? turnPlan.retrievalQueries
              : [searchQuery]
            : buildRetrievalQueries(
                context.payload.content,
                searchQuery,
                turnPlan.retrievalQueries,
              );
        logInfo(
          "widget_turn.retrieval_started",
          buildWidgetTurnLogContext(context, turnId, {
            queryCount: retrievalQueries.length,
            broaderQueryCount: turnPlan.broaderQueries.length,
            allowBroaderRetry: executionPlan.allowBroaderRetry,
          }),
        );

        retrieval = await runAiSearch({
          env: context.env,
          db: context.db,
          projectId: context.project.id,
          queries: retrievalQueries,
          broaderQueries: executionPlan.allowBroaderRetry
            ? turnPlan.broaderQueries
            : [],
          allowBroaderRetry: executionPlan.allowBroaderRetry,
        });
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
      }

      currentStage = "find_canned_match";
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
          hasTools: executionPlan.allowedTools.length > 0,
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
          needsClarification:
            executionPlan.path === "clarify_first" ||
            Boolean(turnPlan.followUpQuestion),
          turnPlan: {
            intent: turnPlan.intent,
            summary: turnPlan.summary,
            followUpQuestion: turnPlan.followUpQuestion,
          },
          executionPath: executionPlan.path,
          retrievalAttempted: retrieval.retrievalAttempted,
          broaderSearchAttempted: retrieval.broaderSearchAttempted,
        },
      );

      currentStage = "stream_agent";
      emitStatus("Writing the reply...", "compose");
      logInfo(
        "widget_turn.agent_stream_started",
        buildWidgetTurnLogContext(context, turnId, {
          toolCount: executionPlan.allowedTools.length,
          hasImage: Boolean(image),
          cannedMatchStatus: cannedMatch ? "approved" : null,
        }),
      );

      let streamTextStarted = false;
      let toolActivityStarted = false;
      eventState = await runWithModelFallback({
        runtime: modelRuntime,
        stage: "stream_agent",
        logContext: buildWidgetTurnLogContext(context, turnId),
        canRetry: () => !streamTextStarted && !toolActivityStarted,
        getRetryContext: () => ({
          streamTextStarted,
          toolActivityStarted,
        }),
        operation: async (activeConfig) => {
          const supportAgent = await streamSupportAgent(
            { modelConfig: activeConfig },
            {
              systemPrompt,
              conversationHistory,
              userMessage: context.payload.content,
              image,
              tools: executionPlan.allowedTools,
              toolChoice: executionPlan.toolChoice,
              onToolCallStart: (info) => {
                toolActivityStarted = true;
                logInfo(
                  "widget_turn.tool_call_started",
                  buildWidgetTurnLogContext(context, turnId, {
                    toolName: info.toolName,
                    inputKeys: Object.keys(info.input ?? {}),
                  }),
                );
                emitStatus("Checking connected systems...", "tool");
              },
              onToolCallFinish: (info) => {
                const matchedTool = enabledTools.find(
                  (tool) => tool.name === info.toolName,
                );
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
                      logError(
                        "widget_turn.tool_execution_log_failed",
                        err,
                        buildWidgetTurnLogContext(context, turnId, {
                          toolName: info.toolName,
                        }),
                      );
                    });
                }
                logInfo(
                  "widget_turn.tool_call_finished",
                  buildWidgetTurnLogContext(context, turnId, {
                    toolName: info.toolName,
                    success: info.success,
                    durationMs: info.durationMs,
                  }),
                );
              },
            },
          );

          let nextEventState = createInitialAgentEventState();
          const emittedToolCalls = new Set<string>();
          const toolCallStartTimes = new Map<string, number>();

          for await (const part of supportAgent.fullStream) {
            if (!telemetry.firstTextAt && part.type === "text-delta") {
              telemetry.firstTextAt = Date.now();
            }

            if (part.type === "text-delta") {
              streamTextStarted = true;
            }
            if (part.type === "tool-call" || part.type === "tool-result") {
              toolActivityStarted = true;
            }

            nextEventState = mapAgentStreamPartToSse({
              part,
              controller,
              encoder,
              emittedToolCalls,
              toolCallStartTimes,
              state: nextEventState,
            });

            if (part.type === "tool-result" && !nextEventState.lastToolError) {
              emitStatus("Writing the reply...", "compose");
            }
          }

          return nextEventState;
        },
      });
      logInfo(
        "widget_turn.agent_stream_completed",
        buildWidgetTurnLogContext(context, turnId, {
          textLength: eventState.fullResponse.length,
          hadToolCalls: eventState.hadToolCalls,
          stepCount: eventState.stepCount,
        }),
      );

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
          hasEvidence:
            retrieval.ragContext.trim().length > 0 ||
            eventState.lastToolOutput != null,
        })
      ) {
        telemetry.verifierRan = true;
        currentStage = "verify_answer";
        emitStatus("Checking factual claims against docs...", "verify");
        logInfo(
          "widget_turn.verification_started",
          buildWidgetTurnLogContext(context, turnId, {
            groundingConfidence: retrieval.groundingConfidence,
            hadToolCalls: eventState.hadToolCalls,
          }),
        );

        let verification: VerificationResult;
        try {
          verification = await runWithModelFallback({
            runtime: modelRuntime,
            stage: "verify_answer",
            logContext: buildWidgetTurnLogContext(context, turnId),
            operation: async (activeConfig) => {
              const activeModel = createLanguageModel(activeConfig);
              return verifyAnswer({
                model: activeModel,
                userMessage: context.payload.content,
                draftedAnswer: fullResponse,
                ragContext: retrieval.ragContext,
                lastToolOutput: eventState.lastToolOutput,
                verifyOptions: { throwOnModelError: true },
              });
            },
          });
        } catch {
          verification = fallbackVerificationResult({
            draftedAnswer: fullResponse,
          });
          logWarn(
            "widget_turn.verification_fallback_used",
            buildWidgetTurnLogContext(context, turnId),
          );
        }
        telemetry.verifierVerdict = verification.verdict;
        logInfo(
          "widget_turn.verification_completed",
          buildWidgetTurnLogContext(context, turnId, {
            verdict: verification.verdict,
            claimsChecked: verification.claims.length,
            unsupportedClaims: verification.claims.filter(
              (claim) => claim.status === "unsupported",
            ).length,
            partialClaims: verification.claims.filter(
              (claim) => claim.status === "partial",
            ).length,
          }),
        );

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
        currentStage = "team_request";
        let contactInfo: { name: string | null; email: string | null };
        try {
          contactInfo = await runWithModelFallback({
            runtime: modelRuntime,
            stage: "extract_contact_info",
            logContext: buildWidgetTurnLogContext(context, turnId),
            canRetry: () => !safeAiReplayWindowClosed,
            getRetryContext: () => ({
              safeAiReplayWindowClosed,
            }),
            operation: async (activeConfig) => {
              const activeModel = createLanguageModel(activeConfig);
              return extractContactInfo(
                activeModel,
                conversationHistory,
                { throwOnModelError: true },
              );
            },
          });
        } catch {
          contactInfo = fallbackExtractContactInfo(conversationHistory);
          logWarn(
            "widget_turn.contact_info_fallback_used",
            buildWidgetTurnLogContext(context, turnId),
          );
        }
        const visitorName = conversation.visitorName ?? contactInfo.name ?? null;
        const visitorEmail = conversation.visitorEmail ?? contactInfo.email ?? null;

        let summary: string;
        try {
          summary = await runWithModelFallback({
            runtime: modelRuntime,
            stage: "summarize_team_request",
            logContext: buildWidgetTurnLogContext(context, turnId),
            canRetry: () => !safeAiReplayWindowClosed,
            getRetryContext: () => ({
              safeAiReplayWindowClosed,
            }),
            operation: async (activeConfig) => {
              const activeModel = createLanguageModel(activeConfig);
              return summarizeTeamRequest(
                activeModel,
                conversationHistory,
                { throwOnModelError: true },
              );
            },
          });
        } catch {
          summary = fallbackSummarizeTeamRequest(conversationHistory);
          logWarn(
            "widget_turn.team_request_summary_fallback_used",
            buildWidgetTurnLogContext(context, turnId),
          );
        }
        closeSafeAiReplayWindow("team_request_mutation");
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
        logInfo(
          "widget_turn.team_request_completed",
          buildWidgetTurnLogContext(context, turnId, {
            submissionId: submission.submissionId,
            telegramThreadId: submission.telegramThreadId ?? null,
          }),
        );

        if (submission.telegramThreadId) {
          await chatService.updateTelegramThreadId(
            context.conversationId,
            context.project.id,
            submission.telegramThreadId,
          );
        }
        fullResponse = fullResponse.replace("[NEW_INQUIRY]", "").trim();
        if (!fullResponse) {
          const agentLabel = settings?.agentName ?? "a team member";
          fullResponse = `I've forwarded this to the team. ${agentLabel} will follow up shortly!`;
        }
        emitSseEvent(controller, encoder, { inquiry: true });
        emitSseEvent(controller, encoder, { finalText: fullResponse });
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
        triggerAutoDraftIfEnabled({
          projectId: context.project.id,
          conversationId: context.conversationId,
          db: context.db,
          env: context.env,
          kv: context.env.CONVERSATIONS_CACHE,
          source: "bot_resolved",
        });
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

      try {
        await billingService.incrementMessageUsage(context.project.userId, ownerSub);
      } catch (err) {
        logError(
          "widget_turn.message_usage_increment_failed",
          err,
          buildWidgetTurnLogContext(context, turnId, {
            messageId: botMessage.id,
          }),
        );
      }

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

      emitSseEvent(controller, encoder, {
        done: true,
        messageId: botMessage.id,
        sources:
          retrieval.sourceReferences.length > 0
            ? retrieval.sourceReferences
            : undefined,
      });
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
