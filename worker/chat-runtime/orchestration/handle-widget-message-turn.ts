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
import {
  runMavenTurn,
  type MavenTurnResult,
} from "./run-maven-turn";
import { normalizeConversationHistory } from "./normalize-history";
import { classifyTaskScope } from "../workflows/classify-task-scope";
import { createWidgetSseResponse } from "../streaming/create-widget-sse-response";
import {
  createInitialAgentEventState,
  emitCompletedEvent,
  emitSseEvent,
  emitStatusEvent,
  mapAgentEventsToSse,
  type WidgetCompletedPayload,
} from "../streaming/map-agent-events-to-sse";
import {
  createStreamingStripState,
  flushStreamingStripState,
  stripInternalTokens,
  stripInternalTokensStreaming,
  type InternalToken,
} from "../streaming/internal-tokens";
import { MavenStreamFailure } from "../streaming/maven-stream-failure";
import {
  broadcastClosed,
  broadcastCustomerUpdated,
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
} from "../types";
import { BillingService } from "../../services/billing-service";
import { ChatService } from "../../services/chat-service";
import { CustomerIdentityService } from "../../services/customer-identity-service";
import { GuidelineService } from "../../services/guideline-service";
import { logError, logInfo, logWarn } from "../../observability";
import { ProjectService } from "../../services/project-service";
import { type SourceReference } from "../../services/resource-service";
import { TelegramService } from "../../services/telegram-service";
import { ToolService } from "../../services/tool-service";
import {
  identifyHardGate,
  parseVisitorAiInvocation,
} from "../routing/public-turn-gates";
import { parsePendingContactReply } from "../routing/pending-contact-reply";
import { buildSupportTurnOpening } from "../prompt/sections";
import { buildContactFallbackMessage } from "../contact-support/contact-support";
import { persistGuardedAiOutput } from "../post-turn/persist-guarded-ai-output";

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

interface CustomerLastSeenTouchService {
  touchVisitorLastSeen(
    projectId: string,
    customerId: string,
    visitorId: string,
    occurredAt: Date,
  ): Promise<void>;
}

