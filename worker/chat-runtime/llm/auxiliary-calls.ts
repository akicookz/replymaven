import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  type ConversationTurnMessage,
} from "../types";
import {
  formatCurrentTime,
  formatTranscript,
} from "../prompt/format-transcript";
import {
  buildExtractContactInfoPrompt,
  buildReformulateQueryPrompt,
  buildReformulateSearchQueriesPrompt,
  buildSelectFaqSetsPrompt,
  buildSummarizeConversationPrompt,
  buildSummarizeTeamRequestPrompt,
} from "./support-prompt-builders";

interface AuxiliaryCallOptions {
  throwOnModelError?: boolean;
}

function shouldThrowOnModelError(options?: AuxiliaryCallOptions): boolean {
  return options?.throwOnModelError === true;
}

// Turn classification lives in the planner (plan-next-action.ts) — the
// planner's first step IS the classifier; there is no separate routing call.

const reformulateSearchQueriesSchema = z.object({
  queries: z.array(z.string().min(3).max(180)).min(1).max(3),
});

const selectFaqSetsSchema = z.object({
  selectedIds: z.array(z.string().min(1).max(100)).max(2),
});

interface SelectFaqSetsParams {
  conversationHistory: ConversationTurnMessage[];
  currentMessage: string;
  pageContext?: Record<string, string>;
  faqSets: Array<{ id: string; title: string; description: string | null }>;
}

export async function selectFaqSets(
  model: LanguageModel,
  params: SelectFaqSetsParams,
  options?: AuxiliaryCallOptions,
): Promise<string[]> {
  if (params.faqSets.length === 0) {
    return [];
  }

  // When there's only one set, always use it — no need to consult the model.
  if (params.faqSets.length === 1) {
    return [params.faqSets[0].id];
  }

  const recentHistory = params.conversationHistory.slice(-4);
  const transcript = formatTranscript(recentHistory);
  const pageContextBlock =
    params.pageContext && Object.keys(params.pageContext).length > 0
      ? Object.entries(params.pageContext)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
      : "None";

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: selectFaqSetsSchema }),
      temperature: 0,
      maxOutputTokens: 128,
      prompt: buildSelectFaqSetsPrompt({
        transcript,
        currentMessage: params.currentMessage,
        pageContextBlock,
        faqSets: params.faqSets,
      }),
    });

    const object = result.output;
    if (!object) {
      const error = new Error(
        "model did not produce a valid structured output",
      );
      error.name = "AI_NoObjectGeneratedError";
      throw error;
    }

    const validIds = new Set(params.faqSets.map((set) => set.id));
    return object.selectedIds.filter((id) => validIds.has(id));
  } catch (error) {
    if (shouldThrowOnModelError(options)) {
      throw error;
    }
    return [];
  }
}

export async function reformulateQuery(
  model: LanguageModel,
  conversationHistory: ConversationTurnMessage[],
  currentMessage: string,
  options?: AuxiliaryCallOptions,
): Promise<string> {
  if (conversationHistory.length <= 1) {
    return currentMessage;
  }

  const recentHistory = conversationHistory.slice(-6);
  const transcript = formatTranscript(recentHistory, { nowMs: Date.now() });

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

export async function reformulateSearchQueries(
  model: LanguageModel,
  params: {
    conversationHistory: ConversationTurnMessage[];
    currentMessage: string;
    failedQueries: string[];
    intent?: string;
    pageContext?: Record<string, string>;
  },
  options?: AuxiliaryCallOptions,
): Promise<string[]> {
  if (params.failedQueries.length === 0) {
    return [];
  }

  const recentHistory = params.conversationHistory.slice(-6);
  const transcript = formatTranscript(recentHistory, { nowMs: Date.now() });
  const pageContextBlock =
    params.pageContext && Object.keys(params.pageContext).length > 0
      ? Object.entries(params.pageContext)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
      : "None";

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: reformulateSearchQueriesSchema }),
      temperature: 0.3,
      maxOutputTokens: 256,
      prompt: buildReformulateSearchQueriesPrompt({
        transcript,
        currentMessage: params.currentMessage,
        failedQueries: params.failedQueries,
        intent: params.intent,
        pageContextBlock,
      }),
    });

    const object =
      result.output ??
      recoverStructuredOutput(result.text ?? "", reformulateSearchQueriesSchema);
    if (!object) {
      const error = new Error(
        "model did not produce a valid structured output",
      );
      error.name = "AI_NoObjectGeneratedError";
      throw error;
    }

    return dedupeReformulatedQueries(object.queries, params.failedQueries);
  } catch (error) {
    if (shouldThrowOnModelError(options)) {
      throw error;
    }
    return [];
  }
}

function recoverStructuredOutput<T extends z.ZodTypeAny>(
  text: string,
  schema: T,
): z.infer<T> | null {
  if (!text.trim()) return null;

  const trimmed = text.trim();
  const candidates: string[] = [];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) candidates.push(fenced[1]);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  candidates.push(trimmed);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const validated = schema.safeParse(parsed);
      if (validated.success) return validated.data;
    } catch {
      // try next candidate
    }
  }

  return null;
}

export function dedupeReformulatedQueries(
  candidates: string[],
  failedQueries: string[],
): string[] {
  const failedSet = new Set(
    failedQueries.map((query) => query.trim().toLowerCase()),
  );
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const query of candidates) {
    const normalized = query.trim();
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    if (failedSet.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    deduped.push(normalized);
  }
  return deduped;
}

export async function summarizeConversation(
  model: LanguageModel,
  conversationHistory: ConversationTurnMessage[],
  options?: AuxiliaryCallOptions,
): Promise<string | null> {
  if (conversationHistory.length < 6) return null;

  // Includes the current turn (call sites pass withCurrentTurn history), so
  // gap dividers cover the resume gap too — no trailing nowMs note needed.
  const transcript = formatTranscript(conversationHistory);

  try {
    const { text } = await generateText({
      model,
      prompt: buildSummarizeConversationPrompt({
        transcript,
        currentTime: formatCurrentTime(Date.now()),
      }),
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
  knownContact?: { name: string | null; email: string | null },
  options?: AuxiliaryCallOptions,
): Promise<string> {
  const transcript = formatTranscript(conversationHistory.slice(-16));

  try {
    const { text } = await generateText({
      model,
      prompt: buildSummarizeTeamRequestPrompt({
        transcript,
        currentTime: formatCurrentTime(Date.now()),
        knownContact,
      }),
      temperature: 0.2,
      maxOutputTokens: 320,
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
