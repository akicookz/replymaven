import { generateObject } from "ai";
import { z } from "zod";
import {
  type ConversationChatState,
  type ConversationTurnMessage,
  type RouterDecision,
  type RouterIntent,
} from "../types";
import {
  createLanguageModel,
  runWithModelFallback,
  type ModelRuntimeState,
} from "./create-language-model";

// ─── Schema ──────────────────────────────────────────────────────────────────

const routerDecisionSchema = z.object({
  intent: z.enum([
    "greeting",
    "how_to",
    "troubleshoot",
    "lookup",
    "policy",
    "clarify",
    "handoff",
    "resolved",
    "chit_chat",
    "out_of_scope",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  needsRetrieval: z.boolean(),
  retrievalQueries: z.array(z.string().min(2).max(200)).max(3),
  escalate: z.boolean(),
  escalationReason: z.string().max(200).nullable(),
  isRepeatedClarification: z.boolean(),
  varyClarificationApproach: z.boolean(),
  suggestedClarification: z.string().max(240).nullable(),
  canAnswerDirectly: z.boolean(),
  summary: z.string().min(1).max(220),
});

// ─── Prompt Builder ──────────────────────────────────────────────────────────

interface BuildRouterPromptInput {
  projectName: string;
  transcript: string;
  currentMessage: string;
  pageContextBlock: string;
  askedClarificationsBlock: string;
  clarificationAttempts: number;
  lastBotQuestion: string | null;
  lastIntent: string | null;
}

function buildRouterPrompt(input: BuildRouterPromptInput): string {
  return `You are the intent router for ${input.projectName}'s support chatbot. You classify a single visitor turn and decide the next move for the runtime.

You MUST produce a JSON object matching the required schema. Be decisive. Temperature is 0. This is the ONLY classification call per turn, so be accurate.

## Conversation state
- Clarification attempts already made this conversation: ${input.clarificationAttempts}
- Last bot question asked: ${input.lastBotQuestion ?? "none"}
- Last classified intent: ${input.lastIntent ?? "none"}

## Previously-asked clarifying questions (do NOT repeat these)
${input.askedClarificationsBlock}

## Recent transcript
${input.transcript || "(no prior turns)"}

## Page context
${input.pageContextBlock}

## Current visitor message
${input.currentMessage}

## Instructions
Classify the visitor's current message into one intent:
- "greeting": hi/hello/hey with no real question
- "how_to": "how do I...", setup, configure, install, connect
- "troubleshoot": something is broken, not working, errors, bugs
- "lookup": account-specific data, status, order, booking
- "policy": pricing, billing, refund, plans, terms, security, compliance
- "clarify": the visitor's message is too vague to answer; you need more info
- "handoff": visitor explicitly asks for a human, agent, engineer, or to escalate
- "resolved": visitor says thanks/bye/that worked/solved
- "chit_chat": unrelated small talk
- "out_of_scope": completely outside the business domain

## Decision rules (CRITICAL — follow exactly)
1. If the visitor asks for escalation, a human, agent, engineer, or "please escalate" / "please fix this" / "this is urgent" → intent="handoff", escalate=true, canAnswerDirectly=false, needsRetrieval=false.
2. If clarificationAttempts >= 2 AND you would otherwise choose intent="clarify" → intent="handoff", escalate=true, escalationReason="clarification_loop_avoided". Do NOT ask another clarifying question.
3. If the message is attached to an image or says "see image" or "this screenshot" → assume the visitor has provided visual context; do NOT ask for what feature/page they mean. Move to troubleshoot or how_to instead of clarify.
4. If intent="clarify" and the previously-asked clarifications list is non-empty, set isRepeatedClarification=true ONLY if your suggestedClarification would duplicate or paraphrase one already asked. In that case, either set varyClarificationApproach=true with a genuinely different angle, or escalate=true.
5. Set needsRetrieval=true for how_to, troubleshoot, policy, and any clarify/lookup where docs might help. Provide 1-3 focused retrievalQueries. Set needsRetrieval=false for greeting, handoff, resolved, chit_chat, out_of_scope.
6. canAnswerDirectly=true ONLY when the question can be answered with the knowledge base alone, no clarification and no tool call needed.
7. summary: one sentence describing what the visitor actually wants this turn. No fluff.
8. suggestedClarification: ONLY if intent="clarify" AND you are NOT escalating; otherwise null.
9. escalationReason is a short internal reason string when escalate=true, otherwise null.

Be aggressive about escalating instead of looping. It is better to hand off than to ask the same question three times.`;
}

// ─── Fallback ────────────────────────────────────────────────────────────────

function fallbackRouterDecision(
  currentMessage: string,
  chatState: ConversationChatState,
): RouterDecision {
  const normalized = currentMessage.trim().toLowerCase();

  if (
    chatState.clarificationAttempts >= 2 ||
    /\bescalat(e|ion)\b|\bhuman\b|\bagent\b|\bperson\b|\bengineer\b/.test(
      normalized,
    )
  ) {
    return {
      intent: "handoff",
      confidence: "medium",
      needsRetrieval: false,
      retrievalQueries: [],
      escalate: true,
      escalationReason: "fallback_router_handoff",
      isRepeatedClarification: false,
      varyClarificationApproach: false,
      suggestedClarification: null,
      canAnswerDirectly: false,
      summary: "Visitor asked for human help or router fallback escalated.",
    };
  }

  if (/^(hi|hello|hey|yo|sup|good\s+(morning|afternoon|evening))/.test(normalized)) {
    return {
      intent: "greeting",
      confidence: "high",
      needsRetrieval: false,
      retrievalQueries: [],
      escalate: false,
      escalationReason: null,
      isRepeatedClarification: false,
      varyClarificationApproach: false,
      suggestedClarification: null,
      canAnswerDirectly: true,
      summary: "Visitor sent a greeting.",
    };
  }

  if (
    /\b(price|pricing|refund|billing|plan|subscription|cancel|policy|terms)\b/.test(
      normalized,
    )
  ) {
    return {
      intent: "policy",
      confidence: "medium",
      needsRetrieval: true,
      retrievalQueries: [currentMessage.slice(0, 180)],
      escalate: false,
      escalationReason: null,
      isRepeatedClarification: false,
      varyClarificationApproach: false,
      suggestedClarification: null,
      canAnswerDirectly: false,
      summary: "Visitor asked about pricing, billing, or policy.",
    };
  }

  if (
    /^(how|where|when|can|does|do|what|is|are)\b/.test(normalized) ||
    /\b(set up|setup|configure|install|connect|integrate|embed|create)\b/.test(
      normalized,
    )
  ) {
    return {
      intent: "how_to",
      confidence: "medium",
      needsRetrieval: true,
      retrievalQueries: [currentMessage.slice(0, 180)],
      escalate: false,
      escalationReason: null,
      isRepeatedClarification: false,
      varyClarificationApproach: false,
      suggestedClarification: null,
      canAnswerDirectly: false,
      summary: "Visitor is asking how to do something.",
    };
  }

  if (
    /\b(error|broken|not\s+working|fail|crash|bug|issue|problem|stuck)\b/.test(
      normalized,
    )
  ) {
    return {
      intent: "troubleshoot",
      confidence: "medium",
      needsRetrieval: true,
      retrievalQueries: [currentMessage.slice(0, 180)],
      escalate: false,
      escalationReason: null,
      isRepeatedClarification: false,
      varyClarificationApproach: false,
      suggestedClarification: null,
      canAnswerDirectly: false,
      summary: "Visitor is reporting a problem.",
    };
  }

  return {
    intent: "clarify",
    confidence: "low",
    needsRetrieval: true,
    retrievalQueries: [currentMessage.slice(0, 180)],
    escalate: chatState.clarificationAttempts >= 2,
    escalationReason:
      chatState.clarificationAttempts >= 2 ? "clarification_loop_avoided" : null,
    isRepeatedClarification: false,
    varyClarificationApproach: chatState.clarificationAttempts >= 1,
    suggestedClarification:
      chatState.clarificationAttempts >= 2
        ? null
        : "Could you share a bit more detail about what you're trying to do?",
    canAnswerDirectly: false,
    summary: "Visitor message needs clarification.",
  };
}

// ─── Main Router ─────────────────────────────────────────────────────────────

export interface RouteIntentInput {
  modelRuntime: ModelRuntimeState;
  conversationHistory: ConversationTurnMessage[];
  currentMessage: string;
  chatState: ConversationChatState;
  pageContext?: Record<string, string>;
  projectName: string;
  throwOnModelError?: boolean;
}

export async function routeIntent(
  input: RouteIntentInput,
): Promise<RouterDecision> {
  const recentHistory = input.conversationHistory.slice(-6);
  const transcript = recentHistory
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  const pageContextBlock =
    input.pageContext && Object.keys(input.pageContext).length > 0
      ? Object.entries(input.pageContext)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
      : "None";

  const askedClarificationsBlock =
    input.chatState.askedClarifications.length > 0
      ? input.chatState.askedClarifications
          .map((question, index) => `${index + 1}. ${question}`)
          .join("\n")
      : "None";

  const prompt = buildRouterPrompt({
    projectName: input.projectName,
    transcript,
    currentMessage: input.currentMessage,
    pageContextBlock,
    askedClarificationsBlock,
    clarificationAttempts: input.chatState.clarificationAttempts,
    lastBotQuestion: input.chatState.lastBotQuestion,
    lastIntent: input.chatState.lastIntent,
  });

  try {
    const object = await runWithModelFallback({
      runtime: input.modelRuntime,
      stage: "intent_router",
      operation: async (config) => {
        const model = createLanguageModel(config);
        const { object: decision } = await generateObject({
          model,
          schema: routerDecisionSchema,
          temperature: 0,
          maxOutputTokens: 512,
          prompt,
        });
        return decision;
      },
    });

    return normalizeDecision(object, input.chatState);
  } catch (error) {
    if (input.throwOnModelError === true) {
      throw error;
    }
    return fallbackRouterDecision(input.currentMessage, input.chatState);
  }
}

function normalizeDecision(
  decision: z.infer<typeof routerDecisionSchema>,
  chatState: ConversationChatState,
): RouterDecision {
  let {
    intent,
    escalate,
    escalationReason,
    suggestedClarification,
    canAnswerDirectly,
    needsRetrieval,
  } = decision;
  const { isRepeatedClarification, varyClarificationApproach } = decision;

  // Hard guard: never let the router choose clarify on attempt #3+.
  if (intent === "clarify" && chatState.clarificationAttempts >= 2) {
    intent = "handoff" as RouterIntent;
    escalate = true;
    escalationReason = escalationReason ?? "clarification_loop_avoided";
    suggestedClarification = null;
    canAnswerDirectly = false;
    needsRetrieval = false;
  }

  if (intent === "handoff") {
    escalate = true;
  }

  if (intent !== "clarify") {
    suggestedClarification = null;
  }

  return {
    intent,
    confidence: decision.confidence,
    needsRetrieval,
    retrievalQueries: decision.retrievalQueries,
    escalate,
    escalationReason,
    isRepeatedClarification,
    varyClarificationApproach,
    suggestedClarification,
    canAnswerDirectly,
    summary: decision.summary,
  };
}
