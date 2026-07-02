// Planner-loop runner used by the visitor-facing widget handler
// (`handle-widget-message-turn`). Owns the planner-loop invocation and the
// capability-claim post-filter. Persistence, broadcasts, the final `done`
// SSE frame, and other post-processing (like `[RESOLVED]` conversation
// close) stay in the outer handler because they depend on handler-specific
// state and ordering.

import { runPlannerLoop } from "../executor/run-planner-loop";
import {
  type BuildSystemPromptFn,
} from "../executor/run-planner-loop";
import { emitSseEvent } from "../streaming/map-agent-events-to-sse";
import { type InternalToken } from "../streaming/internal-tokens";
import {
  type ConversationTurnMessage,
  type SupportIntent,
  type SupportPromptSettings,
  type SupportToolDefinition,
  type TurnTelemetry,
} from "../types";
import { type RetrievalResult } from "../retrieval/run-ai-search";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { ChatService } from "../../services/chat-service";
import { ProjectService } from "../../services/project-service";
import { ToolService } from "../../services/tool-service";
import { type AppEnv } from "../../types";
import { type ToolRow } from "../../db";
import { type ModelRuntimeState } from "../llm/create-language-model";

// Final post-filter: if the model claims it browsed the web / used unassigned
// tools, replace the response with a canned safety string — the visitor bot
// has no such capability and must not claim otherwise.
function claimsUnavailableCapabilities(response: string): boolean {
  if (!response.trim()) return false;
  return (
    /\b(i|i've|i have|i was able to)\b[^.!?\n]{0,100}\b(search(?:ed)?|browse(?:d)?|looked up|found|checked)\b[^.!?\n]{0,100}\b(web|internet|online|google|browser)\b/i.test(
      response,
    ) ||
    /\baccording to google\b/i.test(response) ||
    /\bi found (this|that|it) online\b/i.test(response) ||
    /\bi checked the internet\b/i.test(response)
  );
}

export interface AgenticTurnInput {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  modelRuntime: ModelRuntimeState;
  telemetry: TurnTelemetry;
  currentMessage: string;
  pageContext?: Record<string, string>;
  conversationHistory: ConversationTurnMessage[];
  conversationSummary: string | null;
  compiledFaqContext: string;
  faqMatchHint?: { question: string; answer: string; score: number } | null;
  availableTools: SupportToolDefinition[];
  enabledToolRows: ToolRow[];
  toolService: ToolService;
  chatService: ChatService;
  projectService: ProjectService;
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
  executionCtx: ExecutionContext;
  project: { id: string; name: string };
  conversation: {
    id: string;
    visitorId: string | null;
    visitorName: string | null;
    visitorEmail: string | null;
    status: string;
    metadata: string | null | undefined;
    telegramThreadId?: string | null;
  };
  settings: SupportPromptSettings & {
    companyName?: string | null;
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
  };
  guidelines: Array<{ condition: string; instruction: string }>;
  hasIndexedResources: boolean;
  visitorInfo: { name: string | null; email: string | null };
  // Escalation continuity from the prior turn's persisted chat_state.
  persistedContactState?: {
    awaitingContactFields: Array<"name" | "email">;
    awaitingHandoffConfirmation: boolean;
    contactDeclined: boolean;
  };
  // Clarify continuity from the prior turn's persisted chat_state.
  persistedClarifyState?: {
    clarificationAttempts: number;
    lastBotQuestion: string | null;
  };
  agentHandbackInstructions?: string | null;
  image?: { base64: string; mimeType: string } | null;
  emitStatus: (
    message: string,
    phase: "thinking" | "retrieval" | "tool" | "verify" | "compose",
  ) => void;
  closeSafeAiReplayWindow: (reason: string) => void;
  // Audience-specific planner gate and prompt builder.
  shouldAllowEscalation: () => { allowed: boolean; reason: string };
  buildSystemPrompt?: BuildSystemPromptFn;
  buildLogContext: (extra?: Record<string, unknown>) => Record<string, unknown>;
}

