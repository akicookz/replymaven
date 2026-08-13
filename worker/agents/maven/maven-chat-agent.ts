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
  MavenConversationSummary,
  PendingSidechatApprovalScope,
  SidechatStatus,
  SidechatToolPresentation,
} from "../../../shared/sidechat-agent";
import {
  parseMavenChildName,
  toPublicChildName,
  type PublicConversationRecord,
  type PublicMessageRecord,
} from "../../../shared/maven-conversation";
import { createLanguageModel } from "../../chat-runtime/llm/create-language-model";
import { type AppEnv } from "../../types";
import type {
  DeletePublicMessageResult,
  PublicChatChildState,
  PublicContactUpdateInput,
  PublicConversationAction,
  PublicCustomerLinkInput,
  PublicDeliveryUpdateInput,
  PublicMessageAttachmentSource,
} from "../../conversations/public-conversation-store";
import {
  readVerifiedSidechatClaims,
  resolveSidechatChatTurnClaims,
} from "../sidechat/agent-auth";
import { MavenProjectAgent } from "./maven-project-agent";
import {
  createPrivateToolChunkProjector,
  removeAbandonedApprovalParts,
  sanitizePrivateMessageForPersistence,
} from "../sidechat/private-tool-payload";
import {
  createReplyDraftTool,
  persistCompletedReplyDraft,
} from "../sidechat/reply-draft-tool";
import { buildSidechatSystemPrompt } from "../sidechat/sidechat-prompt";
import {
  buildSidechatDynamicTools,
  resolveSidechatToolSafety,
} from "../sidechat/project-tool-proxy";
import {
  PublicConversationStateStore,
  type PublicConversationStateSql,
  type StoredPublicConversationState,
} from "./public/public-conversation-state";
import {
  fromPublicUiMessage,
  sanitizePublicMessageForPersistence,
  toPublicUiMessage,
} from "./public/public-message";

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

interface PublicConversationSnapshot {
  conversation: PublicConversationRecord;
  messages: PublicMessageRecord[];
  revision: number;
}

interface ImportPublicConversationInput {
  conversation: PublicConversationRecord;
  messages: PublicMessageRecord[];
  checksum: string;
}

type ImportPublicConversationResult = {
  status: "imported" | "noop" | "conflict";
  revision: number;
};

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

export class MavenChatAgent extends AIChatAgent<
  AppEnv,
  PublicChatChildState | Record<string, never>
