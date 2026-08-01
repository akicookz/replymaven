import { describe, expect, test } from "bun:test";
import { buildEmailMessageId, parseEmailMessageId } from "./email-service";

describe("email Message-ID helpers", () => {
  test("keeps inbound replies in the most recent ReplyMaven thread", () => {
    const older = "fedcba98-7654-3210-fedc-ba9876543210";
    const newest = "01234567-89ab-cdef-0123-456789abcdef";
    const references = `${buildEmailMessageId(older)} ${buildEmailMessageId(newest)}`;

    expect(parseEmailMessageId(buildEmailMessageId(newest))).toBe(newest);
    expect(parseEmailMessageId(references, { source: "references" })).toBe(newest);
  });
});
