import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import type {
  PublicConversationRecord,
  PublicMessageMetadata,
  PublicSourceReference,
} from "../../../../shared/maven-conversation";
import type { MavenTurnResult } from "../../../chat-runtime/orchestration/run-maven-turn";
import {
  createStreamingStripState,
  flushStreamingStripState,
  stripInternalTokensStreaming,
  type InternalToken,
} from "../../../chat-runtime/streaming/internal-tokens";
import type {
  AiParticipation,
  MavenStreamPart,
} from "../../../chat-runtime/types";
import type { PublicUIMessage } from "./public-message";

export type PublicTurnGate =
  | "subscription_inactive"
  | "message_limit_reached"
  | "banned"
  | "archived"
  | "muted"
  | "human_mode"
  | "reopen_and_run_ai"
  | "run_ai";

interface PublicTurnGateInput {
  subscriptionActive: boolean;
  messageAllowed: boolean;
  banned: boolean;
  archived: boolean;
  status: PublicConversationRecord["status"];
  closeReason: PublicConversationRecord["closeReason"];
  aiParticipation: AiParticipation;
  aiInvoked: boolean;
}

export function evaluatePublicTurnGate(
  input: PublicTurnGateInput,
): PublicTurnGate {
  if (!input.subscriptionActive) return "subscription_inactive";
  if (!input.messageAllowed) return "message_limit_reached";
  if (input.banned) return "banned";
  if (input.archived) return "archived";
  if (input.closeReason === "spam") return "muted";
  if (input.status === "closed") return "reopen_and_run_ai";
  if (
    input.aiParticipation === "human_only" &&
    !input.aiInvoked
  ) return "human_mode";
  if (
    (input.status === "waiting_agent" || input.status === "agent_replied") &&
    input.aiParticipation !== "assist_until_agent" &&
    !input.aiInvoked
  ) return "human_mode";
  return "run_ai";
}

export interface CollectedPublicTurn {
  fullText: string;
  internalTokens: InternalToken[];
  hadToolCalls: boolean;
}

export async function collectPublicTurnStream(
  stream: AsyncIterable<MavenStreamPart>,
  emitText: (delta: string) => void,
  emitActivity?: (phase: string) => void,
): Promise<CollectedPublicTurn> {
  const stripState = createStreamingStripState();
  const internalTokens: InternalToken[] = [];
  let fullText = "";
  let hadToolCalls = false;
  for await (const part of stream) {
    if (
      part.type === "tool-call" ||
      part.type === "tool-result" ||
      part.type === "tool-error"
    ) {
      hadToolCalls = true;
    }
    if (part.type === "tool-call") {
      emitActivity?.(part.toolName === "search_knowledge"
        ? "retrieval"
        : "tool");
    }
    if (part.type !== "text-delta" || typeof part.text !== "string") {
      continue;
    }
    const stripped = stripInternalTokensStreaming(stripState, part.text);
    internalTokens.push(...stripped.tokens);
    if (!stripped.emit) continue;
    fullText += stripped.emit;
    emitText(stripped.emit);
  }
  const flushed = flushStreamingStripState(stripState);
  internalTokens.push(...flushed.tokens);
  if (flushed.emit) {
    fullText += flushed.emit;
    emitText(flushed.emit);
  }
  return { fullText, internalTokens, hadToolCalls };
}

interface CreatePublicTurnResponseInput {
  originalMessages: PublicUIMessage[];
  assistantMessageId: string;
  projectId: string;
  conversationId: string;
  botName: string | null;
  ownershipRevision: number;
  openingText?: string;
  immediateText?: string;
  resolvedFallbackText?: string;
  runTurn?: () => Promise<MavenTurnResult>;
  onOutcome(outcome: {
    messageId: string;
    ownershipRevision: number;
    internalTokens: InternalToken[];
    httpExecutionIds: string[];
  }): void;
}

function botMetadata(
  input: CreatePublicTurnResponseInput,
  sources: PublicSourceReference[],
  createdAt: number,
): PublicMessageMetadata {
  return {
    v: 1,
    channel: "public",
    projectId: input.projectId,
    conversationId: input.conversationId,
    author: "bot",
    senderName: input.botName,
    senderAvatar: null,
    userId: null,
    imageUrls: [],
    sources,
    createdAt,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
    systemKind: null,
  };
}

export function createPublicTurnResponse(
  input: CreatePublicTurnResponseInput,
): Response {
  const createdAt = Date.now();
  const textPartId = `text-${input.assistantMessageId}`;
  const stream = createUIMessageStream<PublicUIMessage>({
    originalMessages: input.originalMessages,
    generateId() {
      return input.assistantMessageId;
    },
    onError() {
      return "The response failed. Please try again.";
    },
    execute: async ({ writer }) => {
      writer.write({
        type: "start",
        messageId: input.assistantMessageId,
        messageMetadata: botMetadata(input, [], createdAt),
      });
      let textStarted = false;
      // Phases stop once the turn's own reply streams — not when the
      // server-owned opening greeting does, or the whole model run would show
      // a frozen greeting with no status.
      let turnTextStarted = false;
      // Phase keys only; the widget owns the user-facing copy.
      function emitActivity(phase: string): void {
        if (turnTextStarted) return;
        writer.write({
          type: "data-public-activity",
          data: { phase },
          transient: true,
        });
      }
      function emitText(delta: string): void {
        if (!delta) return;
        if (!textStarted) {
          writer.write({ type: "text-start", id: textPartId });
          textStarted = true;
        }
        writer.write({ type: "text-delta", id: textPartId, delta });
      }
      function emitTurnText(delta: string): void {
        if (!delta) return;
        if (!turnTextStarted) {
          emitActivity("compose");
          turnTextStarted = true;
        }
        emitText(delta);
      }
      let internalTokens: InternalToken[] = [];
      let sources: PublicSourceReference[] = [];
      let httpExecutionIds: string[] = [];
      if (input.openingText) {
        emitText(input.openingText);
      }
      if (input.immediateText !== undefined) {
        emitTurnText(input.immediateText);
      } else {
        if (!input.runTurn) throw new Error("Public turn runner is required");
        emitActivity("thinking");
        const turn = await input.runTurn();
        httpExecutionIds = turn.httpExecutionIds;
        const collected = await collectPublicTurnStream(
          turn.fullStream,
          emitTurnText,
          emitActivity,
        );
        internalTokens = collected.internalTokens;
        sources = turn.collectedSources.map((source) => ({
          title: source.title,
          url: source.url ?? null,
          type: source.type,
        }));
      }
      if (
        !textStarted &&
        input.resolvedFallbackText &&
        internalTokens.includes("[RESOLVED]")
      ) {
        emitText(input.resolvedFallbackText);
      }
      const persistedSources = textStarted ? sources : [];
      if (textStarted) {
        writer.write({ type: "text-end", id: textPartId });
      }
      for (const [index, source] of persistedSources.entries()) {
        if (source.url) {
          writer.write({
            type: "source-url",
            sourceId: `public-source-${index}`,
            url: source.url,
            title: source.title,
          });
        } else {
          writer.write({
            type: "source-document",
            sourceId: `public-source-${index}`,
            mediaType: "text/plain",
            title: source.title,
          });
        }
      }
      input.onOutcome({
        messageId: input.assistantMessageId,
        ownershipRevision: input.ownershipRevision,
        internalTokens,
        httpExecutionIds,
      });
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: botMetadata(input, persistedSources, createdAt),
      });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
