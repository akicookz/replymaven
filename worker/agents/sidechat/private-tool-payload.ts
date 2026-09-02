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
const GATEWAY_CALL_TOOL_NAME = "call_project_tool";
const FALLBACK_APPROVAL_CONTEXT: SidechatToolApprovalContext = {
  safety: "write",
  tool: {
    displayName: "Connected tool",
    source: { kind: "mcp", name: "MCP", icon: null },
  },
};
const MODEL_SAFE_TOOL_NAMES = new Set([
  SAFE_STREAM_TOOL_NAME,
  GATEWAY_CALL_TOOL_NAME,
  "search_knowledge",
  "list_knowledge",
  "read_knowledge",
  "apply_knowledge_change",
  "search_project_tools",
  "describe_project_tool",
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactGatewayInput(value: unknown): unknown {
  if (!isRecord(value) || typeof value.argumentsJson !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value.argumentsJson);
    if (!isRecord(parsed)) {
      return {
        ...value,
        argumentsJson: redactPrivateToolText(value.argumentsJson),
      };
    }
    return {
      ...value,
      argumentsJson: JSON.stringify(redactPrivateToolPayload(parsed)),
    };
  } catch {
    return {
      ...value,
      argumentsJson: redactPrivateToolText(value.argumentsJson),
    };
  }
}

// Gemini 3 rejects replayed tool calls without this opaque signature.
function preservedThoughtSignature(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value.google)) return null;
  const signature = value.google.thoughtSignature;
  return typeof signature === "string" && signature.length > 0
    ? { google: { thoughtSignature: signature } }
    : null;
}

function redactToolChunk(chunk: ToolChunkLike): ToolChunkLike {
  const redacted: Record<string, unknown> = { ...chunk };
  if ("input" in chunk) {
    const input = chunk.toolName === GATEWAY_CALL_TOOL_NAME
      ? redactGatewayInput(chunk.input)
      : chunk.input;
    redacted.input = chunk.toolName === SAFE_STREAM_TOOL_NAME
      ? input
      : redactPrivateToolPayload(input);
  }
  if ("output" in chunk) {
    redacted.output = chunk.toolName === SAFE_STREAM_TOOL_NAME
      ? chunk.output
      : redactPrivateToolPayload(chunk.output);
  }
  if ("rawInput" in chunk) {
    const rawInput = chunk.toolName === GATEWAY_CALL_TOOL_NAME
      ? redactGatewayInput(chunk.rawInput)
      : chunk.rawInput;
    redacted.rawInput = chunk.toolName === SAFE_STREAM_TOOL_NAME
      ? rawInput
      : redactPrivateToolPayload(rawInput);
  }
  if (typeof chunk.errorText === "string") {
    redacted.errorText = redactPrivateToolText(chunk.errorText);
  }
  const preserved = preservedThoughtSignature(chunk.callProviderMetadata);
  if (preserved) redacted.callProviderMetadata = preserved;
  else delete redacted.callProviderMetadata;
  return redacted;
}

