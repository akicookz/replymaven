// Routing pipeline used by the visitor-facing widget handler. Runs the
// parallel classify/summarize/select-FAQs probes, compiles the FAQ context,
// and returns everything the planner loop needs to start composing. Has no
// side effects beyond LLM calls and the KV-cached FAQ-context build.

import { type ConversationTurnMessage, type SupportTurnPlan } from "../types";
import {
  createLanguageModel,
  runWithModelFallback,
  type ModelRuntimeState,
} from "../llm/create-language-model";
import {
  classifySupportTurn,
  fallbackClassifySupportTurn,
  selectFaqSets,
  summarizeConversation,
} from "../llm/auxiliary-calls";
import {
  findBestFaqMatch,
  getOrBuildCompiledFaqContext,
} from "../prompt/build-compiled-faq-context";

interface FaqLikeResource {
  id: string;
  type: string;
  title: string;
  description: string | null;
  content: string | null;
  updatedAt: Date;
  status: string;
}

export interface TurnRoutingInput {
  modelRuntime: ModelRuntimeState;
  conversationHistory: ConversationTurnMessage[];
  currentMessage: string;
  pageContext?: Record<string, string>;
  // FAQ resources for the project (all types). Filtered/sorted internally.
  resources: FaqLikeResource[];
  kv: KVNamespace;
  projectId: string;
  executionCtx: ExecutionContext;
  // Hook so the visitor handler can record router latency in its telemetry.
  onRouterFinished?: (elapsedMs: number) => void;
  // Log-context builder for the calling handler.
  buildLogContext: (extra?: Record<string, unknown>) => Record<string, unknown>;
}

export interface TurnRoutingResult {
  turnPlan: SupportTurnPlan;
  conversationSummary: string | null;
  compiledFaqContext: string;
  faqMatchHint: { question: string; answer: string; score: number } | null;
  selectedFaqSetIds: string[];
  selectorOutcome: "none_available" | "single" | "selected" | "failed";
  sortedFaqResources: FaqLikeResource[];
  hasIndexedResources: boolean;
}

type FaqSelection =
  | { outcome: "none_available" }
  | { outcome: "single"; ids: string[] }
  | { outcome: "selected"; ids: string[] }
  | { outcome: "failed" };

export async function prepareTurnRouting(
  input: TurnRoutingInput,
): Promise<TurnRoutingResult> {
  const sortedFaqResources = input.resources
    .filter((r) => r.type === "faq")
    .sort((left, right) => left.title.localeCompare(right.title));
  const hasIndexedResources = input.resources.some(
    (r) => r.status === "indexed",
  );

  const faqMatchHint = findBestFaqMatch(
    sortedFaqResources.map((r) => ({ title: r.title, content: r.content })),
    input.currentMessage,
  );

  const classifyStartedAt = Date.now();
  const [turnPlan, conversationSummary, faqSelection] = await Promise.all([
    runWithModelFallback({
      runtime: input.modelRuntime,
      stage: "classify_support_turn",
      logContext: input.buildLogContext(),
      operation: async (cfg) =>
        classifySupportTurn(
          createLanguageModel(cfg),
          input.conversationHistory,
          input.currentMessage,
          input.pageContext,
          { throwOnModelError: true },
        ),
    }).catch(() => fallbackClassifySupportTurn(input.currentMessage)),
    runWithModelFallback({
      runtime: input.modelRuntime,
      stage: "summarize_conversation",
      logContext: input.buildLogContext(),
      operation: async (cfg) =>
        summarizeConversation(
          createLanguageModel(cfg),
          input.conversationHistory,
          { throwOnModelError: true },
        ),
    }).catch(() => null),
    (async (): Promise<FaqSelection> => {
      if (sortedFaqResources.length === 0)
        return { outcome: "none_available" };
      if (sortedFaqResources.length === 1)
        return { outcome: "single", ids: [sortedFaqResources[0].id] };
      try {
        const ids = await runWithModelFallback({
          runtime: input.modelRuntime,
          stage: "select_faq_sets",
          logContext: input.buildLogContext(),
          operation: async (cfg) =>
            selectFaqSets(
              createLanguageModel(cfg),
              {
                conversationHistory: input.conversationHistory,
                currentMessage: input.currentMessage,
                pageContext: input.pageContext,
                faqSets: sortedFaqResources.map((r) => ({
                  id: r.id,
                  title: r.title,
                  description: r.description,
                })),
              },
              { throwOnModelError: true },
            ),
        });
        return { outcome: "selected", ids };
      } catch {
        return { outcome: "failed" };
      }
    })(),
  ]);
  input.onRouterFinished?.(Date.now() - classifyStartedAt);

  // Fail-open: when the selector errored (not "returned empty"), include all
  // FAQ sets so the model still has tier-1 context. The compile budget keeps
  // prompt size bounded.
  const selectedFaqResources =
    faqSelection.outcome === "failed"
      ? sortedFaqResources
      : faqSelection.outcome === "none_available"
        ? []
        : sortedFaqResources.filter((r) => faqSelection.ids.includes(r.id));
  const selectedFaqSetIds =
    faqSelection.outcome === "failed"
      ? sortedFaqResources.map((r) => r.id)
      : faqSelection.outcome === "none_available"
        ? []
        : faqSelection.ids;

  const compiledFaqContext = await getOrBuildCompiledFaqContext({
    kv: input.kv,
    projectId: input.projectId,
    fingerprintResources: selectedFaqResources.map((r) => ({
      id: r.id,
      updatedAt: r.updatedAt,
      content: r.content,
    })),
    faqResources: selectedFaqResources.map((r) => ({
      title: r.title,
      content: r.content,
    })),
    executionCtx: input.executionCtx,
  });

  return {
    turnPlan,
    conversationSummary,
    compiledFaqContext,
    faqMatchHint,
    selectedFaqSetIds,
    selectorOutcome: faqSelection.outcome,
    sortedFaqResources,
    hasIndexedResources,
  };
}
