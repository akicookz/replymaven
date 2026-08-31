import type { ChatResponseResult } from "@cloudflare/ai-chat";
import { tool, type UIMessage } from "ai";
import { z } from "zod";
import type { ReplyDraftData } from "../../../shared/sidechat-agent";

export const replyDraftInputSchema = z.object({
  text: z.string().trim().min(1).max(5_000),
});

export function createReplyDraftTool() {
  return tool({
    description:
      "Prepare visitor-ready reply text for the human agent to review.",
    inputSchema: replyDraftInputSchema,
    async execute({ text }) {
      void text;
      return { accepted: true as const };
    },
  });
}

function extractSettledReplyDraft(message: UIMessage): string | null {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index] as Record<string, unknown>;
    if (
      part.type !== "tool-present_reply_draft" ||
      part.state !== "output-available"
    ) {
      continue;
    }
    const output = part.output;
    if (
      !output ||
      typeof output !== "object" ||
      (output as Record<string, unknown>).accepted !== true
    ) {
      continue;
    }
    const parsed = replyDraftInputSchema.safeParse(part.input);
    if (parsed.success) return parsed.data.text;
  }
  return null;
}

function extractPersistedReplyDraft(message: UIMessage): string | null {
  const expectedId = `${message.id}:reply-draft`;
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index] as Record<string, unknown>;
    if (
      part.type !== "data-reply-draft" ||
      part.id !== expectedId ||
      !part.data ||
      typeof part.data !== "object"
    ) {
      continue;
    }
    const data = part.data as Record<string, unknown>;
    const parsed = replyDraftInputSchema.safeParse({ text: data.text });
    if (parsed.success) return parsed.data.text;
  }
  return null;
}

export function readSettledReplyDraft(message: UIMessage): string | null {
  return extractPersistedReplyDraft(message) ??
    extractSettledReplyDraft(message);
}

function hasReplyDraftData(message: UIMessage): boolean {
  return message.parts.some(
    (part) =>
      part.type === "data-reply-draft" &&
      "id" in part &&
      part.id === `${message.id}:reply-draft`,
  );
}

interface PersistCompletedReplyDraftOptions {
  result: ChatResponseResult;
  messages: UIMessage[];
  persistMessages(messages: UIMessage[]): Promise<void>;
  now?: () => number;
}

export async function persistCompletedReplyDraft(
  options: PersistCompletedReplyDraftOptions,
): Promise<boolean> {
  if (options.result.status !== "completed") return false;
  if (hasReplyDraftData(options.result.message)) return true;
  const text = extractSettledReplyDraft(options.result.message);
  if (!text) return false;

  const dataPart: ReplyDraftData = {
    type: "data-reply-draft",
    id: `${options.result.message.id}:reply-draft`,
    data: { text, createdAt: (options.now ?? Date.now)() },
  };
  const updatedMessage = {
    ...options.result.message,
    parts: [...options.result.message.parts, dataPart],
  } as UIMessage;
  const persistedMessages = options.messages.map((message) =>
    message.id === updatedMessage.id ? updatedMessage : message,
  );
  if (!persistedMessages.some((message) => message.id === updatedMessage.id)) {
    persistedMessages.push(updatedMessage);
  }
  await options.persistMessages(persistedMessages);
  return true;
}
