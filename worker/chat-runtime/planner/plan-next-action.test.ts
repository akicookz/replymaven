import { describe, expect, test } from "bun:test";
import { type PlannerDecision, type PlannerLoopState, type SupportToolDefinition } from "../types";
import {
  fallbackPlanNextAction,
  recoverPlannerDecisionFromText,
  sanitizePlannerDecision,
} from "./plan-next-action";

function createState(): PlannerLoopState {
  return {
    goal: "Resolve the support request.",
    stepCount: 0,
    conversationSummary: null,
    actionHistory: [],
    docsEvidence: {
      ragContext: "",
      faqContext: "",
      knowledgeBaseContext: "",
      sourceReferences: [],
      groundingConfidence: "none",
      unresolvedKeys: [],
      droppedCrossTenant: 0,
      retrievalAttempted: false,
      broaderSearchAttempted: false,
      queries: [],
      broaderQueries: [],
    },
    toolEvidence: [],
    missingInputs: [],
    knownVisitorName: null,
    knownVisitorEmail: null,
    handoffRequested: false,
    awaitingHandoffConfirmation: false,
    awaitingContactFields: [],
    contactDeclined: false,
    handoffSummary: null,
    finalDraft: null,
    terminationReason: null,
    reformulationUsed: false,
    queryTracker: { normalizedQueries: new Map<string, number>(), semanticGroups: [] },
    intent: null,
    clarificationAttempts: 0,
    lastBotQuestion: null,
  };
}

function createTool(): SupportToolDefinition {
  return {
    name: "check_status",
    displayName: "Check status",
    description: "Checks status.",
    endpoint: "https://api.example.com/status",
    method: "GET",
    headers: null,
    parameters: JSON.stringify([{ name: "url", type: "string", description: "Page URL", required: true }]),
    responseMapping: null,
    enabled: true,
    timeout: 10_000,
  };
}

function sanitize(decision: PlannerDecision, state = createState()) {
  return sanitizePlannerDecision({
    decision,
    conversationHistory: [],
    currentMessage: "The widget is broken.",
    availableTools: [createTool()],
    state,
    maxSteps: 5,
  });
}

describe("planner safety invariants", () => {
  test("requires retrieval before a grounded answer without evidence", () => {
    const result = sanitize({
      goal: "Answer now",
      nextAction: { type: "compose", reason: "Answer now", composeKind: "grounded" },
    });

    expect(result.nextAction.type).toBe("search_docs");
  });

  test("asks for missing required tool input instead of guessing", () => {
    const result = sanitize({
      goal: "Inspect status",
      nextAction: { type: "call_tool", reason: "Need status", toolName: "check_status", input: {} },
    });

    expect(result.nextAction.type).toBe("ask_user");
  });

  test("terminates repeated work and bounded planning", () => {
    const searched = createState();
    searched.docsEvidence.retrievalAttempted = true;
    searched.docsEvidence.ragContext = "evidence";
    searched.actionHistory.push({
      type: "search_docs",
      reason: "First search",
      query: "widget troubleshooting",
      outcome: "executed",
      note: null,
    });
    const duplicate = sanitize(
      { goal: "Search again", nextAction: { type: "search_docs", reason: "Repeat", query: "widget troubleshooting" } },
      searched,
    );

    const exhausted = createState();
    exhausted.stepCount = 5;
    const limit = sanitize(
      { goal: "One more", nextAction: { type: "search_docs", reason: "Retry", query: "widget troubleshooting" } },
      exhausted,
    );

    expect(duplicate.nextAction.type).toBe("compose");
    expect(limit.nextAction.type).toBe("compose");
  });

  test("stops an identical tool call from running twice", () => {
    const state = createState();
    const input = { url: "https://example.com/pricing" };
    state.toolEvidence.push({
      toolName: "check_status",
      input,
      output: { status: "ok" },
      error: null,
      success: true,
      durationMs: 25,
    });
    state.actionHistory.push({
      type: "call_tool",
      reason: "Initial status check",
      toolName: "check_status",
      input,
      outcome: "executed",
      note: null,
    });

    const result = sanitize(
      {
        goal: "Check status again",
        nextAction: {
          type: "call_tool",
          reason: "Repeat the same check",
          toolName: "check_status",
          input,
        },
      },
      state,
    );

    expect(result.nextAction.type).toBe("compose");
  });

  test("does not ask a third clarification question", () => {
    const state = createState();
    state.clarificationAttempts = 2;
    const result = sanitize(
      { goal: "Clarify", nextAction: { type: "ask_user", reason: "Need context", question: "Which page?" } },
      state,
    );

    expect(result.nextAction.type).toBe("offer_handoff");
  });

  test("continues helping rather than reopening an active handoff", () => {
    const state = createState();
    state.handoffRequested = true;
    const result = sanitize(
      { goal: "Help", nextAction: { type: "escalate", reason: "Ask again" } },
      state,
    );

    expect(result.nextAction.type).toBe("search_docs");
  });
});

test("persisted contact state proceeds without relying on a prior message's wording", () => {
  const state = createState();
  state.awaitingContactFields = ["email"];
  state.contactDeclined = true;

  const result = fallbackPlanNextAction({
    conversationHistory: [
      { role: "visitor", content: "The crawl misses most pages." },
      { role: "bot", content: "¿Podrías compartir tu correo?" },
    ],
    currentMessage: "No email; continue here.",
    availableTools: [],
    state,
    maxSteps: 5,
  });

  expect(result.nextAction.type).toBe("escalate");
});

describe("recoverPlannerDecisionFromText", () => {
  test("recovers a valid planner decision from fenced JSON with surrounding prose", () => {
    const response = `Planner result:\n\`\`\`json
${JSON.stringify({
  goal: "Answer the billing question",
  intent: "policy",
  actionType: "compose",
  reason: "The FAQ contains the answer",
  query: null,
  broaderQueries: null,
  toolName: null,
  toolInput: null,
  question: null,
  missingFields: null,
  answerStyle: "direct",
  composeKind: "grounded",
})}
\`\`\`\nReady to compose.`;

    expect(recoverPlannerDecisionFromText(response)).toMatchObject({
      goal: "Answer the billing question",
      actionType: "compose",
      composeKind: "grounded",
    });
  });

  test("rejects text that does not contain a schema-valid planner decision", () => {
    expect(
      recoverPlannerDecisionFromText(
        'Planner result: {"actionType":"unsupported"}',
      ),
    ).toBeNull();
  });
});
