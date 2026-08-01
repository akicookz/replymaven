import { describe, expect, test } from "bun:test";
import {
  buildContactFallbackMessage,
  buildContactAcceptedPayload,
  buildContactFormMessage,
  markContactAiUnavailable,
} from "./contact-support";

test("buildContactFallbackMessage preserves a resolved timing opener exactly once", () => {
  const opening =
    "Hi Akbar,\n\nI've flagged this for the team. Today is Saturday, so the team may be a little slower than usual. You can expect a reply within 8-12 hours.\n\n";

  const fallback = buildContactFallbackMessage(opening);

  expect(fallback).toBe(`${opening}I couldn't investigate this immediately.`);
  expect(fallback.match(/8-12 hours/g)).toHaveLength(1);
  expect(fallback).not.toContain("2-4 hours");
});

describe("buildContactFormMessage", () => {
  test("stores submitted fields and adds known identity only when missing", () => {
    expect(
      buildContactFormMessage(
        { Email: "form@example.com", Problem: "Checkout fails" },
        "Akbar",
        "known@example.com",
      ),
    ).toBe(
      "Contact form submission\nEmail: form@example.com\nProblem: Checkout fails\nVisitor name: Akbar",
    );
  });
});

describe("buildContactAcceptedPayload", () => {
  test("provides widget state and a team-safe fallback with no em dash", () => {
    const payload = buildContactAcceptedPayload({
      conversationId: "conv-123",
      visitorMessageId: "msg-123",
      conversationStatus: "waiting_agent",
      visitorName: "Akbar",
      visitorEmail: "akbar@example.com",
      botName: "Maven",
      isFirstVisitorTurn: true,
    });

    expect(payload.assistantName).toBe("Maven");
    expect(payload.aiWillRespond).toBe(true);
    expect(payload.visitorMessageId).toBe("msg-123");
    expect(payload.fallbackMessage).toContain("Hi Akbar,");
    expect(payload.fallbackMessage).toContain("I've flagged this for the team.");
    expect(payload.fallbackMessage).toContain(
      "The team should get back to you as soon as possible.\n\n",
    );
    expect(payload.fallbackMessage).not.toContain("within 4 hours");
    expect(payload.fallbackMessage).not.toContain("—");
  });

  test("keeps AI out when a human already owns the conversation", () => {
    const payload = buildContactAcceptedPayload({
      conversationId: "conv-123",
      visitorMessageId: "msg-123",
      conversationStatus: "agent_replied",
      visitorName: "Akbar",
      visitorEmail: null,
      botName: "Maven",
      isFirstVisitorTurn: false,
    });

    expect(payload.aiWillRespond).toBe(false);
  });

  test("stops promising an AI reply when the AI response cannot start", () => {
    const payload = buildContactAcceptedPayload({
      conversationId: "conv-123",
      visitorMessageId: "msg-123",
      conversationStatus: "waiting_agent",
      visitorName: "Akbar",
      visitorEmail: null,
      botName: "Maven",
      isFirstVisitorTurn: false,
    });

    expect(markContactAiUnavailable(payload)).toEqual({
      ...payload,
      aiWillRespond: false,
    });
  });
});
