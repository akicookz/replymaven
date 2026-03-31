import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import {
  type ConversationTurnMessage,
  type SupportTurnPlan,
} from "../types";

interface AuxiliaryCallOptions {
  throwOnModelError?: boolean;
}

function shouldThrowOnModelError(options?: AuxiliaryCallOptions): boolean {
  return options?.throwOnModelError === true;
}

export function isVagueIssueReport(message: string): boolean {
  const original = message.trim();
  const normalized = original.toLowerCase();
  if (!original) return false;

  const vagueIssuePattern =
    /\b(not working|isn't working|is not working|doesn't work|does not work|broken|issue|problem|help|stuck|failing|failed|error)\b/i;
  const hasIssueSignal = vagueIssuePattern.test(normalized);
  if (!hasIssueSignal) return false;

  const tokens = original.split(/\s+/).filter(Boolean);
  const hasSpecificContext =
    /https?:\/\//i.test(original) ||
    /["'`].+["'`]/.test(original) ||
    /\b[A-Z]{2,}[A-Z0-9_-]*\d+[A-Z0-9_-]*\b/.test(original) ||
    /\b\d{2,}\b/.test(original) ||
    /\/[a-z0-9._/-]+/i.test(original) ||
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(original);

  return tokens.length <= 12 || !hasSpecificContext;
}

const supportTurnPlanSchema = z.object({
  intent: z.enum([
    "how_to",
    "troubleshoot",
    "lookup",
    "policy",
    "clarify",
    "handoff",
  ]),
  summary: z.string().min(1).max(220),
  retrievalQueries: z.array(z.string().min(3).max(180)).max(4),
  broaderQueries: z.array(z.string().min(3).max(180)).max(4),
  followUpQuestion: z.string().max(220).nullable().optional(),
});

export function fallbackClassifySupportTurn(
  currentMessage: string,
): SupportTurnPlan {
  const normalized = currentMessage.trim().toLowerCase();
  const explicitHandoff =
    /\b(human|person|agent|support team|someone|representative)\b/.test(
      normalized,
    ) && /\b(help|talk|speak|contact|reach)\b/.test(normalized);
  if (explicitHandoff) {
    return {
      intent: "handoff",
      summary: "The visitor is explicitly asking for a human handoff.",
      retrievalQueries: [],
      broaderQueries: [],
      followUpQuestion: null,
    };
  }

  if (
    /\b(price|pricing|refund|billing|invoice|subscription|plan|trial|cancel|security|compliance|sla|policy|terms)\b/.test(
      normalized,
    )
  ) {
    return {
      intent: "policy",
      summary: "The visitor is asking about plans, billing, or policy details.",
      retrievalQueries: [currentMessage],
      broaderQueries: [currentMessage],
      followUpQuestion: null,
    };
  }

  if (
    /\b(check|lookup|look up|find|show|status|track|verify|search|order|account|customer|booking|subscription)\b/.test(
      normalized,
    )
  ) {
    return {
      intent: "lookup",
      summary: "The visitor likely needs account-specific data or a backend lookup.",
      retrievalQueries: [],
      broaderQueries: [],
      followUpQuestion: null,
    };
  }

  if (isVagueIssueReport(currentMessage)) {
    return {
      intent: "troubleshoot",
      summary: "The visitor is reporting something broken or unclear.",
      retrievalQueries: [currentMessage],
      broaderQueries: [currentMessage],
      followUpQuestion:
        "Could you share the exact page, step, or error you are seeing?",
    };
  }

  if (
    /^(how|where|when|can|does|do|is|are|what)\b/.test(normalized) ||
    /\b(set up|setup|configure|install|connect|integrate|embed|create)\b/.test(
      normalized,
    )
  ) {
    return {
      intent: "how_to",
      summary: "The visitor is asking how to do something.",
      retrievalQueries: [currentMessage],
      broaderQueries: [currentMessage],
      followUpQuestion: null,
    };
  }

  return {
    intent: "clarify",
    summary: "The request is too underspecified and needs a focused follow-up.",
    retrievalQueries: [currentMessage],
    broaderQueries: [],
    followUpQuestion:
      "Could you share a bit more detail about what you are trying to do or what is not working?",
  };
}

export async function classifySupportTurn(
  model: LanguageModel,
  conversationHistory: ConversationTurnMessage[],
  currentMessage: string,
  pageContext?: Record<string, string>,
  options?: AuxiliaryCallOptions,
): Promise<SupportTurnPlan> {
  const recentHistory = conversationHistory.slice(-6);
  const transcript = recentHistory
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const pageContextBlock =
    pageContext && Object.keys(pageContext).length > 0
      ? Object.entries(pageContext)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
      : "None";

  try {
    const { object } = await generateObject({
      model,
      schema: supportTurnPlanSchema,
      temperature: 0,
      maxOutputTokens: 384,
      prompt: `Classify the next support-chat turn and provide retrieval hints for the orchestrator.

Conversation:
${transcript || "No prior conversation"}

Latest user message:
${currentMessage}

Page context:
${pageContextBlock}

You must produce:
- intent:
  - how_to: asks how to perform, set up, configure, or use something
  - troubleshoot: reports something broken, failing, or not working
  - lookup: needs account-specific data, status, or a backend lookup/action
  - policy: asks about plans, pricing, billing, limits, refund, security, or policy
  - clarify: too ambiguous to act on confidently yet
  - handoff: explicitly wants a human or support team handoff
- summary: one short line describing the handling posture
- retrievalQueries: focused documentation searches that would help if docs should be consulted
- broaderQueries: broader second-pass documentation searches if focused docs miss
- followUpQuestion: one focused question to ask when the request remains underspecified

Rules:
- Do not invent product-specific features or terminology.
- Retrieval hints are only hints. Do not use them to decide tool policy.
- For lookup turns, retrievalQueries can be empty if documentation is unlikely to help.
- For clarify turns, keep retrieval light and focus on the one missing detail that unblocks help.
- For handoff turns, retrievalQueries and broaderQueries should usually be empty.
- Prefer troubleshooting-oriented search phrases over repeating raw complaints.
- If a product, page, step, error, or integration is mentioned, include it in retrieval queries when relevant.
- Broader queries should be more general than focused queries, but still relevant to the issue.
- Keep queries short and search-friendly.`,
    });

    return {
      intent: object.intent,
      summary: object.summary,
      retrievalQueries: object.retrievalQueries,
      broaderQueries: object.broaderQueries,
      followUpQuestion: object.followUpQuestion ?? null,
    };
  } catch (error) {
    if (shouldThrowOnModelError(options)) {
      throw error;
    }
    return fallbackClassifySupportTurn(currentMessage);
  }
}

export async function reformulateQuery(
  model: LanguageModel,
  conversationHistory: ConversationTurnMessage[],
  currentMessage: string,
  options?: AuxiliaryCallOptions,
): Promise<string> {
  const needsTroubleshootingExpansion = isVagueIssueReport(currentMessage);
  if (conversationHistory.length <= 1 && !needsTroubleshootingExpansion) {
    return currentMessage;
  }

  const recentHistory = conversationHistory.slice(-6);
  const transcript = recentHistory
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model,
      prompt: `Given the conversation below, rewrite the user's latest message into a standalone search query that captures the full intent. The query should be self-contained and optimized for searching a knowledge base.

If the latest message is vague or underspecified (for example "x is not working", "it failed", or "billing is broken"), do NOT just repeat the exact phrase. Expand it into a troubleshooting-oriented search query using the feature, page, or topic mentioned by the user if available, plus likely documentation terms such as setup, troubleshooting, common issues, configuration, errors, or handoff steps.

Do not invent product features or facts that were not mentioned.

CONVERSATION:
${transcript}

LATEST MESSAGE: ${currentMessage}

Output ONLY the rewritten search query, nothing else. If the latest message is already a clear standalone question, return it as-is.`,
      temperature: 0,
      maxOutputTokens: 128,
    });

    return text.trim() || currentMessage;
  } catch (error) {
    if (shouldThrowOnModelError(options)) {
      throw error;
    }
    return currentMessage;
  }
}

