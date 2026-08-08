import { describe, expect, test } from "bun:test";
import { parsePendingContactReply } from "./pending-contact-reply";

describe("parsePendingContactReply", () => {
  test("extracts a short explicit name and email from one contact reply", () => {
    expect(
      parsePendingContactReply(
        "Alice, alice@example.com",
        ["name", "email"],
      ),
    ).toEqual({
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      contactDeclined: false,
      remainingFields: [],
    });
  });

  test("keeps an omitted name pending when only email is explicit", () => {
    expect(
      parsePendingContactReply("alice@example.com", ["name", "email"]),
    ).toEqual({
      visitorName: null,
      visitorEmail: "alice@example.com",
      contactDeclined: false,
      remainingFields: ["name"],
    });
  });

  test.each([
    ["Alice", "Alice"],
    ["Name: alice", "alice"],
    ["My name is Alice Smith", "Alice Smith"],
  ])("accepts an explicit short name reply: %s", (message, expectedName) => {
    expect(parsePendingContactReply(message, ["name"])).toEqual({
      visitorName: expectedName,
      visitorEmail: null,
      contactDeclined: false,
      remainingFields: [],
    });
  });

  test.each([
    "I'd rather not share that.",
    "I don't want to provide my contact details.",
    "No, continue without my email.",
  ])("recognizes an explicit contact refusal: %s", (message) => {
    expect(
      parsePendingContactReply(message, ["name", "email"]),
    ).toEqual({
      visitorName: null,
      visitorEmail: null,
      contactDeclined: true,
      remainingFields: [],
    });
  });

  test("does not infer a name from unrelated prose", () => {
    expect(
      parsePendingContactReply(
        "The account belongs to Alice but I need help changing it today.",
        ["name"],
      ),
    ).toEqual({
      visitorName: null,
      visitorEmail: null,
      contactDeclined: false,
      remainingFields: ["name"],
    });
  });

  test.each(["please continue", "reset password", "need more help"])(
    "does not persist short support prose as a name: %s",
    (message) => {
      expect(parsePendingContactReply(message, ["name"])).toEqual({
        visitorName: null,
        visitorEmail: null,
        contactDeclined: false,
        remainingFields: ["name"],
      });
    },
  );

  test.each([
    "please continue alice@example.com",
    "reset password alice@example.com",
    "need more help alice@example.com",
  ])("does not persist support prose before an email as a name: %s", (message) => {
    expect(parsePendingContactReply(message, ["name", "email"])).toEqual({
      visitorName: null,
      visitorEmail: "alice@example.com",
      contactDeclined: false,
      remainingFields: ["name"],
    });
  });
});
