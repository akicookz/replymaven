import { describe, expect, test } from "bun:test";
import {
  buildContactAcceptedPayload,
  buildContactFormMessage,
  markContactAiUnavailable,
} from "./contact-support";

test("contact form keeps submitted identity authoritative and fills only missing identity", () => {
  const message = buildContactFormMessage(
    { Email: "form@example.com", Problem: "Checkout fails" },
    "Akbar",
    "known@example.com",
  );

  expect(message).toContain("Email: form@example.com");
  expect(message).toContain("Visitor name: Akbar");
  expect(message).not.toContain("known@example.com");
});

describe("contact acknowledgement ownership", () => {
  test("does not advertise an AI reply after a human takes ownership", () => {
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

  test("withdraws an AI reply promise when generation cannot start", () => {
    const payload = buildContactAcceptedPayload({
      conversationId: "conv-123",
      visitorMessageId: "msg-123",
      conversationStatus: "waiting_agent",
      visitorName: null,
      visitorEmail: null,
      botName: "Maven",
      isFirstVisitorTurn: false,
    });

    expect(markContactAiUnavailable(payload).aiWillRespond).toBe(false);
  });
});
