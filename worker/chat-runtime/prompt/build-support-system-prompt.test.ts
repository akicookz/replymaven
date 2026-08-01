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

  test("allows AI to resolve while it is assisting before a human joins", () => {
    const prompt = buildSupportSystemPrompt(BASE_SETTINGS, "ReplyMaven", "", "", {
      aiParticipation: "assist_until_agent",
    });

    expect(prompt).toContain(
      'end that reply with the exact token "[RESOLVED]"',
    );
  });

  test("does not let an invoked one-shot AI close a human-owned thread", () => {
    const prompt = buildSupportSystemPrompt(BASE_SETTINGS, "ReplyMaven", "", "", {
      aiParticipation: "human_only",
    });

    expect(prompt).not.toContain(
      'end that reply with the exact token "[RESOLVED]"',
    );
    expect(prompt).toContain(
      "A human is handling this conversation. Never output [RESOLVED].",
    );
  });

  test("adds first-turn diagnostic instructions to the composer", () => {
    const prompt = buildSupportSystemPrompt(BASE_SETTINGS, "ReplyMaven", "", "", {
      turnContext: { kind: "contact_support", isFirstVisitorTurn: true },
    });

    expect(prompt).toContain("<support-turn>");
    expect(prompt).toContain("strongest evidence-backed explanation");
    expect(prompt).toContain("one focused question");
  });
});
