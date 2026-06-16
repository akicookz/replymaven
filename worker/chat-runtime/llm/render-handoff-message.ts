import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  type ConversationTurnMessage,
  type HandoffRenderDirective,
  type SupportPromptSettings,
} from "../types";
import { resolveToneInstruction } from "../prompt/build-support-system-prompt";
import { buildRenderHandoffMessagePrompt } from "./support-prompt-builders";

interface RenderHandoffMessageOptions {
  throwOnModelError?: boolean;
}

interface RenderHandoffMessageParams {
  directive: HandoffRenderDirective;
  settings: Pick<
    SupportPromptSettings,
    "toneOfVoice" | "customTonePrompt" | "botName"
  >;
  conversationHistory: ConversationTurnMessage[];
}

// Deterministic phrasing the runtime falls back to whenever rendering fails or
// the rendered text violates a guardrail. These strings are intentionally
// byte-identical to the pre-render hardcoded behavior so the fallback path is a
// no-op behavior change.
export function fallbackRenderHandoffMessage(
  directive: HandoffRenderDirective,
): string {
  if (directive.kind === "collect_contact") {
    const wantsName = directive.missingFields.includes("name");
    const wantsEmail = directive.missingFields.includes("email");
    if (wantsName && wantsEmail) {
      return "I can forward this to the team. Before I do, could you share your name and email so they can follow up directly? If you'd rather keep it in chat, just say that.";
    }
    if (wantsName) {
      return "I can forward this to the team. Before I do, could you share your name so they know who to follow up with? If you'd rather keep it in chat, just say that.";
    }
    return "I can forward this to the team. Before I do, could you share your email so they can follow up directly? If you'd rather keep it in chat, just say that.";
  }

  if (directive.kind === "offer_handoff") {
    if (!directive.hasIssueContext) {
      return `Sure — I can help get this to ${directive.agentLabel}. Before I forward it, could you tell me a bit about what you need help with so the team gets the right context?`;
    }
    return `I can forward this to ${directive.agentLabel} for a deeper look. If you'd like me to do that, reply yes and I'll collect anything still missing before sending it over.`;
  }

  if (directive.variant === "appended") {
    return `I've added those details to your existing request. ${directive.agentLabel} will follow up shortly!`;
  }
  if (directive.variant === "created") {
    return `I've forwarded this to the team. ${directive.agentLabel} will follow up shortly!`;
  }
  return `I've already forwarded this conversation to the team. ${directive.agentLabel} will continue the follow-up there.`;
}

// The model writes the message AND self-reports these language-agnostic facts
// about it. Validating the booleans (instead of regex-matching English phrases
// over possibly non-English prose) is what makes the guardrails work across
// languages — see `isRenderedHandoffMessageValid`.
const renderHandoffSchema = z.object({
  message: z
    .string()
    .min(1)
    .max(600)
    .describe(
      "The chat message shown to the visitor, written in the visitor's language.",
    ),
  asksForName: z
    .boolean()
    .describe("True if the message asks the visitor to provide their name."),
  asksForEmail: z
    .boolean()
    .describe(
      "True if the message asks the visitor to provide their email address.",
    ),
  offersToStayInChat: z
    .boolean()
    .describe(
      "True if the message tells the visitor they can decline sharing contact info and keep the conversation here in the chat instead.",
    ),
  claimsAlreadyForwarded: z
    .boolean()
    .describe(
      "True if the message states the conversation has ALREADY been forwarded, sent, or escalated, or that the team has already been notified.",
    ),
});

export type RenderedHandoffAssessment = z.infer<typeof renderHandoffSchema>;

// Validates the model's self-reported assessment against the directive's intent.
// Language-agnostic: it inspects the model's booleans about its own message, not
// the prose, so a correct non-English render is no longer rejected. `false` →
// caller substitutes the deterministic fallback.
export function isRenderedHandoffMessageValid(
  assessment: Omit<RenderedHandoffAssessment, "message">,
  directive: HandoffRenderDirective,
): boolean {
  if (directive.kind === "collect_contact") {
    // The forward has not happened yet, so it must not be claimed.
    if (assessment.claimsAlreadyForwarded) return false;
    if (directive.missingFields.includes("name") && !assessment.asksForName) {
      return false;
    }
    if (directive.missingFields.includes("email") && !assessment.asksForEmail) {
      return false;
    }
    if (!assessment.offersToStayInChat) return false;
    return true;
  }

  if (directive.kind === "offer_handoff") {
    if (assessment.claimsAlreadyForwarded) return false;
    // Must not jump straight to collecting PII at the offer stage.
    if (assessment.asksForName || assessment.asksForEmail) return false;
    return true;
  }

  // ticket_created: the forward really happened, so claiming it is correct; it
  // just must not re-ask for contact details.
  if (assessment.asksForName || assessment.asksForEmail) return false;
  return true;
}

// Renders an escalation directive into a natural, on-brand message in the
// visitor's language, with a structured self-assessment used for guardrails.
// Mirrors the auxiliary-call pattern: model errors throw when `throwOnModelError`
// is set (so the caller's model-fallback wrapper can retry the alternate
// provider); guardrail violations resolve to the deterministic fallback.
export async function renderHandoffMessage(
  model: LanguageModel,
  params: RenderHandoffMessageParams,
  options?: RenderHandoffMessageOptions,
): Promise<string> {
  const transcript = params.conversationHistory
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: renderHandoffSchema }),
      prompt: buildRenderHandoffMessagePrompt(
        {
          directive: params.directive,
          toneInstruction: resolveToneInstruction(params.settings),
          botName: params.settings.botName,
        },
        transcript,
      ),
      temperature: 0.3,
      maxOutputTokens: 220,
    });

    if (!output) {
      const error = new Error(
        "model did not produce a valid structured output",
      );
      error.name = "AI_NoObjectGeneratedError";
      throw error;
    }

    const message = output.message.trim();
    if (message && isRenderedHandoffMessageValid(output, params.directive)) {
      return message;
    }
    return fallbackRenderHandoffMessage(params.directive);
  } catch (error) {
    if (options?.throwOnModelError === true) {
      throw error;
    }
    return fallbackRenderHandoffMessage(params.directive);
  }
}
