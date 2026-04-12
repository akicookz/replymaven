import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import {
  type ConversationTurnMessage,
  type PlannerActionHistoryEntry,
  type PlannerAskUserAction,
  type PlannerDecision,
  type PlannerLoopState,
  type SupportToolDefinition,
  type SupportTurnPlan,
} from "../types";
import { buildIntentAwareFollowUpQuestion } from "../workflows/build-intent-aware-follow-up";
import { buildUnsupportedFallback } from "../workflows/verify-answer";
import {
  isDuplicateQuery,
  getQuerySemanticGroup,
  hasExhaustedSearchPatterns
} from "./query-deduplication";

interface ToolParameterDefinition {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  enum?: string[];
}

interface PlanNextActionOptions {
  model: LanguageModel;
  conversationHistory: ConversationTurnMessage[];
  currentMessage: string;
  pageContext?: Record<string, string>;
  turnPlan: SupportTurnPlan;
  availableTools: SupportToolDefinition[];
  state: PlannerLoopState;
}

interface SanitizePlannerDecisionOptions {
  decision: PlannerDecision;
  conversationHistory: ConversationTurnMessage[];
  currentMessage: string;
  turnPlan: SupportTurnPlan;
  availableTools: SupportToolDefinition[];
  state: PlannerLoopState;
  maxSteps: number;
}

const plannerActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("search_docs"),
    reason: z.string().min(1).max(220),
    query: z.string().min(3).max(220),
    broaderQueries: z.array(z.string().min(3).max(220)).max(3).optional(),
  }),
  z.object({
    type: z.literal("call_tool"),
    reason: z.string().min(1).max(220),
    toolName: z.string().min(1).max(120),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("ask_user"),
    reason: z.string().min(1).max(220),
    question: z.string().min(1).max(220),
  }),
  z.object({
    type: z.literal("offer_handoff"),
    reason: z.string().min(1).max(220),
  }),
  z.object({
    type: z.literal("collect_contact"),
    reason: z.string().min(1).max(220),
    missingFields: z.array(z.enum(["name", "email"])).min(1).max(2),
  }),
  z.object({
    type: z.literal("create_inquiry"),
    reason: z.string().min(1).max(220),
  }),
  z.object({
    type: z.literal("compose"),
    reason: z.string().min(1).max(220),
    answerStyle: z.enum(["direct", "step_by_step", "summary"]).optional(),
  }),
  z.object({
    type: z.literal("stop"),
    reason: z.string().min(1).max(220),
  }),
]);

const plannerDecisionSchema = z.object({
  goal: z.string().min(1).max(220),
  nextAction: plannerActionSchema,
});

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function buildToolCatalog(toolDefs: SupportToolDefinition[]): string {
  if (toolDefs.length === 0) {
    return "No assigned tools.";
  }

  return toolDefs
    .map((toolDef) => {
      const params = parseToolParameters(toolDef)
        .map((param) => {
          const required = param.required ? "required" : "optional";
          const enumHint = param.enum?.length ? ` Allowed values: ${param.enum.join(", ")}.` : "";
          return `- ${param.name} (${param.type}, ${required}): ${param.description}${enumHint}`;
        })
        .join("\n");

      return [
        `Tool: ${toolDef.name}`,
        `Description: ${toolDef.description}`,
        params ? `Parameters:\n${params}` : "Parameters: none",
      ].join("\n");
    })
    .join("\n\n");
}

function buildActionHistorySummary(history: PlannerActionHistoryEntry[]): string {
  if (history.length === 0) {
    return "No prior planner actions.";
  }

  return history
    .map((entry, index) => {
      const details = [
        `type=${entry.type}`,
        `reason=${entry.reason}`,
        entry.query ? `query=${entry.query}` : null,
        entry.toolName ? `tool=${entry.toolName}` : null,
        entry.note ? `note=${entry.note}` : null,
        `outcome=${entry.outcome}`,
      ]
        .filter(Boolean)
        .join("; ");

      return `${index + 1}. ${details}`;
    })
    .join("\n");
}

