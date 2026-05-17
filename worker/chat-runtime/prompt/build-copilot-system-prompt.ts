import { type SupportPromptOptions, type SupportPromptSettings } from "../types";
import {
  buildCompanySection,
  buildConversationSummarySection,
  buildFaqContextSection,
  buildFaqMatchSection,
  buildGroundingStatusSection,
  buildGuidelinesSection,
  buildKnowledgeBaseSection,
  buildPageContextSection,
  buildPlannerLoopSection,
  buildToolEvidenceSection,
  buildVisitorInfoSection,
  trimToCharBudget,
  MAX_CONVERSATION_SUMMARY_CHARS,
} from "./sections";

// System prompt for the Copilot turn. Audience is the human support agent
// asking for help drafting a reply or understanding context. Distinct from
// the visitor-facing `buildSupportSystemPrompt`:
//
//  - Speaks to the agent, never to the visitor
//  - Includes the visitor transcript as a `<visitor-conversation>` block
//  - Omits visitor-facing rules: [RESOLVED] sentinel, ticket-handoff workflow,
//    anti-loop clarifying rules, escalation language, internal-behavior block
//  - Keeps RAG / FAQs / guidelines / tools / grounding-status / planner loop
//    so Copilot can reuse the planner loop with the same evidence pipeline
export interface CopilotPromptOptions
  extends Omit<SupportPromptOptions, "existingTicket" | "ticketFields" | "agentHandbackInstructions"> {
  visitorTranscript: string; // pre-formatted "role: content" block, last N turns
}

export function buildCopilotSystemPrompt(
  settings: SupportPromptSettings,
  projectName: string,
  ragContext: string,
  conversationSummary: string | null,
  options: CopilotPromptOptions,
): string {
  const toneInstructions: Record<string, string> = {
    professional: "professional and concise",
    friendly: "warm and friendly",
    casual: "casual and easy-going",
    formal: "formal and respectful",
    custom: settings.customTonePrompt ?? "professional and helpful",
  };
  const tone = toneInstructions[settings.toneOfVoice] ?? toneInstructions.professional;
  const agentLabel = settings.agentName ?? "a teammate";

  let prompt = "";

  prompt += `<identity>
You are Copilot, an internal assistant inside ${projectName}'s support dashboard. Your audience is the human support agent (${agentLabel}) replying to a visitor — never the visitor themselves.

Speak directly to the agent. When you write a reply for them to send, write the draft text only — don't preface it with "Here's a draft:" or wrap it in a code block. The agent will click a button to paste it into their composer.
</identity>

`;

  prompt += `<task>
Help the agent in three ways:

1. **Draft a reply** to the visitor's most recent message in a ${tone} tone. Base the draft on the provided evidence sources.
2. **Answer the agent's follow-up questions** about the visitor, the conversation, docs, or company policy — answer them directly in plain prose, not as a visitor-facing draft.
3. **Cite your sources**. The runtime attaches source links automatically when you cite knowledge-base or FAQ content — you don't write URLs.

Evidence priority (use in this order):
1. <priority-faq-match> — exact-match curated FAQ for the current question
2. <guidelines> — team SOPs
3. <priority-faqs> — broader curated FAQ corpus
4. <knowledge-base> — retrieved doc excerpts
5. <about-the-company> — broad background, last resort

If you don't know, say so plainly. Never invent facts. Suggest what the agent could ask the visitor to clarify, if relevant.
</task>

`;

  prompt += buildCompanySection(projectName, settings.companyContext);
  prompt += buildGuidelinesSection(projectName, options.guidelines);

  // The visitor transcript is the centerpiece of Copilot context — it's what
  // the agent's question is about.
  prompt += `<visitor-conversation>
This is the conversation between the visitor and ${projectName} so far. Recent turns are at the bottom. The agent is asking you about this conversation.

${trimToCharBudget(options.visitorTranscript, MAX_CONVERSATION_SUMMARY_CHARS * 4)}
</visitor-conversation>

`;

  prompt += buildPageContextSection(options.pageContext);
  prompt += buildVisitorInfoSection(options.visitorInfo);
  prompt += buildPlannerLoopSection(
    options.turnPlan,
    options.plannerGoal,
    options.plannerActionHistory,
  );
  prompt += buildFaqMatchSection(options.faqMatchHint);
  prompt += buildFaqContextSection(options.faqContext);
  prompt += buildKnowledgeBaseSection(ragContext);

  const hasTier1Evidence = !!(
    options.faqContext?.trim() ||
    (options.guidelines && options.guidelines.length > 0)
  );
  prompt += buildGroundingStatusSection({
    retrievalAttempted: options.retrievalAttempted,
    broaderSearchAttempted: options.broaderSearchAttempted,
    groundingConfidence: options.groundingConfidence,
    topScore: options.topScore,
    hasTier1Evidence,
  });

  prompt += buildToolEvidenceSection(options.toolEvidenceSummary);
  prompt += buildConversationSummarySection(conversationSummary);

  prompt += `<copilot-rules>
- Markdown is allowed: **bold**, bullet points, short paragraphs. No headings (#).
- Never emit internal sentinels like [RESOLVED] or [HANDOFF_REQUESTED]. The runtime does not interpret these in Copilot turns.
- Never tell the agent to "forward this" or "escalate" — that's the visitor-facing flow. If you genuinely don't know the answer, say so and suggest what the agent could ask the visitor.
- Never write text that's intended for the visitor unless the agent explicitly asks for a draft. Default to answering the agent.
- If the agent's question is ambiguous, ask them one clarifying question instead of guessing.
- When citing knowledge-base content, name the source in prose (e.g. "Per the refund policy doc, …"). The runtime attaches the actual links.
</copilot-rules>

`;

  return prompt;
}
