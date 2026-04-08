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
import { buildUnsupportedFallback } from "../workflows/verify-answer";

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

function getToolHistoryKey(
  toolName: string,
  input: Record<string, unknown>,
): string {
  return `${normalizeValue(toolName)}:${JSON.stringify(input, Object.keys(input).sort())}`;
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
- compose: answer now using the gathered evidence
- stop: no safe next action remains

Rules:
- Output exactly one next action.
- Prefer search_docs before call_tool when documentation can clarify expected product behavior.
- Use call_tool only when a tool is clearly needed and the required inputs are available.
- If a required tool input is missing, choose ask_user instead of guessing.
- Choose compose only when the existing docs evidence or tool evidence is enough to answer honestly.
- Never name a tool that is not in the assigned tools list.
- Never repeat the same search query or same tool call unless you have a materially different reason.
- If the current evidence is weak and the visitor did not provide enough detail, choose ask_user.
- If no safe action remains, choose stop.`,
  });

  return {
    goal: object.goal,
    nextAction: object.nextAction,
  };
}

export function fallbackPlanNextAction(options: {
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

  return {
    goal: options.state.goal,
    nextAction: {
      type: "ask_user",
      reason: "The request still needs a concrete detail to continue.",
      question:
        options.turnPlan.followUpQuestion ??
        "Could you share the exact feature, page, step, or error you want me to check?",
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
    const queryKey = getSearchHistoryKey(nextAction.query);
    const alreadySearched = options.state.actionHistory.some(
      (entry) =>
        entry.type === "search_docs" &&
        entry.query &&
        getSearchHistoryKey(entry.query) === queryKey,
    );

    if (alreadySearched) {
      if (
        options.state.docsEvidence.ragContext.trim() ||
        options.state.toolEvidence.length > 0
      ) {
        return {
          goal: nextGoal,
          nextAction: {
            type: "compose",
            reason: "The same documentation search already ran; compose from gathered evidence.",
          },
        };
      }

      return {
        goal: nextGoal,
        nextAction: {
          type: "ask_user",
          reason: "The same docs query already failed and more detail is required.",
          question:
            options.turnPlan.followUpQuestion ??
            "Could you share the exact feature, page, step, or error you want me to check?",
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
          question:
            options.turnPlan.followUpQuestion ??
            "Could you share the exact feature, page, step, or error you want me to check?",
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
          question:
            options.turnPlan.followUpQuestion ??
            buildUnsupportedFallback(options.currentMessage),
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
