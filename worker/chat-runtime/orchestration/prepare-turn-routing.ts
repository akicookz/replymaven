// Routing pipeline used by the visitor-facing widget handler. Runs the
// parallel summarize/select-FAQs probes and compiles the FAQ context. Turn
// classification lives in the planner's first step (plan-next-action.ts) —
// there is deliberately no separate classifier here. Has no side effects
// beyond LLM calls and the KV-cached FAQ-context build.

import { type ConversationTurnMessage } from "../types";
import {
  createLanguageModel,
  runWithModelFallback,
  type ModelRuntimeState,
} from "../llm/create-language-model";
import {
  selectFaqSets,
  summarizeConversation,
} from "../llm/auxiliary-calls";
import {
  getOrBuildCompiledFaqContext,
  type FaqMatchResult,
} from "../prompt/build-compiled-faq-context";
import { withCurrentTurn } from "./normalize-history";

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
  sortedFaqResources: FaqLikeResource[];
  faqMatchHint: FaqMatchResult | null;
  hasIndexedResources: boolean;
  kv: KVNamespace;
  projectId: string;
  executionCtx: ExecutionContext;
  // Hook so the visitor handler can record router latency in its telemetry.
  onRouterFinished?: (elapsedMs: number) => void;
  // Log-context builder for the calling handler.
  buildLogContext: (extra?: Record<string, unknown>) => Record<string, unknown>;
}

export interface TurnRoutingResult {
  conversationSummary: string | null;
  compiledFaqContext: string;
  faqMatchHint: FaqMatchResult | null;
  selectedFaqSetIds: string[];
  selectorOutcome:
    | "none_available"
    | "single"
    | "selected"
    | "failed"
    | "fast_path";
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
  const sortedFaqResources = input.sortedFaqResources;
  const faqMatchHint = input.faqMatchHint;

  const routingStartedAt = Date.now();
  const [conversationSummary, faqSelection] = await Promise.all([
    runWithModelFallback({
      runtime: input.modelRuntime,
      stage: "summarize_conversation",
      logContext: input.buildLogContext(),
      operation: async (cfg) =>
        summarizeConversation(
          createLanguageModel(cfg),
          withCurrentTurn(input.conversationHistory, input.currentMessage),
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
  input.onRouterFinished?.(Date.now() - routingStartedAt);

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
    conversationSummary,
    compiledFaqContext,
    faqMatchHint,
    selectedFaqSetIds,
    selectorOutcome: faqSelection.outcome,
    sortedFaqResources,
    hasIndexedResources: input.hasIndexedResources,
  };
}
