import { describe, expect, test } from "bun:test";
import { passesInboxFilter, type InboxFilterableRow } from "./filters";

// Mirrors the server-side inboxFilterConditions semantics (see
// worker/services/chat-service.test.ts): snoozed and flagged (spam)
// conversations belong only to their own tabs.
describe("passesInboxFilter", () => {
  const now = Date.parse("2026-07-07T12:00:00.000Z");
  const future = new Date(now + 60 * 60 * 1000).toISOString();
  const past = new Date(now - 60 * 60 * 1000).toISOString();

  const row = (overrides: Partial<InboxFilterableRow>): InboxFilterableRow => ({
    status: "active",
    closeReason: null,
    snoozedUntil: null,
    ...overrides,
  });

  describe("needs-you", () => {
    test("admits an unsnoozed waiting_agent conversation", () => {
      expect(passesInboxFilter("needs-you", row({ status: "waiting_agent" }), now)).toBe(true);
    });

    test("rejects a snoozed waiting_agent conversation", () => {
      expect(
        passesInboxFilter("needs-you", row({ status: "waiting_agent", snoozedUntil: future }), now),
      ).toBe(false);
    });

    test("admits a waiting_agent conversation whose snooze already expired", () => {
      expect(
        passesInboxFilter("needs-you", row({ status: "waiting_agent", snoozedUntil: past }), now),
      ).toBe(true);
    });

    test("rejects bot-handled (active) and agent_replied conversations", () => {
      expect(passesInboxFilter("needs-you", row({ status: "active" }), now)).toBe(false);
      expect(passesInboxFilter("needs-you", row({ status: "agent_replied" }), now)).toBe(false);
    });

    test("rejects closed conversations", () => {
      expect(passesInboxFilter("needs-you", row({ status: "closed" }), now)).toBe(false);
    });
  });

  describe("all", () => {
    test("admits open and resolved conversations", () => {
      expect(passesInboxFilter("all", row({ status: "active" }), now)).toBe(true);
      expect(
        passesInboxFilter("all", row({ status: "closed", closeReason: "resolved" }), now),
      ).toBe(true);
    });

    test("rejects snoozed conversations", () => {
      expect(passesInboxFilter("all", row({ snoozedUntil: future }), now)).toBe(false);
    });

    test("rejects flagged/blocked (spam) conversations", () => {
      expect(
        passesInboxFilter("all", row({ status: "closed", closeReason: "spam" }), now),
      ).toBe(false);
    });
  });

  describe("snoozed", () => {
    test("admits only conversations snoozed into the future", () => {
      expect(passesInboxFilter("snoozed", row({ snoozedUntil: future }), now)).toBe(true);
      expect(passesInboxFilter("snoozed", row({ snoozedUntil: past }), now)).toBe(false);
      expect(passesInboxFilter("snoozed", row({}), now)).toBe(false);
    });
  });

  describe("resolved", () => {
    test("admits closed conversations except spam-flagged ones", () => {
      expect(
        passesInboxFilter("resolved", row({ status: "closed", closeReason: "resolved" }), now),
      ).toBe(true);
      expect(
        passesInboxFilter("resolved", row({ status: "closed", closeReason: "spam" }), now),
      ).toBe(false);
      expect(passesInboxFilter("resolved", row({ status: "active" }), now)).toBe(false);
    });
  });

  describe("flagged", () => {
    test("admits exactly spam-flagged conversations", () => {
      expect(
        passesInboxFilter("flagged", row({ status: "closed", closeReason: "spam" }), now),
      ).toBe(true);
      expect(passesInboxFilter("flagged", row({ status: "waiting_agent" }), now)).toBe(false);
    });
  });

  test("tolerates a malformed snoozedUntil by treating it as not snoozed", () => {
    expect(passesInboxFilter("all", row({ snoozedUntil: "not-a-date" }), now)).toBe(true);
    expect(passesInboxFilter("snoozed", row({ snoozedUntil: "not-a-date" }), now)).toBe(false);
  });
});
