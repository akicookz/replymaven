import { describe, expect, test } from "bun:test";
import { passesInboxFilter, type InboxFilterableRow } from "./filters";

describe("passesInboxFilter", () => {
  const now = Date.parse("2026-07-07T12:00:00.000Z");
  const future = new Date(now + 60 * 60 * 1000).toISOString();

  function row(overrides: Partial<InboxFilterableRow>): InboxFilterableRow {
    return {
      status: "active",
      closeReason: null,
      snoozedUntil: null,
      archivedAt: null,
      ...overrides,
    };
  }

  test("admits an eligible row for each standard inbox filter", () => {
    expect(
      passesInboxFilter("needs-you", row({ status: "waiting_agent" }), now),
    ).toBe(true);
    expect(passesInboxFilter("all", row({ status: "active" }), now)).toBe(true);
    expect(
      passesInboxFilter("snoozed", row({ snoozedUntil: future }), now),
    ).toBe(true);
    expect(
      passesInboxFilter(
        "resolved",
        row({ status: "closed", closeReason: "resolved" }),
        now,
      ),
    ).toBe(true);
  });

  test("rejects a snoozed waiting_agent conversation", () => {
    expect(
      passesInboxFilter(
        "needs-you",
        row({ status: "waiting_agent", snoozedUntil: future }),
        now,
      ),
    ).toBe(false);
  });

  test("rejects flagged/blocked (spam) conversations", () => {
    expect(
      passesInboxFilter("all", row({ status: "closed", closeReason: "spam" }), now),
    ).toBe(false);
  });

  test("admits closed conversations except spam-flagged ones", () => {
    expect(
      passesInboxFilter("resolved", row({ status: "closed", closeReason: "resolved" }), now),
    ).toBe(true);
    expect(
      passesInboxFilter("resolved", row({ status: "closed", closeReason: "spam" }), now),
    ).toBe(false);
    expect(passesInboxFilter("resolved", row({ status: "active" }), now)).toBe(false);
  });

  test("admits exactly spam-flagged conversations", () => {
    expect(
      passesInboxFilter("flagged", row({ status: "closed", closeReason: "spam" }), now),
    ).toBe(true);
    expect(passesInboxFilter("flagged", row({ status: "waiting_agent" }), now)).toBe(false);
  });

  test("admits an archived conversation only in the archived bucket", () => {
    const archived = row({
      status: "waiting_agent",
      closeReason: "spam",
      snoozedUntil: future,
      archivedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(passesInboxFilter("archived", archived, now)).toBe(true);
    expect(passesInboxFilter("needs-you", archived, now)).toBe(false);
    expect(passesInboxFilter("all", archived, now)).toBe(false);
    expect(passesInboxFilter("snoozed", archived, now)).toBe(false);
    expect(passesInboxFilter("resolved", archived, now)).toBe(false);
    expect(passesInboxFilter("flagged", archived, now)).toBe(false);
  });
});
