import { describe, expect, test } from "bun:test";
import {
  fallbackPlanNextAction,
  planNextAction,
  recoverPlannerDecisionFromText,
  sanitizePlannerDecision,
} from "./plan-next-action";
import {
  type PlannerDecision,
  type PlannerLoopState,
  type SupportToolDefinition,
  type SupportTurnPlan,
} from "../types";
import { createLanguageModel } from "../llm/create-language-model";

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
    reformulationUsed: false,
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

    expect(sanitized.nextAction.type).toBe("compose");
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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const hasGeminiKey = !!GEMINI_API_KEY;

const llmDescribe = hasGeminiKey ? describe : describe.skip;

llmDescribe("planNextAction (LLM integration)", () => {
  function createModel() {
    return createLanguageModel({
      model: "gemini-3-flash-preview",
      geminiApiKey: GEMINI_API_KEY!,
      openaiApiKey: null,
    });
  }

  test("greeting produces compose action", async () => {
    const state = createState();
    state.docsEvidence.retrievalAttempted = true;

    const decision = await planNextAction({
      model: createModel(),
      conversationHistory: [],
      currentMessage: "Hello!",
      turnPlan: {
        intent: "greeting",
        summary: "The visitor is greeting the bot.",
        retrievalQueries: [],
        broaderQueries: [],
        followUpQuestion: null,
      },
      availableTools: [],
      state,
    });

    expect(decision.nextAction.type).toBe("compose");
  }, 15_000);

  test("product question triggers search_docs when no evidence", async () => {
    const decision = await planNextAction({
      model: createModel(),
      conversationHistory: [],
      currentMessage: "How do I set up the chat widget on my website?",
      turnPlan: {
        intent: "how_to",
        summary: "The visitor wants to install the chat widget.",
        retrievalQueries: ["chat widget setup", "install widget"],
        broaderQueries: ["widget installation guide"],
        followUpQuestion: null,
      },
      availableTools: [],
      state: createState(),
    });

    expect(decision.nextAction.type).toBe("search_docs");
  }, 15_000);

  test("resolution signal produces compose action", async () => {
    const state = createState();
    state.docsEvidence.retrievalAttempted = true;
    state.docsEvidence.ragContext = "<source>Widget docs</source>";
    state.docsEvidence.groundingConfidence = "high";

    const decision = await planNextAction({
      model: createModel(),
      conversationHistory: [
        { role: "visitor", content: "How do I install the widget?" },
        { role: "bot", content: "Add the script tag to your HTML head section." },
      ],
      currentMessage: "Thanks, that worked!",
      turnPlan: {
        intent: "resolution",
        summary: "The visitor confirms the issue is resolved.",
        retrievalQueries: [],
        broaderQueries: [],
        followUpQuestion: null,
      },
      availableTools: [],
      state,
    });

    expect(decision.nextAction.type).toBe("compose");
  }, 15_000);

  test("explicit human request triggers handoff flow", async () => {
    const state = createState();
    state.docsEvidence.retrievalAttempted = true;

    const decision = await planNextAction({
      model: createModel(),
      conversationHistory: [
        { role: "visitor", content: "My billing is completely wrong and I need this fixed." },
        { role: "bot", content: "I understand the concern. Could you share more details?" },
      ],
      currentMessage: "I want to talk to a real person.",
      turnPlan: {
        intent: "handoff",
        summary: "The visitor wants to speak with a human agent about billing.",
        retrievalQueries: [],
        broaderQueries: [],
        followUpQuestion: null,
      },
      availableTools: [],
      state,
    });

    expect(["offer_handoff", "collect_contact", "create_inquiry"]).toContain(
      decision.nextAction.type,
    );
  }, 15_000);

  test("tool call scenario with available inputs", async () => {
    const state = createState();
    state.docsEvidence.retrievalAttempted = true;
    state.docsEvidence.ragContext = "<source>Check widget via the tool.</source>";
    state.docsEvidence.groundingConfidence = "low";

    const decision = await planNextAction({
      model: createModel(),
      conversationHistory: [
        { role: "visitor", content: "The widget on https://example.com/pricing is not showing." },
      ],
      currentMessage: "The widget on https://example.com/pricing is not showing.",
      turnPlan: {
        intent: "troubleshoot",
        summary: "Widget not visible on pricing page.",
        retrievalQueries: ["widget not showing"],
        broaderQueries: ["widget troubleshooting"],
        followUpQuestion: null,
      },
      availableTools: [createTool()],
      state,
    });

    expect(["call_tool", "search_docs", "compose"]).toContain(decision.nextAction.type);
    if (decision.nextAction.type === "call_tool") {
      expect(decision.nextAction.toolName).toBe("check_widget_status");
    }
  }, 15_000);

  test("decision always has goal and nextAction with type", async () => {
    const decision = await planNextAction({
      model: createModel(),
      conversationHistory: [],
      currentMessage: "What is your refund policy?",
      turnPlan: {
        intent: "policy",
        summary: "The visitor is asking about the refund policy.",
        retrievalQueries: ["refund policy"],
        broaderQueries: ["policies"],
        followUpQuestion: null,
      },
      availableTools: [],
      state: createState(),
    });

    expect(decision).toHaveProperty("goal");
    expect(decision).toHaveProperty("nextAction");
    expect(typeof decision.goal).toBe("string");
    expect(decision.goal.length).toBeGreaterThan(0);
    expect(decision.nextAction).toHaveProperty("type");
  }, 15_000);
});

describe("recoverPlannerDecisionFromText", () => {
  const validJson = JSON.stringify({
    goal: "Answer the question",
    actionType: "compose",
    reason: "FAQ covers this",
    query: null,
    broaderQueries: null,
    toolName: null,
    toolInput: null,
    question: null,
    missingFields: null,
    answerStyle: "direct",
  });

  test("returns null for empty input", () => {
    expect(recoverPlannerDecisionFromText("")).toBeNull();
    expect(recoverPlannerDecisionFromText("   ")).toBeNull();
  });

  test("parses a plain JSON response", () => {
    const result = recoverPlannerDecisionFromText(validJson);
    expect(result).not.toBeNull();
    expect(result?.actionType).toBe("compose");
  });

  test("parses JSON inside a markdown fence", () => {
    const text = `Here is the decision:\n\n\`\`\`json\n${validJson}\n\`\`\`\n`;
    const result = recoverPlannerDecisionFromText(text);
    expect(result?.actionType).toBe("compose");
  });

  test("extracts JSON from surrounding prose using brace boundaries", () => {
    const text = `The planner thinks: ${validJson} — that's the plan.`;
    const result = recoverPlannerDecisionFromText(text);
    expect(result?.actionType).toBe("compose");
  });

  test("returns null when no valid JSON can be recovered", () => {
    expect(
      recoverPlannerDecisionFromText("just a prose answer, no JSON here"),
    ).toBeNull();
  });

  test("returns null when JSON does not match schema", () => {
    const invalid = JSON.stringify({ actionType: "nonexistent_type" });
    expect(recoverPlannerDecisionFromText(invalid)).toBeNull();
  });
});