export async function touchLinkedCustomerAfterVisitorMessage(options: {
  projectId: string;
  customerId: string | null;
  visitorId: string;
  occurredAt: Date;
  identityService: CustomerLastSeenTouchService;
  logFailure: (error: unknown) => void;
  onTouched?: (customerId: string) => void;
}): Promise<void> {
  if (!options.customerId) return;
  try {
    await options.identityService.touchVisitorLastSeen(
      options.projectId,
      options.customerId,
      options.visitorId,
      options.occurredAt,
    );
    options.onTouched?.(options.customerId);
  } catch (error) {
    options.logFailure(error);
  }
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

function isAgentRequestedStatus(status: string): boolean {
  return status === "waiting_agent" || status === "agent_replied";
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

export interface PublicMavenStreamResult {
  fullResponse: string;
  sources: SourceReference[];
  detectedInternalTokens: InternalToken[];
  hadToolCalls: boolean;
  httpExecutionIds: string[];
}

export async function streamPublicMavenTurn(options: {
  runTurn: typeof runMavenTurn;
  turnInput: Parameters<typeof runMavenTurn>[0];
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  streamProtocolVersion: 1 | 2;
  responseOpening: string;
  telemetry?: TurnTelemetry;
}): Promise<PublicMavenStreamResult> {
  const turn: MavenTurnResult = await options.runTurn(options.turnInput);
  const stripState = createStreamingStripState();
  const detectedInternalTokens: InternalToken[] = [];
  let fullResponse = options.responseOpening;

  if (options.responseOpening && options.streamProtocolVersion === 2) {
    emitSseEvent(options.controller, options.encoder, {
      text: options.responseOpening,
    });
  }

  for await (const event of mapAgentEventsToSse(turn.fullStream)) {
    if ("status" in event) {
      emitStatusEvent(options.controller, options.encoder, event.status);
      continue;
    }

    if (options.telemetry && !options.telemetry.firstTextAt) {
      options.telemetry.firstTextAt = Date.now();
    }
    const stripped = stripInternalTokensStreaming(stripState, event.text);
    detectedInternalTokens.push(...stripped.tokens);
    if (!stripped.emit) continue;
    fullResponse += stripped.emit;
    if (options.streamProtocolVersion === 2) {
      emitSseEvent(options.controller, options.encoder, { text: stripped.emit });
    }
  }

  const flushed = flushStreamingStripState(stripState);
  detectedInternalTokens.push(...flushed.tokens);
  if (flushed.emit) {
    fullResponse += flushed.emit;
    if (options.streamProtocolVersion === 2) {
      emitSseEvent(options.controller, options.encoder, { text: flushed.emit });
    }
  }

  return {
    fullResponse,
    sources: turn.collectedSources,
    detectedInternalTokens,
    hadToolCalls: turn.toolActivity.length > 0,
    httpExecutionIds: turn.httpExecutionIds,
  };
}

export interface WidgetMessageTurnRuntime {
  createProjectService(db: WidgetMessageTurnContext["db"]): ProjectService;
  createBillingService(
    db: WidgetMessageTurnContext["db"],
    env: WidgetMessageTurnContext["env"],
  ): BillingService;
  createChatService(db: WidgetMessageTurnContext["db"]): ChatService;
  createCustomerIdentityService(
    db: WidgetMessageTurnContext["db"],
  ): CustomerIdentityService;
  createToolService(db: WidgetMessageTurnContext["db"]): ToolService;
  createGuidelineService(db: WidgetMessageTurnContext["db"]): GuidelineService;
  createTelegramService(db: WidgetMessageTurnContext["db"]): TelegramService;
  runMavenTurn: typeof runMavenTurn;
}

const defaultWidgetMessageTurnRuntime: WidgetMessageTurnRuntime = {
  createProjectService(db) {
    return new ProjectService(db);
  },
  createBillingService(db, env) {
    return new BillingService(db, env);
  },
  createChatService(db) {
    return new ChatService(db);
  },
  createCustomerIdentityService(db) {
    return new CustomerIdentityService(db);
  },
  createToolService(db) {
    return new ToolService(db);
  },
  createGuidelineService(db) {
    return new GuidelineService(db);
  },
  createTelegramService(db) {
    return new TelegramService(db);
  },
  runMavenTurn,
};

export async function handleWidgetMessageTurn(
  context: WidgetMessageTurnContext,
  runtime: WidgetMessageTurnRuntime = defaultWidgetMessageTurnRuntime,
): Promise<Response> {
  const turnId = crypto.randomUUID();
  const projectService = runtime.createProjectService(context.db);
  const billingService = runtime.createBillingService(context.db, context.env);
  const chatService = runtime.createChatService(context.db);
  const customerIdentityService = runtime.createCustomerIdentityService(
    context.db,
  );
  const toolService = runtime.createToolService(context.db);
  const guidelineService = runtime.createGuidelineService(context.db);

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
  const imageUrl = context.payload.imageUrl ?? null;
  let isFirstVisitorTurn = context.isFirstVisitorTurn ?? false;
  let visitorMessageOccurredAt = new Date();
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
    visitorMessageOccurredAt = visitorMessage.createdAt;
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

  if (
    conversation.status === "active" &&
    chatState.aiParticipation !== "human_only" &&
    chatState.awaitingContactFields.length > 0
  ) {
    const contactReply = parsePendingContactReply(
      context.payload.content,
      chatState.awaitingContactFields,
    );
    if (
      contactReply.visitorName ||
      contactReply.visitorEmail ||
      contactReply.contactDeclined
    ) {
      const updatedConversation =
        await chatService.updatePendingTeamRequestContact(
          context.conversationId,
          context.project.id,
          {
            status: conversation.status,
            chatState: conversation.chatState,
          },
          {
            ...(contactReply.visitorName
              ? { visitorName: contactReply.visitorName }
              : {}),
            ...(contactReply.visitorEmail
              ? { visitorEmail: contactReply.visitorEmail }
              : {}),
            awaitingContactFields: contactReply.remainingFields,
            contactDeclined: contactReply.contactDeclined,
          },
        );
      if (updatedConversation) {
        conversation = updatedConversation;
        chatState = parseChatState(conversation.chatState, {
          fallbackAiParticipation: fallbackAiParticipationForStatus(
            conversation.status,
          ),
        });
        conversationStatusForTurn = conversation.status;
      } else {
        const latestConversation =
          await chatService.getOperationalConversationById(
            context.conversationId,
            context.project.id,
          );
        if (!latestConversation) {
          return Response.json(
            { error: "Conversation archived" },
            { status: 410 },
          );
        }
        conversation = latestConversation;
        chatState = parseChatState(conversation.chatState, {
          fallbackAiParticipation: fallbackAiParticipationForStatus(
            conversation.status,
          ),
        });
        conversationStatusForTurn = conversation.status;
      }
    }
  }

  const participationAtTurnStart = chatState.aiParticipation;
  const ownershipSnapshotAtTurnStart = {
    status: conversation.status,
    chatState: conversation.chatState,
  };

  context.executionCtx.waitUntil(
    touchLinkedCustomerAfterVisitorMessage({
      projectId: context.project.id,
      customerId: conversation.customerId,
      visitorId: conversation.visitorId,
      occurredAt: visitorMessageOccurredAt,
      identityService: customerIdentityService,
      logFailure(error) {
        logError(
          "widget_turn.customer_last_seen_failed",
          error,
          buildWidgetTurnLogContext(context, turnId, {
            customerId: conversation.customerId,
          }),
        );
      },
      onTouched(customerId) {
        broadcastCustomerUpdated(
          context.env,
          context.executionCtx,
          context.project.id,
          [customerId],
        );
      },
    }),
  );

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
    const telegramService = runtime.createTelegramService(context.db);
    const telegramBotToken = settings.telegramBotToken;
    const telegramChatId = settings.telegramChatId;
    context.executionCtx.waitUntil(
      (async () => {
        await chatService.runExternalActionIfOperational(
          conversation.id,
          context.project.id,
          () => telegramService.forwardVisitorMessage(
            telegramBotToken,
            telegramChatId,
            conversation.visitorName,
            context.payload.content,
            conversation.id,
            conversation.telegramThreadId
              ? Number.parseInt(conversation.telegramThreadId, 10)
              : undefined,
          ),
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

  if (hardGate === "closed") {
    logInfo(
      "widget_turn.closed_conversation_bypassed",
      buildWidgetTurnLogContext(context, turnId, { modelCallCount: 0 }),
    );
    return Response.json({ error: "Conversation closed" }, { status: 410 });
  }

  const [enabledGuidelines, recentHistory] = await Promise.all([
    guidelineService.getEnabledByProject(context.project.id),
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
  const conversationMetadata = parseConversationMetadata(conversation.metadata);
  const agentHandbackInstructions =
    typeof conversationMetadata.agentHandbackInstructions === "string"
      ? conversationMetadata.agentHandbackInstructions
      : null;

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

  const turnAbortController = new AbortController();
  function abortTurn(reason: unknown): void {
    if (turnAbortController.signal.aborted) return;
    turnAbortController.abort(reason);
  }
  function abortFromInboundRequest(): void {
    abortTurn(context.abortSignal?.reason);
  }
  context.abortSignal?.addEventListener("abort", abortFromInboundRequest, {
    once: true,
  });
  if (context.abortSignal?.aborted) abortFromInboundRequest();

  return createWidgetSseResponse(async (controller, encoder) => {
    const telemetry: TurnTelemetry = {
      startedAt,
      routeStartedAt: startedAt,
    };

    if (context.contactAccepted) {
      emitSseEvent(controller, encoder, {
        contactAccepted: context.contactAccepted,
      });
    }

    emitStatus("Thinking", "thinking");

    let currentStage = "load_message_image";
    let eventState = createInitialAgentEventState();
    let executionPath: string | null = null;
    let sourceReferences: SourceReference[] = [];
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
        executionPath = "scope_blocked";
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

      executionPath = "maven_tool_loop";

      chatState = {
        ...chatState,
        state: "answering",
      };

      currentStage = "maven_turn";
      logInfo(
        "widget_turn.loop_started",
        buildWidgetTurnLogContext(context, turnId, {
          hasImage: Boolean(image),
        }),
      );

      const loopStartedAt = Date.now();
      const streamedTurn = await streamPublicMavenTurn({
        runTurn: runtime.runMavenTurn,
        turnInput: {
          context: {
            channel: "public",
            projectId: context.project.id,
            conversationId: context.conversationId,
            actorUserId: null,
            customerId: conversation.customerId,
            ownership: ownershipSnapshotAtTurnStart,
          },
          dependencies: {
            db: context.db,
            env: context.env,
            modelRuntime,
            toolService,
            projectName: context.project.name,
            settings: settings ?? {
              toneOfVoice: "professional",
              customTonePrompt: null,
              companyContext: null,
              botName: null,
              agentName: null,
              workingHours: null,
              avgResponseTime: null,
            },
            abortSignal: turnAbortController.signal,
            promptOptions: {
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
              timeContext: {
                nowMs: Date.now(),
                conversationHistory,
              },
              turnContext,
              aiParticipation: chatState.aiParticipation,
              escalated: isAgentRequestedStatus(conversation.status),
            },
            publicToolDependencies: {
              executionCtx: context.executionCtx,
              chatService,
              projectService,
              telegramService: runtime.createTelegramService(context.db),
              acquireHttpRateLimitPermit() {
                return context.checkRateLimit(
                  `toolmsg:${context.project.id}`,
                  100,
                  60_000,
                );
              },
              onTeamRequested() {
                conversationStatusForTurn = "waiting_agent";
                broadcastStatusChange(
                  context.env,
                  context.executionCtx,
                  context.conversationId,
                  "waiting_agent",
                );
              },
              broadcast(message) {
                broadcastMessageNew(
                  context.env,
                  context.executionCtx,
                  context.conversationId,
                  message,
                  { audience: "agents" },
                );
              },
            },
          },
          conversationHistory,
          currentMessage: aiMessageContent,
          image,
        },
        controller,
        encoder,
        streamProtocolVersion: context.streamProtocolVersion,
        responseOpening,
        telemetry,
      });
      telemetry.loopMs = Date.now() - loopStartedAt;
      sourceReferences = streamedTurn.sources;
      eventState = {
        ...createInitialAgentEventState(),
        fullResponse: streamedTurn.fullResponse,
        hadToolCalls: streamedTurn.hadToolCalls,
        detectedInternalTokens: streamedTurn.detectedInternalTokens,
      };

      logInfo(
        "widget_turn.loop_completed",
        buildWidgetTurnLogContext(context, turnId, {
          textLength: eventState.fullResponse.length,
          hadToolCalls: eventState.hadToolCalls,
          sourceCount: sourceReferences.length,
        }),
      );

      let fullResponse = eventState.fullResponse;
      const flaggedForReview = chatState.aiParticipation === "human_only";
      let finalConversationStatus: WidgetCompletedPayload["conversationStatus"] =
        conversationStatusForTurn === "waiting_agent" ||
        conversationStatusForTurn === "agent_replied"
          ? conversationStatusForTurn
          : "active";
      let resolvedByThisTurn = false;
      let outputPermission = await getAiOutputPermission();
      if (
        eventState.detectedInternalTokens.includes("[RESOLVED]") &&
        !flaggedForReview &&
        outputPermission.allowed &&
        outputPermission.status === "active"
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
        outputPermission = await getAiOutputPermission(resolvedByThisTurn);
      }

      finalConversationStatus = outputPermission.status;
      if (!outputPermission.allowed) {
        fullResponse = "";
      }

      // Task 3 guard fallout: on an escalated / waiting_agent conversation the
      // model can emit ONLY [RESOLVED], which strips to empty text AND has its
      // resolved-close branch suppressed above (flaggedForReview). Persisting +
      // streaming that empty response would paint a blank bubble in the widget
      // and a blank row in the inbox. A human is already handling the thread, so
      // the bot has nothing to add — skip the empty message entirely (no message
      // beats an empty bubble) while still emitting `done` so the widget finalizes.
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
                sourceReferences.length > 0
                  ? JSON.stringify(sourceReferences)
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
          if (
            ownershipSnapshotAtTurnStart.status !== "waiting_agent" &&
            finalConversationStatus === "waiting_agent"
          ) {
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
          const telegramService = runtime.createTelegramService(context.db);
          const telegramBotToken = settings.telegramBotToken;
          const telegramChatId = settings.telegramChatId;
          context.executionCtx.waitUntil(
            (async () => {
              await chatService.runExternalActionIfOperational(
                context.conversationId,
                context.project.id,
                () => telegramService.notifyBotResolved(
                  telegramBotToken,
                  telegramChatId,
                  settings.botName,
                  context.conversationId,
                  conversation.telegramThreadId
                    ? Number.parseInt(conversation.telegramThreadId, 10)
                    : undefined,
                ),
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
      const cappedSources = sourceReferences.slice(0, MAX_SOURCES);

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

      if (streamedTurn.httpExecutionIds.length > 0) {
        context.executionCtx.waitUntil(
          toolService
            .linkExecutionsToMessage(
              streamedTurn.httpExecutionIds,
              context.conversationId,
              botMessage.id,
            )
            .catch((err) => {
              logError(
                "widget_turn.link_tool_executions_failed",
                err,
                buildWidgetTurnLogContext(context, turnId, {
                  messageId: botMessage.id,
                }),
              );
            }),
        );
      }

      logInfo(
        "widget_turn.completed",
        buildWidgetTurnLogContext(context, turnId, {
          messageId: botMessage.id,
          sourceCount: sourceReferences.length,
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
          executionPath,
          sourceCount: sourceReferences.length,
          hadToolCalls: eventState.hadToolCalls,
          stepCount: eventState.stepCount,
          verifierRan: telemetry.verifierRan ?? false,
          verifierVerdict: telemetry.verifierVerdict ?? null,
        }),
      );
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";

      if (
        context.contactAccepted &&
        !persistedAiMessage &&
        !(err instanceof MavenStreamFailure)
      ) {
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
  }, {
    onCancel: abortTurn,
  });
}
