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

test("adds the trusted Maven channel contract to the common prompt", () => {
  const publicPrompt = buildSupportSystemPrompt(settings, "Acme", "", "", {
    channel: "public",
    aiParticipation: "continuous",
  });
  const sidechatPrompt = buildSupportSystemPrompt(settings, "Acme", "", "", {
    channel: "sidechat",
    aiParticipation: "continuous",
  });

  expect(publicPrompt).toContain("Channel: public");
  expect(publicPrompt).toContain("visible directly to the website visitor");
  expect(sidechatPrompt).toContain("Channel: sidechat");
  expect(sidechatPrompt).toContain("private conversation with a human support agent");
  expect(publicPrompt).not.toContain("private conversation with a human support agent");
  expect(publicPrompt).toContain("You are answering visitors in Acme's live chat");
  expect(publicPrompt).toContain("call request_team_help");
  expect(publicPrompt).toContain("[RESOLVED]");
  expect(sidechatPrompt).toContain("human dashboard support agent");
  expect(sidechatPrompt).not.toContain("You are answering visitors");
  expect(sidechatPrompt).not.toContain("Your job is to help visitors");
  expect(sidechatPrompt).not.toContain("request_team_help");
  expect(sidechatPrompt).not.toContain("[RESOLVED]");
});

test("frames populated sidechat sections as private evidence for the human agent", () => {
  const prompt = buildSupportSystemPrompt(
    {
      ...settings,
      companyContext: "Acme builds account software.",
      workingHours: "Weekdays",
      avgResponseTime: "One business day",
    },
    "Acme",
    "Retrieved setup instructions.",
    "The visitor cannot finish setup.",
    {
      channel: "sidechat",
      aiParticipation: "continuous",
      guidelines: [
        {
          condition: "Setup is blocked",
          instruction: "Verify the account state.",
        },
      ],
      faqMatchHint: {
        question: "How do I finish setup?",
        answer: "Open Settings and complete verification.",
        score: 0.96,
      },
      faqContext: "Q: Can setup be retried? A: Yes, after verification.",
      pageContext: { page: "Setup" },
      visitorInfo: { name: "Alice", email: "alice@example.com" },
      toolEvidenceSummary: "The account lookup returned pending.",
      retrievalAttempted: true,
      groundingConfidence: "none",
      agentHandbackInstructions: "Check the verification timestamp.",
      turnIntent: "troubleshoot",
      plannerGoal: "Find the setup blocker",
    },
  );

  expect(prompt).toContain("human dashboard support agent");
  expect(prompt).toContain("Verify the account state.");
  expect(prompt).toContain("Open Settings and complete verification.");
  expect(prompt).toContain("Retrieved setup instructions.");
  expect(prompt).toContain("The account lookup returned pending.");
  expect(prompt).not.toContain("Share them when visitors ask");
  expect(prompt).not.toContain("When a visitor's question matches");
  expect(prompt).not.toContain("visitor's language");
  expect(prompt).not.toContain("deliver its content rewritten in your voice");
  expect(prompt).not.toContain("for the visitor's current question");
  expect(prompt).not.toContain("give contextually relevant answers");
  expect(prompt).not.toContain("executed for this visitor");
  expect(prompt).not.toContain("request_team_help");
  expect(prompt).not.toContain("[RESOLVED]");
});
