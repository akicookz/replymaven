import { describe, expect, test } from "bun:test";
import {
  formatCurrentTime,
  formatGapLabel,
  formatTranscript,
} from "./format-transcript";

const T0 = new Date("2026-07-02T10:00:00Z").getTime();
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

describe("formatTranscript", () => {
  test("renders plain role: content lines with no timestamps", () => {
    const out = formatTranscript([
      { role: "visitor", content: "hi" },
      { role: "bot", content: "Hi! What can I help you with?" },
    ]);
    expect(out).toBe("visitor: hi\nbot: Hi! What can I help you with?");
  });

  test("adds no annotations for rapid back-and-forth", () => {
    const out = formatTranscript([
      { role: "visitor", content: "hi", createdAt: iso(0) },
      { role: "bot", content: "Hello", createdAt: iso(30_000) },
      { role: "visitor", content: "widget broken", createdAt: iso(90_000) },
    ]);
    expect(out).not.toContain("[");
  });

  test("inserts a divider for a large gap", () => {
    const out = formatTranscript([
      { role: "visitor", content: "hi", createdAt: iso(0) },
      {
        role: "visitor",
        content: "still broken",
        createdAt: iso(2 * 24 * 60 * 60 * 1000),
      },
    ]);
    expect(out).toBe("visitor: hi\n[2 days later]\nvisitor: still broken");
  });

  test("appends a resume note when nowMs is far past the last message", () => {
    const out = formatTranscript(
      [{ role: "bot", content: "Anything else?", createdAt: iso(0) }],
      { nowMs: T0 + 3 * 60 * 60 * 1000 },
    );
    expect(out).toContain("[current message sent 3 hours later]");
  });

  test("appends no resume note for a fresh reply", () => {
    const out = formatTranscript(
      [{ role: "bot", content: "Anything else?", createdAt: iso(0) }],
      { nowMs: T0 + 60_000 },
    );
    expect(out).not.toContain("current message");
  });

  test("mixed timestamped and untimestamped messages never throw", () => {
    const out = formatTranscript([
      { role: "visitor", content: "a" },
      { role: "bot", content: "b", createdAt: iso(0) },
      { role: "visitor", content: "c", createdAt: "not-a-date" },
    ]);
    expect(out).toContain("visitor: a");
    expect(out).toContain("visitor: c");
  });
});

describe("formatGapLabel", () => {
  test.each([
    [20 * 60 * 1000, "20 minutes"],
    [90 * 60 * 1000, "2 hours"],
    [26 * 60 * 60 * 1000, "1 day"],
    [9 * 24 * 60 * 60 * 1000, "1 week"],
  ])("labels %dms as %s", (ms, label) => {
    expect(formatGapLabel(ms)).toBe(label);
  });
});

describe("formatCurrentTime", () => {
  test("renders weekday + UTC minute precision", () => {
    expect(formatCurrentTime(T0)).toBe("Thursday, 2026-07-02 10:00 UTC");
  });
});
