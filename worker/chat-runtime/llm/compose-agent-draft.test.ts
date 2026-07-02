import { describe, expect, test } from "bun:test";
import { buildComposeAgentDraftPrompt } from "./compose-agent-draft";

describe("compose agent draft prompt", () => {
  test("includes the agent's instruction verbatim", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "tell him we do not offer trial extensions",
      transcript: "visitor: can I get a trial extension?",
      toneInstruction: "Be concise, clear, and solution-oriented.",
    });

    expect(prompt).toContain("tell him we do not offer trial extensions");
    expect(prompt).toContain("Be concise, clear, and solution-oriented.");
  });

  test("includes the transcript for continuity and language matching", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "confirm the refund was processed",
      transcript: "visitor: hola, necesito ayuda con un reembolso",
      toneInstruction: "Be warm, empathetic, and helpful while staying informative.",
    });

    expect(prompt).toContain("visitor: hola, necesito ayuda con un reembolso");
  });

  test("falls back to a generic agent label and omits company lines when settings are absent", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "let them know we're looking into it",
      transcript: "",
      toneInstruction: "Be concise, clear, and solution-oriented.",
    });

    expect(prompt).toContain("on behalf of a human support agent.");
    expect(prompt).not.toContain("Company context:");
    expect(prompt).toContain("(no messages yet)");
  });

  test("includes agent name and company name/context when provided", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "let them know we're looking into it",
      transcript: "visitor: is this fixed yet?",
      toneInstruction: "Be concise, clear, and solution-oriented.",
      agentName: "an engineer",
      companyName: "Acme Inc.",
      companyContext: "Acme sells project management software.",
    });

    expect(prompt).toContain("on behalf of an engineer at Acme Inc.");
    expect(prompt).toContain(
      "Company context: Acme sells project management software.",
    );
  });

  test("instructs the model to output only the message, matching the visitor's language, without inventing facts", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "tell them shipping takes 5-7 days",
      transcript: "visitor: when will my order arrive?",
      toneInstruction: "Be concise, clear, and solution-oriented.",
    });

    expect(prompt).toContain("Output ONLY the message text. No preamble, no quotes, no signature.");
    expect(prompt).toContain("Write in the visitor's language");
    expect(prompt).toContain("do not invent policies, offers, or facts");
    expect(prompt).toContain("Keep it concise and natural for a chat reply.");
  });
});