export function createPrivateToolChunkFilter(
  knownToolNames: ReadonlySet<string> = new Set(),
  seedToolCalls: ReadonlyMap<string, string> = new Map(),
): (chunk: unknown) => boolean {
  const visibleToolCalls = new Set<string>();
  // Approved tools executed at continuation start stream their output without
  // a fresh tool-input-start, so calls already in the transcript must be
  // visible from the beginning or their outputs are dropped and the call
  // stays dangling forever.
  for (const [toolCallId, toolName] of seedToolCalls) {
    if (toolName === SAFE_STREAM_TOOL_NAME || knownToolNames.has(toolName)) {
      visibleToolCalls.add(toolCallId);
    }
  }
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
  seedToolCalls: ReadonlyMap<string, string> = new Map(),
  resolveContextByToolCallId: (
    toolCallId: string,
    toolName: string | null,
    input: unknown,
  ) => SidechatToolApprovalContext | null |
    Promise<SidechatToolApprovalContext | null> = () => null,
): (chunk: unknown) => Promise<unknown[]> {
  const shouldForward = createPrivateToolChunkFilter(
    new Set([...contextByToolName.keys(), GATEWAY_CALL_TOOL_NAME]),
    seedToolCalls,
  );
  const contextByToolCallId = new Map<string, SidechatToolApprovalContext>();
  const startedAtByToolCallId = new Map<string, number>();

  return async function projectPrivateToolChunk(chunk: unknown): Promise<unknown[]> {
    if (!isRecord(chunk) || typeof chunk.type !== "string") return [];
    const value = chunk as ToolChunkLike;
    const projected: unknown[] = [];
    if (
      (value.type === "tool-input-start" ||
        value.type === "tool-input-available") &&
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string"
    ) {
      const context = contextByToolName.get(value.toolName) ??
        await resolveContextByToolCallId(
          value.toolCallId,
          value.toolName,
          value.input,
        );
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
      // A dropped approval card kills the turn silently; fall back to a
      // generic presentation instead.
      const context = contextByToolCallId.get(value.toolCallId) ??
        await resolveContextByToolCallId(value.toolCallId, null, undefined) ??
        FALLBACK_APPROVAL_CONTEXT;
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
      if (!contextByToolCallId.has(value.toolCallId)) {
        const context = await resolveContextByToolCallId(
          value.toolCallId,
          null,
          undefined,
        );
        if (context) contextByToolCallId.set(value.toolCallId, context);
      }
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
  // Strip provider metadata, but keep a stable persistence timestamp so the
  // dashboard can render real message times instead of the render clock.
  const existing = isRecord(message.metadata) ? message.metadata.createdAt : null;
  const createdAt = typeof existing === "number" && Number.isFinite(existing)
    ? existing
    : Date.now();
  return {
    ...message,
    metadata: { createdAt },
    parts: message.parts.map(sanitizeToolPart),
  };
}

function isApprovalStatePart(part: UIMessage["parts"][number]): boolean {
  return isToolUIPart(part) && (
    part.state === "approval-requested" ||
    part.state === "approval-responded"
  );
}

export function removeAbandonedApprovalParts(
  messages: UIMessage[],
  preserveLatestApproval = false,
): UIMessage[] {
  // The SDK only executes approvals whose responses land in the final model
  // tool message, i.e. the final step segment of the latest approval-bearing
  // message. Approval-state parts anywhere else can never be healed and must
  // be dropped, or the provider receives a tool call with no output.
  let preservedMessageIndex = -1;
  let preservedFromPartIndex = -1;
  if (preserveLatestApproval) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const parts = messages[index]?.parts ?? [];
      let lastApprovalPartIndex = -1;
      for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
        if (isApprovalStatePart(parts[partIndex]!)) {
          lastApprovalPartIndex = partIndex;
          break;
        }
      }
      if (lastApprovalPartIndex === -1) continue;
      let segmentStart = 0;
      for (let partIndex = lastApprovalPartIndex; partIndex >= 0; partIndex -= 1) {
        if (parts[partIndex]?.type === "step-start") {
          segmentStart = partIndex;
          break;
        }
      }
      preservedMessageIndex = index;
      preservedFromPartIndex = segmentStart;
      break;
    }
  }
  return messages
    .map((message, messageIndex) => ({
      ...message,
      parts: message.parts.filter((part, partIndex) =>
        !isApprovalStatePart(part) ||
        (
          messageIndex === preservedMessageIndex &&
          partIndex >= preservedFromPartIndex
        )
      ),
    }))
    .filter((message) => message.parts.length > 0);
}

export function removeLegacyProjectToolParts(
  messages: UIMessage[],
): UIMessage[] {
  return messages
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part) =>
        !isToolUIPart(part) || MODEL_SAFE_TOOL_NAMES.has(
          part.type === "dynamic-tool" ? part.toolName : part.type.slice(5),
        )
      ),
    }))
    .filter((message) => message.parts.length > 0);
}
