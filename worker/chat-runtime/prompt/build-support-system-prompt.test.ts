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