function buildDocsEvidenceSummary(state: PlannerLoopState): string {
  if (!state.docsEvidence.retrievalAttempted) {
    return "No documentation searches have been executed yet.";
  }

  if (!state.docsEvidence.ragContext.trim()) {
    return [
      `Docs search attempted. Grounding confidence: ${state.docsEvidence.groundingConfidence}.`,
      `Queries tried: ${state.docsEvidence.queries.join(" | ") || "none"}.`,
      state.docsEvidence.broaderQueries.length > 0
        ? `Broader queries: ${state.docsEvidence.broaderQueries.join(" | ")}.`
        : null,
      "No reliable documentation evidence was found yet.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Docs search attempted. Grounding confidence: ${state.docsEvidence.groundingConfidence}.`,
    `Queries tried: ${state.docsEvidence.queries.join(" | ") || "none"}.`,
    `Source count: ${state.docsEvidence.sourceReferences.length}.`,
    `RAG context:\n${state.docsEvidence.ragContext}`,
  ].join("\n");
}

function buildToolEvidenceSummary(state: PlannerLoopState): string {
  if (state.toolEvidence.length === 0) {
    return "No tool calls have executed yet.";
  }

  return state.toolEvidence
    .map((toolEvidence, index) => {
      return [
        `${index + 1}. Tool ${toolEvidence.toolName}`,
        `Success: ${toolEvidence.success}`,
        `Input: ${JSON.stringify(toolEvidence.input)}`,
        toolEvidence.error ? `Error: ${toolEvidence.error}` : null,
        `Output: ${JSON.stringify(toolEvidence.output).slice(0, 1200)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function parseToolParameters(
  toolDef: SupportToolDefinition,
): ToolParameterDefinition[] {
  try {
    const parsed = JSON.parse(toolDef.parameters) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];

      const record = entry as Record<string, unknown>;
      const type = record.type;
      if (type !== "string" && type !== "number" && type !== "boolean") {
        return [];
      }

      return [
        {
          name: typeof record.name === "string" ? record.name : "unknown",
          type,
          description:
            typeof record.description === "string"
              ? record.description
              : "No description provided.",
          required: record.required === true,
          enum: Array.isArray(record.enum)
            ? record.enum.filter((value): value is string => typeof value === "string")
            : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

function findToolByName(
  availableTools: SupportToolDefinition[],
  toolName: string,
): SupportToolDefinition | null {
  const normalizedToolName = normalizeValue(toolName);

  return (
    availableTools.find((tool) => normalizeValue(tool.name) === normalizedToolName) ??
    null
  );
}

function buildMissingInputQuestion(
  toolDef: SupportToolDefinition,
  missingParams: ToolParameterDefinition[],
): PlannerAskUserAction {
  const descriptions = missingParams.map((param) => {
    return param.description && param.description !== "No description provided."
      ? `${param.name} (${param.description})`
      : param.name;
  });

  const details =
    descriptions.length === 1
      ? descriptions[0]
      : `${descriptions.slice(0, -1).join(", ")} and ${descriptions.at(-1)}`;

  return {
    type: "ask_user",
    reason: `Missing required input before calling ${toolDef.name}.`,
    question: `To check that, I need ${details}. Could you share ${details}?`,
  };
}

function getSearchHistoryKey(query: string): string {
  return normalizeValue(query);
}

function hasGatheredEvidence(state: PlannerLoopState): boolean {
  return (
    state.docsEvidence.ragContext.trim().length > 0 ||
    state.toolEvidence.length > 0
  );
}

function getToolHistoryKey(
  toolName: string,
  input: Record<string, unknown>,
): string {
  return `${normalizeValue(toolName)}:${JSON.stringify(input, Object.keys(input).sort())}`;
}

function buildClarificationQuestion(
  turnPlan: SupportTurnPlan,
  currentMessage: string,
): string {
  return (
    turnPlan.followUpQuestion ??
    buildIntentAwareFollowUpQuestion({
      userMessage: currentMessage,
      intent: turnPlan.intent,
    })
  );
}

function isExplicitHumanRequest(message: string): boolean {
  const normalized = normalizeValue(message);
  if (!normalized) return false;

  if (/\b(live agent|human|support team|talk to support|talk to a human|engineer)\b/.test(normalized)) {
    return true;
  }

  const wantsHuman =
    /\b(human|person|agent|engineer|support team|team member|representative|someone)\b/.test(
      normalized,
    );
  const asksForContact =
    /\b(help|talk|speak|contact|reach|connect|escalate|handoff|hand off|follow up)\b/.test(
      normalized,
    );

  return wantsHuman && asksForContact;
}

function isAffirmativeConfirmation(message: string): boolean {
  const normalized = normalizeValue(message);
  return /^(yes|yeah|yep|sure|ok|okay|please do|go ahead|do it|sounds good|that works)\b/.test(
    normalized,
  );
}

function getLastAssistantMessage(
  conversationHistory: ConversationTurnMessage[],
): string | null {
  for (let index = conversationHistory.length - 1; index >= 0; index--) {
    const message = conversationHistory[index];
    if (message.role === "bot" || message.role === "agent") {
      return message.content;
    }
  }

  return null;
}

function lastAssistantOfferedHandoff(
  conversationHistory: ConversationTurnMessage[],
): boolean {
  const lastAssistantMessage = getLastAssistantMessage(conversationHistory);
  if (!lastAssistantMessage) return false;

  return /\b(forward this|forward your request|forward this to the team|team follow up|engineer|follow up shortly|would you like me to forward|reply yes)\b/i.test(
    lastAssistantMessage,
  );
}

function lastAssistantRequestedContact(
  conversationHistory: ConversationTurnMessage[],
): boolean {
  const lastAssistantMessage = getLastAssistantMessage(conversationHistory);
  if (!lastAssistantMessage) return false;

  return /before i do, could you share your (name|email)|share your name and email so they can follow up directly|share your email so they can follow up directly|share your name so they know who to follow up with/i.test(
    lastAssistantMessage,
  );
}

function isDecliningContactDetails(message: string): boolean {
  const normalized = normalizeValue(message);
  if (!normalized) return false;

  return /\b(no email|no e-mail|don't want to share|do not want to share|rather not share|prefer not to share|no thanks|continue here|in this chat|reply here|keep it in chat|without email|without e-mail)\b/.test(
    normalized,
  );
}

function hasPriorIssueContext(
  conversationHistory: ConversationTurnMessage[],
  currentMessage: string,
): boolean {
  return conversationHistory.some((message) => {
    if (message.role !== "visitor") {
      return false;
    }

    if (message.content.trim() === currentMessage.trim()) {
      return false;
    }

    if (isExplicitHumanRequest(message.content) || isAffirmativeConfirmation(message.content)) {
      return false;
    }

    return message.content.trim().length >= 12;
  });
}

function getMissingContactFields(state: PlannerLoopState): Array<"name" | "email"> {
  const missingFields: Array<"name" | "email"> = [];

  if (!state.knownVisitorName?.trim()) {
    missingFields.push("name");
  }

  if (!state.knownVisitorEmail?.trim()) {
    missingFields.push("email");
  }

  return missingFields;
}

export async function planNextAction(
  options: PlanNextActionOptions,
): Promise<PlannerDecision> {
  const recentHistory = options.conversationHistory.slice(-8);
  const transcript = recentHistory
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const pageContextBlock =
    options.pageContext && Object.keys(options.pageContext).length > 0
      ? Object.entries(options.pageContext)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
      : "None";

  const { object } = await generateObject({
    model: options.model,
    schema: plannerDecisionSchema,
    temperature: 0,
    maxOutputTokens: 600,
    prompt: `Choose the next bounded action for a support-chat planner.

Conversation:
${transcript || "No prior conversation"}

Latest visitor message:
${options.currentMessage}

Page context:
${pageContextBlock}

Initial turn analysis:
- intent: ${options.turnPlan.intent}
- summary: ${options.turnPlan.summary}
- retrievalQueries: ${options.turnPlan.retrievalQueries.join(" | ") || "none"}
- broaderQueries: ${options.turnPlan.broaderQueries.join(" | ") || "none"}
- focusedFollowUp: ${options.turnPlan.followUpQuestion ?? "none"}

Current planner state:
- goal: ${options.state.goal}
- stepCount: ${options.state.stepCount}
- missingInputs: ${options.state.missingInputs.join(", ") || "none"}
- knownVisitorName: ${options.state.knownVisitorName ?? "unknown"}
- knownVisitorEmail: ${options.state.knownVisitorEmail ?? "unknown"}
- handoffRequested: ${options.state.handoffRequested}
- awaitingHandoffConfirmation: ${options.state.awaitingHandoffConfirmation}
- awaitingContactFields: ${options.state.awaitingContactFields.join(", ") || "none"}
- contactDeclined: ${options.state.contactDeclined}

Action history:
${buildActionHistorySummary(options.state.actionHistory)}

Documentation evidence:
${buildDocsEvidenceSummary(options.state)}

Tool evidence:
${buildToolEvidenceSummary(options.state)}

Assigned tools:
${buildToolCatalog(options.availableTools)}

Allowed next actions:
- search_docs: search the knowledge base again with a better query
- call_tool: call exactly one assigned tool with explicit input
- ask_user: ask one focused question when a required detail is missing
- offer_handoff: offer team follow-up when support is exhausted and wait for confirmation
- collect_contact: ask only for the missing name/email needed for a team follow-up
- create_inquiry: create the actual team follow-up request in runtime
- compose: answer now using the gathered evidence
- stop: no safe next action remains

Rules:
- Output exactly one next action.
- Priority order for finding answers: 1) Check SOPs/guidelines, 2) Check FAQs, 3) Search knowledge base multiple times
- Prefer search_docs before call_tool when documentation can clarify expected product behavior.
- Always attempt at least 3 different search_docs queries before concluding information is not available
- Try: 1) exact terms, 2) synonyms/related terms, 3) broader category searches
- Explicitly search for FAQ patterns like "how to", "what is", "why does"
- Use call_tool only when a tool is clearly needed and the required inputs are available.
- If a required tool input is missing, choose ask_user instead of guessing.
- If the visitor explicitly asks for a human, do not route them back into normal docs troubleshooting unless the issue context is still missing.
- Use offer_handoff only when you need visitor confirmation before forwarding.
- Use collect_contact only when optional contact details would genuinely help follow-up and the visitor has not already declined to share them.
- Use create_inquiry when the visitor wants human follow-up, there is enough issue context to forward, and either contact details are already known or the visitor has declined to share them.
- When documentation is weak or missing, prefer search_docs with different queries over compose.
- Exhaust at least 3 different search attempts before considering ask_user or offer_handoff.
- Choose compose ONLY when SOPs, FAQs, or docs/tool evidence directly answers the question.
- Do NOT compose answers based on general context or business domain knowledge without explicit documentation.
- When partial information exists across tiers:
  * Combine complementary information from different tiers only if no conflicts exist
  * Clearly indicate confidence level when merging partial matches
  * If tier-1 has partial info, do not supplement with lower-tier speculation
  * Tier-1 partial answers are better than complete lower-tier answers
