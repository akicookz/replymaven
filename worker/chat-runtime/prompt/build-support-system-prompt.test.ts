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
        turnIntent: "policy",
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

  test("does not render handoff-sop-override block", () => {
    const prompt = buildSupportSystemPrompt(BASE_SETTINGS, "ReplyMaven", "", "");

    expect(prompt).not.toContain("<handoff-sop-override>");
  });

  test("instructs the model to emit [RESOLVED] when not escalated", () => {
    const prompt = buildSupportSystemPrompt(BASE_SETTINGS, "ReplyMaven", "", "");

    expect(prompt).toContain('end that reply with the exact token "[RESOLVED]"');
    expect(prompt).not.toContain("Never output [RESOLVED]");
  });

  test("never instructs [RESOLVED] once the conversation is escalated", () => {
    const prompt = buildSupportSystemPrompt(BASE_SETTINGS, "ReplyMaven", "", "", {
      escalated: true,
    });

    expect(prompt).not.toContain('end that reply with the exact token "[RESOLVED]"');
    expect(prompt).toContain(
      "This conversation has been escalated to the human team. Never output [RESOLVED]; keep helping until a teammate takes over.",
    );
  });
});
