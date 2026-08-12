import { isToolUIPart, type UIMessage } from "ai";
import type { SidechatToolApprovalContext } from "../../../shared/sidechat-agent";
import {
  redactPrivateToolPayload,
  redactPrivateToolText,
} from "../../../shared/private-tool-payload";

interface ToolChunkLike {
  type?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  rawInput?: unknown;
  errorText?: unknown;
  approvalId?: unknown;
  callProviderMetadata?: unknown;
}

const SAFE_STREAM_TOOL_NAME = "present_reply_draft";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactToolChunk(chunk: ToolChunkLike): ToolChunkLike {
  const redacted: Record<string, unknown> = { ...chunk };
  if ("input" in chunk) redacted.input = redactPrivateToolPayload(chunk.input);
  if ("output" in chunk) redacted.output = redactPrivateToolPayload(chunk.output);
  if ("rawInput" in chunk) {
    redacted.rawInput = redactPrivateToolPayload(chunk.rawInput);
  }
  if (typeof chunk.errorText === "string") {
    redacted.errorText = redactPrivateToolText(chunk.errorText);
  }
  delete redacted.callProviderMetadata;
  return redacted;
}

export function createPrivateToolChunkFilter(
  knownToolNames: ReadonlySet<string> = new Set(),
): (chunk: unknown) => boolean {
  const visibleToolCalls = new Set<string>();
  return function shouldForward(chunk: unknown): boolean {
    if (!isRecord(chunk) || typeof chunk.type !== "string") return false;
    if (
      chunk.type === "tool-input-start" ||
      chunk.type === "tool-input-available" ||
      chunk.type === "tool-input-error"
    ) {
      if (
        typeof chunk.toolCallId !== "string" ||
        typeof chunk.toolName !== "string"
      ) {
        return false;
      }
      if (
        chunk.toolName === SAFE_STREAM_TOOL_NAME ||
        knownToolNames.has(chunk.toolName)
      ) {
        visibleToolCalls.add(chunk.toolCallId);
        return true;
      }
      return false;
    }
    if (chunk.type === "tool-input-delta") return false;
    if (chunk.type.startsWith("tool-")) {
      return typeof chunk.toolCallId === "string" &&
        visibleToolCalls.has(chunk.toolCallId);
    }
    return true;
  };
}

export function createPrivateToolChunkProjector(
  contextByToolName: ReadonlyMap<string, SidechatToolApprovalContext>,
  now: () => number = Date.now,
): (chunk: unknown) => unknown[] {
  const shouldForward = createPrivateToolChunkFilter(
    new Set(contextByToolName.keys()),
  );
  const contextByToolCallId = new Map<string, SidechatToolApprovalContext>();
  const startedAtByToolCallId = new Map<string, number>();

  return function projectPrivateToolChunk(chunk: unknown): unknown[] {
    if (!isRecord(chunk) || typeof chunk.type !== "string") return [];
    const value = chunk as ToolChunkLike;
    const projected: unknown[] = [];
    if (
      (value.type === "tool-input-start" ||
        value.type === "tool-input-available") &&
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string"
    ) {
      const context = contextByToolName.get(value.toolName);
      if (context && !contextByToolCallId.has(value.toolCallId)) {
        contextByToolCallId.set(value.toolCallId, context);
        const startedAt = now();
        startedAtByToolCallId.set(value.toolCallId, startedAt);
        projected.push({
          type: "data-tool-trace",
          id: `${value.toolCallId}:trace`,
          data: {
            toolCallId: value.toolCallId,
            startedAt,
            ...context,
          },
        });
      }
    }

    if (!shouldForward(chunk)) return projected;

    if (
      value.type === "tool-approval-request" &&
      typeof value.toolCallId === "string" &&
      typeof value.approvalId === "string"
    ) {
      const context = contextByToolCallId.get(value.toolCallId);
      if (!context) return projected;
      projected.push(
        {
          type: "data-tool-approval",
          id: `${value.toolCallId}:approval-context`,
          data: { toolCallId: value.toolCallId, ...context },
        },
        {
          type: "tool-approval-request",
          toolCallId: value.toolCallId,
          approvalId: value.approvalId,
        },
      );
      return projected;
    }

    if (
      (value.type === "tool-output-available" ||
        value.type === "tool-output-error" ||
        value.type === "tool-output-denied") &&
      typeof value.toolCallId === "string"
    ) {
      const startedAt = startedAtByToolCallId.get(value.toolCallId);
      if (startedAt !== undefined) {
        projected.push({
          type: "data-tool-timing",
          id: `${value.toolCallId}:timing`,
          data: {
            toolCallId: value.toolCallId,
            durationMs: Math.max(0, now() - startedAt),
          },
        });
      }
    }

    projected.push(redactToolChunk(value));
    return projected;
  };
}

function sanitizeToolPart(part: UIMessage["parts"][number]): UIMessage["parts"][number] {
  if (!isToolUIPart(part)) return part;
  return redactToolChunk(part) as UIMessage["parts"][number];
}

export function sanitizePrivateMessageForPersistence(
  message: UIMessage,
): UIMessage {
  return {
    ...message,
    metadata: undefined,
    parts: message.parts.map(sanitizeToolPart),
  };
}

export function removeAbandonedApprovalParts(
  messages: UIMessage[],
  preserveLatestApproval = false,
): UIMessage[] {
  let latestApprovalMessageIndex = -1;
  if (preserveLatestApproval) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.parts.some((part) =>
        isToolUIPart(part) && (
          part.state === "approval-requested" ||
          part.state === "approval-responded"
        )
      )) {
        latestApprovalMessageIndex = index;
        break;
      }
    }
  }
  return messages
    .map((message, messageIndex) => ({
      ...message,
      parts: message.parts.filter((part) =>
        !isToolUIPart(part) ||
        messageIndex === latestApprovalMessageIndex ||
        (
          part.state !== "approval-requested" &&
          part.state !== "approval-responded"
        )
      ),
    }))
    .filter((message) => message.parts.length > 0);
}
