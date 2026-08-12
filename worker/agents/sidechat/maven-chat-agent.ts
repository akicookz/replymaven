import {
  AIChatAgent,
  type ChatResponseResult,
} from "@cloudflare/ai-chat";
import {
  getCurrentAgent,
  type Connection,
  type ConnectionContext,
} from "agents";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  getToolName,
  isToolUIPart,
  type ToolSet,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import type {
  PendingSidechatApprovalScope,
  SidechatStatus,
  SidechatToolPresentation,
} from "../../../shared/sidechat-agent";
import { createLanguageModel } from "../../chat-runtime/llm/create-language-model";
import { type AppEnv } from "../../types";
import {
  readVerifiedSidechatClaims,
  resolveSidechatChatTurnClaims,
} from "./agent-auth";
import { MavenProjectAgent } from "./maven-project-agent";
import {
  createPrivateToolChunkProjector,
  removeAbandonedApprovalParts,
  sanitizePrivateMessageForPersistence,
} from "./private-tool-payload";
import {
  createReplyDraftTool,
  persistCompletedReplyDraft,
} from "./reply-draft-tool";
import { buildSidechatSystemPrompt } from "./sidechat-prompt";
import {
  buildSidechatDynamicTools,
  resolveSidechatToolSafety,
} from "./project-tool-proxy";

type SidechatDataParts = Record<string, unknown> & {
  "turn-accepted": { messageId: string };
  "safe-activity": {
    label: string;
    status: "started" | "success" | "error";
    tool?: SidechatToolPresentation;
  };
  "tool-approval": {
    toolCallId: string;
    safety: "read" | "write" | "destructive";
    tool: SidechatToolPresentation;
  };
  "tool-trace": {
    toolCallId: string;
    startedAt: number;
    safety: "read" | "write" | "destructive";
    tool: SidechatToolPresentation;
  };
  "tool-timing": {
    toolCallId: string;
    durationMs: number;
  };
  "reply-draft": { text: string; createdAt: number };
};

type SidechatUIMessage = UIMessage<unknown, SidechatDataParts>;
const MAX_PRIVATE_MODEL_MESSAGES = 80;

interface SidechatStatusUpdater {
  isSidechatOperational(
    childName: string,
    conversationId: string,
  ): Promise<boolean>;
  updateSidechatSummary(
    conversationId: string,
    status: SidechatStatus,
  ): Promise<boolean>;
}

interface SidechatMessageStore {
  messages: UIMessage[];
  persistMessages(
    messages: UIMessage[],
    excludeBroadcastIds?: string[],
    options?: { _deleteStaleRows?: boolean },
  ): Promise<void>;
}

async function discardArchivedSubmission(
  store: SidechatMessageStore,
  submittedMessageId: string | null,
): Promise<void> {
  if (!submittedMessageId) return;
  await store.persistMessages(
    store.messages.filter((message) => message.id !== submittedMessageId),
    [],
    { _deleteStaleRows: true },
  );
}

export function buildTurnAcceptedPart(messageId: string) {
  return {
    type: "data-turn-accepted" as const,
    data: { messageId },
    transient: true as const,
  };
}

export function readSubmittedUiMessageId(
  body: Record<string, unknown> | undefined,
  messages: UIMessage[],
): string | null {
  const submittedMessageId = body?.submittedMessageId;
  if (
    typeof submittedMessageId !== "string" ||
    submittedMessageId.length === 0 ||
    submittedMessageId.length > 200
  ) {
    return null;
  }
  const submittedMessageExists = messages.some(
    (message) =>
      message.role === "user" && message.id === submittedMessageId,
  );
  return submittedMessageExists ? submittedMessageId : null;
}

export function selectSidechatModelMessages(
  messages: UIMessage[],
  continuation = false,
): UIMessage[] {
  const eligible = removeAbandonedApprovalParts(messages, continuation);
  if (eligible.length <= MAX_PRIVATE_MODEL_MESSAGES) return eligible;
  const bounded = eligible.slice(-MAX_PRIVATE_MODEL_MESSAGES);
  const firstUserIndex = bounded.findIndex((message) => message.role === "user");
  return firstUserIndex > 0 ? bounded.slice(firstUserIndex) : bounded;
}

