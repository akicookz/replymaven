import { describe, expect, test } from "bun:test";
import { fallbackPlanNextAction, sanitizePlannerDecision } from "./plan-next-action";
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
  conversationHistory?: Array<{ role: "visitor" | "bot" | "agent"; content: string }>;
}) {
  return sanitizePlannerDecision({
    decision: options.decision,
    conversationHistory:
      options.conversationHistory ?? [
        {
          role: "visitor",
          content: "The widget is not working on my pricing page.",
        },
      ],
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

  test("asks for contact once before creating inquiry when contact info is missing", () => {
    const sanitized = sanitize({
      decision: {
        goal: "Forward this to the team",
        nextAction: {
          type: "create_inquiry",
          reason: "Human follow-up requested.",
        },
      },
      conversationHistory: [
        {
          role: "visitor",
          content: "The SEO Spider crawl is missing most of my pages.",
        },
        {
          role: "visitor",
          content: "I need a live agent.",
        },
      ],
    });

    expect(sanitized.nextAction.type).toBe("collect_contact");
  });

  test("allows create_inquiry after contact details were declined", () => {
    const state = createState();
    state.awaitingContactFields = ["email"];
    state.contactDeclined = true;

    const sanitized = sanitize({
      state,
      decision: {
        goal: "Forward this to the team",
        nextAction: {
          type: "create_inquiry",
          reason: "The visitor still wants human follow-up.",
        },
      },
      conversationHistory: [
        {
          role: "bot",
          content:
            "I can forward this to the team. Before I do, could you share your email so they can follow up directly? If you'd rather keep it in chat, just say that.",
        },
        {
          role: "visitor",
          content: "Please just keep it in chat.",
        },
      ],
    });

    expect(sanitized.nextAction.type).toBe("create_inquiry");
  });
});

describe("fallbackPlanNextAction", () => {
  test("moves explicit human requests into contact collection when issue context exists", () => {
    const state = createState();

    const decision = fallbackPlanNextAction({
      conversationHistory: [
        {
          role: "visitor",
          content: "The SEO Spider crawl is only finding 40 out of 300 pages.",
        },
        {
          role: "visitor",
          content: "live agent",
        },
      ],
      currentMessage: "live agent",
      turnPlan: {
        ...createTurnPlan(),
        intent: "handoff",
        summary: "The visitor wants human help with an incomplete SEO Spider crawl.",
      },
      availableTools: [createTool()],
      state,
      maxSteps: 5,
    });

    expect(decision.nextAction.type).toBe("collect_contact");
  });

  test("proceeds to inquiry when visitor declines contact after a contact request", () => {
    const state = createState();
    state.awaitingContactFields = ["email"];
    state.contactDeclined = true;

    const decision = fallbackPlanNextAction({
      conversationHistory: [
        {
          role: "visitor",
          content: "The SEO Spider crawl is only finding 40 out of 300 pages.",
        },
        {
          role: "bot",
          content:
            "I can forward this to the team. Before I do, could you share your email so they can follow up directly? If you'd rather keep it in chat, just say that.",
        },
        {
          role: "visitor",
          content: "No email, please keep it in chat.",
        },
      ],
      currentMessage: "No email, please keep it in chat.",
      turnPlan: {
        ...createTurnPlan(),
        intent: "handoff",
        summary: "The visitor wants human help with an incomplete SEO Spider crawl.",
      },
      availableTools: [createTool()],
      state,
      maxSteps: 5,
    });

    expect(decision.nextAction.type).toBe("create_inquiry");
  });

  test("does not mistake generic contact wording for contact collection flow", () => {
    const state = createState();
    state.docsEvidence.retrievalAttempted = true;

    const decision = fallbackPlanNextAction({
      conversationHistory: [
        {
          role: "bot",
          content: "You can contact support from the dashboard settings page.",
        },
        {
          role: "visitor",
          content: "Still broken on my pricing page.",
        },
      ],
      currentMessage: "Still broken on my pricing page.",
      turnPlan: createTurnPlan(),
      availableTools: [createTool()],
      state,
      maxSteps: 5,
    });

    expect(decision.nextAction.type).not.toBe("create_inquiry");
    expect(decision.nextAction.type).not.toBe("collect_contact");
  });
});
