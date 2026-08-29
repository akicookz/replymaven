import {
  getToolApproval,
  getToolCallId,
} from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { SidechatToolPresentation } from "../../../shared/sidechat-agent";
import {
  redactPrivateToolPayload,
  redactPrivateToolText,
} from "../../../shared/private-tool-payload";
import type {
  Message,
  SidechatToolTraceState,
  SidechatTraceItem,
} from "./types";

const MAX_RENDERED_TEXT = 20_000;
const MAX_ACTIVITY_LABEL = 240;
const MAX_TOOL_DISPLAY_NAME = 160;
const MAX_SOURCE_NAME = 100;
const SAFE_INTEGRATION_ICON = /^\/integrations\/[a-z0-9-]+\.svg$/u;
const GATEWAY_CALL_TOOL_NAME = "call_project_tool";
const HIDDEN_GATEWAY_TOOL_NAMES = new Set([
  "search_project_tools",
  "describe_project_tool",
]);
const LEGACY_APPROVAL_EXPIRED =
  "This approval expired after the connected-tool upgrade. Ask Maven to retry.";

export type SafeSidechatDataPart =
  | { type: "turn-accepted"; messageId: string }
  | {
      type: "safe-activity";
      label: string;
      status: "started" | "success" | "error";
      tool?: SidechatToolPresentation;
    };

interface AdaptSidechatMessagesOptions {
  now?: number;
  canAlwaysAllow?: boolean;
}

interface ToolTraceContext {
  toolCallId: string;
  safety: ApprovalSafety;
  tool: SidechatToolPresentation | null;
  startedAt?: number;
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readToolPresentation(value: unknown): SidechatToolPresentation | null {
  if (!isRecord(value) || !isRecord(value.source)) return null;
  const displayName = boundedString(value.displayName, MAX_TOOL_DISPLAY_NAME);
  const kind = value.source.kind;
  const name = boundedString(value.source.name, MAX_SOURCE_NAME);
  const rawIcon = value.source.icon;
  const icon = rawIcon === null
    ? null
    : typeof rawIcon === "string" && SAFE_INTEGRATION_ICON.test(rawIcon)
      ? rawIcon
      : null;
  if (!displayName || !name || (kind !== "mcp" && kind !== "http")) {
    return null;
  }
  return { displayName, source: { kind, name, icon } };
}

export function readSafeSidechatDataPart(
  value: unknown,
): SafeSidechatDataPart | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  if (value.type === "data-turn-accepted") {
    const messageId = boundedString(value.data.messageId, 200);
    return messageId ? { type: "turn-accepted", messageId } : null;
  }
  if (value.type === "data-safe-activity") {
    const label = boundedString(value.data.label, MAX_ACTIVITY_LABEL);
    const status = value.data.status;
    if (
      !label ||
      (status !== "started" && status !== "success" && status !== "error")
    ) {
      return null;
    }
    const tool = readToolPresentation(value.data.tool);
    return {
      type: "safe-activity",
      label,
      status,
      ...(tool ? { tool } : {}),
    };
  }
  return null;
}

function readReplyDraft(
  part: unknown,
  expectedId: string,
): { text: string; createdAt: number } | null {
  if (
    !isRecord(part) ||
    part.type !== "data-reply-draft" ||
    part.id !== expectedId ||
    !isRecord(part.data)
  ) {
    return null;
  }
  const text = boundedString(part.data.text, 5_000)?.trim();
  const createdAt = part.data.createdAt;
  if (!text || typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
    return null;
  }
  return { text, createdAt };
}

type ApprovalSafety = "read" | "write" | "destructive";

function readApprovalContext(
  part: unknown,
): {
  toolCallId: string;
  safety: ApprovalSafety;
  tool: SidechatToolPresentation | null;
} | null {
  if (
    !isRecord(part) ||
    part.type !== "data-tool-approval" ||
    !isRecord(part.data)
  ) {
    return null;
  }
  const toolCallId = boundedString(part.data.toolCallId, 200);
  const safety = part.data.safety;
  if (
    !toolCallId ||
    part.id !== `${toolCallId}:approval-context` ||
    (safety !== "read" && safety !== "write" && safety !== "destructive")
  ) {
    return null;
  }
  return {
    toolCallId,
    safety,
    tool: readToolPresentation(part.data.tool),
  };
}