export function readPendingApprovalScope(
  messages: UIMessage[],
  approvalId: string,
  toolCallId: string,
): PendingSidechatApprovalScope | null {
  if (
    approvalId.length === 0 || approvalId.length > 200 ||
    toolCallId.length === 0 || toolCallId.length > 200
  ) {
    return null;
  }
  const seenToolCalls = new Set<string>();
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message?.role !== "assistant") continue;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (!part || !isToolUIPart(part)) continue;
      if (seenToolCalls.has(part.toolCallId)) continue;
      seenToolCalls.add(part.toolCallId);
      if (part.toolCallId !== toolCallId) continue;
      if (
        part.state !== "approval-requested" ||
        part.approval.id !== approvalId
      ) return null;
      return {
        approvalId,
        toolCallId,
        exposedName: getToolName(part),
      };
    }
  }
  return null;
}

export function hasPendingSidechatApproval(messages: UIMessage[]): boolean {
  const seenToolCalls = new Set<string>();
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message?.role !== "assistant") continue;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (!part || !isToolUIPart(part)) continue;
      if (seenToolCalls.has(part.toolCallId)) continue;
      seenToolCalls.add(part.toolCallId);
      if (part.state === "approval-requested") return true;
    }
  }
  return false;
}

function conversationIdFromChildName(childName: string): string {
  if (!childName.startsWith("sc_") || childName.length <= 3) {
    throw new Error("Invalid Sidechat child name");
  }
  return childName.slice(3);
}

export class MavenChatAgent extends AIChatAgent<AppEnv> {
  messageConcurrency = "queue" as const;
  chatRecovery = true;
  maxPersistedMessages = 200;
  waitForMcpConnections = false;

  override async onConnect(
    connection: Connection,
    context: ConnectionContext,
  ): Promise<void> {
    const claims = readVerifiedSidechatClaims(context.request);
    if (!claims || claims.scope !== "child" || claims.childName !== this.name) {
      throw new Error("Unauthorized Sidechat child connection");
    }
    await super.onConnect(connection, context);
    connection.setState({ sidechatActor: claims });
  }

  protected createSidechatLanguageModel(): LanguageModel {
    return createLanguageModel({
      model: this.env.AI_MODEL,
      geminiApiKey: this.env.GEMINI_API_KEY || null,
      openaiApiKey: this.env.OPENAI_API_KEY || null,
    });
  }

