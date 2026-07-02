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
      "Human follow-up, contact collection, and ticket submission are controlled by the runtime",
    );
    expect(prompt).toContain(
      'Do not end with optional offers like "Would you like an example?"',
    );
  });

  test("renders existing-ticket block when ticket data is provided", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        ticketFields: [
          { label: "Name", type: "text", required: true },
          { label: "Email", type: "email", required: true },
          { label: "Phone", type: "tel", required: false },
        ],
        existingTicket: {
          Name: "Alice",
          Email: "alice@example.com",
        },
      },
    );

    expect(prompt).toContain("<existing-ticket>");
    expect(prompt).toContain("</existing-ticket>");
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
        ticketFields: [
          { label: "Name", type: "text", required: true },
          { label: "Email", type: "email", required: true },
        ],
        existingTicket: {
          Name: "Bob",
        },
      },
    );

    expect(prompt).toContain("<existing-ticket>");
    expect(prompt).toContain("Name (required): Bob");
    expect(prompt).toContain("Email (required): <not provided>");
    expect(prompt).toContain("Missing required fields: Email");
  });

  test("omits existing-ticket block when ticket data is not provided", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        visitorInfo: { name: "Carol", email: "carol@example.com" },
      },
    );

    expect(prompt).not.toContain("</existing-ticket>");
    expect(prompt).not.toContain(
      "The visitor already has a ticket submission on file for this conversation.",
    );
  });

  test("omits existing-ticket block when ticketFields is empty", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        ticketFields: [],
        existingTicket: { Name: "Dave" },
      },
    );

    expect(prompt).not.toContain("</existing-ticket>");
    expect(prompt).not.toContain(
      "The visitor already has a ticket submission on file for this conversation.",
    );
  });

  test("omits existing-ticket block when existingTicket is null", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        ticketFields: [{ label: "Name", type: "text", required: true }],
        existingTicket: null,
      },
    );

    expect(prompt).not.toContain("</existing-ticket>");
    expect(prompt).not.toContain(
      "The visitor already has a ticket submission on file for this conversation.",
    );
  });

  test("treats empty-string field values as not provided", () => {
    const prompt = buildSupportSystemPrompt(
      BASE_SETTINGS,
      "ReplyMaven",
      "",
      "",
      {
        ticketFields: [
          { label: "Name", type: "text", required: true },
          { label: "Email", type: "email", required: true },
        ],
        existingTicket: {
          Name: "Eve",
          Email: "   ",
        },
      },
    );

    expect(prompt).toContain("Email (required): <not provided>");
    expect(prompt).toContain("Missing required fields: Email");
  });

  test("does not render handoff-sop-override block", () => {
    const prompt = buildSupportSystemPrompt(BASE_SETTINGS, "ReplyMaven", "", "");

    expect(prompt).not.toContain("<handoff-sop-override>");
  });

  test("instructs the model to emit [RESOLVED] when not escalated", () => {
    const prompt = buildSupportSystemPrompt(BASE_SETTINGS, "ReplyMaven", "", "");

    expect(prompt).toContain('respond with ONLY the exact text "[RESOLVED]"');
    expect(prompt).not.toContain("Never output [RESOLVED]");
  });

  test("never instructs [RESOLVED] once the conversation is escalated", () => {
    const prompt = buildSupportSystemPrompt(BASE_SETTINGS, "ReplyMaven", "", "", {
      escalated: true,
    });

    expect(prompt).not.toContain('respond with ONLY the exact text "[RESOLVED]"');
    expect(prompt).toContain(
      "This conversation has been escalated to the human team. Never output [RESOLVED]; keep helping until a teammate takes over.",
    );
  });
});
