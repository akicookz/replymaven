import { generateText, type LanguageModel } from "ai";
import { type ProjectSettingsRow } from "../../db";
import { resolveToneInstruction } from "../prompt/build-support-system-prompt";

export type ComposeAgentDraftSettings = Pick<
  ProjectSettingsRow,
  | "toneOfVoice"
  | "customTonePrompt"
  | "agentName"
  | "companyName"
  | "companyContext"
>;

export interface ComposeAgentDraftParams {
  instruction: string;
  conversationHistory: Array<{ role: string; content: string }>;
  settings: ComposeAgentDraftSettings | null;
}

// Pure prompt construction — takes the raw params (full history + settings)
// and does the transcript truncation and tone resolution itself, so every
// prompt-shaping behavior is unit-testable without invoking generateText
// (mirrors the builder-vs-call split in support-prompt-builders.ts).
export function buildComposeAgentDraftPrompt(
  params: ComposeAgentDraftParams,
): string {
  const transcript = params.conversationHistory
    .slice(-20)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  const settings = params.settings;
  const toneInstruction = resolveToneInstruction({
    toneOfVoice: settings?.toneOfVoice ?? "professional",
    customTonePrompt: settings?.customTonePrompt ?? null,
  });

  return [
    `You write chat replies on behalf of ${settings?.agentName ?? "a human support agent"}${settings?.companyName ? ` at ${settings.companyName}` : ""}.`,
    settings?.companyContext
      ? `Company context: ${settings.companyContext}`
      : null,
    `Tone: ${toneInstruction}`,
    ``,
    `Conversation so far:`,
    transcript || "(no messages yet)",
    ``,
    `The agent's instruction for the reply:`,
    params.instruction,
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
// substance, the model does phrasing; no retrieval. Thin generateText wrapper
// around buildComposeAgentDraftPrompt.
export async function composeAgentDraft(
  model: LanguageModel,
  params: ComposeAgentDraftParams,
  options?: { throwOnModelError?: boolean },
): Promise<string> {
  const prompt = buildComposeAgentDraftPrompt(params);

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
