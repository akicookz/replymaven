import { type DrizzleD1Database } from "drizzle-orm/d1";
import { type ToolRow } from "../../db";
import { logError, logWarn } from "../../observability";
import { type ToolService } from "../../services/tool-service";
import { type AppEnv } from "../../types";
import { buildSupportSystemPrompt } from "../prompt/build-support-system-prompt";
import {
  createLanguageModel,
  runWithModelFallback,
  type ModelRuntimeState,
} from "../llm/create-language-model";
import { reformulateQuery } from "../llm/auxiliary-calls";
import {
  planNextAction,
  fallbackPlanNextAction,
  sanitizePlannerDecision,
} from "../planner/plan-next-action";
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

const MAX_PLANNER_STEPS = 5;

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
  db: DrizzleD1Database<Record<string, unknown>>;
  env: Pick<AppEnv, "AI" | "UPLOADS">;
  project: {
    id: string;
    name: string;
  };
  conversationId: string;
  settings: SupportPromptSettings;
  guidelines: Array<{ condition: string; instruction: string }>;
  visitorInfo: { name: string | null; email: string | null };
  agentHandbackInstructions?: string | null;
  image?: { base64: string; mimeType: string } | null;
  emitStatus: (
    message: string,
    phase: "retrieval" | "tool" | "verify" | "compose",
  ) => void;
  closeSafeAiReplayWindow: (reason: string) => void;
  buildLogContext: (extra?: Record<string, unknown>) => Record<string, unknown>;
}

function createEmptyPlannerDocsEvidence(): PlannerDocsEvidence {
  return {
    ragContext: "",
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
  const sourceMap = new Map<string, PlannerDocsEvidence["sourceReferences"][number]>();

  for (const source of current.sourceReferences) {
    sourceMap.set(getSourceReferenceDedupKey(source), source);
  }

  for (const source of next.sourceReferences) {
    sourceMap.set(getSourceReferenceDedupKey(source), source);
  }

  const groundingConfidence =
    current.groundingConfidence === "high" || next.groundingConfidence === "high"
      ? "high"
      : current.groundingConfidence === "low" || next.groundingConfidence === "low"
        ? "low"
        : "none";

  return {
    ragContext: mergeRagContextBlocks(current.ragContext, next.ragContext),
    sourceReferences: [...sourceMap.values()],
    groundingConfidence,
    unresolvedKeys: [...new Set([...current.unresolvedKeys, ...next.unresolvedKeys])],
    droppedCrossTenant: current.droppedCrossTenant + next.droppedCrossTenant,
    retrievalAttempted: current.retrievalAttempted || next.retrievalAttempted,
    broaderSearchAttempted:
      current.broaderSearchAttempted || next.broaderSearchAttempted,
    queries: [...new Set([...current.queries, ...queries])],
    broaderQueries: [...new Set([...current.broaderQueries, ...broaderQueries])],
  };
}

function summarizeToolEvidence(toolEvidence: PlannerToolEvidence[]): string | null {
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
    finalDraft: null,
    terminationReason: null,
  };
}

function pushActionHistory(
  state: PlannerLoopState,
  entry: PlannerActionHistoryEntry,
): void {
  state.actionHistory.push(entry);
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

function buildStopResponse(options: {
  currentMessage: string;
  turnPlan: SupportTurnPlan;
  state: PlannerLoopState;
}): string {
  if (options.state.docsEvidence.ragContext.trim() || options.state.toolEvidence.length > 0) {
    return "I've reached the end of the reliable checks I can do here. If you want, I can summarize what I found so far or you can share one more concrete detail and I'll try again.";
  }

  return options.turnPlan.followUpQuestion
    ? `${buildUnsupportedFallback(options.currentMessage)} ${options.turnPlan.followUpQuestion}`.trim()
    : buildUnsupportedFallback(options.currentMessage);
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
    options.state.docsEvidence.ragContext,
    options.state.conversationSummary,
    {
      hasTools: false,
      guidelines: options.guidelines,
      agentHandbackInstructions: options.agentHandbackInstructions,
      pageContext: options.pageContext,
      visitorInfo: options.visitorInfo,
      groundingConfidence: options.state.docsEvidence.groundingConfidence,
      needsClarification: false,
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
    emitSseEvent(options.controller, options.encoder, { finalText: fullResponse });
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
      emitSseEvent(options.controller, options.encoder, { finalText: fullResponse });
    }
  }

  if (
    !fullResponse.includes("[NEW_INQUIRY]") &&
    !fullResponse.includes("[RESOLVED]")
  ) {
    const strippedResponse = stripTrailingSolicitedFollowUp(fullResponse);
    if (strippedResponse !== fullResponse.trim()) {
      fullResponse = strippedResponse;
      emitSseEvent(options.controller, options.encoder, { finalText: fullResponse });
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
  );
  let lastToolOutput: unknown = null;
  let lastToolError: string | null = null;
  let hadToolCalls = false;

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
            conversationId: options.conversationId,
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

    if (nextAction.type === "ask_user") {
      pushActionHistory(loopState, {
        type: "ask_user",
        reason: nextAction.reason,
        outcome: "completed",
        note: nextAction.question,
      });
      loopState.finalDraft = nextAction.question;
      loopState.terminationReason = nextAction.reason;
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