function readToolTraceContext(part: unknown): ToolTraceContext | null {
  if (
    !isRecord(part) ||
    part.type !== "data-tool-trace" ||
    !isRecord(part.data)
  ) {
    return null;
  }
  const toolCallId = boundedString(part.data.toolCallId, 200);
  const safety = part.data.safety;
  const startedAt = part.data.startedAt;
  if (
    !toolCallId ||
    part.id !== `${toolCallId}:trace` ||
    (safety !== "read" && safety !== "write" && safety !== "destructive")
  ) {
    return null;
  }
  return {
    toolCallId,
    safety,
    tool: readToolPresentation(part.data.tool),
    ...(typeof startedAt === "number" && Number.isFinite(startedAt)
      ? { startedAt }
      : {}),
  };
}

function readToolDuration(part: unknown): {
  toolCallId: string;
  durationMs: number;
} | null {
  if (
    !isRecord(part) ||
    part.type !== "data-tool-timing" ||
    !isRecord(part.data)
  ) {
    return null;
  }
  const toolCallId = boundedString(part.data.toolCallId, 200);
  const durationMs = part.data.durationMs;
  if (
    !toolCallId ||
    part.id !== `${toolCallId}:timing` ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return null;
  }
  return { toolCallId, durationMs };
}

function readText(parts: UIMessage["parts"]): string {
  return parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("")
    .slice(0, MAX_RENDERED_TEXT);
}

function fallbackToolPresentation(part: UIMessage["parts"][number]) {
  const dynamicTitle = part.type === "dynamic-tool"
    ? boundedString(part.title, MAX_TOOL_DISPLAY_NAME)
    : null;
  return {
    displayName: dynamicTitle ?? "Connected tool",
    source: {
      kind: part.type === "dynamic-tool" ? "mcp" as const : "http" as const,
      name: part.type === "dynamic-tool" ? "MCP" : "Custom tool",
      icon: null,
    },
  };
}

function visibleToolInput(toolName: string, input: unknown): unknown {
  if (
    toolName === GATEWAY_CALL_TOOL_NAME &&
    isRecord(input) &&
    typeof input.argumentsJson === "string" &&
    input.argumentsJson.length <= 20_000
  ) {
    try {
      const parsed: unknown = JSON.parse(input.argumentsJson);
      return isRecord(parsed) ? parsed : { error: "Invalid tool arguments" };
    } catch {
      return { error: "Invalid tool arguments" };
    }
  }
  return input;
}

function visibleToolError(
  legacyPendingApproval: boolean,
  errorText: unknown,
): string | null {
  if (legacyPendingApproval) return LEGACY_APPROVAL_EXPIRED;
  if (typeof errorText !== "string") return null;
  return redactPrivateToolText(errorText).slice(0, 2_000);
}

