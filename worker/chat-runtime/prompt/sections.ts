// Reusable prompt-section builders shared across system prompts (currently the
// visitor-facing support prompt). Each builder returns a string that already
// contains the section's trailing blank line, or "" if the section doesn't
// apply for the given inputs. Callers concatenate the returned strings.
//
// The output of these helpers is verified byte-identical to the pre-refactor
// inline blocks in build-support-system-prompt.ts via the existing
// build-support-system-prompt.test.ts snapshots.

import {
  type GroundingConfidence,
  type SupportIntent,
  type PlannerActionHistoryEntry,
} from "../types";

export const MAX_RAG_CONTEXT_CHARS = 30_000;
export const MAX_COMPANY_CONTEXT_CHARS = 4_000;
export const MAX_FAQ_CONTEXT_CHARS = 22_000;
export const MAX_TOOL_EVIDENCE_CHARS = 4_000;
export const MAX_CONVERSATION_SUMMARY_CHARS = 2_000;

export function trimToCharBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return text.slice(0, budget) + "\n[...truncated]";
}

// ─── Company background ─────────────────────────────────────────────────────

export function buildCompanySection(
  projectName: string,
  companyContext: string | null | undefined,
): string {
  if (!companyContext) return "";
  return `<about-the-company>
This is general background about ${projectName}. Use it to understand what the business does, what products or services it offers, and who its customers are. This helps you give informed answers when the knowledge base doesn't cover a specific topic.

${trimToCharBudget(companyContext, MAX_COMPANY_CONTEXT_CHARS)}
</about-the-company>

`;
}

// ─── Guidelines (SOPs) ──────────────────────────────────────────────────────

export function buildGuidelinesSection(
  projectName: string,
  guidelines: Array<{ condition: string; instruction: string }> | undefined,
): string {
  if (!guidelines || guidelines.length === 0) return "";
  const guidelineEntries = guidelines
    .map(
      (guideline) =>
        `- When: ${guideline.condition}\n  Then: ${guideline.instruction}`,
    )
    .join("\n\n");
  return `<guidelines>
These are specific standard operating procedures from the ${projectName} team. When a visitor's question matches one of these scenarios, follow the corresponding instructions precisely. These take priority over general response rules.

${guidelineEntries}
</guidelines>

`;
}

// ─── Page context ───────────────────────────────────────────────────────────

export function buildPageContextSection(
  pageContext: Record<string, string> | undefined,
): string {
  if (!pageContext || Object.keys(pageContext).length === 0) return "";
  const contextLines = Object.entries(pageContext)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `<page-context>
The visitor is currently viewing the following page/section. Use this to give contextually relevant answers.

${contextLines}
</page-context>

`;
}

// ─── Visitor info ───────────────────────────────────────────────────────────

export function buildVisitorInfoSection(
  visitorInfo: { name: string | null; email: string | null } | undefined,
): string {
  if (!visitorInfo) return "";
  const nameStr = visitorInfo.name ?? "unknown";
  const emailStr = visitorInfo.email ?? "unknown";
  return `<visitor-info>
The visitor's known contact information. Treat this as context only.

- Do not ask for contact details unless a required runtime-controlled follow-up flow clearly needs them.
- Do not invent contact details or say you collected them unless they are present here.

Name: ${nameStr}
Email: ${emailStr}
</visitor-info>

`;
}

// ─── Planner loop state ─────────────────────────────────────────────────────

export function buildPlannerLoopSection(
  turnPlan:
    | {
        intent: SupportIntent;
        summary: string;
        followUpQuestion?: string | null;
      }
    | null
    | undefined,
  plannerGoal: string | null | undefined,
  plannerActionHistory: PlannerActionHistoryEntry[] | undefined,
): string {
  if (
    !turnPlan &&
    !plannerGoal &&
    (!plannerActionHistory || plannerActionHistory.length === 0)
  ) {
    return "";
  }
  const plannerHistory =
    plannerActionHistory && plannerActionHistory.length > 0
      ? plannerActionHistory
          .map((entry, index) => {
            return `${index + 1}. ${entry.type}: ${entry.reason}${entry.note ? ` (${entry.note})` : ""}`;
          })
          .join("\n")
      : "No prior planner actions.";

  return `<planner-loop>
Support intent: ${turnPlan?.intent ?? "unknown"}
Planner goal: ${plannerGoal ?? turnPlan?.summary ?? "unknown"}
${turnPlan?.followUpQuestion ? `Focused follow-up if needed: ${turnPlan.followUpQuestion}` : ""}
Action history:
${plannerHistory}
</planner-loop>

`;
}

// ─── Priority FAQ direct match ──────────────────────────────────────────────

