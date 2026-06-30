import { describe, expect, test } from "bun:test";
import { deriveMessageStatus } from "./message-status";

const base = { role: "agent" as const };

describe("deriveMessageStatus", () => {
  test("agent message with no timestamps is Sent", () => {
    expect(deriveMessageStatus(base)).toEqual({
      status: "sent",
      label: "Sent",
      emailed: false,
    });
  });

  test("deliveredAt set (no readAt) is Delivered", () => {
    expect(deriveMessageStatus({ ...base, deliveredAt: "2026-07-01T00:00:00Z" })).toEqual({
      status: "delivered",
      label: "Delivered",
      emailed: false,
    });
  });

  test("readAt takes precedence over deliveredAt → Seen", () => {
    expect(
      deriveMessageStatus({
        ...base,
        deliveredAt: "2026-07-01T00:00:00Z",
        readAt: "2026-07-01T00:01:00Z",
      }),
    ).toEqual({ status: "seen", label: "Seen", emailed: false });
  });

  test("readAt without deliveredAt still → Seen", () => {
    expect(deriveMessageStatus({ ...base, readAt: "2026-07-01T00:01:00Z" })).toEqual({
      status: "seen",
      label: "Seen",
      emailed: false,
    });
  });

  test("emailed flag reflects emailedAt", () => {
    expect(deriveMessageStatus({ ...base, emailedAt: "2026-07-01T00:00:00Z" })).toEqual({
      status: "sent",
      label: "Sent",
      emailed: true,
    });
  });

  test("bot messages get receipts like agent", () => {
    expect(deriveMessageStatus({ role: "bot", readAt: "2026-07-01T00:00:00Z" })?.label).toBe(
      "Seen",
    );
  });

  test("visitor messages get no receipt", () => {
    expect(deriveMessageStatus({ role: "visitor", readAt: "x" })).toBeNull();
  });

  test("system messages get no receipt", () => {
    expect(deriveMessageStatus({ role: "system" })).toBeNull();
  });

  test("null timestamps behave like absent", () => {
    expect(
      deriveMessageStatus({ role: "agent", deliveredAt: null, readAt: null, emailedAt: null }),
    ).toEqual({ status: "sent", label: "Sent", emailed: false });
  });
});
