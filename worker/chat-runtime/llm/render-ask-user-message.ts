import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  type ConversationTurnMessage,
  type SupportPromptSettings,
} from "../types";
import { buildVoiceContract } from "../prompt/voice";
import { formatTranscript } from "../prompt/format-transcript";

const renderAskUserSchema = z.object({
  message: z
    .string()
    .min(1)
    .max(400)
    .describe(
      "The chat message shown to the visitor, written in the visitor's language.",
    ),
  asksExactlyOneQuestion: z
    .boolean()
    .describe("True if the message asks exactly one question."),
  introducesNewTopics: z
    .boolean()
    .describe(
      "True if the message brings up topics, offers, or requests beyond the single clarifying question.",
    ),
});

export function isRenderedAskUserMessageValid(assessment: {
  asksExactlyOneQuestion: boolean;
  introducesNewTopics: boolean;
}): boolean {
  return assessment.asksExactlyOneQuestion && !assessment.introducesNewTopics;
}

// Renders the planner's clarifying question into the shared voice and the
// visitor's language. Model errors throw when `throwOnModelError` is set (so
// the caller's model-fallback wrapper can retry the other provider); guardrail
// violations fall back to the planner's raw question — same contract as
// renderHandoffMessage.
export async function renderAskUserMessage(
  model: LanguageModel,
  params: {
    question: string;
    settings: Pick<
      SupportPromptSettings,
      "toneOfVoice" | "customTonePrompt" | "botName"
    >;
    projectName: string;
    conversationHistory: ConversationTurnMessage[];
  },
  options?: { throwOnModelError?: boolean },
): Promise<string> {
  const transcript = formatTranscript(params.conversationHistory.slice(-6));

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: renderAskUserSchema }),
      prompt: `${buildVoiceContract(params.settings, params.projectName)}

Recent conversation (for continuity and to match the visitor's language):
${transcript || "No prior conversation"}

You need one piece of information from the visitor before you can help further. Rewrite the following clarifying question as a single short chat message in your voice and in the visitor's language. Keep exactly the same meaning — do not ask for anything else and do not add offers.

Question to ask: ${params.question}

After writing the message, set each self-report field to honestly describe the message you wrote (in any language).`,
      temperature: 0.3,
      maxOutputTokens: 200,
    });

    if (!output) {
      const error = new Error(
        "model did not produce a valid structured output",
      );
      error.name = "AI_NoObjectGeneratedError";
      throw error;
    }

    const message = output.message.trim();
    if (message && isRenderedAskUserMessageValid(output)) {
      return message;
    }
    return params.question;
  } catch (error) {
    if (options?.throwOnModelError === true) {
      throw error;
    }
    return params.question;
  }
}
