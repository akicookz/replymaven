import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
  createPrivateToolChunkFilter,
  sanitizePrivateMessageForPersistence,
} from "./private-tool-payload";

describe("private Sidechat tool payload boundary", () => {
  test("drops external tool inputs and outputs while preserving text and reply drafts", () => {
    const keep = createPrivateToolChunkFilter();
    const chunks = [
      { type: "text-delta", id: "text-1", delta: "I checked that." },
      {
        type: "tool-input-start",
        toolCallId: "external-1",
        toolName: "tool_mcpserver_find_customer",
        dynamic: true,
      },
      {
        type: "tool-input-available",
        toolCallId: "external-1",
        toolName: "tool_mcpserver_find_customer",
        input: { externalId: "secret-id" },
        dynamic: true,
      },
      {
        type: "tool-output-available",
        toolCallId: "external-1",
        output: { email: "private@example.com" },
        dynamic: true,
      },
      {
        type: "tool-input-available",
        toolCallId: "draft-1",
        toolName: "present_reply_draft",
        input: { text: "Safe visitor reply" },
      },
      {
        type: "tool-output-available",
        toolCallId: "draft-1",
        output: { accepted: true },
      },
    ];

    const forwarded = chunks.filter((chunk) => keep(chunk));
    expect(JSON.stringify(forwarded)).not.toContain("secret-id");
    expect(JSON.stringify(forwarded)).not.toContain("private@example.com");
    expect(forwarded).toContainEqual(
      expect.objectContaining({ type: "text-delta" }),
    );
    expect(forwarded).toContainEqual(
      expect.objectContaining({
        type: "tool-input-available",
        toolName: "present_reply_draft",
      }),
    );
    expect(forwarded).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        toolCallId: "draft-1",
      }),
    );
  });

  test("removes dynamic external tool parts before native transcript persistence", () => {
    const message: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "I checked that." },
        {
          type: "dynamic-tool",
          toolName: "tool_mcpserver_find_customer",
          toolCallId: "external-1",
          state: "output-available",
          input: { externalId: "secret-id" },
          output: { email: "private@example.com" },
        },
        {
          type: "tool-present_reply_draft",
          toolCallId: "draft-1",
          state: "output-available",
          input: { text: "Safe visitor reply" },
          output: { accepted: true },
        },
      ],
    };

    const sanitized = sanitizePrivateMessageForPersistence(message);
    expect(JSON.stringify(sanitized)).not.toContain("secret-id");
    expect(JSON.stringify(sanitized)).not.toContain("private@example.com");
    expect(sanitized.parts).toContainEqual({
      type: "text",
      text: "I checked that.",
    });
    expect(sanitized.parts).toContainEqual(
      expect.objectContaining({ type: "tool-present_reply_draft" }),
    );
  });
});
