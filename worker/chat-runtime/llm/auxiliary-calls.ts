import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import {
  type ConversationTurnMessage,
  type SupportTurnPlan,
} from "../types";
import {
  buildClassifySupportTurnPrompt,
  buildExtractContactInfoPrompt,
  buildReformulateQueryPrompt,
  buildSummarizeConversationPrompt,
  buildSummarizeTeamRequestPrompt,
} from "./support-prompt-builders";
import { buildIntentAwareFollowUpQuestion } from "../workflows/build-intent-aware-follow-up";

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

function isTroubleshootingCheckRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;

  return (
    /\b(check|test|verify|confirm)\b/.test(normalized) &&
    /\b(work|working|works|installed|connected|configured|set up|setup|enabled|running)\b/.test(
      normalized,
    ) &&
    /^(how|can|what|where|is|does|do)\b/.test(normalized)
  );
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
    /\b(live agent|human|person|agent|support team|someone|representative|engineer)\b/.test(
      normalized,
    ) &&
    (
      /\b(help|talk|speak|contact|reach|connect|handoff|hand off|escalate)\b/.test(
        normalized,
      ) ||
      /^live agent$/.test(normalized)
    );
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
      followUpQuestion: buildIntentAwareFollowUpQuestion({
        userMessage: currentMessage,
        intent: "policy",
      }),
    };
  }

  if (isTroubleshootingCheckRequest(currentMessage)) {
    return {
      intent: "troubleshoot",
      summary:
        "The visitor is trying to verify whether something is working and likely needs troubleshooting guidance.",
      retrievalQueries: [currentMessage],
      broaderQueries: [currentMessage],
      followUpQuestion: buildIntentAwareFollowUpQuestion({
        userMessage: currentMessage,
        intent: "troubleshoot",
      }),
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
      followUpQuestion: buildIntentAwareFollowUpQuestion({
        userMessage: currentMessage,
        intent: "troubleshoot",
      }),
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
    followUpQuestion: buildIntentAwareFollowUpQuestion({
      userMessage: currentMessage,
      intent: "clarify",
    }),
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
      prompt: buildClassifySupportTurnPrompt({
        transcript,
        currentMessage,
        pageContextBlock,
      }),
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
      prompt: buildReformulateQueryPrompt({
        transcript,
        currentMessage,
      }),
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
      prompt: buildSummarizeConversationPrompt({ transcript }),
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
      prompt: buildSummarizeTeamRequestPrompt({ transcript }),
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
      prompt: buildExtractContactInfoPrompt({ transcript }),
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
