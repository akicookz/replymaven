import { describe, expect, test } from "bun:test";
import { formatTitleWithBadge } from "./title-badge";

describe("formatTitleWithBadge", () => {
  test("no count leaves the title unchanged", () => {
    expect(formatTitleWithBadge("ReplyMaven", 0)).toEqual({
      title: "ReplyMaven",
      base: "ReplyMaven",
    });
  });

  test("adds a (N) prefix when count > 0", () => {
    expect(formatTitleWithBadge("ReplyMaven", 3)).toEqual({
      title: "(3) ReplyMaven",
      base: "ReplyMaven",
    });
  });

  test("replaces an existing prefix instead of stacking", () => {
    expect(formatTitleWithBadge("(2) ReplyMaven", 5)).toEqual({
      title: "(5) ReplyMaven",
      base: "ReplyMaven",
    });
  });

  test("dropping to zero strips the prefix", () => {
    expect(formatTitleWithBadge("(2) ReplyMaven", 0)).toEqual({
      title: "ReplyMaven",
      base: "ReplyMaven",
    });
  });

  test("repeated application is idempotent (no stacking across renders)", () => {
    const first = formatTitleWithBadge("ReplyMaven", 1);
    const second = formatTitleWithBadge(first.title, 2);
    const third = formatTitleWithBadge(second.title, 1);
    expect(third).toEqual({ title: "(1) ReplyMaven", base: "ReplyMaven" });
  });

  test("multi-digit counts are stripped correctly", () => {
    expect(formatTitleWithBadge("(12) ReplyMaven", 7)).toEqual({
      title: "(7) ReplyMaven",
      base: "ReplyMaven",
    });
  });
});
