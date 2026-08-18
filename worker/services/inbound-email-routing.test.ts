import { describe, expect, test } from "bun:test";
import { parseConversationReference } from "./inbound-email-routing";

const conversation = "d1cb260d-6b42-45fe-aca7-c37a50f0dad6";
const older = "c0d37de0-9d74-44bc-a71a-13f278db11ad";
const project = "22b751c7-2a94-4e4d-ab4f-8612af218347";

describe("inbound email conversation reference", () => {
  test("reads the link a visitor reply quotes back", () => {
    // Shape taken from a real reply: the quoted footer carries the link.
    const body = [
      "So my question to you is, how did you add the domain?",
      "",
      "On Mon, Aug 17, 2026 at 7:02 PM LovableHTML <",
      "lovablehtml@updates.replymaven.com> wrote:",
      "> Roxanne from Encited replied",
      "> View Conversation",
      `> <https://replymaven.com/app/projects/${project}/conversations/${conversation}>`,
      "> You can reply to this email to continue the conversation.",
    ].join("\n");
    expect(parseConversationReference(body)).toBe(conversation);
  });

  test("reads the inbox-filter link form used by team notifications", () => {
    const body =
      `Open conversation https://replymaven.com/app/projects/${project}/conversations?filter=needs-you&id=${conversation}`;
    expect(parseConversationReference(body)).toBe(conversation);
  });

  test("reads the explicit reference line", () => {
    expect(parseConversationReference(`ReplyMaven ref: ${conversation}`))
      .toBe(conversation);
    expect(parseConversationReference(`replymaven  REF:   ${conversation}`))
      .toBe(conversation);
  });

  test("takes the newest quote when a thread nests older ones", () => {
    const body = [
      "thanks!",
      `> View Conversation <https://replymaven.com/app/projects/${project}/conversations/${conversation}>`,
      ">> older thread",
      `>> <https://replymaven.com/app/projects/${project}/conversations/${older}>`,
    ].join("\n");
    expect(parseConversationReference(body)).toBe(conversation);
  });

  test("ignores text with no usable reference", () => {
    for (
      const body of [
        null,
        undefined,
        "",
        "just a reply with no links",
        "https://replymaven.com/app/projects/not-a-uuid/conversations/nope",
        "/conversations/12345",
      ]
    ) {
      expect(parseConversationReference(body)).toBeNull();
    }
  });

  test("normalizes case so the id matches stored rows", () => {
    expect(
      parseConversationReference(`/conversations/${conversation.toUpperCase()}`),
    ).toBe(conversation);
  });
});
