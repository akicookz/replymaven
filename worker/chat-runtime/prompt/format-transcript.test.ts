import { expect, test } from "bun:test";
import { formatTranscript } from "./format-transcript";

const start = new Date("2026-07-02T10:00:00Z").getTime();

test("adds temporal context only for meaningful conversation gaps", () => {
  const delayed = formatTranscript([
    { role: "visitor", content: "first", createdAt: new Date(start).toISOString() },
    { role: "visitor", content: "later", createdAt: new Date(start + 2 * 24 * 60 * 60 * 1000).toISOString() },
  ]);
  const rapid = formatTranscript([
    { role: "visitor", content: "first", createdAt: new Date(start).toISOString() },
    { role: "bot", content: "reply", createdAt: new Date(start + 60_000).toISOString() },
  ]);

  expect(delayed).toContain("later]");
  expect(rapid).not.toContain("[");
});