function readSidechatTrace(
  nativeMessage: UIMessage,
  canAlwaysAllow: boolean,
): SidechatTraceItem[] {
  const contextByToolCallId = new Map<string, ToolTraceContext>();
  const durationByToolCallId = new Map<string, number>();
  for (const part of nativeMessage.parts) {
    const trace = readToolTraceContext(part);
    if (trace) contextByToolCallId.set(trace.toolCallId, trace);
    const approval = readApprovalContext(part);
    if (approval) {
      const current = contextByToolCallId.get(approval.toolCallId);
      contextByToolCallId.set(approval.toolCallId, {
        toolCallId: approval.toolCallId,
        safety: approval.safety,
        tool: approval.tool ?? current?.tool ?? null,
        ...(current?.startedAt !== undefined
          ? { startedAt: current.startedAt }
          : {}),
      });
    }
    const timing = readToolDuration(part);
    if (timing) durationByToolCallId.set(timing.toolCallId, timing.durationMs);
  }

  const traceItems: SidechatTraceItem[] = [];
  nativeMessage.parts.forEach((part, index) => {
    if (part.type === "reasoning") {
      const text = boundedString(part.text, MAX_RENDERED_TEXT);
      if (text) {
        traceItems.push({
          type: "reasoning",
          id: `${nativeMessage.id}:reasoning:${index}`,
          text: redactPrivateToolText(text),
          state: part.state === "streaming" ? "streaming" : "done",
        });
      }
      return;
    }
    if (!isToolUIPart(part)) return;
    const toolName = getToolName(part);
    // The internal reply-draft tool is presentation plumbing, not an action:
    // its result already renders as the draft bubble with "Add to reply".
    if (
      toolName === "present_reply_draft" ||
      HIDDEN_GATEWAY_TOOL_NAMES.has(toolName)
    ) return;
    const toolCallId = boundedString(getToolCallId(part), 200);
    if (!toolCallId) return;
    const context = contextByToolCallId.get(toolCallId);
    const state = part.state as SidechatToolTraceState;
    const approval = getToolApproval(part);
    const value = part as typeof part & {
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };
    const legacyPendingApproval =
      part.state === "approval-requested" &&
      toolName !== GATEWAY_CALL_TOOL_NAME &&
      toolName !== "search_knowledge";
    const errorText = visibleToolError(
      legacyPendingApproval,
      value.errorText,
    );
    traceItems.push({
      type: "tool",
      id: `${nativeMessage.id}:${toolCallId}`,
      toolCallId,
      state: legacyPendingApproval ? "output-error" : state,
      tool: {
        ...(context?.tool ?? fallbackToolPresentation(part)),
        safety: context?.safety ?? "write",
      },
      ...(value.input !== undefined
        ? {
            input: redactPrivateToolPayload(
              visibleToolInput(toolName, value.input),
            ),
          }
        : {}),
      ...(value.output !== undefined
        ? { output: redactPrivateToolPayload(value.output) }
        : {}),
      ...(errorText ? { errorText } : {}),
      ...(durationByToolCallId.has(toolCallId)
        ? { durationMs: durationByToolCallId.get(toolCallId) }
        : {}),
      ...(approval && !legacyPendingApproval
        ? {
            approval: {
              id: approval.id,
              ...(typeof approval.approved === "boolean"
                ? { approved: approval.approved }
                : {}),
              canAlwaysAllow,
            },
          }
        : {}),
    });
  });
  return traceItems;
}

function readLatestReplyDraft(
  messageId: string,
  parts: UIMessage["parts"],
): { text: string; createdAt: number } | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const draft = readReplyDraft(
      parts[index],
      `${messageId}:reply-draft`,
    );
    if (draft) return draft;
  }
  return null;
}

function readMessageCreatedAt(message: UIMessage): number | null {
  const metadata = message.metadata;
  if (
    isRecord(metadata) &&
    typeof metadata.createdAt === "number" &&
    Number.isFinite(metadata.createdAt)
  ) {
    return metadata.createdAt;
  }
  return null;
}

function toIsoTime(milliseconds: number): string {
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

export function adaptSidechatMessages(
  nativeMessages: UIMessage[],
  options: AdaptSidechatMessagesOptions = {},
): Message[] {
  const baseTime = options.now ?? Date.now();
  const rendered: Message[] = [];

  nativeMessages.forEach((nativeMessage, messageIndex) => {
    if (nativeMessage.role !== "user" && nativeMessage.role !== "assistant") {
      return;
    }

    const text = readText(nativeMessage.parts);
    const draft = nativeMessage.role === "assistant"
      ? readLatestReplyDraft(nativeMessage.id, nativeMessage.parts)
      : null;
    const content = text || draft?.text || "";
    const sidechatTrace = nativeMessage.role === "assistant"
      ? readSidechatTrace(nativeMessage, options.canAlwaysAllow === true)
      : [];
    if (content || sidechatTrace.length > 0) {
      rendered.push({
        id: nativeMessage.id,
        role: nativeMessage.role === "user" ? "agent" : "bot",
        content,
        senderName: nativeMessage.role === "assistant" ? "Maven" : "You",
        createdAt: toIsoTime(
          readMessageCreatedAt(nativeMessage) ??
            draft?.createdAt ??
            baseTime + messageIndex,
        ),
        ...(sidechatTrace.length > 0 ? { sidechatTrace } : {}),
        ...(draft
          ? {
              presentationAction: {
                type: "add_to_reply" as const,
                draft: draft.text,
              },
            }
          : {}),
      });
    }
  });

  return rendered;
}
