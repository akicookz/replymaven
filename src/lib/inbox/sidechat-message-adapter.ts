import {
  getToolApproval,
  getToolCallId,
  getToolPartState,
} from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { Message } from "./types";

const MAX_RENDERED_TEXT = 20_000;
const MAX_ACTIVITY_LABEL = 240;

export type SafeSidechatDataPart =
  | { type: "turn-accepted"; messageId: string }
  | {
      type: "safe-activity";
      label: string;
      status: "started" | "success" | "error";
    };

interface AdaptSidechatMessagesOptions {
  now?: number;
  canAlwaysAllow?: boolean;
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
    return { type: "safe-activity", label, status };
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
    if (content) {
      rendered.push({
        id: nativeMessage.id,
        role: nativeMessage.role === "user" ? "agent" : "bot",
        content,
        senderName: nativeMessage.role === "assistant" ? "Maven" : "You",
        createdAt: toIsoTime(draft?.createdAt ?? baseTime + messageIndex),
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

    if (nativeMessage.role !== "assistant") return;
    nativeMessage.parts.forEach((part, partIndex) => {
      if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") {
        return;
      }
      const toolCallId = boundedString(getToolCallId(part), 200);
      const approvalId = boundedString(getToolApproval(part)?.id, 200);
      const toolName = boundedString(getToolName(part), 200);
      if (!toolCallId || !approvalId || !toolName) return;
      rendered.push({
        id: `${nativeMessage.id}:${toolCallId}`,
        role: "bot",
        content:
          "Run this write action?\n\nThis **can change data in the connected service** and may not be reversible.",
        senderName: "Maven",
        createdAt: toIsoTime(baseTime + messageIndex + partIndex + 1),
        presentationAction: {
          type: "approval",
          approvalId,
          toolCallId,
          canAlwaysAllow: options.canAlwaysAllow === true,
        },
      });
    });
  });

  return rendered;
}