export async function summarizeConversation(
  model: LanguageModel,
  conversationHistory: ConversationTurnMessage[],
  options?: AuxiliaryCallOptions,
): Promise<string | null> {
  if (conversationHistory.length < 6) return null;

  const transcript = conversationHistory
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model,
      prompt: `Summarize this customer support conversation in 1-2 sentences. Focus on: what the visitor needs help with and what has been discussed so far. Be factual and concise.

CONVERSATION:
${transcript}

SUMMARY:`,
      temperature: 0,
      maxOutputTokens: 128,
    });

    return text.trim() || null;
  } catch (error) {
    if (shouldThrowOnModelError(options)) {
      throw error;
    }
    return null;
  }
}

export function fallbackSummarizeTeamRequest(
  conversationHistory: Array<{ role: string; content: string }>,
): string {
  const visitorMessages = conversationHistory
    .filter((message) => message.role === "visitor")
    .slice(-4)
    .map((message) => message.content.trim())
    .filter(Boolean);

  return visitorMessages.join(" ").slice(0, 700);
}

export async function summarizeTeamRequest(
  model: LanguageModel,
  conversationHistory: Array<{ role: string; content: string }>,
  options?: AuxiliaryCallOptions,
): Promise<string> {
  const transcript = conversationHistory
    .slice(-16)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model,
      prompt: `Summarize this support conversation for an internal team follow-up request.

CONVERSATION:
${transcript}

Write a short factual summary that covers:
- what the visitor is trying to do
- what is not working or still unclear
- any concrete details already shared
- what the team should investigate or respond with

Rules:
- Keep it under 700 characters
- Do not invent details
- Do not use markdown headings
- Write in plain text for an internal support note`,
      temperature: 0.2,
      maxOutputTokens: 256,
    });

    return text.trim();
  } catch (error) {
    if (shouldThrowOnModelError(options)) {
      throw error;
    }
    return fallbackSummarizeTeamRequest(conversationHistory);
  }
}