  override async onChatMessage(
    onFinish: Parameters<AIChatAgent<AppEnv>["onChatMessage"]>[0],
    options?: Parameters<AIChatAgent<AppEnv>["onChatMessage"]>[1],
  ): Promise<Response> {
    if (!options?.requestId) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const token = options?.body?.token;
    const claims = await resolveSidechatChatTurnClaims({
      token,
      continuation: options.continuation === true,
      connectionState: getCurrentAgent<MavenChatAgent>().connection?.state,
      secret: this.env.SIDECHAT_TOKEN_SECRET,
    });
    if (
      !claims ||
      claims.scope !== "child" ||
      !claims.canSubmit ||
      claims.childName !== this.name
    ) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const conversationId = conversationIdFromChildName(this.name);
    const submittedMessageId = readSubmittedUiMessageId(
      options.body,
      this.messages,
    );
    const directParent = this.parentPath.at(-1);
    if (
      claims.conversationId !== conversationId ||
      claims.projectId !== claims.parentName ||
      directParent?.className !== MavenProjectAgent.name ||
      directParent.name !== claims.parentName
    ) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const parent = await this.parentAgent(MavenProjectAgent);
    if (!await parent.isSidechatOperational(this.name, conversationId)) {
      await discardArchivedSubmission(this, submittedMessageId);
      return new Response(null, { status: 409 });
    }

    const stream = createUIMessageStream<SidechatUIMessage>({
      originalMessages: this.messages as SidechatUIMessage[],
      onError() {
        return "The Sidechat response failed.";
      },
      execute: async ({ writer }) => {
        const parentForFailure: SidechatStatusUpdater = parent;
        try {
          if (!await parent.isSidechatOperational(this.name, conversationId)) {
            await discardArchivedSubmission(this, submittedMessageId);
            throw new Error("Sidechat conversation is archived");
          }
          if (submittedMessageId) {
            writer.write(buildTurnAcceptedPart(submittedMessageId));
          }
          await parent.updateSidechatSummary(conversationId, "working");
          const [context, descriptors] = await Promise.all([
            parent.getSidechatContext(this.name, conversationId),
            parent.getSidechatToolDescriptors(this.name, conversationId),
          ]);
          if (context.archivedAt !== null) {
            await discardArchivedSubmission(this, submittedMessageId);
            throw new Error("Sidechat conversation is archived");
          }
          const model = this.createSidechatLanguageModel();
          const tools: ToolSet = {
            present_reply_draft: createReplyDraftTool(),
            ...buildSidechatDynamicTools({
              descriptors,
              childName: this.name,
              conversationId,
              actorUserId: claims.userId,
              execute: (request) => parent.executeProjectTool(request),
              emitActivity(part) {
                writer.write(part);
              },
            }),
          };
          const result = streamText({
            model,
            system: buildSidechatSystemPrompt(context),
            messages: await convertToModelMessages(
              selectSidechatModelMessages(
                this.messages,
                options.continuation === true,
              ),
            ),
            tools,
            stopWhen: stepCountIs(8),
            abortSignal: options.abortSignal,
            onFinish(event) {
              return onFinish(
                event as unknown as Parameters<typeof onFinish>[0],
              );
            },
          });
          const projectChunk = createPrivateToolChunkProjector(
            new Map(
              descriptors
                .map((descriptor) => [
                  descriptor.exposedName,
                  {
                    safety: resolveSidechatToolSafety(descriptor),
                    tool: {
                      displayName: descriptor.displayName,
                      source: descriptor.source ?? {
                        kind: descriptor.connectionId.startsWith("mcp-")
                          ? "mcp"
                          : "http",
                        name: descriptor.connectionId.startsWith("mcp-")
                          ? "MCP"
                          : "Custom tool",
                        icon: null,
                      },
                    },
                  },
                ] as const),
            ),
          );
          writer.merge(
            result
              .toUIMessageStream<SidechatUIMessage>({
                sendReasoning: true,
              })
              .pipeThrough(
                new TransformStream({
                  transform(chunk, controller) {
                    for (const projected of projectChunk(chunk)) {
                      controller.enqueue(projected as typeof chunk);
                    }
                  },
                }),
              ),
          );
        } catch {
          if (await parentForFailure.isSidechatOperational(
            this.name,
            conversationId,
          )) {
            await parentForFailure.updateSidechatSummary(
              conversationId,
              "failed",
            );
          }
          throw new Error("Sidechat turn setup failed");
        }
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  protected override async onChatResponse(
    result: ChatResponseResult,
  ): Promise<void> {
    const conversationId = conversationIdFromChildName(this.name);
    const parent = await this.parentAgent(MavenProjectAgent);
    if (!await parent.isSidechatOperational(this.name, conversationId)) return;
    if (result.status !== "completed") {
      await parent.updateSidechatSummary(conversationId, "failed");
      return;
    }

    if (hasPendingSidechatApproval([...this.messages, result.message])) {
      await parent.updateSidechatSummary(conversationId, "waiting_approval");
      return;
    }

    try {
      const published = await persistCompletedReplyDraft({
        result,
        messages: this.messages,
        persistMessages: (messages) => this.persistMessages(messages),
      });
      await parent.updateSidechatSummary(
        conversationId,
        published ? "ready" : "idle",
      );
    } catch (error) {
      await parent.updateSidechatSummary(conversationId, "failed");
      throw error;
    }
  }

  protected override sanitizeMessageForPersistence(
    message: UIMessage,
  ): UIMessage {
    return sanitizePrivateMessageForPersistence(message);
  }

  // Internal Durable Object RPC for retention/recovery verification. It is not
  // decorated as browser-callable and is never mounted on an HTTP route.
  async getPrivateTranscriptSnapshot(): Promise<UIMessage[]> {
    return structuredClone(this.messages);
  }

  async getPendingApprovalScope(
    approvalId: string,
    toolCallId: string,
  ): Promise<PendingSidechatApprovalScope | null> {
    return readPendingApprovalScope(this.messages, approvalId, toolCallId);
  }

  async enforceArchive(): Promise<void> {
    this.abortAllRequests("Conversation archived");
    for (const connection of this.getConnections()) {
      connection.close(4003, "Conversation archived");
    }
  }
}
