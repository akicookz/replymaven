// Copilot turn handler. Thin shell over runAgenticPipeline — owns only the
// Copilot-specific gates and persistence/broadcast wiring. Everything else
// (planner loop, classify/summarize/RAG, FAQ compile, capability post-filter,
// final SSE done frame) lives in the shared pipeline.
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { createModelRuntimeState } from "../llm/create-language-model";
import { buildCopilotSystemPrompt } from "../prompt/build-copilot-system-prompt";
import { createWidgetSseResponse } from "../streaming/create-widget-sse-response";
import {
  emitSseEvent,
  emitStatusEvent,
} from "../streaming/map-agent-events-to-sse";
import {
  type ConversationTurnMessage,
  type TurnTelemetry,
  toToolDefinition,
} from "../types";
import { BillingService } from "../../services/billing-service";
import { ChatService } from "../../services/chat-service";
import { CopilotService } from "../../services/copilot-service";
import { GuidelineService } from "../../services/guideline-service";
import { ProjectService } from "../../services/project-service";
import { ResourceService } from "../../services/resource-service";
import { ToolService } from "../../services/tool-service";
import { broadcastCopilotMessage } from "../../realtime/broadcast";
import { decryptEnabledToolHeaders } from "../../services/encryption-service";
import { logInfo, logWarn, logError } from "../../observability";
import { type AppEnv } from "../../types";
import { prepareTurnRouting } from "./prepare-turn-routing";
import { runAgenticTurn } from "./run-agentic-pipeline";

export interface CopilotTurnContext {
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
  executionCtx: ExecutionContext;
  project: { id: string; userId: string; name: string };
  conversationId: string;
  agentUserId: string;
  payload: { content: string };
  isAutoSuggest?: boolean;
}

const COPILOT_HISTORY_LIMIT = 10;
const VISITOR_TRANSCRIPT_TURN_LIMIT = 30;

function buildVisitorTranscript(
  messages: Array<{ role: string; content: string; senderName: string | null }>,
): string {
  if (messages.length === 0) {
    return "(No visitor messages yet — this is the start of the conversation.)";
  }
  const tail = messages.slice(-VISITOR_TRANSCRIPT_TURN_LIMIT);
  return tail
    .map((m) => {
      const speaker =
        m.role === "visitor"
          ? "Visitor"
          : m.role === "agent"
            ? m.senderName ?? "Agent"
            : m.senderName ?? "Bot";
      return `${speaker}: ${m.content}`;
    })
    .join("\n\n");
}

function copilotHistoryToTurns(
  rows: Array<{ role: "agent" | "copilot"; content: string }>,
): ConversationTurnMessage[] {
  // Map agent → visitor and copilot → bot so the planner's classifier and
  // retrieval reformulator (which expect visitor/bot vocabulary) work
  // unmodified. Purely a shape adapter for the planner.
  return rows.slice(-COPILOT_HISTORY_LIMIT).map((m) => ({
    role: m.role === "agent" ? "visitor" : "bot",
    content: m.content,
  }));
}

// Auto-suggest has no real agent question — only a synthetic "draft a reply"
// instruction. Routing the planner on that string (with an empty thread) runs
// classify / summarize / FAQ-select / RAG reformulation blind, so the planner
// produces a "please share the visitor's message" clarification that the
// compose step then emits. Instead, route on the actual visitor↔bot transcript:
// the latest visitor message becomes the message to reply to, everything before
// it becomes history — exactly how the visitor-facing handler is anchored.
export function buildAutoSuggestTurnInput(
  messages: Array<{ role: string; content: string }>,
  fallbackInstruction: string,
): { conversationHistory: ConversationTurnMessage[]; currentMessage: string } {
  const turns: ConversationTurnMessage[] = messages.map((m) => ({
    role: m.role === "visitor" ? "visitor" : "bot",
    content: m.content,
  }));
  let lastVisitorIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "visitor" && messages[i].content.trim()) {
      lastVisitorIdx = i;
      break;
    }
  }
  // No visitor message to reply to → keep the friendly-opening instruction,
  // with whatever transcript exists as background.
  if (lastVisitorIdx === -1) {
    return {
      conversationHistory: turns.slice(-COPILOT_HISTORY_LIMIT),
      currentMessage: fallbackInstruction,
    };
  }
  return {
    conversationHistory: turns
      .slice(0, lastVisitorIdx)
      .slice(-COPILOT_HISTORY_LIMIT),
    currentMessage: messages[lastVisitorIdx].content,
  };
}

