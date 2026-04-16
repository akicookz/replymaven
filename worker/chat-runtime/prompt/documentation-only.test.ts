import { describe, expect, test } from "bun:test";
import { buildSupportSystemPrompt } from "./build-support-system-prompt";

describe("documentation-only behavior", () => {
  const mockSettings = {
    botName: "TestBot",
    toneOfVoice: "professional",
    companyContext: "We are a test company",
    customTonePrompt: null,
  };

  test("instructs to check SOPs and FAQs first", () => {
    const prompt = buildSupportSystemPrompt(
      mockSettings,
      "TestCompany",
      "Some documentation",
      null,
      {},
    );

    // Check that SOPs and FAQs are prioritized (match-hint first when present,
    // then guidelines, then priority FAQs, then knowledge base).
    expect(prompt).toContain("1. <priority-faq-match>");
    expect(prompt).toContain("2. <guidelines>");
    expect(prompt).toContain("3. <priority-faqs>");
    expect(prompt).toContain("4. <knowledge-base>");
    expect(prompt).toContain("ALWAYS trust SOPs and FAQs over any other source");
  });

  test("includes no-information template without exposing internal structure", () => {
    const prompt = buildSupportSystemPrompt(
      mockSettings,
      "TestCompany",
      "",
      null,
      {},
    );

    // Should use generic "documentation" language
    expect(prompt).toContain("I've searched the documentation but couldn't find information about");
    expect(prompt).toContain("Never provide undocumented suggestions, even if they seem helpful");

    // Should include instruction to hide internal structure
    expect(prompt).toContain("never mention SOPs, FAQs, guidelines, or tier-1 sources to the visitor");
  });

  test("removes tentative suggestions when grounding is weak", () => {
    const prompt = buildSupportSystemPrompt(
      mockSettings,
      "TestCompany",
      "",
      null,
      {
        retrievalAttempted: true,
        groundingConfidence: "low",
      },
    );

    // Should NOT contain old tentative suggestion language
    expect(prompt).not.toContain("tentative high-level suggestion");
    expect(prompt).not.toContain("best-effort suggestion");

    // Should say to rely only on documented facts
    expect(prompt).toContain("Use only explicit facts from the retrieved excerpts");
  });

  test("instructs to say 'not in documentation' when no grounding", () => {
    const prompt = buildSupportSystemPrompt(
      mockSettings,
      "TestCompany",
      "",
      null,
      {
        retrievalAttempted: true,
        groundingConfidence: "none",
      },
    );

    // Should use generic "documentation" instead of exposing SOPs/FAQs
    expect(prompt).toContain("Clearly convey that you could not find information about this topic in the documentation");
    expect(prompt).toContain("Do not provide suggestions or workarounds that are not explicitly documented");
  });

  test("maintains FAQ context as tier-1 source", () => {
    const prompt = buildSupportSystemPrompt(
      mockSettings,
      "TestCompany",
      "Some docs",
      null,
      {
        faqContext: "Q: How do I reset? A: Click reset button",
      },
    );

    expect(prompt).toContain("<priority-faqs>");
    expect(prompt).toContain("Q: How do I reset? A: Click reset button");
    expect(prompt).toContain("tier-1 knowledge because they are usually curated directly by the team");
  });
});