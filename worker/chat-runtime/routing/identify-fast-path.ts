import { detectSmallTalk } from "../planner/small-talk";
import { type FaqMatchResult } from "../prompt/build-compiled-faq-context";
import {
  type AiParticipation,
  type FastPathDecision,
} from "../types";
import { type TaskScopeDecision } from "../workflows/classify-task-scope";

interface IdentifyFastPathInput {
  message: string;
  scopeDecision: TaskScopeDecision | null;
  faqMatch: FaqMatchResult | null;
  hasPendingWorkflow?: boolean;
  hasImage?: boolean;
  hasPriorityInstructions?: boolean;
}

export type HardGateDecision = "muted" | "agent_mode" | null;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseVisitorAiInvocation(
  message: string,
  botName: string | null | undefined,
): { invoked: boolean; content: string } {
  const normalizedBotName = botName?.trim();
  if (!normalizedBotName) return { invoked: false, content: message };

  const mention = new RegExp(
    `^@${escapeRegExp(normalizedBotName)}(?:\\s+|[,:]\\s*|$)`,
    "i",
  );
  if (!mention.test(message)) return { invoked: false, content: message };

  const content = message.replace(mention, "").trim();
  if (!content) return { invoked: false, content: message };

  return { invoked: true, content };
}

export function identifyHardGate(input: {
  status: string;
  closeReason: string | null;
  aiParticipation?: AiParticipation;
  aiInvoked?: boolean;
}): HardGateDecision {
  if (input.closeReason === "spam") return "muted";
  if (input.aiParticipation === "human_only") {
    return input.aiInvoked ? null : "agent_mode";
  }
  if (input.status === "waiting_agent" || input.status === "agent_replied") {
    if (input.aiParticipation === "assist_until_agent") return null;
    return "agent_mode";
  }
  return null;
}

export function identifyFastPath(
  input: IdentifyFastPathInput,
): FastPathDecision | null {
  if (
    input.scopeDecision &&
    input.scopeDecision.kind !== "in_scope_support"
  ) {
    return {
      kind: "scope_blocked",
      reason: input.scopeDecision.reason,
      response:
        input.scopeDecision.response ??
        "I can only help with this product, website, and support-related questions here.",
    };
  }

  if (input.hasPendingWorkflow || input.hasImage) return null;

  const smallTalkKind = detectSmallTalk(input.message);
  if (smallTalkKind) {
    return {
      kind: "small_talk",
      reason:
        smallTalkKind === "greeting" ? "pure_greeting" : "pure_resolution",
      composeKind: smallTalkKind,
    };
  }

  if (!input.faqMatch?.authoritative || input.hasPriorityInstructions) {
    return null;
  }

  return {
    kind: "authoritative_faq",
    reason:
      input.faqMatch.matchKind === "exact"
        ? "exact_faq"
        : "high_coverage_faq",
    faq: {
      question: input.faqMatch.question,
      answer: input.faqMatch.answer,
      score: input.faqMatch.score,
    },
  };
}
