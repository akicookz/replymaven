import { type DrizzleD1Database } from "drizzle-orm/d1";
import { type ToolRow } from "../../db";
import { logError, logWarn } from "../../observability";
import { type ChatService } from "../../services/chat-service";
import { type ProjectService } from "../../services/project-service";
import { TelegramService } from "../../services/telegram-service";
import { type ToolService } from "../../services/tool-service";
import { WidgetService } from "../../services/widget-service";
import { type AppEnv } from "../../types";
import { buildSupportSystemPrompt } from "../prompt/build-support-system-prompt";
import {
  createLanguageModel,
  runWithModelFallback,
  type ModelRuntimeState,
} from "../llm/create-language-model";
import {
  extractContactInfo,
  fallbackExtractContactInfo,
  fallbackSummarizeTeamRequest,
  reformulateQuery,
  summarizeTeamRequest,
} from "../llm/auxiliary-calls";
import { createTeamRequestSubmission } from "../post-turn/team-request";
import {
  planNextAction,
  fallbackPlanNextAction,
  sanitizePlannerDecision,
} from "../planner/plan-next-action";
import {
  getQuerySemanticGroup,
  normalizeQuery
} from "../planner/query-deduplication";
import { buildRetrievalQueries } from "../retrieval/build-retrieval-queries";
import { getSourceReferenceDedupKey } from "../retrieval/build-rag-context";
import { runAiSearch, type RetrievalResult } from "../retrieval/run-ai-search";
import { emitSseEvent } from "../streaming/map-agent-events-to-sse";
import { streamSupportAgent } from "../agents/support-agent";
import { stripTrailingSolicitedFollowUp } from "./strip-trailing-solicited-follow-up";
import { executeHttpTool } from "../tools/http-tool-executor";
import {
  buildUnsupportedFallback,
  fallbackVerificationResult,
  type VerificationResult,
  verifyAnswer,
} from "../workflows/verify-answer";
import {
  type PlannerActionHistoryEntry,
  type PlannerDocsEvidence,
  type PlannerLoopResult,
  type PlannerLoopState,
  type PlannerToolEvidence,
  type SupportPromptSettings,
  type SupportToolDefinition,
  type SupportTurnPlan,
  type TurnTelemetry,
  type ConversationTurnMessage,
} from "../types";

const MAX_PLANNER_STEPS = 8; // Increased to allow more search attempts for thorough documentation checking

interface RunPlannerLoopOptions {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  modelRuntime: ModelRuntimeState;
  telemetry: TurnTelemetry;
  currentMessage: string;
  pageContext?: Record<string, string>;
  conversationHistory: ConversationTurnMessage[];
  conversationSummary: string | null;
  turnPlan: SupportTurnPlan;
  availableTools: SupportToolDefinition[];
  enabledToolRows: ToolRow[];
  toolService: ToolService;
  chatService: ChatService;
  projectService: ProjectService;
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
  executionCtx: ExecutionContext;
  project: {
    id: string;
    name: string;
  };
  conversation: {
    id: string;
    visitorId: string | null;
    visitorName: string | null;
    visitorEmail: string | null;
    status: string;
    metadata: string | null | undefined;
  };
  settings: SupportPromptSettings & {
    companyName?: string | null;
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
  };
  guidelines: Array<{ condition: string; instruction: string }>;
  compiledFaqContext: string;
  visitorInfo: { name: string | null; email: string | null };
  agentHandbackInstructions?: string | null;
  image?: { base64: string; mimeType: string } | null;
  emitStatus: (
    message: string,
    phase: "retrieval" | "tool" | "verify" | "compose",
  ) => void;
  shouldAllowTeamRequest: (options: {
    retrievalAttempted: boolean;
    hadToolCalls: boolean;
  }) => { allowed: boolean; reason: string };
  closeSafeAiReplayWindow: (reason: string) => void;
  buildLogContext: (extra?: Record<string, unknown>) => Record<string, unknown>;
}

function createEmptyPlannerDocsEvidence(): PlannerDocsEvidence {
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
    queries: [],
    broaderQueries: [],
  };
}

function mergeRagContextBlocks(...contexts: string[]): string {
  const merged = new Set<string>();

  for (const context of contexts) {
    for (const block of context.split(/\n\n(?=<source )/g)) {
      const normalized = block.trim();
      if (normalized) {
        merged.add(normalized);
      }
    }
  }

  return [...merged].join("\n\n");
}