export function buildFaqMatchSection(
  faqMatchHint:
    | { question: string; answer: string; score: number }
    | null
    | undefined,
): string {
  if (!faqMatchHint) return "";
  return `<priority-faq-match>
The visitor's current question closely matches a curated FAQ below (tier-1, match score ${faqMatchHint.score.toFixed(2)}). Use this answer directly unless the visitor's latest turn makes it clearly inapplicable. Do not claim the documentation lacks this information.

Q: ${faqMatchHint.question}
A: ${faqMatchHint.answer}
</priority-faq-match>

`;
}

// ─── Priority FAQs (compiled) ───────────────────────────────────────────────

export function buildFaqContextSection(
  faqContext: string | null | undefined,
): string {
  if (!faqContext) return "";
  return `<priority-faqs>
These are the project's compiled FAQ entries. They are tier-1 knowledge because they are usually curated directly by the team. Check them before relying on lower-tier retrieved context. Prefer these answers when they directly address the visitor's question.

${trimToCharBudget(faqContext, MAX_FAQ_CONTEXT_CHARS)}
</priority-faqs>

`;
}

// ─── Knowledge base (RAG) ───────────────────────────────────────────────────

export function buildKnowledgeBaseSection(ragContext: string): string {
  if (!ragContext) return "";
  return `<knowledge-base>
These are lower-tier retrieved excerpts from webpages, PDFs, and other documentation for the visitor's current question. Use them after checking SOPs and priority FAQs first. Each source includes a relevance percentage. Prioritize high-relevance sources. Ignore sources that clearly don't address the visitor's question.

${trimToCharBudget(ragContext, MAX_RAG_CONTEXT_CHARS)}
</knowledge-base>

`;
}

// ─── Grounding status ───────────────────────────────────────────────────────

export function buildGroundingStatusSection(options: {
  retrievalAttempted: boolean | undefined;
  broaderSearchAttempted: boolean | undefined;
  groundingConfidence: GroundingConfidence | undefined;
  topScore: number | undefined;
  hasTier1Evidence: boolean;
}): string {
  if (!options.retrievalAttempted) return "";

  const score = options.topScore ?? 0;
  const confidence = options.groundingConfidence ?? "none";
  const { hasTier1Evidence, broaderSearchAttempted } = options;

  if (!hasTier1Evidence && confidence === "none") {
    return `<grounding-status>
No relevant documentation was found for this question (relevance: ${score.toFixed(2)}).
${broaderSearchAttempted ? "A broader follow-up search was also attempted with no results.\n" : ""}
Confidence tier: NONE — You have no evidence to work with.
- Clearly convey that you could not find information about this topic in the documentation. Use your own words and match the configured tone.
- Do not provide suggestions or workarounds that are not explicitly documented.
- Offer to forward the question to the team for a proper answer.
- Do not turn missing grounding into a human handoff promise. Runtime owns escalation state.
</grounding-status>

`;
  }
  if (!hasTier1Evidence && confidence === "low") {
    return `<grounding-status>
Documentation retrieval returned only weak or partial matches (relevance: ${score.toFixed(2)}).

Confidence tier: LOW — You have some evidence but it may not directly answer the question.
- Naturally communicate that your answer is based on limited documentation. Use your own words and match the configured tone — do not use a scripted phrase.
- Use only explicit facts from the retrieved excerpts. Do not fill gaps with assumptions.
- If the excerpts do not directly answer the question, say so honestly.
</grounding-status>

`;
  }
  if (!hasTier1Evidence && confidence === "high" && score < 0.8) {
    return `<grounding-status>
Documentation retrieval found relevant matches (relevance: ${score.toFixed(2)}).

Confidence tier: MODERATE — Evidence is relevant but not a strong direct match.
- Naturally signal that your answer is drawn from the documentation without being fully certain. Use your own words and match the configured tone.
- Stick closely to the retrieved excerpts. Do not embellish or add details not present in the evidence.
</grounding-status>

`;
  }
  return "";
}

// ─── Tool evidence ──────────────────────────────────────────────────────────

export function buildToolEvidenceSection(
  toolEvidenceSummary: string | null | undefined,
): string {
  if (!toolEvidenceSummary) return "";
  return `<tool-evidence>
These are results from support tools already executed for this visitor. Treat them as evidence.

${trimToCharBudget(toolEvidenceSummary, MAX_TOOL_EVIDENCE_CHARS)}
</tool-evidence>

`;
}

// ─── Conversation summary ───────────────────────────────────────────────────

export function buildConversationSummarySection(
  conversationSummary: string | null,
): string {
  if (!conversationSummary) return "";
  return `<conversation-summary>
This is a summary of the conversation so far. Use it to stay on topic and avoid repeating information already covered.

${trimToCharBudget(conversationSummary, MAX_CONVERSATION_SUMMARY_CHARS)}
</conversation-summary>

`;
}