export function fallbackExtractContactInfo(
  messages: Array<{ role: string; content: string }>,
): { name: string | null; email: string | null } {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  let extractedEmail: string | null = null;

  const visitorMessages = messages
    .filter((message) => message.role === "visitor")
    .slice(-10);

  for (const message of visitorMessages) {
    const emailMatch = message.content.match(emailRegex);
    if (emailMatch) {
      extractedEmail = emailMatch[0].toLowerCase();
    }
  }

  return { name: null, email: extractedEmail };
}

export async function extractContactInfo(
  model: LanguageModel,
  messages: Array<{ role: string; content: string }>,
  options?: AuxiliaryCallOptions,
): Promise<{ name: string | null; email: string | null }> {
  const fallbackContactInfo = fallbackExtractContactInfo(messages);
  let extractedEmail = fallbackContactInfo.email;
  let extractedName = fallbackContactInfo.name;

  const visitorMessages = messages
    .filter((message) => message.role === "visitor")
    .slice(-10);

  const transcript = visitorMessages.map((message) => message.content).join("\n");

  try {
    const { text } = await generateText({
      model,
      prompt: `Extract the visitor's name and email from these messages. If either is not present, return "unknown".

VISITOR MESSAGES:
${transcript}

Respond in exactly this format (no other text):
name: <name or unknown>
email: <email or unknown>`,
      temperature: 0,
      maxOutputTokens: 64,
    });

    const nameMatch = text.match(/name:\s*(.+)/i);
    const emailMatch = text.match(/email:\s*(.+)/i);

    if (nameMatch) {
      const name = nameMatch[1].trim();
      if (name && name.toLowerCase() !== "unknown") {
        extractedName = name;
      }
    }

    if (!extractedEmail && emailMatch) {
      const email = emailMatch[1].trim();
      if (email && email.toLowerCase() !== "unknown" && email.includes("@")) {
        extractedEmail = email.toLowerCase();
      }
    }
  } catch (error) {
    if (shouldThrowOnModelError(options)) {
      throw error;
    }
    // Regex fallback is good enough.
  }

  return { name: extractedName, email: extractedEmail };
}