export interface AgenticTurnResult {
  fullResponse: string;
  retrieval: RetrievalResult;
  detectedInternalTokens: InternalToken[];
  hadToolCalls: boolean;
  lastToolOutput: unknown;
  lastToolError: string | null;
  stepCount: number;
  terminationAction: string;
  // Classification the planner recorded on its first decision this turn.
  turnIntent: SupportIntent | null;
  // Capability-filter substitution happened — caller may want to skip
  // post-processing like [RESOLVED] handling.
  capabilityFallbackApplied: boolean;
  // Post-loop escalation state to persist into chat_state for the next turn.
  awaitingContactFields: Array<"name" | "email">;
  awaitingHandoffConfirmation: boolean;
  contactDeclined: boolean;
}

// Runs the planner loop and applies the capability-claim post-filter. Does
// NOT persist, broadcast, or emit the final `done` SSE frame — those are
// audience-specific. The caller decides ordering of [RESOLVED] handling,
// persistence, broadcast, and final SSE event.
export async function runAgenticTurn(
  input: AgenticTurnInput,
): Promise<AgenticTurnResult> {
  const loopStartedAt = Date.now();
  const loopResult = await runPlannerLoop({
    controller: input.controller,
    encoder: input.encoder,
    modelRuntime: input.modelRuntime,
    telemetry: input.telemetry,
    currentMessage: input.currentMessage,
    pageContext: input.pageContext,
    conversationHistory: input.conversationHistory,
    conversationSummary: input.conversationSummary,
    availableTools: input.availableTools,
    enabledToolRows: input.enabledToolRows,
    toolService: input.toolService,
    chatService: input.chatService,
    projectService: input.projectService,
    db: input.db,
    env: input.env,
    executionCtx: input.executionCtx,
    project: input.project,
    conversation: input.conversation,
    settings: input.settings,
    guidelines: input.guidelines,
    compiledFaqContext: input.compiledFaqContext,
    hasIndexedResources: input.hasIndexedResources,
    visitorInfo: input.visitorInfo,
    persistedContactState: input.persistedContactState,
    persistedClarifyState: input.persistedClarifyState,
    agentHandbackInstructions: input.agentHandbackInstructions,
    image: input.image,
    faqMatchHint: input.faqMatchHint,
    emitStatus: input.emitStatus,
    shouldAllowEscalation: input.shouldAllowEscalation,
    closeSafeAiReplayWindow: input.closeSafeAiReplayWindow,
    buildLogContext: input.buildLogContext,
    buildSystemPrompt: input.buildSystemPrompt,
  });
  input.telemetry.loopMs = Date.now() - loopStartedAt;

  let fullResponse = loopResult.fullResponse;
  let capabilityFallbackApplied = false;
  if (claimsUnavailableCapabilities(fullResponse)) {
    const capabilityFallback =
      "I can't browse the web or use unassigned tools here. I can only help with this product or website using the provided documentation and any assigned support tools.";
    if (capabilityFallback !== fullResponse.trim()) {
      fullResponse = capabilityFallback;
      capabilityFallbackApplied = true;
      emitSseEvent(input.controller, input.encoder, {
        finalText: fullResponse,
      });
    }
  }

  return {
    fullResponse,
    retrieval: loopResult.retrieval,
    detectedInternalTokens: loopResult.detectedInternalTokens,
    hadToolCalls: loopResult.hadToolCalls,
    lastToolOutput: loopResult.lastToolOutput,
    lastToolError: loopResult.lastToolError,
    stepCount: loopResult.stepCount,
    terminationAction: loopResult.terminationAction,
    turnIntent: loopResult.loopState.intent,
    capabilityFallbackApplied,
    awaitingContactFields: loopResult.loopState.awaitingContactFields,
    awaitingHandoffConfirmation:
      loopResult.loopState.awaitingHandoffConfirmation,
    contactDeclined: loopResult.loopState.contactDeclined,
  };
}
