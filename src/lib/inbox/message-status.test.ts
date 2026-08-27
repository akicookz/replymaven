import { describe, expect, test } from "bun:test";
import { deriveEmailAction } from "./message-status";

describe("deriveEmailAction", () => {
  test("shows send for a real outbound message with a visitor email", () => {
    expect(
      deriveEmailAction({
        role: "agent",
        visitorEmail: "ada@example.com",
      }),
    ).toBe("send");
    expect(
      deriveEmailAction({
        role: "bot",
        visitorEmail: "ada@example.com",
      }),
    ).toBe("send");
  });

  test("keeps emailed rows labelled after send", () => {
    expect(
      deriveEmailAction({
        role: "agent",
        visitorEmail: "ada@example.com",
        emailedAt: "2026-08-27T01:00:00.000Z",
      }),
    ).toBe("sent");
  });

  test("hides send when there is no visitor email", () => {
    expect(deriveEmailAction({ role: "agent" })).toBe("hidden");
    expect(
      deriveEmailAction({
        role: "agent",
        visitorEmail: "",
      }),
    ).toBe("hidden");
  });

  test("hides send on archived or optimistic rows", () => {
    expect(
      deriveEmailAction({
        role: "agent",
        visitorEmail: "ada@example.com",
        readOnly: true,
      }),
    ).toBe("hidden");
    expect(
      deriveEmailAction({
        role: "agent",
        visitorEmail: "ada@example.com",
        optimistic: true,
      }),
    ).toBe("hidden");
  });

  test("still labels emailed rows when the thread is archived", () => {
    expect(
      deriveEmailAction({
        role: "agent",
        visitorEmail: "ada@example.com",
        emailedAt: "2026-08-27T01:00:00.000Z",
        readOnly: true,
      }),
    ).toBe("sent");
  });

  test("hides visitor rows", () => {
    expect(
      deriveEmailAction({
        role: "visitor",
        visitorEmail: "ada@example.com",
      }),
    ).toBe("hidden");
  });
});
