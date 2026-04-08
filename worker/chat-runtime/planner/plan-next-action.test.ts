import { describe, expect, test } from "bun:test";
import { sanitizePlannerDecision } from "./plan-next-action";
import {
  type PlannerDecision,
  type PlannerLoopState,
  type SupportToolDefinition,
  type SupportTurnPlan,
} from "../types";

function createTurnPlan(): SupportTurnPlan {
  return {
    intent: "troubleshoot",
    summary: "Help the visitor verify whether the widget is working.",
    retrievalQueries: ["widget troubleshooting"],
    broaderQueries: ["widget setup troubleshooting"],
    followUpQuestion: "What exact page, step, or error are you seeing?",
  };
}

function createState(): PlannerLoopState {
  return {
    goal: "Help the visitor verify whether the widget is working.",
    stepCount: 0,
    conversationSummary: null,
    initialTurnPlan: createTurnPlan(),
    actionHistory: [],
    docsEvidence: {
      ragContext: "",
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
    finalDraft: null,
    terminationReason: null,
  };
}

function createTool(overrides: Partial<SupportToolDefinition> = {}): SupportToolDefinition {
  return {
    name: "check_widget_status",
    displayName: "Check Widget Status",
    description: "Check widget installation status for a URL.",
    endpoint: "https://api.example.com/widget/status",
    method: "GET",
    headers: null,
    parameters: JSON.stringify([
      {
        name: "url",
        type: "string",
        description: "The page URL to inspect.",
        required: true,
      },
    ]),
    responseMapping: null,
    enabled: true,
    timeout: 10_000,
    ...overrides,
  };
}

function sanitize(options: {
  decision: PlannerDecision;
  state?: PlannerLoopState;
  tools?: SupportToolDefinition[];
}) {
  return sanitizePlannerDecision({
    decision: options.decision,
    currentMessage: "The widget is not working on my pricing page.",
    turnPlan: createTurnPlan(),
    availableTools: options.tools ?? [createTool()],
    state: options.state ?? createState(),
    maxSteps: 5,
  });
}

describe("sanitizePlannerDecision", () => {
  test("forces docs search before compose when no evidence exists", () => {
    const sanitized = sanitize({
      decision: {
        goal: "Answer immediately",
        nextAction: {
          type: "compose",
          reason: "Go straight to the answer.",
        },
      },
    });

    expect(sanitized.nextAction.type).toBe("search_docs");
  });

  test("converts missing required tool input into ask_user", () => {
    const sanitized = sanitize({
      decision: {
        goal: "Check live status",
        nextAction: {
          type: "call_tool",
          reason: "Need runtime evidence.",
          toolName: "check_widget_status",
          input: {},
        },
      },
    });

    expect(sanitized.nextAction.type).toBe("ask_user");
    if (sanitized.nextAction.type === "ask_user") {
      expect(sanitized.nextAction.question).toContain("url");
    }
  });

  test("avoids repeating the same docs query after evidence exists", () => {
    const state = createState();
    state.docsEvidence.retrievalAttempted = true;
    state.docsEvidence.ragContext = "<source file=\"docs/widget.md\">Install snippet</source>";
    state.docsEvidence.groundingConfidence = "low";
    state.actionHistory.push({
      type: "search_docs",
      reason: "First search",
      query: "widget troubleshooting",
      outcome: "executed",
      note: null,
    });

    const sanitized = sanitize({
      state,
      decision: {
        goal: "Search again",
        nextAction: {
          type: "search_docs",
          reason: "Repeat the same query.",
          query: "widget troubleshooting",
        },
      },
    });

    expect(sanitized.nextAction.type).toBe("compose");
  });

  test("stops repeated identical tool calls from looping", () => {
    const state = createState();
    state.docsEvidence.retrievalAttempted = true;
    state.toolEvidence.push({
      toolName: "check_widget_status",
      input: { url: "https://example.com/pricing" },
      output: { success: true, status: "ok" },
      error: null,
      success: true,
      durationMs: 123,
    });
    state.actionHistory.push({
      type: "call_tool",
      reason: "First tool call",
      toolName: "check_widget_status",
      input: { url: "https://example.com/pricing" },
      outcome: "executed",
      note: null,
    });

    const sanitized = sanitize({
      state,
      decision: {
        goal: "Run the same tool again",
        nextAction: {
          type: "call_tool",
          reason: "Retry identical request.",
          toolName: "check_widget_status",
          input: { url: "https://example.com/pricing" },
        },
      },
    });

    expect(sanitized.nextAction.type).toBe("compose");
  });

  test("enforces the planner step limit", () => {
    const state = createState();
    state.stepCount = 5;

    const sanitized = sanitize({
      state,
      decision: {
        goal: "One more step",
        nextAction: {
          type: "search_docs",
          reason: "Try again",
          query: "widget troubleshooting",
        },
      },
    });

    expect(sanitized.nextAction.type).toBe("stop");
  });
});
