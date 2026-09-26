// Reusable prompt-section builders shared across system prompts (currently the
// visitor-facing support prompt). Each builder returns a string that already
// contains the section's trailing blank line, or "" if the section doesn't
// apply for the given inputs. Callers concatenate the returned strings.
//
// The output of these helpers is verified byte-identical to the pre-refactor
// inline blocks in build-support-system-prompt.ts via the existing
// build-support-system-prompt.test.ts snapshots.

import {
  type ConversationTurnMessage,
  type GroundingConfidence,
  type SupportTurnContext,
} from "../types";
import {
  formatGapLabel,
  formatZonedTime,
  resolveTimeZone,
  toMessageTimestampMs,
  TRANSCRIPT_GAP_THRESHOLD_MS,
  zonedDayKey,
  zonedWeekday,
} from "./format-transcript";

export const MAX_RAG_CONTEXT_CHARS = 30_000;
const MAX_COMPANY_CONTEXT_CHARS = 4_000;
const MAX_FAQ_CONTEXT_CHARS = 22_000;
const MAX_TOOL_EVIDENCE_CHARS = 4_000;
const MAX_CONVERSATION_SUMMARY_CHARS = 2_000;

export function trimToCharBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return text.slice(0, budget) + "\n[...truncated]";
}

const GREETING_RULES = `Greeting:
- Decide for yourself whether to open with a greeting, the way a person would. Read <time-context> and your own earlier messages in this conversation before you choose.
- A sitting is one continuous stretch of talking. It has ended, and this message starts a new one, whenever <time-context> says the previous message was on a different local day for the visitor, or that it was several hours or more ago.
- Greet once at the start of a sitting: on the first message of a new conversation, and on the visitor's first message of a new sitting.
- If the visitor's message opens with a greeting of its own ("hi", "morning", "hey again"), mirror it back in a few words before anything else, whatever the timing says. Leaving a greeting unanswered reads as cold.
- Within a sitting, never greet again. If your own previous message already greeted and the talk has continued since, go straight to the substance.
- A new sitting resets that. Greeting again is correct even though you greeted earlier in this same conversation, and skipping it there reads as cold. Keep the second one shorter, like picking a thread back up rather than meeting someone.
- Keep any greeting to a few words in the visitor's language, then go straight into the answer. A greeting is never the whole message.
- When you greet and <visitor-info> carries a usable name, use the first name only, once, inside the greeting itself. Never use the full name, and never repeat the name later in the same message.
- Skip the name when it is not a plain personal name: an email address, a login handle, a company name, or a placeholder.`;

function buildContactSupportRules(timingMessage: string | null): string {
  const timingRule = timingMessage?.trim()
    ? `Base the reply time on this, restated in your own words and the visitor's language: "${timingMessage.trim()}" Keep its meaning and any times intact. Do not add a time it does not state.`
    : "Do not give a reply time. None is configured for today.";
  return `This turn answers a contact form submission. Handle it like any other message, with one addition:
- Open with one short line, in your own words, that their message reached the team and when the team usually replies if they still need them. ${timingRule}
- Then help as you would in chat. If the request needs something you cannot do, or you are not sure, use request_team_help as usual.`;
}

export function buildSupportTurnSection(
  turnContext: SupportTurnContext | null | undefined,
): string {
  if (!turnContext) return "";

  const blocks = [GREETING_RULES];
  if (turnContext.kind === "contact_support") {
    blocks.push(
      buildContactSupportRules(turnContext.contactTimingMessage ?? null),
    );
  }
  blocks.push(`Work collaboratively toward a resolution now, even when a human follow-up is pending:
- Use the conversation, page context, documentation, FAQs, guidelines, and assigned tools before requesting more information.
- When the evidence is sufficient, lead with the strongest evidence-backed explanation of the likely cause and give concrete steps.
- When the evidence is partial, state the strongest supported hypothesis and ask one focused question that distinguishes it from the next plausible cause.
- When essential context is missing, ask for the exact screenshot, value, error text, URL, account state, or reproduction step needed to continue. Ask no more than one focused question in a turn.
- Do not pad the opening. No review preamble, and never say that you reviewed or analyzed what the visitor shared. Once any greeting is done, go straight into the substance.
- Do not use em dashes.`);

  return `<support-turn>
${blocks.join("\n\n")}
</support-turn>

`;
}

// ─── Company background ─────────────────────────────────────────────────────

export function buildCompanySection(
  projectName: string,
  companyContext: string | null | undefined,
  availability?: {
    workingHours?: string | null;
    avgResponseTime?: string | null;
  },
): string {
  const workingHours = availability?.workingHours?.trim();
  const avgResponseTime = availability?.avgResponseTime?.trim();
  if (!companyContext && !workingHours && !avgResponseTime) return "";

  let section = `<about-the-company>
This is general background about ${projectName}. Use it to understand what the business does, what products or services it offers, and who its customers are. This helps you give informed answers when the knowledge base doesn't cover a specific topic.
`;
  if (companyContext) {
    section += `\n${trimToCharBudget(companyContext, MAX_COMPANY_CONTEXT_CHARS)}\n`;
  }
  if (workingHours || avgResponseTime) {
    section += "\nSupport availability — set directly by the team and authoritative: if the documentation states different hours or response times, these values win. Share them when visitors ask about hours or when to expect a reply.\n";
    if (workingHours) section += `- Working hours: ${workingHours}\n`;
    if (avgResponseTime) section += `- Typical response time: ${avgResponseTime}\n`;
  }
  return section + `</about-the-company>\n\n`;
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
  const framing = `These are specific standard operating procedures from the ${projectName} team. When a visitor's question matches one of these scenarios, follow the corresponding instructions precisely. These take priority over general response rules for what you do and say — your voice rules still govern the phrasing, so express the outcome in your own words and the visitor's language.`;
  return `<guidelines>
${framing}

${guidelineEntries}
</guidelines>

`;
}

