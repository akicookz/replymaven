import { expect, test } from "bun:test";
import { buildSupportSystemPrompt } from "./build-support-system-prompt";

const settings = {
  toneOfVoice: "professional" as const,
  customTonePrompt: null,
  companyContext: null,
  botName: "Maven",
  agentName: "an engineer",
};

test("RESOLVED machine token is unavailable for a human-owned AI turn", () => {
  const assisting = buildSupportSystemPrompt(settings, "Acme", "", "", {
    aiParticipation: "assist_until_agent",
  });
  const humanOwned = buildSupportSystemPrompt(settings, "Acme", "", "", {
    aiParticipation: "human_only",
  });

  expect(assisting).toContain("[RESOLVED]");
  expect(humanOwned).not.toContain('end that reply with the exact token "[RESOLVED]"');
});

test("gives the shared Maven loop a factual knowledge-search rule", () => {
  const prompt = buildSupportSystemPrompt(settings, "Acme", "", "", {
    aiParticipation: "assist_until_agent",
  });

  expect(prompt).toContain("search knowledge when project facts are needed");
  expect(prompt).toContain("answer directly when it is not");
  expect(prompt).toContain("ask a normal conversational question if information is missing");
  expect(prompt).toContain("never invent a search result");
});

test("makes request_team_help the only public handoff path", () => {
  const prompt = buildSupportSystemPrompt(settings, "Acme", "", "", {
    aiParticipation: "continuous",
  });
  const missingGroundingPrompt = buildSupportSystemPrompt(
    settings,
    "Acme",
    "",
    "",
    {
      aiParticipation: "continuous",
      retrievalAttempted: true,
      groundingConfidence: "none",
    },
  );

  expect(prompt).toContain("call request_team_help");
  expect(prompt).toContain(
    "ask only for the returned requiredFields as an ordinary conversational follow-up",
  );
  expect(prompt).toContain("use the returned visitorMessage exactly");
  expect(prompt).not.toContain("Runtime decides whether handoff/contact collection is needed");
  expect(prompt).not.toContain("The runtime handles forwarding silently");
  expect(missingGroundingPrompt).not.toContain(
    "Runtime owns escalation state",
  );
});
