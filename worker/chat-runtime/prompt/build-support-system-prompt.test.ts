import { describe, expect, test } from "bun:test";
import { buildSupportSystemPrompt } from "./build-support-system-prompt";

const BASE_SETTINGS = {
  toneOfVoice: "professional" as const,
  customTonePrompt: null,
  companyContext: "ReplyMaven helps teams answer support questions.",
  botName: "Maven",
  agentName: "an engineer",
};

describe("buildSupportSystemPrompt", () => {
  test("does not reference canned responses or model-owned escalation", () => {
    const prompt = buildSupportSystemPrompt(
      {
        toneOfVoice: "professional",
        customTonePrompt: null,
        companyContext: "ReplyMaven helps teams answer support questions.",
        botName: "Maven",
        agentName: "an engineer",
      },
      "ReplyMaven",
      "<source>Pricing docs</source>",
      "The visitor is asking about pricing.",
      {
        visitorInfo: { name: null, email: null },
        faqContext: '<source file="faq.md">FAQ answer</source>',
        toolEvidenceSummary: '{"status":"ok"}',
        retrievalAttempted: true,
        groundingConfidence: "low",
        turnPlan: {
          intent: "policy",
          summary: "The visitor wants pricing guidance.",
          followUpQuestion: "Which pricing detail do you want checked?",
        },
      },
    );

    expect(prompt).not.toContain("Canned responses");
    expect(prompt).not.toContain(
      "Use this to decide whether you need to ask for their name and email during escalation.",
    );
    expect(prompt).not.toContain("<tools>");
    expect(prompt).not.toContain("<clarification-guidance>");
    expect(prompt).toContain("<priority-faqs>");
    expect(prompt).toContain("compiled FAQ entries");
    expect(prompt).toContain("Treat <guidelines> and <priority-faqs> as tier-1 sources.");
    expect(prompt).toContain(
      "Human follow-up, contact collection, and inquiry submission are controlled by the runtime",
    );
    expect(prompt).toContain(
      'Do not end with optional offers like "Would you like an example?"',
    );
  });

  test("renders existing-inquiry block when inquiry data is provided", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        inquiryFields: [
          { label: "Name", type: "text", required: true },
          { label: "Email", type: "email", required: true },
          { label: "Phone", type: "tel", required: false },
        ],
        existingInquiry: {
          Name: "Alice",
          Email: "alice@example.com",
        },
      },
    );

    expect(prompt).toContain("<existing-inquiry>");
    expect(prompt).toContain("</existing-inquiry>");
    expect(prompt).toContain("Name (required): Alice");
    expect(prompt).toContain("Email (required): alice@example.com");
    expect(prompt).toContain("Phone: <not provided>");
    expect(prompt).toContain("Do not ask for any field already present here.");
    expect(prompt).toContain(
      "All required fields are already on file. Do not re-ask for them.",
    );
  });

  test("lists missing required fields when some are absent", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        inquiryFields: [
          { label: "Name", type: "text", required: true },
          { label: "Email", type: "email", required: true },
        ],
        existingInquiry: {
          Name: "Bob",
        },
      },
    );

    expect(prompt).toContain("<existing-inquiry>");
    expect(prompt).toContain("Name (required): Bob");
    expect(prompt).toContain("Email (required): <not provided>");
    expect(prompt).toContain("Missing required fields: Email");
  });

  test("omits existing-inquiry block when inquiry data is not provided", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        visitorInfo: { name: "Carol", email: "carol@example.com" },
      },
    );

    expect(prompt).not.toContain("</existing-inquiry>");
    expect(prompt).not.toContain(
      "The visitor already has an inquiry submission on file for this conversation.",
    );
  });

  test("omits existing-inquiry block when inquiryFields is empty", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        inquiryFields: [],
        existingInquiry: { Name: "Dave" },
      },
    );

    expect(prompt).not.toContain("</existing-inquiry>");
    expect(prompt).not.toContain(
      "The visitor already has an inquiry submission on file for this conversation.",
    );
  });

  test("omits existing-inquiry block when existingInquiry is null", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        inquiryFields: [{ label: "Name", type: "text", required: true }],
        existingInquiry: null,
      },
    );

    expect(prompt).not.toContain("</existing-inquiry>");
    expect(prompt).not.toContain(
      "The visitor already has an inquiry submission on file for this conversation.",
    );
  });

  test("treats empty-string field values as not provided", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        inquiryFields: [
          { label: "Name", type: "text", required: true },
          { label: "Email", type: "email", required: true },
        ],
        existingInquiry: {
          Name: "Eve",
          Email: "   ",
        },
      },
    );

    expect(prompt).toContain("Email (required): <not provided>");
    expect(prompt).toContain("Missing required fields: Email");
  });

  test("renders handoff-sop-override block when classifier decision shouldOverride is true", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        handoffSopDecision: {
          shouldOverride: true,
          trigger: "visitor_frustrated",
          priority: "high",
          reason: "Visitor used frustrated language after two clarification attempts.",
        },
      },
    );

    expect(prompt).toContain("<handoff-sop-override>");
    expect(prompt).toContain("</handoff-sop-override>");
    expect(prompt).toContain("Trigger: visitor_frustrated");
    expect(prompt).toContain("Priority: high");
    expect(prompt).toContain(
      "Visitor used frustrated language after two clarification attempts.",
    );
    expect(prompt).toContain("Do NOT ask another clarifying question this turn.");
    expect(prompt).toContain(
      "Runtime controls the actual handoff mechanics",
    );
  });

  test("omits handoff-sop-override block when decision is null", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        handoffSopDecision: null,
      },
    );

    expect(prompt).not.toContain("<handoff-sop-override>");
  });

  test("omits handoff-sop-override block when shouldOverride is false", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        handoffSopDecision: {
          shouldOverride: false,
          trigger: "none",
          priority: "low",
          reason: "No override conditions detected.",
        },
      },
    );

    expect(prompt).not.toContain("<handoff-sop-override>");
  });

  test("omits handoff-sop-override block when decision is absent", () => {
    const prompt = buildSupportSystemPrompt(BASE_SETTINGS, "ReplyMaven", "", "");

    expect(prompt).not.toContain("<handoff-sop-override>");
  });
});
