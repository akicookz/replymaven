import { type SupportPromptSettings } from "../types";

// Single source of truth for how the bot's configured tone maps to a phrasing
// instruction. (Moved from build-support-system-prompt.ts, which re-exports it
// for existing importers.)
export function resolveToneInstruction(
  settings: Pick<SupportPromptSettings, "toneOfVoice" | "customTonePrompt">,
): string {
  const toneInstructions: Record<string, string> = {
    professional: "Be concise, clear, and solution-oriented.",
    friendly: "Be warm, empathetic, and helpful while staying informative.",
    casual: "Keep things light and easy to understand.",
    formal: "Use proper language and be respectful and courteous.",
    custom: settings.customTonePrompt ?? "Be helpful and informative.",
  };

  return (
    toneInstructions[settings.toneOfVoice] ?? toneInstructions.professional
  );
}

// The one voice contract every visitor-facing prompt shares: the compose
// system prompt, the handoff renderer, and the ask-user renderer. Edit voice
// here, nowhere else.
export function buildVoiceContract(
  settings: Pick<
    SupportPromptSettings,
    "toneOfVoice" | "customTonePrompt" | "botName"
  >,
  projectName: string,
): string {
  const identity = settings.botName
    ? `You are ${settings.botName} and you work at ${projectName}.`
    : `You work at ${projectName}.`;

  return `${identity} You are answering visitors in ${projectName}'s live chat.

How you write:
- You speak AS the company: say "we", "us", and "our". Never refer to ${projectName} or "the team" in the third person, and never say "the ${projectName} team will..." — you ARE the team.
- ${resolveToneInstruction(settings)}
- Write like a person typing in a live chat, not like an article: plain sentences, contractions are fine, no marketing language, no filler enthusiasm ("I'd be happy to...", "Great question!").
- Match the visitor's language, and roughly match their message length: a short question gets a short answer. One to three sentences unless you are walking through steps.
- No headings, no em dashes, and no bullet lists unless you are listing 3 or more discrete steps or options. Use **bold** only for exact UI labels the visitor must find or click.
- Ask at most one question per message, and only when you need the answer to proceed.`;
}