> {
  messageConcurrency = "queue" as const;
  chatRecovery = true;
  maxPersistedMessages: number | undefined;
  waitForMcpConnections = false;
  private publicState?: PublicConversationStateStore;
  private publicMutationTail: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.maxPersistedMessages = parseMavenChildName(this.name).kind === "sidechat"
      ? 200
      : undefined;
  }

  override async onConnect(
    connection: Connection,
    context: ConnectionContext,
  ): Promise<void> {
    if (parseMavenChildName(this.name).kind === "public") {
      throw new Error("Public Agent sessions are not enabled");
    }
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
    if (parseMavenChildName(this.name).kind === "public") {
      return Response.json(
        { error: "public_agent_session_unavailable" },
        { status: 503 },
      );
    }
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
    if (parseMavenChildName(this.name).kind === "public") return;
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
    const identity = parseMavenChildName(this.name);
    if (identity.kind === "public") {
      return sanitizePublicMessageForPersistence(
        message,
        this.publicProjectId(),
        identity.conversationId,
      );
    }
    return sanitizePrivateMessageForPersistence(message);
  }

  async getPublicSnapshot(): Promise<PublicConversationSnapshot> {
    const state = this.requirePublicState();
    return {
      conversation: this.toPublicConversation(state),
      messages: this.readPublicMessages(),
      revision: state.revision,
    };
  }

  async getPublicMessages(): Promise<PublicMessageRecord[]> {
    this.assertPublicChild();
    return this.readPublicMessages();
  }

  async getPublicChildState(): Promise<PublicChatChildState> {
    return this.safePublicState(this.requirePublicState());
  }

  async importLegacyPublicConversation(
    input: ImportPublicConversationInput,
  ): Promise<ImportPublicConversationResult> {
    return this.runExclusivePublicMutation(async () => {
      const identity = this.assertPublicChild();
      const projectId = this.publicProjectId();
      if (
        input.conversation.id !== identity.conversationId ||
        input.conversation.projectId !== projectId ||
        input.messages.some((message) =>
          message.conversationId !== identity.conversationId
        )
      ) {
        throw new Error("Legacy public conversation does not match its child");
      }
      const existing = this.publicStateStore().get();
      if (existing) {
        return existing.revision === 0 &&
            existing.legacyChecksum === input.checksum
          ? { status: "noop", revision: existing.revision }
          : { status: "conflict", revision: existing.revision };
      }
      const uiMessages = input.messages.map((message) =>
        toPublicUiMessage(message, projectId)
      );
      await this.persistMessages(uiMessages, [], { _deleteStaleRows: true });
      const initialized = this.publicStateStore().initialize(
        input.conversation,
        input.checksum,
      );
      if (!initialized.created) {
        return initialized.state.revision === 0 &&
            initialized.state.legacyChecksum === input.checksum
          ? { status: "noop", revision: initialized.state.revision }
          : { status: "conflict", revision: initialized.state.revision };
      }
      await this.publishPublicProjection(initialized.state, input.messages);
      return { status: "imported", revision: initialized.state.revision };
    });
  }

  async createPublicConversation(
    conversation: PublicConversationRecord,
  ): Promise<PublicConversationRecord> {
    return this.runExclusivePublicMutation(async () => {
      const identity = this.assertPublicChild();
      if (
        conversation.id !== identity.conversationId ||
        conversation.projectId !== this.publicProjectId()
      ) {
        throw new Error("Public conversation does not match its child");
      }
      const initialized = this.publicStateStore().initialize(
        conversation,
        null,
      );
      if (initialized.created) {
        await this.persistMessages([], [], { _deleteStaleRows: true });
        await this.publishPublicProjection(initialized.state, []);
      }
      return this.toPublicConversation(initialized.state);
    });
  }

  async appendHumanMessage(
    message: PublicMessageRecord,
  ): Promise<PublicMessageRecord> {
    if (message.author !== "agent") {
      throw new Error("Human public messages must use the agent author");
    }
    return this.appendPublicRecord(message, true);
  }

  async appendSystemMessage(
    message: PublicMessageRecord,
  ): Promise<PublicMessageRecord> {
    if (message.author !== "system") {
      throw new Error("System public messages must use the system author");
    }
    return this.appendPublicRecord(message, false);
  }

  async deleteHumanMessage(
    messageId: string,
  ): Promise<DeletePublicMessageResult> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      const messages = this.readPublicMessages();
      const message = messages.find((candidate) => candidate.id === messageId);
      if (!message) return { deleted: false, reason: "not_found" };
      if (message.author !== "agent") {
        return { deleted: false, reason: "not_agent" };
      }
      const remaining = messages.filter((candidate) => candidate.id !== messageId);
      await this.persistPublicRecords(remaining);
      const saved = this.saveNextPublicState(state, {
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, remaining);
      return { deleted: true, message };
    });
  }

  async applyConversationAction(
    action: PublicConversationAction,
  ): Promise<PublicConversationRecord | null> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      const now = Date.now();
      if (state.archivedAt !== null && action.action !== "unarchive") {
        return null;
      }
      const changes: Partial<StoredPublicConversationState> = {
        updatedAt: now,
      };
      switch (action.action) {
        case "archive":
          if (state.archivedAt !== null) return null;
          changes.archivedAt = now;
          changes.purgeStartedAt = null;
          break;
        case "unarchive":
          if (state.archivedAt === null || state.purgeStartedAt !== null) {
            return null;
          }
          changes.archivedAt = null;
          break;
        case "resolve":
          changes.status = "closed";
          changes.closeReason = "resolved";
          break;
        case "snooze":
          changes.snoozedUntil = action.until;
          break;
        case "assign":
          changes.assigneeId = action.assigneeId;
          break;
        case "priority":
          changes.priority = action.priority;
          break;
        case "flag_spam":
          changes.status = "closed";
          changes.closeReason = "spam";
          break;
      }
      const saved = this.saveNextPublicState(state, changes);
      const messages = this.readPublicMessages();
      await this.publishPublicProjection(saved, messages);
      return this.toPublicConversation(saved);
    });
  }

  async markDelivery(input: PublicDeliveryUpdateInput): Promise<string[]> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      this.assertPublicInput(input.projectId, input.conversationId);
      const messages = this.readPublicMessages();
      const cutoff = messages.find((message) => message.id === input.upToMessageId);
      if (!cutoff) return [];
      const now = Date.now();
      const updatedIds: string[] = [];
      const updated = messages.map((message) => {
        if (
          (message.author !== "agent" && message.author !== "bot") ||
          message.createdAt > cutoff.createdAt
        ) return message;
        if (input.kind === "delivered") {
          if (message.deliveredAt !== null) return message;
          updatedIds.push(message.id);
          return { ...message, deliveredAt: now };
        }
        if (message.readAt !== null) return message;
        updatedIds.push(message.id);
        return {
          ...message,
          deliveredAt: message.deliveredAt ?? now,
          readAt: now,
        };
      });
      if (updatedIds.length === 0) return [];
      await this.persistPublicRecords(updated);
      const saved = this.saveNextPublicState(state, { updatedAt: now });
      await this.publishPublicProjection(saved, updated);
      return updatedIds;
    });
  }

  async updateContact(
    input: PublicContactUpdateInput,
  ): Promise<PublicConversationRecord | null> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      this.assertPublicInput(input.projectId, input.conversationId);
      const saved = this.saveNextPublicState(state, {
        ...(input.visitorName !== undefined
          ? { visitorName: input.visitorName }
          : {}),
        ...(input.visitorEmail !== undefined
          ? { visitorEmail: input.visitorEmail }
          : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return this.toPublicConversation(saved);
    });
  }

  async updateCustomer(
    input: PublicCustomerLinkInput,
  ): Promise<PublicConversationRecord | null> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      this.assertPublicInput(input.projectId, input.conversationId);
      const saved = this.saveNextPublicState(state, {
        customerId: input.customerId,
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return this.toPublicConversation(saved);
    });
  }

  async getAttachmentManifest(): Promise<PublicMessageAttachmentSource[]> {
    this.requirePublicState();
    return this.readPublicMessages()
      .filter((message) => message.imageUrls.length > 0)
      .map((message) => ({
        author: message.author,
        userId: message.userId,
        imageUrls: [...message.imageUrls],
      }));
  }

  async retryPublicSummary(payload: { revision: number }): Promise<void> {
    const state = this.requirePublicState();
    if (state.revision !== payload.revision) return;
    const parent = await this.parentAgent(MavenProjectAgent);
    await parent.upsertConversationSummary(
      this.buildPublicSummary(state, this.readPublicMessages()),
    );
  }

  private async appendPublicRecord(
    message: PublicMessageRecord,
    updateActivity: boolean,
  ): Promise<PublicMessageRecord> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (message.conversationId !== state.id) {
        throw new Error("Public message does not match its child");
      }
      const messages = this.readPublicMessages();
      if (messages.some((candidate) => candidate.id === message.id)) {
        throw new Error("Public message id already exists");
      }
      const updated = [...messages, structuredClone(message)];
      await this.persistPublicRecords(updated);
      const saved = this.saveNextPublicState(state, {
        updatedAt: Math.max(state.updatedAt, message.createdAt),
        ...(updateActivity
          ? { lastActivityAt: Math.max(state.lastActivityAt, message.createdAt) }
          : {}),
      });
      await this.publishPublicProjection(saved, updated);
      return structuredClone(message);
    });
  }

  private publicStateStore(): PublicConversationStateStore {
    if (this.publicState) return this.publicState;
    const durableSql = this.ctx.storage.sql;
    const adapter: PublicConversationStateSql = {
      execute<T>(query: string, bindings: Array<string | number | null>): T[] {
        return durableSql.exec(query, ...bindings).toArray() as T[];
      },
    };
    this.publicState = new PublicConversationStateStore(adapter);
    return this.publicState;
  }

  private assertPublicChild(): {
    kind: "public";
    conversationId: string;
  } {
    const identity = parseMavenChildName(this.name);
    if (identity.kind !== "public") {
      throw new Error("Public conversation RPC requires a public child");
    }
    return { kind: "public", conversationId: identity.conversationId };
  }

  private publicProjectId(): string {
    this.assertPublicChild();
    const parent = this.parentPath.at(-1);
    if (parent?.className !== MavenProjectAgent.name || !parent.name) {
      throw new Error("Public child requires a Maven project parent");
    }
    return parent.name;
  }

  private assertPublicInput(projectId: string, conversationId: string): void {
    const identity = this.assertPublicChild();
    if (
      projectId !== this.publicProjectId() ||
      conversationId !== identity.conversationId
    ) {
      throw new Error("Public input does not match its child");
    }
  }

  private requirePublicState(): StoredPublicConversationState {
    this.assertPublicChild();
    const state = this.publicStateStore().get();
    if (!state) throw new Error("Public conversation is not initialized");
    if (
      state.id !== this.assertPublicChild().conversationId ||
      state.projectId !== this.publicProjectId()
    ) {
      throw new Error("Stored public conversation does not match its child");
    }
    return state;
  }

  private readPublicMessages(): PublicMessageRecord[] {
    const identity = this.assertPublicChild();
    const projectId = this.publicProjectId();
    return this.messages.map((message) =>
      fromPublicUiMessage(message, projectId, identity.conversationId)
    );
  }

  private async persistPublicRecords(
    messages: PublicMessageRecord[],
  ): Promise<void> {
    const projectId = this.publicProjectId();
    await this.persistMessages(
      messages.map((message) => toPublicUiMessage(message, projectId)),
      [],
      { _deleteStaleRows: true },
    );
  }

  private saveNextPublicState(
    current: StoredPublicConversationState,
    changes: Partial<StoredPublicConversationState>,
  ): StoredPublicConversationState {
    const next: StoredPublicConversationState = {
      ...current,
      ...changes,
      revision: current.revision + 1,
    };
    const saved = this.publicStateStore().save(next, current.revision);
    if (!saved) throw new Error("Public conversation revision conflict");
    return saved;
  }

  private safePublicState(
    state: StoredPublicConversationState,
  ): PublicChatChildState {
    return {
      status: state.status,
      visitorPresence: state.visitorPresence,
      visitorLastOnlineAt: state.visitorLastOnlineAt,
      archived: state.archivedAt !== null,
      revision: state.revision,
    };
  }

  private toPublicConversation(
    state: StoredPublicConversationState,
  ): PublicConversationRecord {
    return {
      id: state.id,
      projectId: state.projectId,
      customerId: state.customerId,
      visitorId: state.visitorId,
      visitorName: state.visitorName,
      visitorEmail: state.visitorEmail,
      status: state.status,
      closeReason: state.closeReason,
      telegramThreadId: state.telegramThreadId,
      metadata: structuredClone(state.metadata),
      chatState: structuredClone(state.chatState),
      lastActivityAt: state.lastActivityAt,
      visitorLastSeenAt: state.visitorLastSeenAt,
      visitorPresence: state.visitorPresence,
      visitorLastOnlineAt: state.visitorLastOnlineAt,
      snoozedUntil: state.snoozedUntil,
      archivedAt: state.archivedAt,
      purgeStartedAt: state.purgeStartedAt,
      externalActionStartedAt: state.externalActionStartedAt,
      priority: state.priority,
      assigneeId: state.assigneeId,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      ownershipRevision: state.ownershipRevision,
    };
  }

  private buildPublicSummary(
    state: StoredPublicConversationState,
    messages: PublicMessageRecord[],
  ): MavenConversationSummary {
    const last = messages.at(-1) ?? null;
    return {
      conversationId: state.id,
      publicChildName: toPublicChildName(state.id),
      sidechatChildName: null,
      sidechatStatus: null,
      customerId: state.customerId,
      visitorId: state.visitorId,
      visitorName: state.visitorName,
      visitorEmail: state.visitorEmail,
      telegramThreadId: state.telegramThreadId,
      status: state.status,
      closeReason: state.closeReason,
      metadata: structuredClone(state.metadata),
      priority: state.priority,
      assigneeId: state.assigneeId,
      snoozedUntil: state.snoozedUntil,
      archivedAt: state.archivedAt,
      purgeStartedAt: state.purgeStartedAt,
      visitorLastSeenAt: state.visitorLastSeenAt,
      visitorPresence: state.visitorPresence,
      visitorLastOnlineAt: state.visitorLastOnlineAt,
      lastMessageId: last?.id ?? null,
      lastMessageAuthor: last?.author ?? null,
      lastMessagePreview: last?.content ?? null,
      lastActivityAt: state.lastActivityAt,
      messageCount: messages.length,
      botMessageCount: messages.filter((message) => message.author === "bot").length,
      childRevision: state.revision,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  }

  private async publishPublicProjection(
    state: StoredPublicConversationState,
    messages: PublicMessageRecord[],
  ): Promise<void> {
    this.setState(this.safePublicState(state));
    const parent = await this.parentAgent(MavenProjectAgent);
    try {
      await parent.upsertConversationSummary(
        this.buildPublicSummary(state, messages),
      );
    } catch {
      await this.schedule(
        1,
        "retryPublicSummary",
        { revision: state.revision },
        { idempotent: true },
      );
    }
  }

  private async runExclusivePublicMutation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.publicMutationTail;
    let release = (): void => undefined;
    const complete = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => complete);
    this.publicMutationTail = tail;
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.publicMutationTail === tail) {
        this.publicMutationTail = Promise.resolve();
      }
    }
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