export async function handleCopilotTurn(
  context: CopilotTurnContext,
): Promise<Response> {
  const turnId = crypto.randomUUID();
  const projectService = new ProjectService(context.db);
  const billingService = new BillingService(context.db, context.env);
  const chatService = new ChatService(context.db);
  const toolService = new ToolService(context.db);
  const guidelineService = new GuidelineService(context.db);
  const resourceService = new ResourceService(context.db, context.env.UPLOADS);
  const copilotService = new CopilotService(context.db);

  const logCtx = {
    turnId,
    projectId: context.project.id,
    conversationId: context.conversationId,
    agentUserId: context.agentUserId,
    isAutoSuggest: !!context.isAutoSuggest,
  };
  logInfo("copilot_turn.started", {
    ...logCtx,
    contentLength: context.payload.content.length,
  });

  // Stage 1: cheap auth/scope checks. Gate the heavy reads on this so a
  // mistyped convId doesn't trigger unbounded reads on a foreign conversation.
  const [ownerSub, conversation] = await Promise.all([
    billingService.getSubscriptionByUserId(context.project.userId),
    chatService.getConversationById(context.conversationId, context.project.id),
  ]);

  if (!ownerSub || !billingService.isSubscriptionActive(ownerSub)) {
    logWarn("copilot_turn.blocked", {
      ...logCtx,
      reason: "subscription_inactive",
    });
    return Response.json(
      { error: "Copilot requires an active subscription on this project." },
      { status: 403 },
    );
  }
  if (!conversation) {
    logWarn("copilot_turn.blocked", {
      ...logCtx,
      reason: "conversation_not_found",
    });
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Stage 2: parallel project artifact fetch.
  const [
    settings,
    enabledTools,
    enabledGuidelines,
    allResources,
    copilotHistory,
    visitorMessages,
  ] = await Promise.all([
    projectService.getSettings(context.project.id),
    toolService.getEnabledTools(context.project.id),
    guidelineService.getEnabledByProject(context.project.id),
    resourceService.getResourcesByProject(context.project.id),
    copilotService.getThread(context.conversationId),
    chatService.getMessages(context.conversationId),
  ]);

  // Decrypt tool headers in-place — visitor handler does the same step before
  // handing tools to the planner's `call_tool` branch. Skipping this would
  // mean encrypted JSON gets sent as Authorization headers on tool calls.
  await decryptEnabledToolHeaders(
    enabledTools,
    context.env.ENCRYPTION_KEY,
    (row) => {
      logWarn("copilot_turn.tool_headers_decrypt_failed", {
        ...logCtx,
        toolId: row.id,
        toolName: row.name,
      });
    },
  );

  // Persist the agent's question first so the thread is consistent if the
  // SSE stream drops mid-response. Skip for auto-suggest — the synthetic
  // "draft a reply" prompt isn't real agent input and would clutter the
  // thread for other dashboard sessions watching this conversation.
  if (!context.isAutoSuggest) {
    const agentMessage = await copilotService.addMessage({
      conversationId: context.conversationId,
      role: "agent",
      content: context.payload.content,
      agentUserId: context.agentUserId,
      autoSuggest: false,
    });
    broadcastCopilotMessage(
      context.env,
      context.executionCtx,
      context.conversationId,
      agentMessage,
      { excludeSubjectId: context.agentUserId },
    );
  }

  return createWidgetSseResponse(async (controller, encoder) => {
    const telemetry: TurnTelemetry = { startedAt: Date.now() };
    const modelRuntime = createModelRuntimeState({
      model: context.env.AI_MODEL,
      geminiApiKey: context.env.GEMINI_API_KEY,
      openaiApiKey: context.env.OPENAI_API_KEY,
    });

    function emitStatus(
      message: string,
      phase: "thinking" | "retrieval" | "tool" | "verify" | "compose",
    ): void {
      if (!telemetry.firstStatusAt) telemetry.firstStatusAt = Date.now();
      emitStatusEvent(controller, encoder, { phase, message });
    }
    function closeSafeAiReplayWindow(_reason: string): void {
      // No-op for Copilot — there's no model-fallback replay safety window
      // because Copilot turns are agent-initiated and don't need the visitor
      // anti-replay protection.
    }

    emitStatus("Thinking", "thinking");
    let teamRequestRejections = 0;

    try {
      // Agent-question turns: the planner sees the agent↔copilot thread (mapped
      // to visitor/bot vocabulary). Auto-suggest turns: there's no agent
      // question, so the planner must route on the real visitor↔bot transcript
      // instead — otherwise it has no content to classify and drafts a "share
      // the visitor's message" clarification. Either way the full visitor
      // conversation still goes into the Copilot system prompt below.
      const { conversationHistory, currentMessage }: {
        conversationHistory: ConversationTurnMessage[];
        currentMessage: string;
      } = context.isAutoSuggest
        ? buildAutoSuggestTurnInput(
            visitorMessages.map((m) => ({ role: m.role, content: m.content })),
            context.payload.content,
          )
        : {
            conversationHistory: [
              ...copilotHistoryToTurns(copilotHistory),
              { role: "visitor" as const, content: context.payload.content },
            ].slice(-COPILOT_HISTORY_LIMIT),
            currentMessage: context.payload.content,
          };

      const visitorTranscript = buildVisitorTranscript(
        visitorMessages.map((m) => ({
          role: m.role,
          content: m.content,
          senderName: m.senderName,
        })),
      );

      const convMeta = (() => {
        try {
          return conversation.metadata
            ? (JSON.parse(conversation.metadata as string) as Record<
                string,
                unknown
              >)
            : {};
        } catch {
          return {};
        }
      })();
      // Use the same `currentPageUrl` / `pageTitle` keys the visitor handler
      // would have rendered into <page-context>, so the prompt look is
      // consistent between audiences. Custom keys set via `setPageContext`
      // on the widget aren't persisted to conversation.metadata, so Copilot
      // only has the auto-collected device/page fields. Acceptable v1 gap.
      const pageContext: Record<string, string> | undefined =
        typeof convMeta.currentPageUrl === "string" ||
        typeof convMeta.pageTitle === "string"
          ? {
              ...(typeof convMeta.currentPageUrl === "string"
                ? { currentPageUrl: convMeta.currentPageUrl }
                : {}),
              ...(typeof convMeta.pageTitle === "string"
                ? { pageTitle: convMeta.pageTitle }
                : {}),
            }
          : undefined;

      const routing = await prepareTurnRouting({
        modelRuntime,
        conversationHistory,
        currentMessage,
        pageContext,
        resources: allResources,
        kv: context.env.CONVERSATIONS_CACHE,
        projectId: context.project.id,
        executionCtx: context.executionCtx,
        onRouterFinished: (ms) => {
          telemetry.routerMs = ms;
        },
        buildLogContext: (extra = {}) => ({ ...logCtx, ...extra }),
      });

      const availableTools = enabledTools.map((t) => toToolDefinition(t));

      const result = await runAgenticTurn({
        controller,
        encoder,
        modelRuntime,
        telemetry,
        currentMessage,
        pageContext,
        conversationHistory,
        conversationSummary: routing.conversationSummary,
        turnPlan: routing.turnPlan,
        compiledFaqContext: routing.compiledFaqContext,
        faqMatchHint: routing.faqMatchHint,
        ticketRefinementDecision: null,
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
        guidelines: enabledGuidelines.map((g) => ({
          condition: g.condition,
          instruction: g.instruction,
        })),
        hasIndexedResources: routing.hasIndexedResources,
        visitorInfo: {
          name: conversation.visitorName,
          email: conversation.visitorEmail,
        },
        existingTicket: null,
        ticketFields: null,
        agentHandbackInstructions: null,
        image: null,
        emitStatus,
        closeSafeAiReplayWindow,
        shouldAllowTeamRequest: () => {
          // Copilot never escalates / creates tickets — the system prompt
          // forbids these actions. Track rejection count as defense-in-depth
          // so we notice if the planner keeps proposing create_ticket and
          // burning through its step budget.
          teamRequestRejections += 1;
          if (teamRequestRejections === 2) {
            logWarn("copilot_turn.team_request_loop_suspected", {
              ...logCtx,
              rejections: teamRequestRejections,
            });
          }
          return { allowed: false, reason: "copilot_mode" };
        },
        buildLogContext: (extra = {}) => ({ ...logCtx, ...extra }),
        buildSystemPrompt: (ctx) =>
          buildCopilotSystemPrompt(
            ctx.settings,
            ctx.projectName,
            ctx.state.docsEvidence.knowledgeBaseContext,
            ctx.state.conversationSummary,
            {
              visitorTranscript,
              autoDraft: !!context.isAutoSuggest,
              guidelines: ctx.guidelines,
              pageContext: ctx.pageContext,
              visitorInfo: ctx.visitorInfo,
              faqContext: ctx.compiledFaqContext,
              faqMatchHint: ctx.faqMatchHint,
              groundingConfidence: ctx.state.docsEvidence.groundingConfidence,
              topScore: ctx.state.docsEvidence.topScore,
              turnPlan: {
                intent: ctx.state.initialTurnPlan.intent,
                summary: ctx.state.initialTurnPlan.summary,
                followUpQuestion: ctx.state.initialTurnPlan.followUpQuestion,
              },
              plannerGoal: ctx.state.goal,
              plannerActionHistory: ctx.state.actionHistory,
              toolEvidenceSummary: null,
              retrievalAttempted:
                ctx.state.docsEvidence.retrievalAttempted,
              broaderSearchAttempted:
                ctx.state.docsEvidence.broaderSearchAttempted,
            },
          ),
      });

      // Persist + broadcast Copilot reply.
      const copilotRow = await copilotService.addMessage({
        conversationId: context.conversationId,
        role: "copilot",
        content: result.fullResponse,
        sources:
          result.retrieval.sourceReferences.length > 0
            ? JSON.stringify(result.retrieval.sourceReferences)
            : null,
        agentUserId: null,
        autoSuggest: !!context.isAutoSuggest,
      });
      broadcastCopilotMessage(
        context.env,
        context.executionCtx,
        context.conversationId,
        copilotRow,
        { excludeSubjectId: context.agentUserId },
      );

      const MAX_SOURCES = 3;
      emitSseEvent(controller, encoder, {
        done: true,
        messageId: copilotRow.id,
        sources: result.retrieval.sourceReferences.slice(0, MAX_SOURCES),
      });

      // NOTE: Copilot intentionally does NOT call
      // `billingService.incrementMessageUsage` — Copilot turns are agent
      // productivity, not visitor-billed messages. If product decides Copilot
      // should count against a quota in the future, add the increment here.

      logInfo("copilot_turn.completed", {
        ...logCtx,
        messageId: copilotRow.id,
        textLength: result.fullResponse.length,
        sourceCount: result.retrieval.sourceReferences.length,
        stepCount: result.stepCount,
      });
    } catch (err) {
      logError("copilot_turn.failed", err, logCtx);
      // Surface a truncated cause in the persisted reply so the agent
      // watching the thread can self-diagnose without grepping logs.
      // Copilot is agent-facing only — leaking error text here doesn't
      // reach visitors.
      const cause = err instanceof Error ? err.message.slice(0, 120).trim() : "";
      const fallback = cause
        ? `Sorry — Copilot failed: ${cause}. Try again in a moment.`
        : "Sorry — Copilot hit an error. Try again in a moment.";
      emitSseEvent(controller, encoder, { finalText: fallback });
      try {
        const errMsg = await copilotService.addMessage({
          conversationId: context.conversationId,
          role: "copilot",
          content: fallback,
          agentUserId: null,
          autoSuggest: !!context.isAutoSuggest,
        });
        broadcastCopilotMessage(
          context.env,
          context.executionCtx,
          context.conversationId,
          errMsg,
          { excludeSubjectId: context.agentUserId },
        );
        emitSseEvent(controller, encoder, { done: true, messageId: errMsg.id });
      } catch {
        // best-effort
      }
    }
  });
}
