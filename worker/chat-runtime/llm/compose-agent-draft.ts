import { generateText, type LanguageModel } from "ai";
import { type ProjectSettingsRow } from "../../db";
import { resolveToneInstruction } from "../prompt/build-support-system-prompt";

export type ComposeAgentDraftSettings = Pick<
  ProjectSettingsRow,
  | "toneOfVoice"
  | "customTonePrompt"
  | "botName"
  | "agentName"
  | "companyName"
  | "companyContext"
>;

export interface ComposeAgentDraftParams {
  instruction: string;
  conversationHistory: Array<{ role: string; content: string }>;
  settings: ComposeAgentDraftSettings | null;
}

interface ComposeAgentDraftPromptOptions {
  instruction: string;
  transcript: string;
  toneInstruction: string;
  agentName?: string | null;
  companyName?: string | null;
  companyContext?: string | null;
}

// Pure prompt construction, kept separate from the model call so it can be
// unit tested without invoking generateText (mirrors support-prompt-builders.ts).
export function buildComposeAgentDraftPrompt(
  options: ComposeAgentDraftPromptOptions,
): string {
  return [
    `You write chat replies on behalf of ${options.agentName ?? "a human support agent"}${options.companyName ? ` at ${options.companyName}` : ""}.`,
    options.companyContext ? `Company context: ${options.companyContext}` : null,
    `Tone: ${options.toneInstruction}`,
    ``,
    `Conversation so far:`,
    options.transcript || "(no messages yet)",
    ``,
    `The agent's instruction for the reply:`,
    options.instruction,
    ``,
    `Write the message the agent should send to the visitor.`,
    `Rules:`,
    `- Output ONLY the message text. No preamble, no quotes, no signature.`,
    `- Write in the visitor's language (from the conversation above; default to the instruction's language if there is no prior conversation).`,
    `- Convey exactly what the instruction says — do not invent policies, offers, or facts.`,
    `- Keep it concise and natural for a chat reply.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

// Turns a human agent's shorthand instruction ("tell him we don't offer trial
// extensions") into a polished visitor-facing reply matching the configured
// tone and the visitor's language. Single scoped call — the agent supplies the
// substance, the model does phrasing; no retrieval.
export async function composeAgentDraft(
  model: LanguageModel,
  params: ComposeAgentDraftParams,
  options?: { throwOnModelError?: boolean },
): Promise<string> {
  const transcript = params.conversationHistory
    .slice(-20)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  const settings = params.settings;
  const toneInstruction = resolveToneInstruction({
    toneOfVoice: settings?.toneOfVoice ?? "professional",
    customTonePrompt: settings?.customTonePrompt ?? null,
  });

  const prompt = buildComposeAgentDraftPrompt({
    instruction: params.instruction,
    transcript,
    toneInstruction,
    agentName: settings?.agentName,
    companyName: settings?.companyName,
    companyContext: settings?.companyContext,
  });

  try {
    const { text } = await generateText({
      model,
      prompt,
      temperature: 0.4,
      maxOutputTokens: 400,
    });
    return text.trim();
  } catch (error) {
    if (options?.throwOnModelError) throw error;
    return "";
  }
}