- Never name a tool that is not in the assigned tools list.
- Never repeat the same search query or same tool call unless you have a materially different reason.
- Only use ask_user when critical details are genuinely missing relative to the business context and what would be reasonable to expect.

Anti-loop rules (CRITICAL):
- If action history already contains one or more ask_user entries, do NOT choose ask_user again. Instead choose offer_handoff, create_inquiry, or compose with best-effort grounding.
- Never repeat the same ask_user question or a paraphrase of it. Cross-check the action history before picking ask_user.
- If the visitor already provided an image, URL, page context, or specific feature name, do NOT ask what feature/page they mean. Use what they gave you.
- If the visitor shows frustration signals ("useless", "not helping", "stop asking", "I already said"), immediately prefer offer_handoff over any further ask_user.

- If no safe action remains, choose stop.`,
  });

  return {
    goal: object.goal,
    nextAction: object.nextAction,
  };
}

export function fallbackPlanNextAction(options: {
  conversationHistory: ConversationTurnMessage[];
  currentMessage: string;
  turnPlan: SupportTurnPlan;
  availableTools: SupportToolDefinition[];
  state: PlannerLoopState;
  maxSteps: number;
}): PlannerDecision {
  if (options.state.stepCount >= options.maxSteps) {
    return {
      goal: options.state.goal,
      nextAction: {
        type: "stop",
        reason: "Planner step limit reached.",
      },
    };
  }

  const explicitHumanRequest =
    options.turnPlan.intent === "handoff" ||
    isExplicitHumanRequest(options.currentMessage);
  const confirmedHandoff =
    isAffirmativeConfirmation(options.currentMessage) &&
    lastAssistantOfferedHandoff(options.conversationHistory);
  const contactFollowUp =
    options.state.awaitingContactFields.length > 0 ||
    lastAssistantRequestedContact(options.conversationHistory);
  const hasIssueContext = hasPriorIssueContext(
    options.conversationHistory,
    options.currentMessage,
  );
  const missingContactFields = getMissingContactFields(options.state);
  const contactDeclined =
    options.state.contactDeclined ||
    (contactFollowUp && isDecliningContactDetails(options.currentMessage));

  if (explicitHumanRequest || confirmedHandoff || contactFollowUp) {
    if (!hasIssueContext && explicitHumanRequest) {
      return {
        goal: options.state.goal,
        nextAction: {
          type: "offer_handoff",
          reason: "A human was requested but the issue context is still too thin to forward cleanly.",
        },
      };
    }

    if (contactFollowUp && contactDeclined) {
      return {
        goal: options.state.goal,
        nextAction: {
          type: "create_inquiry",
          reason: "The visitor declined to share contact details but still wants human follow-up.",
        },
      };
    }

    if (missingContactFields.length > 0 && !contactFollowUp) {
      return {
        goal: options.state.goal,
        nextAction: {
          type: "collect_contact",
          reason: "Team follow-up is requested but contact details are missing.",
          missingFields: missingContactFields,
        },
      };
    }

    return {
      goal: options.state.goal,
      nextAction: {
        type: "create_inquiry",
        reason: "The visitor wants human follow-up and enough issue context is available.",
      },
    };
  }

  if (!options.state.docsEvidence.retrievalAttempted) {
    return {
      goal: options.state.goal,
      nextAction: {
        type: "search_docs",
        reason: "Start with documentation before taking other actions.",
        query:
          options.turnPlan.retrievalQueries[0] ??
          options.currentMessage,
        broaderQueries: options.turnPlan.broaderQueries.slice(0, 2),
      },
    };
  }

  if (
    options.state.docsEvidence.ragContext.trim() ||
    options.state.toolEvidence.length > 0
  ) {
    return {
      goal: options.state.goal,
      nextAction: {
        type: "compose",
        reason: "There is enough evidence to draft a grounded reply.",
      },
    };
  }

  // Let the LLM decide if there's enough context to compose based on the business domain
  // This decision should be made by the LLM in planNextAction, not through hardcoded patterns

  return {
    goal: options.state.goal,
    nextAction: {
      type: "ask_user",
      reason: "The request still needs a concrete detail to continue.",
      question: buildClarificationQuestion(
        options.turnPlan,
        options.currentMessage,
      ),
    },
  };
}

export function sanitizePlannerDecision(
  options: SanitizePlannerDecisionOptions,
): PlannerDecision {
  if (options.state.stepCount >= options.maxSteps) {
    return {
      goal: options.state.goal,
      nextAction: {
        type: "stop",
        reason: "Planner step limit reached.",
      },
    };
  }

  const nextGoal = options.decision.goal.trim() || options.state.goal;
  const nextAction = options.decision.nextAction;

  if (nextAction.type === "search_docs") {
    // Check for exact duplicate
    const queryKey = getSearchHistoryKey(nextAction.query);
    const alreadySearched = options.state.actionHistory.some(
      (entry) =>
        entry.type === "search_docs" &&
        entry.query &&
        getSearchHistoryKey(entry.query) === queryKey,
    );

    // Check for semantic duplicate
    const previousQueries = options.state.actionHistory
      .filter((entry) => entry.type === "search_docs" && entry.query)
      .map((entry) => entry.query as string);

    const isDuplicate = isDuplicateQuery(nextAction.query, previousQueries, 0.8);

    if (alreadySearched || isDuplicate) {
      // 1. Evidence already gathered → compose, regardless of search count.
      if (hasGatheredEvidence(options.state)) {
        return {
          goal: nextGoal,
          nextAction: {
            type: "compose",
            reason: "The same documentation search already ran; compose from gathered evidence.",
          },
        };
      }

      // 2. No evidence + exhausted semantic patterns → ask_user.
      const semanticGroup = getQuerySemanticGroup(nextAction.query);
      const semanticGroups = options.state.queryTracker?.semanticGroups || [];

      if (hasExhaustedSearchPatterns(semanticGroup, semanticGroups, 3)) {
        return {
          goal: nextGoal,
          nextAction: {
            type: "ask_user",
            reason: "Multiple search attempts with no results; need more specific information.",
            question: buildClarificationQuestion(
              options.turnPlan,
              options.currentMessage,
            ),
          },
        };
      }

      // 3. No evidence, not exhausted → try a genuinely unused query from the plan.
      const unusedVariation =
        options.turnPlan.retrievalQueries.find(
          (query) =>
            query.trim().length > 0 &&
            !previousQueries.some(
              (prev) => getSearchHistoryKey(prev) === getSearchHistoryKey(query),
            ),
        ) ??
        options.turnPlan.broaderQueries.find(
          (query) =>
            query.trim().length > 0 &&
            !previousQueries.some(
              (prev) => getSearchHistoryKey(prev) === getSearchHistoryKey(query),
            ),
        );

      if (unusedVariation) {
        return {
          goal: nextGoal,
          nextAction: {
            type: "search_docs",
            reason: `Trying alternate query variation from plan (attempt ${previousQueries.length + 1}/3).`,
            query: unusedVariation.trim(),
            broaderQueries: [],
          },
        };
      }

      // 4. No unused variations left → ask_user.
      return {
        goal: nextGoal,
        nextAction: {
          type: "ask_user",
          reason: "The same docs query already failed and no unused variations remain.",
          question: buildClarificationQuestion(
            options.turnPlan,
            options.currentMessage,
          ),
        },
      };
    }

    return {
      goal: nextGoal,
      nextAction: {
        ...nextAction,
        query: nextAction.query.trim(),
        broaderQueries:
          nextAction.broaderQueries?.map((query) => query.trim()).filter(Boolean) ?? [],
      },
    };
  }

  if (nextAction.type === "call_tool") {
    const toolDef = findToolByName(options.availableTools, nextAction.toolName);
    if (!toolDef) {
      if (!options.state.docsEvidence.retrievalAttempted) {
        return {
          goal: nextGoal,
          nextAction: {
            type: "search_docs",
            reason: "The requested tool is not assigned, so retry with docs first.",
            query:
              options.turnPlan.retrievalQueries[0] ??
              options.currentMessage,
            broaderQueries: options.turnPlan.broaderQueries.slice(0, 2),
          },
        };
      }

      return {
        goal: nextGoal,
        nextAction: {
          type: "ask_user",
          reason: "The requested tool is not available, so narrow the issue with one question.",
          question: buildClarificationQuestion(
            options.turnPlan,
            options.currentMessage,
          ),
        },
      };
    }

    const requiredParams = parseToolParameters(toolDef).filter((param) => param.required);
    const missingParams = requiredParams.filter((param) => {
      const value = nextAction.input[param.name];
      return value === undefined || value === null || String(value).trim() === "";
    });

    if (missingParams.length > 0) {
      return {
        goal: nextGoal,
        nextAction: buildMissingInputQuestion(toolDef, missingParams),
      };
    }

    const toolHistoryKey = getToolHistoryKey(toolDef.name, nextAction.input);
    const alreadyCalled = options.state.actionHistory.some((entry) => {
      if (entry.type !== "call_tool" || !entry.toolName || !entry.input) {
        return false;
      }

      return getToolHistoryKey(entry.toolName, entry.input) === toolHistoryKey;
    });

    if (alreadyCalled) {
      if (
        options.state.docsEvidence.ragContext.trim() ||
        options.state.toolEvidence.length > 0
      ) {
        return {
          goal: nextGoal,
          nextAction: {
            type: "compose",
            reason: "That tool call already ran with the same input; use the evidence already gathered.",
          },
        };
      }

      return {
        goal: nextGoal,
        nextAction: {
          type: "stop",
          reason: "The same tool call already ran and no new evidence path remains.",
        },
      };
    }

    return {
      goal: nextGoal,
      nextAction: {
        ...nextAction,
        toolName: toolDef.name,
      },
    };
  }

  if (nextAction.type === "compose") {
    if (
      !options.state.docsEvidence.ragContext.trim() &&
      options.state.toolEvidence.length === 0
    ) {
      if (!options.state.docsEvidence.retrievalAttempted) {
        return {
          goal: nextGoal,
          nextAction: {
            type: "search_docs",
            reason: "Compose is not allowed before any evidence is gathered.",
            query:
              options.turnPlan.retrievalQueries[0] ??
              options.currentMessage,
            broaderQueries: options.turnPlan.broaderQueries.slice(0, 2),
          },
        };
      }

      return {
        goal: nextGoal,
        nextAction: {
          type: "ask_user",
          reason: "Compose is not allowed because the current evidence is still empty.",
          question: buildUnsupportedFallback(
            options.currentMessage,
            options.turnPlan.intent,
          ),
        },
      };
    }
  }

  if (nextAction.type === "offer_handoff") {
    const explicitHumanRequest =
      options.turnPlan.intent === "handoff" ||
      isExplicitHumanRequest(options.currentMessage);
    const hasIssueContext = hasPriorIssueContext(
      options.conversationHistory,
      options.currentMessage,
    );

    if (explicitHumanRequest && hasIssueContext) {
      const missingContactFields = getMissingContactFields(options.state);
      if (missingContactFields.length > 0) {
        return {
          goal: nextGoal,
          nextAction: {
            type: "collect_contact",
            reason: "A human was explicitly requested and contact details are still missing.",
            missingFields: missingContactFields,
          },
        };
      }

      return {
        goal: nextGoal,
        nextAction: {
          type: "create_inquiry",
          reason: "A human was explicitly requested and enough context already exists.",
        },
      };
    }
  }

  if (nextAction.type === "collect_contact") {
    if (options.state.contactDeclined) {
      return {
        goal: nextGoal,
        nextAction: {
          type: "create_inquiry",
          reason: "The visitor declined contact details, so proceed with the inquiry without them.",
        },
      };
    }

    const missingFields = nextAction.missingFields.filter(
      (field) =>
        (field === "name" && !options.state.knownVisitorName?.trim()) ||
        (field === "email" && !options.state.knownVisitorEmail?.trim()),
    );

    if (missingFields.length === 0) {
      return {
        goal: nextGoal,
        nextAction: {
          type: "create_inquiry",
          reason: "The required contact details are already available.",
        },
      };
    }

    return {
      goal: nextGoal,
      nextAction: {
        ...nextAction,
        missingFields,
      },
    };
  }

  if (nextAction.type === "create_inquiry") {
    const missingFields = getMissingContactFields(options.state);
    if (
      missingFields.length > 0 &&
      !options.state.contactDeclined &&
      options.state.awaitingContactFields.length === 0
    ) {
      return {
        goal: nextGoal,
        nextAction: {
          type: "collect_contact",
          reason: "An inquiry cannot be created until the missing contact details are collected.",
          missingFields,
        },
      };
    }
  }

  if (nextAction.type === "ask_user") {
    return {
      goal: nextGoal,
      nextAction: {
        ...nextAction,
        question: nextAction.question.trim(),
      },
    };
  }

  return {
    goal: nextGoal,
    nextAction,
  };
}
