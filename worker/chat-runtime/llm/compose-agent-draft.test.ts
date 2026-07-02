import { describe, expect, test } from "bun:test";
import {
  buildComposeAgentDraftPrompt,
  type ComposeAgentDraftSettings,
} from "./compose-agent-draft";

const BASE_SETTINGS: ComposeAgentDraftSettings = {
  toneOfVoice: "professional",
  customTonePrompt: null,
  botName: null,
  agentName: null,
  companyName: null,
  companyContext: null,
};

describe("compose agent draft prompt", () => {
  test("includes the agent's instruction verbatim", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "tell him we do not offer trial extensions",
      conversationHistory: [
        { role: "visitor", content: "can I get a trial extension?" },
      ],
      settings: BASE_SETTINGS,
    });

    expect(prompt).toContain("tell him we do not offer trial extensions");
  });

  test("includes the transcript for continuity and language matching", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "confirm the refund was processed",
      conversationHistory: [
        { role: "visitor", content: "hola, necesito ayuda con un reembolso" },
      ],
      settings: BASE_SETTINGS,
    });

    expect(prompt).toContain("visitor: hola, necesito ayuda con un reembolso");
  });

  test("truncates the transcript to the last 20 messages", () => {
    const conversationHistory = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? "visitor" : "agent",
      content: `marker-${String(index + 1).padStart(2, "0")}`,
    }));

    const prompt = buildComposeAgentDraftPrompt({
      instruction: "tell them we are on it",
      conversationHistory,
      settings: BASE_SETTINGS,
    });

    // 25 messages, keep the last 20: 1-5 dropped, 6-25 kept.
    expect(prompt).not.toContain("marker-01");
    expect(prompt).not.toContain("marker-05");
    expect(prompt).toContain("marker-06");
    expect(prompt).toContain("marker-25");
  });

  test("falls back to a generic agent label and omits company lines when settings are absent", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "let them know we're looking into it",
      conversationHistory: [],
      settings: null,
    });

    expect(prompt).toContain("on behalf of a human support agent.");
    expect(prompt).not.toContain("Company context:");
    expect(prompt).toContain("(no messages yet)");
  });

  test("includes agent name and company name/context when provided", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "let them know we're looking into it",
      conversationHistory: [{ role: "visitor", content: "is this fixed yet?" }],
      settings: {
        ...BASE_SETTINGS,
        agentName: "an engineer",
        companyName: "Acme Inc.",
        companyContext: "Acme sells project management software.",
      },
    });

    expect(prompt).toContain("on behalf of an engineer at Acme Inc.");
    expect(prompt).toContain(
      "Company context: Acme sells project management software.",
    );
  });

  test("resolves the professional tone by default when settings are absent", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "tell them shipping takes 5-7 days",
      conversationHistory: [],
      settings: null,
    });

    expect(prompt).toContain("Tone: Be concise, clear, and solution-oriented.");
  });

  test("resolves the configured tone through resolveToneInstruction", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "tell them shipping takes 5-7 days",
      conversationHistory: [],
      settings: { ...BASE_SETTINGS, toneOfVoice: "friendly" },
    });

    expect(prompt).toContain(
      "Tone: Be warm, empathetic, and helpful while staying informative.",
    );
  });

  test("custom tone uses the customTonePrompt text", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "tell them shipping takes 5-7 days",
      conversationHistory: [],
      settings: {
        ...BASE_SETTINGS,
        toneOfVoice: "custom",
        customTonePrompt: "Speak like a cheerful pirate.",
      },
    });

    expect(prompt).toContain("Tone: Speak like a cheerful pirate.");
    expect(prompt).not.toContain("Be concise, clear, and solution-oriented.");
  });

  test("instructs the model to output only the message, matching the visitor's language, without inventing facts", () => {
    const prompt = buildComposeAgentDraftPrompt({
      instruction: "tell them shipping takes 5-7 days",
      conversationHistory: [
        { role: "visitor", content: "when will my order arrive?" },
      ],
      settings: BASE_SETTINGS,
    });

    expect(prompt).toContain(
      "Output ONLY the message text. No preamble, no quotes, no signature.",
    );
    expect(prompt).toContain("Write in the visitor's language");
    expect(prompt).toContain("do not invent policies, offers, or facts");
    expect(prompt).toContain("Keep it concise and natural for a chat reply.");
  });
});