function mergeDocsEvidence(
  current: PlannerDocsEvidence,
  next: RetrievalResult,
  queries: string[],
  broaderQueries: string[],
): PlannerDocsEvidence {
  const sourceMap = new Map<
    string,
    PlannerDocsEvidence["sourceReferences"][number]
  >();

  for (const source of current.sourceReferences) {
    sourceMap.set(getSourceReferenceDedupKey(source), source);
  }

  for (const source of next.sourceReferences) {
    sourceMap.set(getSourceReferenceDedupKey(source), source);
  }

  const groundingConfidence =
    current.groundingConfidence === "high" ||
    next.groundingConfidence === "high"
      ? "high"
      : current.groundingConfidence === "low" ||
          next.groundingConfidence === "low"
        ? "low"
        : "none";

  return {
    ragContext: mergeRagContextBlocks(current.ragContext, next.ragContext),
    faqContext: mergeRagContextBlocks(current.faqContext, next.faqContext),
    knowledgeBaseContext: mergeRagContextBlocks(
      current.knowledgeBaseContext,
      next.knowledgeBaseContext,
    ),
    sourceReferences: [...sourceMap.values()],
    groundingConfidence,
    unresolvedKeys: [
      ...new Set([...current.unresolvedKeys, ...next.unresolvedKeys]),
    ],
    droppedCrossTenant: current.droppedCrossTenant + next.droppedCrossTenant,
    retrievalAttempted: current.retrievalAttempted || next.retrievalAttempted,
    broaderSearchAttempted:
      current.broaderSearchAttempted || next.broaderSearchAttempted,
    queries: [...new Set([...current.queries, ...queries])],
    broaderQueries: [
      ...new Set([...current.broaderQueries, ...broaderQueries]),
    ],
  };
}

