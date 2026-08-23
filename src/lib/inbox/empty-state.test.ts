import { describe, expect, test } from "bun:test";
import {
  formatInboxEmptyCopy,
  inboxEmptyCopy,
  isInboxFirstRun,
} from "./empty-state";
import type { InboxCounts } from "./types";

function counts(overrides: Partial<InboxCounts> = {}): InboxCounts {
  return {
    "needs-you": 0,
    inbox: 0,
    snoozed: 0,
    resolved: 0,
    archived: 0,
    flagged: 0,
    ...overrides,
  };
}

describe("isInboxFirstRun", () => {
  test("is true only when every filter count is 0", () => {
    expect(isInboxFirstRun(counts())).toBe(true);
    expect(isInboxFirstRun(counts({ resolved: 1 }))).toBe(false);
  });
});

describe("inboxEmptyCopy", () => {
  test("search wins over every other empty case", () => {
    expect(
      inboxEmptyCopy({
        filter: "needs-you",
        search: "refund",
        counts: counts({ inbox: 3 }),
        unreadOnly: true,
      }),
    ).toEqual({ headline: "No conversations match your search." });
  });

  test("first run wins over Needs You and unread-only", () => {
    expect(
      inboxEmptyCopy({
        filter: "needs-you",
        search: "",
        counts: counts(),
        unreadOnly: true,
      }),
    ).toEqual({ headline: "Conversations from the widget will land here." });
  });

  test("Needs You with open inbox conversations", () => {
    expect(
      inboxEmptyCopy({
        filter: "needs-you",
        search: "",
        counts: counts({ inbox: 4 }),
        unreadOnly: false,
      }),
    ).toEqual({
      headline: "Support is being handled.",
      body: "You're all free.",
    });
  });

  test("Needs You with an empty inbox", () => {
    expect(
      inboxEmptyCopy({
        filter: "needs-you",
        search: "",
        counts: counts({ resolved: 2 }),
        unreadOnly: false,
      }),
    ).toEqual({ headline: "No open conversations." });
  });

  test("Inbox is a single status line", () => {
    expect(
      inboxEmptyCopy({
        filter: "inbox",
        search: "",
        counts: counts({ resolved: 2 }),
        unreadOnly: false,
      }),
    ).toEqual({ headline: "No open conversations." });
  });

  test("unread-only after the inbox has history", () => {
    expect(
      inboxEmptyCopy({
        filter: "inbox",
        search: "",
        counts: counts({ inbox: 3 }),
        unreadOnly: true,
      }),
    ).toEqual({ headline: "No unread conversations." });
  });

  test("other filters use a short nothing-here line", () => {
    expect(
      inboxEmptyCopy({
        filter: "snoozed",
        search: "",
        counts: counts({ inbox: 1 }),
        unreadOnly: false,
      }),
    ).toEqual({ headline: "Nothing snoozed." });
    expect(
      inboxEmptyCopy({
        filter: "resolved",
        search: "",
        counts: counts({ inbox: 1 }),
        unreadOnly: false,
      }),
    ).toEqual({ headline: "Nothing resolved yet." });
    expect(
      inboxEmptyCopy({
        filter: "archived",
        search: "",
        counts: counts({ inbox: 1 }),
        unreadOnly: false,
      }),
    ).toEqual({ headline: "Nothing archived." });
    expect(
      inboxEmptyCopy({
        filter: "flagged",
        search: "",
        counts: counts({ inbox: 1 }),
        unreadOnly: false,
      }),
    ).toEqual({ headline: "Nothing flagged." });
  });

  test("formatInboxEmptyCopy joins the Needs You pair", () => {
    expect(
      formatInboxEmptyCopy({
        headline: "Support is being handled.",
        body: "You're all free.",
      }),
    ).toBe("Support is being handled. You're all free.");
  });
});
