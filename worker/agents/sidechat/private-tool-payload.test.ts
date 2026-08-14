import { describe, expect, test } from "bun:test";
import { convertToModelMessages, isToolUIPart, type UIMessage } from "ai";
import {
  createPrivateToolChunkFilter,
  createPrivateToolChunkProjector,
  removeAbandonedApprovalParts,
  sanitizePrivateMessageForPersistence,
} from "./private-tool-payload";

const posthogContext = {
  safety: "read" as const,
  tool: {
    displayName: "Query events",
    source: {
      kind: "mcp" as const,
      name: "PostHog",
      icon: "/integrations/posthog.svg",
    },
  },
};

describe("private Sidechat tool transcript boundary", () => {
  test("removes abandoned approval state before a later model turn", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant-old-approval",
        role: "assistant",
        parts: [
          { type: "text", text: "I need permission first." },
          {
            type: "tool-tool_posthog_list_persons",
            toolCallId: "stale-call",
            state: "approval-responded",
            input: { search: "private@example.com" },
            approval: { id: "stale-approval", approved: true },
          },
        ],
      },
      {
        id: "user-new-turn",
        role: "user",
        parts: [{ type: "text", text: "Try something else." }],
      },
    ];

    expect(removeAbandonedApprovalParts(messages)).toEqual([
      {
        id: "assistant-old-approval",
        role: "assistant",
        parts: [{ type: "text", text: "I need permission first." }],
      },
      messages[1],
    ]);
  });

  test("projects presentation, timing, and credential-redacted business payloads", () => {
    const times = [1_000, 1_240];
    const project = createPrivateToolChunkProjector(
      new Map([["tool_posthog_query_events", posthogContext]]),
      () => times.shift() ?? 1_240,
    );

    expect(project({
      type: "tool-input-start",
      toolCallId: "read-1",
      toolName: "tool_posthog_query_events",
      dynamic: true,
    })).toEqual([
      {
        type: "data-tool-trace",
        id: "read-1:trace",
        data: {
          toolCallId: "read-1",
          startedAt: 1_000,
          ...posthogContext,
        },
      },
      expect.objectContaining({ type: "tool-input-start" }),
    ]);

    expect(project({
      type: "tool-input-available",
      toolCallId: "read-1",
      toolName: "tool_posthog_query_events",
      input: {
        email: "customer@example.com",
        range: { from: "2026-08-10", to: "2026-08-13" },
        authorization: "Bearer private-auth-token",
      },
    })).toEqual([expect.objectContaining({
      input: {
        email: "customer@example.com",
        range: { from: "2026-08-10", to: "2026-08-13" },
        authorization: "[REDACTED]",
      },
    })]);

    expect(project({
      type: "tool-output-available",
      toolCallId: "read-1",
      output: {
        events: [{ event: "checkout", distinctId: "customer-42" }],
        accessToken: "secret-output-token",
      },
    })).toEqual([
      {
        type: "data-tool-timing",
        id: "read-1:timing",
        data: { toolCallId: "read-1", durationMs: 240 },
      },
      expect.objectContaining({
        output: {
          events: [{ event: "checkout", distinctId: "customer-42" }],
          accessToken: "[REDACTED]",
        },
      }),
    ]);
  });

  test("binds an approval to the same presented tool call", () => {
    const project = createPrivateToolChunkProjector(
      new Map([["tool_posthog_query_events", posthogContext]]),
      () => 1_000,
    );
    project({
      type: "tool-input-start",
      toolCallId: "read-1",
      toolName: "tool_posthog_query_events",
    });

    expect(project({
      type: "tool-approval-request",
      toolCallId: "read-1",
      approvalId: "approval-1",
    })).toEqual([
      {
        type: "data-tool-approval",
        id: "read-1:approval-context",
        data: { toolCallId: "read-1", ...posthogContext },
      },
      {
        type: "tool-approval-request",
        toolCallId: "read-1",
        approvalId: "approval-1",
      },
    ]);
  });

  test("persists reasoning and tool history while stripping message metadata and credentials", () => {
    const message: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      metadata: { provider: "openai", credential: "sk-this-is-private-123456" },
      parts: [
        { type: "reasoning", text: "I should query recent activity." },
        { type: "text", text: "I found the cause." },
        {
          type: "dynamic-tool",
          toolName: "tool_posthog_query_events",
          toolCallId: "external-1",
          state: "output-available",
          input: {
            email: "customer@example.com",
            apiKey: "private-key",
          },
          output: {
            events: [{ event: "checkout", distinctId: "customer-42" }],
            refresh_token: "private-refresh",
          },
          callProviderMetadata: { secret: "provider-secret" },
        },
      ],
    } as UIMessage;

    const sanitized = sanitizePrivateMessageForPersistence(message);
    // Provider metadata is stripped; only a persistence timestamp survives.
    expect(sanitized.metadata).toEqual({ createdAt: expect.any(Number) });
    expect(sanitized.parts).toHaveLength(3);
    expect(JSON.stringify(sanitized)).toContain("customer@example.com");
    expect(JSON.stringify(sanitized)).toContain("customer-42");
    expect(JSON.stringify(sanitized)).toContain("I should query recent activity");
    expect(JSON.stringify(sanitized)).not.toContain("private-key");
    expect(JSON.stringify(sanitized)).not.toContain("private-refresh");
    expect(JSON.stringify(sanitized)).not.toContain("provider-secret");
  });

  test("keeps an existing persistence timestamp stable across re-sanitization", () => {
    const message: UIMessage = {
      id: "assistant-2",
      role: "assistant",
      metadata: { createdAt: 1_786_300_000_000, provider: "openai" },
      parts: [{ type: "text", text: "Done." }],
    } as UIMessage;

    const sanitized = sanitizePrivateMessageForPersistence(message);
    expect(sanitized.metadata).toEqual({ createdAt: 1_786_300_000_000 });
  });

  test("keeps approval continuation state and redacts only credential fields", () => {
    const pending: UIMessage = {
      id: "assistant-approval",
      role: "assistant",
      parts: [
        {
          type: "data-tool-approval",
          id: "write-1:approval-context",
          data: { toolCallId: "write-1", safety: "write" },
        },
        {
          type: "dynamic-tool",
          toolName: "tool_linear_create_issue",
          toolCallId: "write-1",
          state: "approval-requested",
          input: {
            title: "Customer cannot checkout",
            token: "private-token",
          },
          approval: { id: "approval-1" },
        },
      ],
    } as UIMessage;

    const sanitized = sanitizePrivateMessageForPersistence(pending);
    expect(sanitized.parts).toHaveLength(2);
    expect(JSON.stringify(sanitized)).toContain("Customer cannot checkout");
    expect(JSON.stringify(sanitized)).not.toContain("private-token");
    expect(sanitized.parts[1]).toMatchObject({
      state: "approval-requested",
      approval: { id: "approval-1" },
      input: { title: "Customer cannot checkout", token: "[REDACTED]" },
    });
  });

  test("forwards continuation outputs for tool calls approved in an earlier stream", () => {
    const project = createPrivateToolChunkProjector(
      new Map([["tool_posthog_query_events", posthogContext]]),
      () => 1_000,
      new Map([["approved-1", "tool_posthog_query_events"]]),
    );

    expect(project({
      type: "tool-output-available",
      toolCallId: "approved-1",
      output: {
        events: [{ event: "checkout" }],
        authorization: "Bearer private-auth-token",
      },
    })).toEqual([
      expect.objectContaining({
        type: "tool-output-available",
        toolCallId: "approved-1",
        output: {
          events: [{ event: "checkout" }],
          authorization: "[REDACTED]",
        },
      }),
    ]);
  });

  test("does not forward continuation outputs for unregistered seeded calls", () => {
    const project = createPrivateToolChunkProjector(
      new Map([["tool_posthog_query_events", posthogContext]]),
      () => 1_000,
      new Map([["approved-1", "tool_unknown_tool"]]),
    );

    expect(project({
      type: "tool-output-available",
      toolCallId: "approved-1",
      output: { value: true },
    })).toEqual([]);
  });

  test("drops earlier-step approval state while keeping the final continuation step", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant-multi-step",
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "tool-tool_posthog_list_persons",
            toolCallId: "call-1",
            state: "approval-responded",
            input: { search: "simon" },
            approval: { id: "approval-1", approved: true },
          },
          { type: "step-start" },
          {
            type: "tool-tool_posthog_execute_sql",
            toolCallId: "call-2",
            state: "approval-responded",
            input: { query: "select 1" },
            approval: { id: "approval-2", approved: true },
          },
        ],
      },
    ];

    const [pruned] = removeAbandonedApprovalParts(messages, true);
    const toolCallIds = pruned!.parts
      .filter((part) => isToolUIPart(part))
      .map((part) => part.toolCallId);
    expect(toolCallIds).toEqual(["call-2"]);
  });

  test("continuation model view never leaves an unhealable dangling tool call", async () => {
    // Mirrors the production shape that produced
    // "AI_APICallError: No tool output found for function call".
    const messages: UIMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "check his activity on posthog" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "tool-tool_posthog_list_persons",
            toolCallId: "call-old",
            state: "approval-responded",
            input: { search: "simon" },
            approval: { id: "approval-old", approved: true },
          },
          { type: "step-start" },
          { type: "text", text: "I found a matching person record." },
        ],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "do that" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "tool-tool_posthog_list_persons",
            toolCallId: "call-1",
            state: "approval-responded",
            input: { search: "simon" },
            approval: { id: "approval-1", approved: true },
          },
          { type: "step-start" },
          {
            type: "tool-tool_posthog_execute_sql",
            toolCallId: "call-2",
            state: "approval-responded",
            input: { query: "select 1" },
            approval: { id: "approval-2", approved: true },
          },
        ],
      },
    ];

    const modelMessages = await convertToModelMessages(
      removeAbandonedApprovalParts(messages, true),
    );

    const approvalIdToToolCallId = new Map<string, string>();
    const callIds = new Set<string>();
    const resultIds = new Set<string>();
    for (const message of modelMessages) {
      if (typeof message.content === "string") continue;
      for (const part of message.content) {
        if (part.type === "tool-call") callIds.add(part.toolCallId);
        if (part.type === "tool-result") resultIds.add(part.toolCallId);
        if (part.type === "tool-approval-request") {
          approvalIdToToolCallId.set(part.approvalId, part.toolCallId);
        }
      }
    }
    // Approvals are only healed (executed by the SDK) when their response is
    // in the final model message.
    const healableIds = new Set<string>();
    const lastMessage = modelMessages.at(-1);
    if (lastMessage?.role === "tool") {
      for (const part of lastMessage.content) {
        if (part.type === "tool-approval-response") {
          const toolCallId = approvalIdToToolCallId.get(part.approvalId);
          if (toolCallId) healableIds.add(toolCallId);
        }
      }
    }
    const dangling = [...callIds].filter(
      (id) => !resultIds.has(id) && !healableIds.has(id),
    );
    expect(dangling).toEqual([]);
  });

  test("does not forward an unregistered tool call", () => {
    const keep = createPrivateToolChunkFilter(new Set(["known_tool"]));
    expect(keep({
      type: "tool-input-start",
      toolCallId: "unknown-1",
      toolName: "unknown_tool",
    })).toBe(false);
    expect(keep({
      type: "tool-output-available",
      toolCallId: "unknown-1",
      output: { value: true },
    })).toBe(false);
  });
});
