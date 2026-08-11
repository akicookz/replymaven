import {
  AIChatAgent,
  type ChatResponseResult,
} from "@cloudflare/ai-chat";
import { type Connection, type ConnectionContext } from "agents";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ToolSet,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import type { SidechatStatus } from "../../../shared/sidechat-agent";
import { createLanguageModel } from "../../chat-runtime/llm/create-language-model";
import { type AppEnv } from "../../types";
import {
  readVerifiedSidechatClaims,
  verifySidechatToken,
} from "./agent-auth";
import { MavenProjectAgent } from "./maven-project-agent";
import {
  createPrivateToolChunkFilter,
  sanitizePrivateMessageForPersistence,
} from "./private-tool-payload";
import {
  createReplyDraftTool,
  persistCompletedReplyDraft,
} from "./reply-draft-tool";
import { buildSidechatSystemPrompt } from "./sidechat-prompt";
import { buildSidechatDynamicTools } from "./project-tool-proxy";

type SidechatDataParts = Record<string, unknown> & {
  "turn-accepted": { messageId: string };
  "safe-activity": {
    label: string;
    status: "started" | "success" | "error";
  };
  "reply-draft": { text: string; createdAt: number };
};

type SidechatUIMessage = UIMessage<unknown, SidechatDataParts>;
const MAX_PRIVATE_MODEL_MESSAGES = 80;

interface SidechatStatusUpdater {
  updateSidechatSummary(
    conversationId: string,
    status: SidechatStatus,
  ): Promise<boolean>;
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
): UIMessage[] {
  if (messages.length <= MAX_PRIVATE_MODEL_MESSAGES) return messages;
  const bounded = messages.slice(-MAX_PRIVATE_MODEL_MESSAGES);
  const firstUserIndex = bounded.findIndex((message) => message.role === "user");
  return firstUserIndex > 0 ? bounded.slice(firstUserIndex) : bounded;
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
    const claims =
      typeof token === "string"
        ? await verifySidechatToken(token, this.env.SIDECHAT_TOKEN_SECRET)
        : null;
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

    const stream = createUIMessageStream<SidechatUIMessage>({
      originalMessages: this.messages as SidechatUIMessage[],
      onError() {
        return "The Sidechat response failed.";
      },
      execute: async ({ writer }) => {
        if (submittedMessageId) {
          writer.write(buildTurnAcceptedPart(submittedMessageId));
        }
        let parentForFailure: SidechatStatusUpdater | null = null;
        try {
          const parent = await this.parentAgent(MavenProjectAgent);
          parentForFailure = parent;
          await parent.updateSidechatSummary(conversationId, "working");
          const [context, descriptors] = await Promise.all([
            parent.getSidechatContext(this.name, conversationId),
            parent.getSidechatToolDescriptors(this.name, conversationId),
          ]);
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
              selectSidechatModelMessages(this.messages),
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
          const shouldForward = createPrivateToolChunkFilter();
          writer.merge(
            result
              .toUIMessageStream<SidechatUIMessage>({
                sendReasoning: false,
              })
              .pipeThrough(
                new TransformStream({
                  transform(chunk, controller) {
                    if (shouldForward(chunk)) controller.enqueue(chunk);
                  },
                }),
              ),
          );
        } catch {
          await parentForFailure?.updateSidechatSummary(
            conversationId,
            "failed",
          );
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
    if (result.status !== "completed") {
      await parent.updateSidechatSummary(conversationId, "failed");
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
}
