import { describe, expect, test } from "bun:test";
import {
  buildCompiledFaqContext,
  findBestFaqMatch,
} from "./build-compiled-faq-context";

test("compiles structured FAQs and preserves normalized legacy FAQ content", () => {
  const context = buildCompiledFaqContext([
    {
      title: "Billing FAQ",
      content: JSON.stringify([
        {
          question: "  How   long is the trial? ",
          answer: " The trial lasts\n14 days. ",
        },
      ]),
    },
    {
      title: "Legacy FAQ",
      content: "Q: How do I cancel?\n\nA: Open   Billing.",
    },
  ]);

  expect(context).toContain("FAQ: Billing FAQ");
  expect(context).toContain("- Q: How long is the trial?\n  A: The trial lasts 14 days.");
  expect(context).toContain("FAQ: Legacy FAQ");
  expect(context).toContain("Q: How do I cancel? A: Open Billing.");
});

describe("FAQ fast-path safety", () => {
  const resources = [
    {
      title: "Team FAQ",
      content: JSON.stringify([
        { question: "How do I invite a team member?", answer: "Open Team." },
        { question: "How do I cancel my subscription?", answer: "Open Billing." },
      ]),
    },
  ];

  test("treats a normalized exact question as authoritative", () => {
    const match = findBestFaqMatch(resources, " HOW DO I INVITE A TEAM MEMBER?! ");

    expect(match).toMatchObject({ authoritative: true, matchKind: "exact" });
  });

  test("does not authorize ambiguous, multi-intent, conflicting, or unrelated questions", () => {
    const ambiguous = findBestFaqMatch(
      [{ title: "Team", content: JSON.stringify([
        { question: "How do I invite a team member?", answer: "Invite." },
        { question: "How do I remove a team member?", answer: "Remove." },
      ]) }],
      "How do I manage a team member?",
    );
    const multiIntent = findBestFaqMatch(resources, "How do I invite a team member and cancel my subscription?");
    const conflicting = findBestFaqMatch(
      [{ title: "Conflicts", content: JSON.stringify([
        { question: "How long is the trial?", answer: "7 days" },
        { question: "How long is the trial?", answer: "14 days" },
      ]) }],
      "How long is the trial?",
    );
    const unrelated = findBestFaqMatch(resources, "비밀번호를 어떻게 변경하나요");

    expect(ambiguous?.authoritative).toBe(false);
    expect(multiIntent?.authoritative).toBe(false);
    expect(conflicting?.authoritative).toBe(false);
    expect(unrelated).toBeNull();
  });
});
