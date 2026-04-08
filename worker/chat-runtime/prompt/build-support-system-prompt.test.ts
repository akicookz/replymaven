import { describe, expect, test } from "bun:test";
import { buildSupportSystemPrompt } from "./build-support-system-prompt";

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
    expect(prompt).toContain(
      "Human follow-up, contact collection, and inquiry submission are controlled by the runtime",
    );
    expect(prompt).toContain(
      'Do not end with optional offers like "Would you like an example?"',
    );
  });
});
