import type { UIMessage } from "ai";

interface ToolChunkLike {
  type?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
}

const SAFE_PERSISTED_TOOL_TYPE = "tool-present_reply_draft";
const SAFE_STREAM_TOOL_NAME = "present_reply_draft";

function isToolInputChunk(type: string): boolean {
  return (
    type === "tool-input-start" ||
    type === "tool-input-available" ||
    type === "tool-input-error"
  );
}

function isToolFollowupChunk(type: string): boolean {
  return (
    type === "tool-input-delta" ||
    type === "tool-approval-request" ||
    type === "tool-output-available" ||
    type === "tool-output-error" ||
    type === "tool-output-denied"
  );
}

export function createPrivateToolChunkFilter(): (chunk: unknown) => boolean {
  const safeToolCalls = new Map<string, boolean>();
  return function shouldForward(chunk: unknown): boolean {
    if (!chunk || typeof chunk !== "object") return false;
    const value = chunk as ToolChunkLike;
    if (typeof value.type !== "string") return false;
    if (isToolInputChunk(value.type)) {
      if (
        typeof value.toolCallId !== "string" ||
        typeof value.toolName !== "string"
      ) {
        return false;
      }
      const safe = value.toolName === SAFE_STREAM_TOOL_NAME;
      safeToolCalls.set(value.toolCallId, safe);
      return safe;
    }
    if (isToolFollowupChunk(value.type)) {
      return (
        typeof value.toolCallId === "string" &&
        safeToolCalls.get(value.toolCallId) === true
      );
    }
    return true;
  };
}

export function sanitizePrivateMessageForPersistence(
  message: UIMessage,
): UIMessage {
  return {
    ...message,
    parts: message.parts.filter((part) => {
      if (part.type === "dynamic-tool") return false;
      if (part.type.startsWith("tool-")) {
        return part.type === SAFE_PERSISTED_TOOL_TYPE;
      }
      return true;
    }),
  };
}