// ─── Time context ───────────────────────────────────────────────────────────

// The compose model receives history as a structured message array with the
// timestamps stripped, so this block is the only clock it has. It carries
// facts, not conclusions: the greeting decision is made by the model from
// what a person would actually notice, which is the visitor's own local day
// and how long the conversation has been quiet.
export function buildTimeContextSection(
  timeContext:
    | {
        nowMs: number;
        conversationHistory: ConversationTurnMessage[];
        visitorTimezone?: string | null;
      }
    | null
    | undefined,
  turnContext?: SupportTurnContext | null,
): string {
  if (!timeContext) return "";
  const { nowMs, conversationHistory } = timeContext;
  const zone = resolveTimeZone(timeContext.visitorTimezone);
  const lines = [
    `The visitor's local time: ${formatZonedTime(nowMs, zone)} (${zone}).`,
  ];
  if (zone === "UTC" && !timeContext.visitorTimezone?.trim()) {
    lines.push(
      "The visitor's timezone is unknown, so that time is UTC and may not be their real local time.",
    );
  }

  if (turnContext?.isNewConversation) {
    lines.push("This is the visitor's first message in a new conversation.");
  }

  const firstMs = toMessageTimestampMs(conversationHistory[0]?.createdAt);
  if (firstMs != null && nowMs - firstMs > 60 * 60 * 1000) {
    lines.push(
      `This conversation started ${formatGapLabel(nowMs - firstMs)} ago.`,
    );
  }

  const lastMs = toMessageTimestampMs(
    conversationHistory[conversationHistory.length - 1]?.createdAt,
  );
  if (lastMs != null) {
    if (nowMs - lastMs > TRANSCRIPT_GAP_THRESHOLD_MS) {
      lines.push(
        `The previous message in this conversation was ${formatGapLabel(nowMs - lastMs)} ago.`,
      );
    }
    if (zonedDayKey(lastMs, zone) !== zonedDayKey(nowMs, zone)) {
      lines.push(
        `The previous message was on a different local day for the visitor (${zonedWeekday(lastMs, zone)}). Today is ${zonedWeekday(nowMs, zone)} where they are.`,
      );
    } else {
      lines.push(
        "The previous message was earlier on the same local day for the visitor.",
      );
    }
  }

  return `<time-context>
${lines.join("\n")}
</time-context>

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
  const framing = "The visitor is currently viewing the following page/section. Use this to give contextually relevant answers.";
  return `<page-context>
${framing}

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
  const framing = `The visitor's known contact information. Treat this as context only.

- Do not ask for contact details unless a required runtime-controlled follow-up flow clearly needs them.
- Do not invent contact details or say you collected them unless they are present here.
- The name is stored as the visitor gave it, so it is often a full name. Address them by first name only, and only inside a greeting. Never repeat their name in the body of a message.
- This name is not always a person's name. Skip it entirely when it reads as an email address, a login handle, a company, or a placeholder.`;
  return `<visitor-info>
${framing}

Name: ${nameStr}
Email: ${emailStr}
</visitor-info>

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
  const framing = `The visitor's current question closely matches a curated FAQ below (tier-1, match score ${faqMatchHint.score.toFixed(2)}). This IS the answer — deliver its content rewritten in your voice and the visitor's language, keeping exact values, URLs, and steps intact, unless the visitor's latest turn makes it clearly inapplicable. Do not claim the documentation lacks this information.`;
  return `<priority-faq-match>
${framing}

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
  const framing = "These are the project's compiled FAQ entries. They are tier-1 knowledge because they are usually curated directly by the team. Check them before relying on lower-tier retrieved context. Prefer these answers when they directly address the visitor's question.";
  return `<priority-faqs>
${framing}

${trimToCharBudget(faqContext, MAX_FAQ_CONTEXT_CHARS)}
</priority-faqs>

`;
}

// ─── Knowledge base (RAG) ───────────────────────────────────────────────────

export function buildKnowledgeBaseSection(
  ragContext: string,
): string {
  if (!ragContext) return "";
  const framing = "These are lower-tier retrieved excerpts from webpages, PDFs, and other documentation for the visitor's current question. Use them after checking SOPs and priority FAQs first. Each source includes a relevance percentage. Prioritize high-relevance sources. Ignore sources that clearly don't address the visitor's question.";
  return `<knowledge-base>
${framing}

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
- Do not turn missing grounding into a human handoff promise. Offer team follow-up, then call request_team_help only after the visitor asks or confirms.
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
  const framing = "These are results from support tools already executed for this visitor. Treat them as evidence.";
  return `<tool-evidence>
${framing}

${trimToCharBudget(toolEvidenceSummary, MAX_TOOL_EVIDENCE_CHARS)}
</tool-evidence>

`;
}

// ─── Conversation summary ───────────────────────────────────────────────────

export function buildConversationSummarySection(
  conversationSummary: string | null,
): string {
  if (!conversationSummary) return "";
  const framing = "This is a summary of the conversation so far. Use it to stay on topic and avoid repeating information already covered.";
  return `<conversation-summary>
${framing}

${trimToCharBudget(conversationSummary, MAX_CONVERSATION_SUMMARY_CHARS)}
</conversation-summary>

`;
}
