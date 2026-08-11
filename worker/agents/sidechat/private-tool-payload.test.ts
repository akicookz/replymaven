import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
  createPrivateToolChunkFilter,
  sanitizePrivateMessageForPersistence,
} from "./private-tool-payload";

describe("private Sidechat tool payload boundary", () => {
  test("drops external tool inputs and outputs while preserving text and reply drafts", () => {
    const keep = createPrivateToolChunkFilter(new Set(["tool_mcpserver_write_customer"]));
    const chunks = [
      { type: "text-delta", id: "text-1", delta: "I checked that." },
      {
        type: "tool-input-start",
        toolCallId: "external-1",
        toolName: "tool_mcpserver_find_customer",
        dynamic: true,
      },
      {
        type: "tool-input-start",
        toolCallId: "write-1",
        toolName: "tool_mcpserver_write_customer",
        dynamic: true,
      },
      {
        type: "tool-input-available",
        toolCallId: "write-1",
        toolName: "tool_mcpserver_write_customer",
        input: { opaque: "approval-input" },
        dynamic: true,
      },
      {
        type: "tool-approval-request",
        toolCallId: "write-1",
        approvalId: "approval-1",
      },
      {
        type: "tool-output-available",
        toolCallId: "write-1",
        output: { raw: "write-output" },
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
    expect(JSON.stringify(forwarded)).not.toContain("write-output");
    expect(forwarded).toContainEqual(
      expect.objectContaining({
        type: "tool-approval-request",
        approvalId: "approval-1",
      }),
    );
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

  test("retains only pending native write parts needed for durable approval continuation", () => {
    const pending: UIMessage = {
      id: "assistant-approval",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "tool_mcpserver_write_customer",
          toolCallId: "write-1",
          state: "approval-requested",
          input: { opaque: "native-continuation-input" },
          approval: { id: "approval-1" },
        },
        {
          type: "dynamic-tool",
          toolName: "tool_mcpserver_read_customer",
          toolCallId: "read-1",
          state: "output-available",
          input: { private: "read-input" },
          output: { private: "read-output" },
        },
      ],
    };

    const sanitized = sanitizePrivateMessageForPersistence(pending);
    expect(sanitized.parts).toHaveLength(1);
    expect(sanitized.parts[0]).toMatchObject({
      type: "dynamic-tool",
      state: "approval-requested",
      toolCallId: "write-1",
      approval: { id: "approval-1" },
    });
    expect(JSON.stringify(sanitized)).not.toContain("read-input");
    expect(JSON.stringify(sanitized)).not.toContain("read-output");
  });
});