function summarizeToolEvidence(
  toolEvidence: PlannerToolEvidence[],
): string | null {
  if (toolEvidence.length === 0) {
    return null;
  }

  return toolEvidence
    .map((entry, index) => {
      return [
        `${index + 1}. Tool ${entry.toolName}`,
        `Success: ${entry.success}`,
        `Input: ${JSON.stringify(entry.input)}`,
        entry.error ? `Error: ${entry.error}` : null,
        `Output: ${JSON.stringify(entry.output).slice(0, 1500)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function createInitialLoopState(
  turnPlan: SupportTurnPlan,
  conversationSummary: string | null,
  visitorInfo: { name: string | null; email: string | null },
): PlannerLoopState {
  return {
    goal: turnPlan.summary,
    stepCount: 0,
    conversationSummary,
    initialTurnPlan: turnPlan,
    actionHistory: [],
    docsEvidence: createEmptyPlannerDocsEvidence(),
    toolEvidence: [],
    missingInputs: [],
    knownVisitorName: visitorInfo.name,
    knownVisitorEmail: visitorInfo.email,
    handoffRequested: false,
    awaitingHandoffConfirmation: false,
    awaitingContactFields: [],
    contactDeclined: false,
    handoffSummary: null,
    finalDraft: null,
    terminationReason: null,
    queryTracker: {
      normalizedQueries: new Map<string, number>(),
      semanticGroups: [],
    },
  };
}

function pushActionHistory(
  state: PlannerLoopState,
  entry: PlannerActionHistoryEntry,
): void {
  state.actionHistory.push(entry);
}

function buildContactQuestion(missingFields: Array<"name" | "email">): string {
  if (missingFields.length === 2) {
    return "I can forward this to the team. Before I do, could you share your name and email so they can follow up directly? If you'd rather keep it in chat, just say that.";
  }

  if (missingFields[0] === "name") {
    return "I can forward this to the team. Before I do, could you share your name so they know who to follow up with? If you'd rather keep it in chat, just say that.";
  }

  return "I can forward this to the team. Before I do, could you share your email so they can follow up directly? If you'd rather keep it in chat, just say that.";
}

function getMissingContactFields(state: PlannerLoopState): Array<"name" | "email"> {
  const missingFields: Array<"name" | "email"> = [];

  if (!state.knownVisitorName?.trim()) {
    missingFields.push("name");
  }

  if (!state.knownVisitorEmail?.trim()) {
    missingFields.push("email");
  }

  return missingFields;
}

function buildHandoffOfferMessage(options: {
  hasIssueContext: boolean;
  agentLabel: string;
}): string {
  if (!options.hasIssueContext) {
    return `Sure — I can help get this to ${options.agentLabel}. Before I forward it, could you tell me a bit about what you need help with so the team gets the right context?`;
  }

  return `I can forward this to ${options.agentLabel} for a deeper look. If you'd like me to do that, reply yes and I'll collect anything still missing before sending it over.`;
}

function hasIssueContext(
  conversationHistory: ConversationTurnMessage[],
  currentMessage: string,
): boolean {
  return conversationHistory.some((message) => {
    if (message.role !== "visitor") {
      return false;
    }

    if (message.content.trim() === currentMessage.trim()) {
      return false;
    }

    return message.content.trim().length >= 12;
  });
}

function lastAssistantRequestedStructuredContact(
  conversationHistory: ConversationTurnMessage[],
): boolean {
  const lastAssistantMessage = [...conversationHistory]
    .reverse()
    .find((message) => message.role === "bot" || message.role === "agent")
    ?.content;

  if (!lastAssistantMessage) {
    return false;
  }

  return /before i do, could you share your (name|email)|share your name and email so they can follow up directly|share your email so they can follow up directly|share your name so they know who to follow up with/i.test(
    lastAssistantMessage,
  );
}

function visitorDeclinedContactDetails(message: string): boolean {
  return /\b(no email|no e-mail|don't want to share|do not want to share|rather not share|prefer not to share|no thanks|continue here|in this chat|reply here|keep it in chat|without email|without e-mail)\b/i.test(
    message,
  );
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
    (options.groundingConfidence !== "high" ||
      options.hadToolCalls ||
      draftedAnswerHasSpecificClaims)
  );
}

function buildStopResponse(options: {
  currentMessage: string;
  turnPlan: SupportTurnPlan;
  state: PlannerLoopState;
}): string {
  if (
    options.state.docsEvidence.ragContext.trim() ||
    options.state.toolEvidence.length > 0
  ) {
    return "I've reached the end of the reliable checks I can do here. Share one more concrete detail and I'll try again.";
  }

  return buildUnsupportedFallback(
    options.currentMessage,
    options.turnPlan.intent,
  );
}

async function populateKnownVisitorInfo(options: {
  modelRuntime: ModelRuntimeState;
  conversationHistory: ConversationTurnMessage[];
  state: PlannerLoopState;
  buildLogContext: (extra?: Record<string, unknown>) => Record<string, unknown>;
}): Promise<void> {
  if (options.state.knownVisitorName && options.state.knownVisitorEmail) {
    return;
  }

  let contactInfo: { name: string | null; email: string | null };
  try {
    contactInfo = await runWithModelFallback({
      runtime: options.modelRuntime,
      stage: "extract_contact_info_planner",
      logContext: options.buildLogContext(),
      operation: async (activeConfig) => {
        return extractContactInfo(
          createLanguageModel(activeConfig),
          options.conversationHistory,
          { throwOnModelError: true },
        );
      },
    });
  } catch {
    contactInfo = fallbackExtractContactInfo(options.conversationHistory);
    logWarn(
      "widget_turn.contact_info_planner_fallback_used",
      options.buildLogContext(),
    );
  }

  options.state.knownVisitorName =
    options.state.knownVisitorName ?? contactInfo.name ?? null;
  options.state.knownVisitorEmail =
    options.state.knownVisitorEmail ?? contactInfo.email ?? null;
}

async function buildTeamRequestSummary(options: {
  modelRuntime: ModelRuntimeState;
  conversationHistory: ConversationTurnMessage[];
  buildLogContext: (extra?: Record<string, unknown>) => Record<string, unknown>;
}): Promise<string> {
  try {
    return await runWithModelFallback({
      runtime: options.modelRuntime,
      stage: "summarize_team_request",
      logContext: options.buildLogContext(),
      operation: async (activeConfig) => {
        return summarizeTeamRequest(
          createLanguageModel(activeConfig),
          options.conversationHistory,
          { throwOnModelError: true },
        );
      },
    });
  } catch {
    logWarn(
      "widget_turn.team_request_summary_fallback_used",
      options.buildLogContext(),
    );
    return fallbackSummarizeTeamRequest(options.conversationHistory);
  }
}

async function executeCompose(options: {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  modelRuntime: ModelRuntimeState;
  telemetry: TurnTelemetry;
  currentMessage: string;
  conversationHistory: ConversationTurnMessage[];
  state: PlannerLoopState;
  settings: SupportPromptSettings;
  projectName: string;
  guidelines: Array<{ condition: string; instruction: string }>;
  compiledFaqContext: string;
  pageContext?: Record<string, string>;
  visitorInfo: { name: string | null; email: string | null };
  agentHandbackInstructions?: string | null;
  image?: { base64: string; mimeType: string } | null;
  emitStatus: (
    message: string,
    phase: "retrieval" | "tool" | "verify" | "compose",
  ) => void;
  buildLogContext: (extra?: Record<string, unknown>) => Record<string, unknown>;
  closeSafeAiReplayWindow: (reason: string) => void;
}): Promise<{
  fullResponse: string;
  lastToolOutput: unknown;
  lastToolError: string | null;
}> {
  const systemPrompt = buildSupportSystemPrompt(
    options.settings,
    options.projectName,
    options.state.docsEvidence.knowledgeBaseContext,
    options.state.conversationSummary,
    {
      guidelines: options.guidelines,
      agentHandbackInstructions: options.agentHandbackInstructions,
      pageContext: options.pageContext,
      visitorInfo: options.visitorInfo,
      faqContext: options.compiledFaqContext,
      groundingConfidence: options.state.docsEvidence.groundingConfidence,
      turnPlan: {
        intent: options.state.initialTurnPlan.intent,
        summary: options.state.initialTurnPlan.summary,
        followUpQuestion: options.state.initialTurnPlan.followUpQuestion,
      },
      plannerGoal: options.state.goal,
      plannerActionHistory: options.state.actionHistory,
      toolEvidenceSummary: summarizeToolEvidence(options.state.toolEvidence),
      retrievalAttempted: options.state.docsEvidence.retrievalAttempted,
      broaderSearchAttempted: options.state.docsEvidence.broaderSearchAttempted,
    },
    // options.currentMessage,
  );

  options.emitStatus("Writing the reply...", "compose");
  let streamTextStarted = false;
  const supportAgent = await runWithModelFallback({
    runtime: options.modelRuntime,
    stage: "compose_answer",
    logContext: options.buildLogContext(),
    canRetry: () => !streamTextStarted,
    getRetryContext: () => ({
      streamTextStarted,
    }),
    operation: async (activeConfig) => {
      return streamSupportAgent(
        { modelConfig: activeConfig },
        {
          systemPrompt,
          conversationHistory: options.conversationHistory,
          userMessage: options.currentMessage,
          image: options.image,
          tools: [],
          toolChoice: "none",
        },
      );
    },
  });

  let fullResponse = "";
  for await (const part of supportAgent.fullStream) {
    if (part.type !== "text-delta") {
      continue;
    }

    if (!options.telemetry.firstTextAt) {
      options.telemetry.firstTextAt = Date.now();
    }
    if (!streamTextStarted) {
      streamTextStarted = true;
      options.closeSafeAiReplayWindow("compose_started");
    }

    fullResponse += part.text;
    emitSseEvent(options.controller, options.encoder, { text: part.text });
  }

  if (!fullResponse.trim()) {
    fullResponse = buildStopResponse({
      currentMessage: options.currentMessage,
      turnPlan: options.state.initialTurnPlan,
      state: options.state,
    });
    emitSseEvent(options.controller, options.encoder, {
      finalText: fullResponse,
    });
  }

  if (
    shouldVerifyAnswer({
      userMessage: options.currentMessage,
      fullResponse,
      groundingConfidence: options.state.docsEvidence.groundingConfidence,
      hadToolCalls: options.state.toolEvidence.length > 0,
      hasEvidence:
        options.state.docsEvidence.ragContext.trim().length > 0 ||
        options.state.toolEvidence.length > 0,
    })
  ) {
    options.telemetry.verifierRan = true;
    options.emitStatus("Checking factual claims against docs...", "verify");

    let verification: VerificationResult;
    try {
      verification = await runWithModelFallback({
        runtime: options.modelRuntime,
        stage: "verify_answer",
        logContext: options.buildLogContext(),
        operation: async (activeConfig) => {
          return verifyAnswer({
            model: createLanguageModel(activeConfig),
            userMessage: options.currentMessage,
            intent: options.state.initialTurnPlan.intent,
            draftedAnswer: fullResponse,
            ragContext: options.state.docsEvidence.ragContext,
            lastToolOutput: options.state.toolEvidence.at(-1)?.output,
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
        options.buildLogContext(),
      );
    }

    options.telemetry.verifierVerdict = verification.verdict;
    if (
      verification.verdict !== "supported" &&
      verification.answer.trim() &&
      verification.answer.trim() !== fullResponse.trim()
    ) {
      fullResponse = verification.answer.trim();
      emitSseEvent(options.controller, options.encoder, {
        finalText: fullResponse,
      });
    }
  }

  if (!fullResponse.includes("[RESOLVED]")) {
    const strippedResponse = stripTrailingSolicitedFollowUp(fullResponse);
    if (strippedResponse !== fullResponse.trim()) {
      fullResponse = strippedResponse;
      emitSseEvent(options.controller, options.encoder, {
        finalText: fullResponse,
      });
    }
  }

  return {
    fullResponse,
    lastToolOutput: options.state.toolEvidence.at(-1)?.output ?? null,
    lastToolError: options.state.toolEvidence.at(-1)?.error ?? null,
  };
}

export async function runPlannerLoop(
  options: RunPlannerLoopOptions,
): Promise<PlannerLoopResult> {
  const loopState = createInitialLoopState(
    options.turnPlan,
    options.conversationSummary,
    options.visitorInfo,
  );
  let lastToolOutput: unknown = null;
  let lastToolError: string | null = null;
  let hadToolCalls = false;

  await populateKnownVisitorInfo({
    modelRuntime: options.modelRuntime,
    conversationHistory: options.conversationHistory,
    state: loopState,
    buildLogContext: options.buildLogContext,
  });

  if (lastAssistantRequestedStructuredContact(options.conversationHistory)) {
    loopState.awaitingContactFields = getMissingContactFields(loopState);
    loopState.contactDeclined = visitorDeclinedContactDetails(
      options.currentMessage,
    );
  }

  while (loopState.stepCount < MAX_PLANNER_STEPS) {
    let plannerDecision;
    try {
      plannerDecision = await runWithModelFallback({
        runtime: options.modelRuntime,
        stage: "plan_next_action",
        logContext: options.buildLogContext({
          loopStep: loopState.stepCount + 1,
        }),
        operation: async (activeConfig) => {
          return planNextAction({
            model: createLanguageModel(activeConfig),
            conversationHistory: options.conversationHistory,
            currentMessage: options.currentMessage,
            pageContext: options.pageContext,
            turnPlan: options.turnPlan,
            availableTools: options.availableTools,
            state: loopState,
          });
        },
      });
    } catch {
      plannerDecision = fallbackPlanNextAction({
        conversationHistory: options.conversationHistory,
        currentMessage: options.currentMessage,
        turnPlan: options.turnPlan,
        availableTools: options.availableTools,
        state: loopState,
        maxSteps: MAX_PLANNER_STEPS,
      });
      logWarn(
        "widget_turn.plan_next_action_fallback_used",
        options.buildLogContext({
          loopStep: loopState.stepCount + 1,
        }),
      );
    }

    const sanitizedDecision = sanitizePlannerDecision({
      decision: plannerDecision,
      conversationHistory: options.conversationHistory,
      currentMessage: options.currentMessage,
      turnPlan: options.turnPlan,
      availableTools: options.availableTools,
      state: loopState,
      maxSteps: MAX_PLANNER_STEPS,
    });
    loopState.goal = sanitizedDecision.goal;
    loopState.stepCount += 1;

    const nextAction = sanitizedDecision.nextAction;

    if (nextAction.type === "search_docs") {
      // Track semantic group for this query
      const semanticGroup = getQuerySemanticGroup(nextAction.query);
      loopState.queryTracker.semanticGroups.push(semanticGroup);

      // Track normalized query count
      const normalizedQuery = normalizeQuery(nextAction.query);
      const currentCount = loopState.queryTracker.normalizedQueries.get(normalizedQuery) || 0;
      loopState.queryTracker.normalizedQueries.set(normalizedQuery, currentCount + 1);

      pushActionHistory(loopState, {
        type: "search_docs",
        reason: nextAction.reason,
        query: nextAction.query,
        broaderQueries: nextAction.broaderQueries,
        outcome: "executed",
        note: null,
      });

      options.emitStatus("Searching docs...", "retrieval");
      let searchQuery = nextAction.query;
      try {
        searchQuery = await runWithModelFallback({
          runtime: options.modelRuntime,
          stage: "reformulate_query",
          logContext: options.buildLogContext({
            loopStep: loopState.stepCount,
          }),
          operation: async (activeConfig) => {
            return reformulateQuery(
              createLanguageModel(activeConfig),
              options.conversationHistory,
              nextAction.query,
              { throwOnModelError: true },
            );
          },
        });
      } catch {
        logWarn(
          "widget_turn.reformulate_query_fallback_used",
          options.buildLogContext({
            loopStep: loopState.stepCount,
          }),
        );
      }

      const retrievalQueries = buildRetrievalQueries(
        options.currentMessage,
        searchQuery,
        [nextAction.query],
      );
      const broaderQueries = nextAction.broaderQueries ?? [];
      const retrieval = await runAiSearch({
        env: options.env,
        db: options.db,
        projectId: options.project.id,
        queries: retrievalQueries,
        broaderQueries,
        allowBroaderRetry: broaderQueries.length > 0,
      });

      loopState.docsEvidence = mergeDocsEvidence(
        loopState.docsEvidence,
        retrieval,
        retrievalQueries,
        broaderQueries,
      );
      continue;
    }

    if (nextAction.type === "call_tool") {
      pushActionHistory(loopState, {
        type: "call_tool",
        reason: nextAction.reason,
        toolName: nextAction.toolName,
        input: nextAction.input,
        outcome: "executed",
        note: null,
      });

      hadToolCalls = true;
      options.emitStatus("Checking connected systems...", "tool");
      options.closeSafeAiReplayWindow("tool_started");
      emitSseEvent(options.controller, options.encoder, {
        toolCall: {
          name: nextAction.toolName,
          args: nextAction.input,
        },
      });

      const toolStartedAt = Date.now();
      const toolDef = options.availableTools.find(
        (tool) => tool.name === nextAction.toolName,
      );
      const output = toolDef
        ? await executeHttpTool(toolDef, nextAction.input)
        : { error: "Tool definition missing." };
      const durationMs = Date.now() - toolStartedAt;
      const errorMessage = output.error ? String(output.error) : null;

      emitSseEvent(options.controller, options.encoder, {
        toolResult: {
          name: nextAction.toolName,
          success: !errorMessage,
          ...(errorMessage ? { errorMessage } : {}),
          output,
          ...(typeof output.httpStatus === "number"
            ? { httpStatus: output.httpStatus }
            : {}),
          duration: durationMs,
        },
      });

      const toolEvidence: PlannerToolEvidence = {
        toolName: nextAction.toolName,
        input: nextAction.input,
        output,
        error: errorMessage,
        success: !errorMessage,
        durationMs,
      };
      loopState.toolEvidence.push(toolEvidence);
      lastToolOutput = output;
      lastToolError = errorMessage;

      const matchedToolRow = options.enabledToolRows.find(
        (tool) => tool.name === nextAction.toolName,
      );
      if (matchedToolRow) {
        options.toolService
          .logExecution({
            toolId: matchedToolRow.id,
            conversationId: options.conversation.id,
            input: nextAction.input,
            output,
            status: errorMessage ? "error" : "success",
            httpStatus:
              typeof output.httpStatus === "number" ? output.httpStatus : null,
            duration: durationMs,
            errorMessage,
          })
          .catch((error) => {
            logError(
              "widget_turn.tool_execution_log_failed",
              error,
              options.buildLogContext({
                toolName: nextAction.toolName,
              }),
            );
          });
      }

      continue;
    }

    if (nextAction.type === "offer_handoff") {
      const fullResponse = buildHandoffOfferMessage({
        hasIssueContext: hasIssueContext(
          options.conversationHistory,
          options.currentMessage,
        ),
        agentLabel: options.settings.agentName ?? "the team",
      });

      loopState.handoffRequested = true;
      loopState.awaitingHandoffConfirmation = true;
      pushActionHistory(loopState, {
        type: "offer_handoff",
        reason: nextAction.reason,
        outcome: "completed",
        note: fullResponse,
      });
      loopState.finalDraft = fullResponse;
      loopState.terminationReason = nextAction.reason;
      emitSseEvent(options.controller, options.encoder, {
        finalText: fullResponse,
      });
      return {
        fullResponse,
        retrieval: loopState.docsEvidence,
        hadToolCalls,
        lastToolOutput,
        lastToolError,
        stepCount: loopState.stepCount,
        terminationAction: "offer_handoff",
        loopState,
      };
    }

    if (nextAction.type === "collect_contact") {
      const fullResponse = buildContactQuestion(nextAction.missingFields);
      loopState.handoffRequested = true;
      loopState.contactDeclined = false;
      loopState.awaitingContactFields = nextAction.missingFields;
      loopState.missingInputs = nextAction.missingFields;
      pushActionHistory(loopState, {
        type: "collect_contact",
        reason: nextAction.reason,
        outcome: "completed",
        note: fullResponse,
      });
      loopState.finalDraft = fullResponse;
      loopState.terminationReason = nextAction.reason;
      emitSseEvent(options.controller, options.encoder, {
        finalText: fullResponse,
      });
      return {
        fullResponse,
        retrieval: loopState.docsEvidence,
        hadToolCalls,
        lastToolOutput,
        lastToolError,
        stepCount: loopState.stepCount,
        terminationAction: "collect_contact",
        loopState,
      };
    }

    if (nextAction.type === "create_inquiry") {
      const teamRequestDecision = options.shouldAllowTeamRequest({
        retrievalAttempted: loopState.docsEvidence.retrievalAttempted,
        hadToolCalls,
      });

      if (!teamRequestDecision.allowed) {
        const fullResponse = `I don't have enough detail yet to escalate this usefully. ${buildUnsupportedFallback(
          options.currentMessage,
          options.turnPlan.intent,
        )}`;
        pushActionHistory(loopState, {
          type: "create_inquiry",
          reason: `${nextAction.reason} Blocked: ${teamRequestDecision.reason}.`,
          outcome: "rejected",
          note: fullResponse,
        });
        loopState.finalDraft = fullResponse;
        loopState.terminationReason = teamRequestDecision.reason;
        emitSseEvent(options.controller, options.encoder, {
          finalText: fullResponse,
        });
        return {
          fullResponse,
          retrieval: loopState.docsEvidence,
          hadToolCalls,
          lastToolOutput,
          lastToolError,
          stepCount: loopState.stepCount,
          terminationAction: "create_inquiry",
          loopState,
        };
      }

      const summary =
        loopState.handoffSummary ??
        (await buildTeamRequestSummary({
          modelRuntime: options.modelRuntime,
          conversationHistory: options.conversationHistory,
          buildLogContext: options.buildLogContext,
        }));
      loopState.handoffSummary = summary;
      loopState.handoffRequested = true;
      loopState.awaitingContactFields = [];
      options.closeSafeAiReplayWindow("team_request_mutation");
      let submission;
      try {
        const telegramService =
          options.settings.telegramBotToken && options.settings.telegramChatId
            ? new TelegramService(options.db)
            : undefined;

        submission = await createTeamRequestSubmission({
          chatService: options.chatService,
          widgetService: new WidgetService(options.db),
          projectService: options.projectService,
          telegramService,
          project: options.project,
          conversation: {
            id: options.conversation.id,
            visitorId: options.conversation.visitorId,
            visitorName: loopState.knownVisitorName,
            visitorEmail: loopState.knownVisitorEmail,
          },
          conversationHistory: options.conversationHistory,
          summary,
          email: loopState.knownVisitorEmail ?? "not provided",
          settings: options.settings,
          env: {
            BETTER_AUTH_URL: options.env.BETTER_AUTH_URL,
            RESEND_API_KEY: options.env.RESEND_API_KEY,
          },
          executionCtx: options.executionCtx,
        });
      } catch (error) {
        logError(
          "widget_turn.team_request_submission_failed",
          error,
          options.buildLogContext(),
        );
        const fullResponse =
          "I couldn't forward that to the team just now. I can keep helping here, or you can try again in a moment.";
        pushActionHistory(loopState, {
          type: "create_inquiry",
          reason: `${nextAction.reason} Submission failed.`,
          outcome: "rejected",
          note: fullResponse,
        });
        loopState.finalDraft = fullResponse;
        loopState.terminationReason = "team_request_submission_failed";
        emitSseEvent(options.controller, options.encoder, {
          finalText: fullResponse,
        });
        return {
          fullResponse,
          retrieval: loopState.docsEvidence,
          hadToolCalls,
          lastToolOutput,
          lastToolError,
          stepCount: loopState.stepCount,
          terminationAction: "create_inquiry",
          loopState,
        };
      }

      if (loopState.knownVisitorName || loopState.knownVisitorEmail) {
        await options.chatService.updateConversation(
          options.conversation.id,
          options.project.id,
          {
            visitorName: loopState.knownVisitorName ?? undefined,
            visitorEmail: loopState.knownVisitorEmail ?? undefined,
          },
        );
      }

      try {
        await options.chatService.updateConversationStatus(
          options.conversation.id,
          options.project.id,
          "waiting_agent",
        );
      } catch (error) {
        logError(
          "widget_turn.team_request_status_update_failed",
          error,
          options.buildLogContext(),
        );
      }

      if (submission.telegramThreadId) {
        await options.chatService.updateTelegramThreadId(
          options.conversation.id,
          options.project.id,
          submission.telegramThreadId,
        );
      }

      const agentLabel = options.settings.agentName ?? "a team member";
      const fullResponse = submission.created
        ? `I've forwarded this to the team. ${agentLabel} will follow up shortly!`
        : `I've already forwarded this conversation to the team. ${agentLabel} will continue the follow-up there.`;
      pushActionHistory(loopState, {
        type: "create_inquiry",
        reason: nextAction.reason,
        outcome: "completed",
        note: summary,
      });
      loopState.finalDraft = fullResponse;
      loopState.terminationReason = nextAction.reason;
      emitSseEvent(options.controller, options.encoder, { inquiry: true });
      emitSseEvent(options.controller, options.encoder, {
        finalText: fullResponse,
      });
      return {
        fullResponse,
        retrieval: loopState.docsEvidence,
        hadToolCalls,
        lastToolOutput,
        lastToolError,
        stepCount: loopState.stepCount,
        terminationAction: "create_inquiry",
        loopState,
      };
    }

    if (nextAction.type === "ask_user") {
      loopState.missingInputs = [];
      loopState.awaitingContactFields = [];
      pushActionHistory(loopState, {
        type: "ask_user",
        reason: nextAction.reason,
        outcome: "completed",
        note: nextAction.question,
      });
      loopState.finalDraft = nextAction.question;
      loopState.terminationReason = nextAction.reason;
      emitSseEvent(options.controller, options.encoder, {
        finalText: nextAction.question,
      });
      return {
        fullResponse: nextAction.question,
        retrieval: loopState.docsEvidence,
        hadToolCalls,
        lastToolOutput,
        lastToolError,
        stepCount: loopState.stepCount,
        terminationAction: "ask_user",
        loopState,
      };
    }

    if (nextAction.type === "compose") {
      pushActionHistory(loopState, {
        type: "compose",
        reason: nextAction.reason,
        outcome: "completed",
        note: nextAction.answerStyle ?? null,
      });

      const composeResult = await executeCompose({
        controller: options.controller,
        encoder: options.encoder,
        modelRuntime: options.modelRuntime,
        telemetry: options.telemetry,
        currentMessage: options.currentMessage,
        conversationHistory: options.conversationHistory,
        state: loopState,
        settings: options.settings,
        projectName: options.project.name,
        guidelines: options.guidelines,
        compiledFaqContext: options.compiledFaqContext,
        pageContext: options.pageContext,
        visitorInfo: options.visitorInfo,
        agentHandbackInstructions: options.agentHandbackInstructions,
        image: options.image,
        emitStatus: options.emitStatus,
        buildLogContext: options.buildLogContext,
        closeSafeAiReplayWindow: options.closeSafeAiReplayWindow,
      });

      loopState.finalDraft = composeResult.fullResponse;
      loopState.terminationReason = nextAction.reason;
      return {
        fullResponse: composeResult.fullResponse,
        retrieval: loopState.docsEvidence,
        hadToolCalls,
        lastToolOutput: composeResult.lastToolOutput,
        lastToolError: composeResult.lastToolError,
        stepCount: loopState.stepCount,
        terminationAction: "compose",
        loopState,
      };
    }

    pushActionHistory(loopState, {
      type: "stop",
      reason: nextAction.reason,
      outcome: "completed",
      note: null,
    });
    const fullResponse = buildStopResponse({
      currentMessage: options.currentMessage,
      turnPlan: options.turnPlan,
      state: loopState,
    });
    loopState.finalDraft = fullResponse;
    loopState.terminationReason = nextAction.reason;
    emitSseEvent(options.controller, options.encoder, {
      finalText: fullResponse,
    });
    return {
      fullResponse,
      retrieval: loopState.docsEvidence,
      hadToolCalls,
      lastToolOutput,
      lastToolError,
      stepCount: loopState.stepCount,
      terminationAction: "stop",
      loopState,
    };
  }

  const fullResponse = buildStopResponse({
    currentMessage: options.currentMessage,
    turnPlan: options.turnPlan,
    state: loopState,
  });
  loopState.finalDraft = fullResponse;
  loopState.terminationReason = "Planner step limit reached.";
  pushActionHistory(loopState, {
    type: "stop",
    reason: "Planner step limit reached.",
    outcome: "completed",
    note: null,
  });
  emitSseEvent(options.controller, options.encoder, {
    finalText: fullResponse,
  });

  return {
    fullResponse,
    retrieval: loopState.docsEvidence,
    hadToolCalls,
    lastToolOutput,
    lastToolError,
    stepCount: loopState.stepCount,
    terminationAction: "stop",
    loopState,
  };
}
