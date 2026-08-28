import type { UIMessage } from "ai";
import type { SidechatStatus } from "../../../shared/sidechat-agent";

export function hasVisibleSidechatAssistantText(message: UIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type !== "text") return false;
    return typeof part.text === "string" && part.text.trim().length > 0;
  });
}

export function resolveCompletedSidechatSummary(input: {
  publishedDraft: boolean;
  hasAssistantText: boolean;
}): Extract<SidechatStatus, "ready" | "idle" | "failed"> {
  if (input.publishedDraft) return "ready";
  if (input.hasAssistantText) return "idle";
  return "failed";
}

export function summarizeStreamFinish(event: unknown): {
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  textLength: number;
  stepCount: number | null;
} {
  const record = isRecord(event) ? event : {};
  const usage = isRecord(record.usage) ? record.usage : {};
  const text = typeof record.text === "string" ? record.text : "";
  const steps = Array.isArray(record.steps) ? record.steps : null;
  return {
    finishReason: typeof record.finishReason === "string"
      ? record.finishReason
      : null,
    inputTokens: readNumber(usage.inputTokens ?? usage.promptTokens),
    outputTokens: readNumber(usage.outputTokens ?? usage.completionTokens),
    totalTokens: readNumber(usage.totalTokens),
    textLength: text.length,
    stepCount: steps?.length ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
