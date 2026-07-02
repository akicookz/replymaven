import { describe, expect, test } from "bun:test";
import {
  buildClassifySupportTurnPrompt,
  buildExtractContactInfoPrompt,
  buildReformulateQueryPrompt,
  buildSummarizeTeamRequestPrompt,
} from "./support-prompt-builders";

describe("support prompt builders", () => {
  test("classification prompt does not mention light retrieval", () => {
    const prompt = buildClassifySupportTurnPrompt({
      transcript: "visitor: pricing seems wrong",
      currentMessage: "can I get a discount?",
      pageContextBlock: "page: pricing",
    });

    expect(prompt).not.toContain("keep retrieval light");
    expect(prompt).toContain(
      "Do not skip docs just because the request is underspecified.",
    );
  });

  test("reformulation prompt does not mention handoff steps", () => {
    const prompt = buildReformulateQueryPrompt({
      transcript: "visitor: SEO Spider is missing pages",
      currentMessage: "still not working",
    });

    expect(prompt).not.toContain("handoff steps");
    expect(prompt).toContain("docs-oriented search query");
  });

  test("contact extraction prompt forbids invented contact info", () => {
    const prompt = buildExtractContactInfoPrompt({
      transcript: "hi there\nplease just reply in chat",
    });

    expect(prompt).toContain("Extract only contact details the visitor explicitly shared");
    expect(prompt).toContain('return "unknown"');
  });

  test("team request summary prompt asks for a sectioned agent brief", () => {
    const prompt = buildSummarizeTeamRequestPrompt({
      transcript: "visitor: my order #1234 hasn't arrived",
    });

    expect(prompt).toContain("Inquiry:");
    expect(prompt).toContain("Details:");
    expect(prompt).toContain("Already tried:");
    expect(prompt).toContain("Contact:");
    expect(prompt).toContain("otherwise \"not provided\"");
    expect(prompt).toContain("Maximum 120 words.");
    expect(prompt).toContain("never invent details not present in the transcript");
    expect(prompt).toContain("visitor: my order #1234 hasn't arrived");
  });
});
