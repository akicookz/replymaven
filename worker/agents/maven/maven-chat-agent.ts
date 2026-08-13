import {
  AIChatAgent,
  type ChatResponseResult,
} from "@cloudflare/ai-chat";
import { drizzle } from "drizzle-orm/d1";
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
import { createModelRuntimeState } from "../../chat-runtime/llm/create-language-model";
import { normalizeConversationHistory } from "../../chat-runtime/orchestration/normalize-history";
import { runMavenTurn } from "../../chat-runtime/orchestration/run-maven-turn";
import { parseVisitorAiInvocation } from "../../chat-runtime/routing/public-turn-gates";
import { classifyTaskScope } from "../../chat-runtime/workflows/classify-task-scope";
import { buildSupportTurnOpening } from "../../chat-runtime/prompt/sections";
import { type AppEnv } from "../../types";
import type {
  DeletePublicMessageResult,
  AppendPublicSystemInput,
  PublicChatChildState,
  PublicContactUpdateInput,
  PublicConversationAction,
  PublicCustomerLinkInput,
  PublicDeliveryUpdateInput,
  PublicEmailUpdateInput,
  PublicExternalActionLease,
  PublicExternalActionLeaseInput,
  PublicLegacyEscalationMetadataUpdate,
  PublicMessageAttachmentSource,
  PublicOwnershipTransitionResult,
  PublicPresenceUpdateInput,
  PublicConversationStore,
  PublicTeamRequestAcceptance,
  PublicTeamRequestClaimInput,
  PublicTeamRequestClaimResult,
  PublicTeamRequestSummaryInput,
} from "../../conversations/public-conversation-store";
import {
  applyChatOwnershipEvent,
  fallbackAiParticipationForStatus,
  mergeChatStateForPersistence,
  parseChatState,
  type ChatOwnershipEvent,
  type ConversationChatState,
} from "../../chat-runtime/types";
import { getLocalUploadKey } from "../../../shared/upload-ownership";
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
  type PublicUIMessage,
  sanitizePublicMessageForPersistence,
  toPublicUiMessage,
} from "./public/public-message";
import {
  readPublicChatConnectionClaims,
  readVerifiedPublicChatClaims,
} from "./public/public-agent-auth";
import {
  buildPublicProtocolErrorFrame,
  guardPublicChatProtocolMessage,
} from "./public/public-chat-protocol-guard";
import {
  createPublicTurnResponse,
  evaluatePublicTurnGate,
} from "./public/public-turn";
import {
  PublicTurnOutcomeStore,
  type PublicTurnOutcomeSql,
} from "./public/public-turn-outcome";
import { decidePublicPostTurn } from "./public/public-post-turn";
import { BillingService } from "../../services/billing-service";
import { CustomerIdentityService } from "../../services/customer-identity-service";
import { GuidelineService } from "../../services/guideline-service";
import { ProjectService } from "../../services/project-service";
import { TelegramService } from "../../services/telegram-service";
import { ToolService } from "../../services/tool-service";
import { VisitorBanService } from "../../services/visitor-ban-service";
import { logError } from "../../observability";
import { resolvePendingPublicContactUpdate } from "./public/public-human-mode";

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
  private publicTurnOutcomes?: PublicTurnOutcomeStore;
  private publicMutationTail: Promise<void> = Promise.resolve();
  private publicToolRateLimit = { count: 0, resetAt: 0 };

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    const channel = parseMavenChildName(this.name).kind;
    this.maxPersistedMessages = channel === "sidechat"
      ? 200
      : undefined;
    if (channel === "public") {
      const sdkOnMessage = this.onMessage.bind(this);
      this.onMessage = async (connection, message) => {
        if (typeof message !== "string") {
          connection.close(4003, "Invalid public chat protocol");
          return;
        }
        const guarded = guardPublicChatProtocolMessage({
          raw: message,
          authoritativeMessages: this.messages,
          claims: readPublicChatConnectionClaims(connection.state),
        });
        if (!guarded.allowed) {
          if (guarded.requestId) {
            connection.send(buildPublicProtocolErrorFrame(guarded.requestId));
          }
          if (guarded.close) {
            connection.close(4003, "Invalid public chat protocol");
          }
          return;
        }
        return sdkOnMessage(connection, guarded.raw);
      };
    }
  }

  override async onConnect(
    connection: Connection,
    context: ConnectionContext,
  ): Promise<void> {
    const identity = parseMavenChildName(this.name);
    if (identity.kind === "public") {
      const claims = readVerifiedPublicChatClaims(context.request);
      const parentName = this.publicProjectId();
      const state = this.requirePublicState();
      if (
        !claims ||
        claims.parentName !== parentName ||
        claims.projectId !== parentName ||
        claims.childName !== this.name ||
        claims.conversationId !== identity.conversationId ||
        (claims.actor === "visitor" &&
          (claims.visitorId !== state.visitorId || state.archivedAt !== null))
      ) {
        throw new Error("Unauthorized public child connection");
      }
      await super.onConnect(connection, context);
      connection.setState({ publicChatActor: claims });
      return;
    }
    const claims = readVerifiedSidechatClaims(context.request);
    if (!claims || claims.scope !== "child" || claims.childName !== this.name) {
      throw new Error("Unauthorized Sidechat child connection");
    }
    await super.onConnect(connection, context);
    connection.setState({ sidechatActor: claims });
  }

  override shouldConnectionBeReadonly(
    _connection: Connection,
    context: ConnectionContext,
  ): boolean {
    if (parseMavenChildName(this.name).kind !== "public") return false;
    const claims = readVerifiedPublicChatClaims(context.request);
    return claims?.actor !== "visitor";
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
      return this.handlePublicChatMessage(options);
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

  private async handlePublicChatMessage(
    options?: Parameters<AIChatAgent<AppEnv>["onChatMessage"]>[1],
  ): Promise<Response> {
    const identity = this.assertPublicChild();
    const projectId = this.publicProjectId();
    const claims = readPublicChatConnectionClaims(
      getCurrentAgent<MavenChatAgent>().connection?.state,
    );
    if (
      !claims ||
      claims.actor !== "visitor" ||
      !claims.canSubmitVisitor ||
      claims.projectId !== projectId ||
      claims.conversationId !== identity.conversationId ||
      claims.childName !== this.name
    ) return new Response(null, { status: 401 });

    const submittedUiMessage = this.messages.at(-1);
    if (!submittedUiMessage || submittedUiMessage.role !== "user") {
      return new Response(null, { status: 400 });
    }
    let submitted: PublicMessageRecord;
    try {
      submitted = fromPublicUiMessage(
        submittedUiMessage,
        projectId,
        identity.conversationId,
      );
    } catch {
      await this.discardPublicSubmission(submittedUiMessage.id);
      return new Response(null, { status: 400 });
    }

    const initialState = this.requirePublicState();
    if (
      submitted.author !== "visitor" ||
      submitted.conversationId !== initialState.id
    ) {
      await this.discardPublicSubmission(submitted.id);
      return new Response(null, { status: 400 });
    }

    const db = drizzle(this.env.DB);
    const projectService = new ProjectService(db);
    const billingService = new BillingService(db, this.env);
    const projectPromise = projectService.getProjectById(projectId);
    const [project, settings, subscription, ban] = await Promise.all([
      projectPromise,
      projectService.getSettings(projectId),
      projectPromise.then((row) =>
        row
          ? billingService.getSubscriptionByUserId(row.userId)
          : Promise.resolve(null)
      ),
      new VisitorBanService(db).isVisitorBanned(
        projectId,
        initialState.visitorId,
        initialState.visitorEmail,
      ),
    ]);
    const subscriptionActive = Boolean(
      project &&
      subscription &&
      billingService.isSubscriptionActive(subscription),
    );
    const messageAllowed = subscriptionActive && project
      ? (await billingService.checkMessageLimit(
          project.userId,
          subscription,
        )).allowed
      : false;
    const aiInvocation = parseVisitorAiInvocation(
      submitted.content,
      settings?.botName,
    );
    let currentState = initialState;
    let currentChatState = this.parseStoredChatState(currentState);
    let gate = evaluatePublicTurnGate({
      subscriptionActive,
      messageAllowed,
      banned: Boolean(ban),
      archived: currentState.archivedAt !== null,
      status: currentState.status,
      closeReason: currentState.closeReason,
      aiParticipation: currentChatState.aiParticipation,
      aiInvoked: aiInvocation.invoked,
    });

    if (
      gate === "subscription_inactive" ||
      gate === "message_limit_reached" ||
      gate === "banned" ||
      gate === "archived"
    ) {
      await this.discardPublicSubmission(submitted.id);
      const status = gate === "message_limit_reached"
        ? 429
        : gate === "banned"
        ? 403
        : gate === "archived"
        ? 410
        : 503;
      return new Response(null, { status });
    }

    await this.recordAcceptedVisitorActivity(submitted.createdAt);
    await this.reconcilePublicAutoClose(settings?.autoCloseMinutes ?? null);
    currentState = this.requirePublicState();
    currentChatState = this.parseStoredChatState(currentState);

    const contactUpdate = resolvePendingPublicContactUpdate({
      status: currentState.status,
      chatState: currentChatState,
      message: submitted.content,
    });
    if (contactUpdate) {
      await this.updatePendingTeamRequestContact(
        projectId,
        currentState.id,
        {
          status: currentState.status,
          chatState: JSON.stringify(currentState.chatState),
        },
        contactUpdate,
      );
      currentState = this.requirePublicState();
      currentChatState = this.parseStoredChatState(currentState);
    }

    gate = evaluatePublicTurnGate({
      subscriptionActive,
      messageAllowed,
      banned: false,
      archived: currentState.archivedAt !== null,
      status: currentState.status,
      closeReason: currentState.closeReason,
      aiParticipation: currentChatState.aiParticipation,
      aiInvoked: aiInvocation.invoked,
    });
    if (gate === "archived") {
      await this.discardPublicSubmission(submitted.id);
      return new Response(null, { status: 410 });
    }

    const operationalStore = this as unknown as PublicConversationStore;
    if (currentState.customerId) {
      const customerId = currentState.customerId;
      const conversationId = currentState.id;
      const identityService = new CustomerIdentityService(db, operationalStore);
      this.ctx.waitUntil(
        identityService.touchVisitorLastSeen(
          projectId,
          customerId,
          currentState.visitorId,
          new Date(submitted.createdAt),
        ).catch((error) => {
          logError("agent_public_turn.customer_last_seen_failed", error, {
            projectId,
            conversationId,
            customerId,
          });
        }),
      );
    }

    if (gate === "muted") return new Response(null, { status: 204 });
    if (gate === "human_mode") {
      if (
        settings?.telegramBotToken &&
        settings.telegramChatId &&
        currentState.status !== "closed"
      ) {
        const telegram = new TelegramService(db);
        this.ctx.waitUntil((async () => {
          const lease = await this.acquireExternalAction({
            projectId,
            conversationId: currentState.id,
          });
          if (!lease) return;
          try {
            await telegram.forwardVisitorMessage(
              settings.telegramBotToken!,
              settings.telegramChatId!,
              currentState.visitorName,
              submitted.content,
              currentState.id,
              currentState.telegramThreadId
                ? Number.parseInt(currentState.telegramThreadId, 10)
                : undefined,
            );
          } finally {
            await this.releaseExternalAction(lease);
          }
        })());
      }
      return new Response(null, { status: 204 });
    }

    if (!project) {
      await this.discardPublicSubmission(submitted.id);
      return new Response(null, { status: 404 });
    }
    if (gate === "reopen_and_run_ai") {
      await this.reopenPublicConversationForVisitor();
    }
    currentState = this.requirePublicState();
    currentChatState = this.parseStoredChatState(currentState);
    const messageForAi = aiInvocation.invoked
      ? aiInvocation.content
      : submitted.content;
    const pageContext = this.readPublicPageContext(options?.body?.pageContext);
    const scope = classifyTaskScope({
      message: messageForAi,
      pageContext,
    });
    const assistantMessageId = crypto.randomUUID();
    const originalMessages = this.messages as PublicUIMessage[];
    const immediateText = scope.kind === "in_scope_support"
      ? undefined
      : scope.response ??
        "I can only help with this product, website, and support-related questions here.";
    const modelRuntime = createModelRuntimeState({
      model: this.env.AI_MODEL,
      geminiApiKey: this.env.GEMINI_API_KEY || null,
      openaiApiKey: this.env.OPENAI_API_KEY || null,
    });
    const rawHistory = this.readPublicMessages().map((message) => ({
      role: message.author,
      content: message.content,
      createdAt: message.createdAt,
    }));
    const isFirstVisitorTurn = rawHistory.filter((message) =>
      message.role === "visitor"
    ).length === 1;
    const turnContext = {
      kind: "standard",
      isFirstVisitorTurn,
    } as const;
    const openingText = buildSupportTurnOpening(turnContext, {
      name: currentState.visitorName,
      email: currentState.visitorEmail,
    });
    const conversationHistory = normalizeConversationHistory({
      rawHistory,
      currentMessage: messageForAi,
      persistedCurrentMessage: submitted.content,
    });
    const [guidelines, image] = await Promise.all([
      new GuidelineService(db).getEnabledByProject(projectId),
      this.loadPublicMessageImage(submitted.imageUrls[0] ?? null),
    ]);
    const toolService = new ToolService(db);
    const telegramService = new TelegramService(db);
    const executionCtx = this.ctx as unknown as ExecutionContext;
    this.publicTurnOutcomeStore().begin({
      messageId: assistantMessageId,
      ownershipRevision: currentState.ownershipRevision,
      aiInvoked: aiInvocation.invoked,
      createdAt: Date.now(),
    });

    return createPublicTurnResponse({
      originalMessages,
      assistantMessageId,
      projectId,
      conversationId: currentState.id,
      botName: settings?.botName ?? null,
      ownershipRevision: currentState.ownershipRevision,
      openingText,
      resolvedFallbackText: currentState.status === "active"
        ? "Glad I could help! Feel free to reach out anytime if you have more questions."
        : undefined,
      ...(immediateText === undefined ? {} : { immediateText }),
      runTurn: immediateText === undefined
        ? () => runMavenTurn({
            context: {
              channel: "public",
              projectId,
              conversationId: currentState.id,
              actorUserId: null,
              customerId: currentState.customerId,
              ownership: {
                status: currentState.status,
                chatState: JSON.stringify(currentState.chatState),
              },
            },
            dependencies: {
              db,
              env: this.env,
              modelRuntime,
              toolService,
              projectName: project.name,
              settings: settings ?? {
                toneOfVoice: "professional",
                customTonePrompt: null,
                companyContext: null,
                botName: null,
                agentName: null,
                workingHours: null,
                avgResponseTime: null,
              },
              abortSignal: options?.abortSignal,
              promptOptions: {
                guidelines: guidelines.map((guideline) => ({
                  condition: guideline.condition,
                  instruction: guideline.instruction,
                })),
                agentHandbackInstructions:
                  typeof currentState.metadata.agentHandbackInstructions ===
                      "string"
                    ? currentState.metadata.agentHandbackInstructions
                    : null,
                pageContext,
                visitorInfo: {
                  name: currentState.visitorName,
                  email: currentState.visitorEmail,
                },
                timeContext: {
                  nowMs: Date.now(),
                  conversationHistory,
                },
                turnContext,
                aiParticipation: currentChatState.aiParticipation,
                escalated:
                  currentState.status === "waiting_agent" ||
                  currentState.status === "agent_replied",
              },
              publicToolDependencies: {
                executionCtx,
                chatService: operationalStore,
                projectService,
                telegramService,
                acquireHttpRateLimitPermit: () =>
                  this.acquirePublicToolRateLimitPermit(),
                onTeamRequested() {},
                broadcast() {},
              },
            },
            conversationHistory,
            currentMessage: messageForAi,
            image,
          })
        : undefined,
      onOutcome: (outcome) => {
        this.publicTurnOutcomeStore().complete({
          ...outcome,
          createdAt: Date.now(),
        });
      },
    });
  }

  protected override async onChatResponse(
    result: ChatResponseResult,
  ): Promise<void> {
    if (parseMavenChildName(this.name).kind === "public") {
      await this.handlePublicChatResponse(result);
      return;
    }
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

  private async handlePublicChatResponse(
    result: ChatResponseResult,
  ): Promise<void> {
    const outcome = this.publicTurnOutcomeStore().take(result.message.id);
    if (!outcome) return;
    if (result.status !== "completed" || outcome.status !== "completed") {
      await this.discardUndeliveredPublicAssistant(result.message.id);
      return;
    }
    if (!this.messages.some((message) => message.id === result.message.id)) {
      return;
    }
    let responseMessage: PublicMessageRecord;
    try {
      responseMessage = fromPublicUiMessage(
        result.message,
        this.publicProjectId(),
        this.assertPublicChild().conversationId,
      );
    } catch {
      await this.discardPublicSubmission(result.message.id);
      return;
    }

    const persisted = await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      const chatState = this.parseStoredChatState(state);
      const decision = decidePublicPostTurn({
        responseStatus: result.status,
        outcomeStatus: outcome.status,
        assistantPersisted: true,
        archived: state.archivedAt !== null,
        currentStatus: state.status,
        currentParticipation: chatState.aiParticipation,
        currentOwnershipRevision: state.ownershipRevision,
        capturedOwnershipRevision: outcome.ownershipRevision,
        aiInvoked: outcome.aiInvoked,
        resolved: outcome.internalTokens.includes("[RESOLVED]"),
      });
      if (decision === "discard") {
        const retained = this.readPublicMessages().filter((message) =>
          message.id !== responseMessage.id
        );
        await this.persistPublicRecords(retained);
        await this.publishPublicProjection(state, retained);
        return false;
      }
      if (decision === "ignore") return false;

      let nextChatState = chatState;
      let status = state.status;
      let closeReason = state.closeReason;
      if (decision === "commit_resolved") {
        nextChatState = applyChatOwnershipEvent(chatState, "ai_handed_back");
        status = "closed";
        closeReason = "bot_resolved";
      }
      const saved = this.saveNextPublicState(state, {
        status,
        closeReason,
        chatState: { ...nextChatState },
        ownershipRevision: nextChatState.ownershipRevision,
        lastActivityAt: Math.max(state.lastActivityAt, responseMessage.createdAt),
        updatedAt: Math.max(state.updatedAt, responseMessage.createdAt),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return true;
    });
    if (!persisted) return;

    const projectId = this.publicProjectId();
    const db = drizzle(this.env.DB);
    const projectService = new ProjectService(db);
    const billingService = new BillingService(db, this.env);
    this.ctx.waitUntil((async () => {
      const project = await projectService.getProjectById(projectId);
      if (!project) return;
      const subscription = await billingService.getSubscriptionByUserId(
        project.userId,
      );
      await billingService.incrementMessageUsageOnce(
        responseMessage.id,
        project.userId,
        subscription,
      );
      if (outcome.httpExecutionIds.length > 0) {
        await new ToolService(db).linkExecutionsToMessage(
          outcome.httpExecutionIds,
          responseMessage.conversationId,
          responseMessage.id,
        );
      }
      const settings = await projectService.getSettings(projectId);
      await this.reconcilePublicAutoClose(settings?.autoCloseMinutes ?? null);
    })());
  }

  private async discardUndeliveredPublicAssistant(
    messageId: string,
  ): Promise<void> {
    await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      const messages = this.readPublicMessages();
      const message = messages.find((candidate) => candidate.id === messageId);
      if (
        !message ||
        message.author !== "bot" ||
        message.deliveredAt !== null
      ) return;
      const retained = messages.filter((candidate) => candidate.id !== messageId);
      await this.persistPublicRecords(retained);
      await this.publishPublicProjection(state, retained);
    });
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

  async getOperational(
    projectId: string,
    conversationId: string,
  ): Promise<PublicConversationRecord | null> {
    this.assertPublicInput(projectId, conversationId);
    const state = this.requirePublicState();
    return state.archivedAt === null ? this.toPublicConversation(state) : null;
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
    this.abortAllRequests("Human takeover");
    const interruptedAssistantIds = new Set(
      this.publicTurnOutcomeStore().markPendingHumanTakeover(),
    );
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (message.conversationId !== state.id) {
        throw new Error("Public message does not match its child");
      }
      if (state.archivedAt !== null || state.purgeStartedAt !== null) {
        throw new Error("Conversation is not available for a human reply");
      }
      const messages = this.readPublicMessages();
      const existing = messages.find((candidate) => candidate.id === message.id);
      if (existing) {
        if (
          existing.author !== "agent" ||
          !this.samePublicMessagePayload(existing, message)
        ) {
          throw new Error("Public message id already exists");
        }
        return existing;
      }
      const retained = messages.filter((candidate) =>
        !(
          interruptedAssistantIds.has(candidate.id) &&
          candidate.author === "bot" &&
          candidate.deliveredAt === null
        )
      );
      const updated = [...retained, structuredClone(message)];
      if (state.autoCloseScheduleId) {
        await this.cancelSchedule(state.autoCloseScheduleId);
      }
      const nextChatState = applyChatOwnershipEvent(
        this.parseStoredChatState(state),
        "human_joined",
      );
      await this.persistPublicRecords(updated);
      const saved = this.saveNextPublicState(state, {
        status: "agent_replied",
        closeReason: null,
        chatState: { ...nextChatState },
        ownershipRevision: nextChatState.ownershipRevision,
        lastActivityAt: Math.max(state.lastActivityAt, message.createdAt),
        updatedAt: Math.max(state.updatedAt, message.createdAt),
        autoCloseScheduleId: null,
      });
      await this.publishPublicProjection(saved, updated);
      return structuredClone(message);
    });
  }

  async appendVisitorMessage(
    message: PublicMessageRecord,
  ): Promise<PublicMessageRecord> {
    if (message.author !== "visitor") {
      throw new Error("Visitor public messages must use the visitor author");
    }
    return this.appendPublicRecord(message, true);
  }

  async appendBotMessage(
    message: PublicMessageRecord,
  ): Promise<PublicMessageRecord> {
    if (message.author !== "bot") {
      throw new Error("Bot public messages must use the bot author");
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
    if (
      action.action === "archive" ||
      action.action === "resolve" ||
      action.action === "flag_spam"
    ) {
      this.abortAllRequests(`Conversation action: ${action.action}`);
    }
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
          if (state.status === "closed" && state.closeReason === "resolved") {
            return null;
          }
          changes.status = "closed";
          changes.closeReason = "resolved";
          break;
        case "snooze":
          if (state.snoozedUntil === action.until) return null;
          changes.snoozedUntil = action.until;
          break;
        case "assign":
          if (state.assigneeId === action.assigneeId) return null;
          changes.assigneeId = action.assigneeId;
          break;
        case "priority":
          if (state.priority === action.priority) return null;
          changes.priority = action.priority;
          break;
        case "flag_spam":
          if (state.status === "closed" && state.closeReason === "spam") {
            return null;
          }
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

  async markEmailed(input: PublicEmailUpdateInput): Promise<boolean> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      this.assertPublicInput(input.projectId, input.conversationId);
      const messages = this.readPublicMessages();
      const now = Date.now();
      let found = false;
      const updated = messages.map((message) => {
        if (message.id !== input.messageId) return message;
        found = true;
        return message.emailedAt === null
          ? { ...message, emailedAt: now }
          : message;
      });
      if (!found) return false;
      if (updated.some((message, index) => message !== messages[index])) {
        await this.persistPublicRecords(updated);
        const saved = this.saveNextPublicState(state, { updatedAt: now });
        await this.publishPublicProjection(saved, updated);
      }
      return true;
    });
  }

  async updatePresence(
    input: PublicPresenceUpdateInput,
  ): Promise<PublicChatChildState | null> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      this.assertPublicInput(input.projectId, input.conversationId);
      const now = Date.now();
      const saved = this.saveNextPublicState(state, {
        visitorPresence: input.presence,
        visitorLastSeenAt: now,
        visitorLastOnlineAt: now,
        updatedAt: now,
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return this.safePublicState(saved);
    });
  }

  async setPublicStatus(input: {
    projectId: string;
    conversationId: string;
    status: PublicConversationRecord["status"];
    closeReason?: PublicConversationRecord["closeReason"];
  }): Promise<PublicConversationRecord | null> {
    if (input.status === "closed") {
      this.abortAllRequests("Conversation closed");
    }
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      this.assertPublicInput(input.projectId, input.conversationId);
      if (state.archivedAt !== null || state.purgeStartedAt !== null) {
        return null;
      }
      const closeReason = input.closeReason ??
        (input.status === "closed" ? state.closeReason : null);
      if (state.status === input.status && state.closeReason === closeReason) {
        return this.toPublicConversation(state);
      }
      const saved = this.saveNextPublicState(state, {
        status: input.status,
        closeReason,
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return this.toPublicConversation(saved);
    });
  }

  async transitionPublicOwnership(
    event: ChatOwnershipEvent,
  ): Promise<PublicOwnershipTransitionResult> {
    if (event === "human_joined") {
      this.abortAllRequests("Human takeover");
      this.publicTurnOutcomeStore().markPendingHumanTakeover();
    }
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (state.archivedAt !== null || state.purgeStartedAt !== null) {
        return { status: null, conversation: null };
      }
      const currentChatState = this.parseStoredChatState(state);
      const nextChatState = applyChatOwnershipEvent(currentChatState, event);
      const status = event === "human_joined"
        ? "agent_replied"
        : event === "team_requested"
        ? "waiting_agent"
        : "active";
      if (
        nextChatState === currentChatState &&
        state.status === status
      ) {
        const conversation = this.toPublicConversation(state);
        return { status: conversation.status, conversation };
      }
      if (state.autoCloseScheduleId && status === "waiting_agent") {
        await this.cancelSchedule(state.autoCloseScheduleId);
      }
      const saved = this.saveNextPublicState(state, {
        status,
        closeReason: event === "ai_handed_back" ? null : state.closeReason,
        chatState: { ...nextChatState },
        ownershipRevision: nextChatState.ownershipRevision,
        autoCloseScheduleId: status === "waiting_agent"
          ? null
          : state.autoCloseScheduleId,
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      const conversation = this.toPublicConversation(saved);
      return { status: conversation.status, conversation };
    });
  }

  async takePublicHumanOwnership(): Promise<{
    status: PublicConversationRecord["status"];
    chatState: string | null;
  } | null> {
    const result = await this.transitionPublicOwnership("human_joined");
    return result.conversation
      ? {
          status: result.conversation.status,
          chatState: JSON.stringify(result.conversation.chatState),
        }
      : null;
  }

  async resolvePublicByAi(): Promise<boolean> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (
        state.archivedAt !== null ||
        state.purgeStartedAt !== null ||
        state.status === "closed"
      ) return false;
      const chatState = this.parseStoredChatState(state);
      if (chatState.aiParticipation === "human_only") return false;
      const nextChatState = applyChatOwnershipEvent(chatState, "ai_handed_back");
      const saved = this.saveNextPublicState(state, {
        status: "closed",
        closeReason: "bot_resolved",
        chatState: { ...nextChatState },
        ownershipRevision: nextChatState.ownershipRevision,
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return true;
    });
  }

  async checkAndClosePublicStale(autoCloseMinutes: number): Promise<{
    closed: boolean;
    conversation: PublicConversationRecord | null;
  }> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (state.archivedAt !== null || state.purgeStartedAt !== null) {
        return { closed: false, conversation: null };
      }
      if (state.status === "closed" || state.status === "waiting_agent") {
        return {
          closed: false,
          conversation: this.toPublicConversation(state),
        };
      }
      if (state.lastActivityAt >= Date.now() - autoCloseMinutes * 60_000) {
        return {
          closed: false,
          conversation: this.toPublicConversation(state),
        };
      }
      const saved = this.saveNextPublicState(state, {
        status: "closed",
        closeReason: "ended",
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return { closed: true, conversation: this.toPublicConversation(saved) };
    });
  }

  async preparePublicContactSupportOwnership(): Promise<
    "waiting_agent" | "agent_replied" | null
  > {
    const state = this.requirePublicState();
    if (state.archivedAt !== null || state.purgeStartedAt !== null) return null;
    const chatState = this.parseStoredChatState(state);
    if (chatState.aiParticipation === "human_only") {
      const ownership = await this.takePublicHumanOwnership();
      return ownership?.status === "agent_replied" ? ownership.status : null;
    }
    if (state.status === "closed") {
      await this.setPublicStatus({
        projectId: state.projectId,
        conversationId: state.id,
        status: "active",
      });
    }
    const result = await this.transitionPublicOwnership("team_requested");
    return result.status === "waiting_agent" ? result.status : null;
  }

  async updatePublicTelegramThreadId(threadId: string): Promise<void> {
    await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (
        state.archivedAt !== null ||
        state.purgeStartedAt !== null ||
        state.telegramThreadId === threadId
      ) return;
      const saved = this.saveNextPublicState(state, {
        telegramThreadId: threadId,
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
    });
  }

  async getPublicChatState(): Promise<ConversationChatState> {
    return this.parseStoredChatState(this.requirePublicState());
  }

  async savePublicChatState(chatState: ConversationChatState): Promise<void> {
    await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (state.archivedAt !== null || state.purgeStartedAt !== null) return;
      const current = this.parseStoredChatState(state);
      const next = mergeChatStateForPersistence(current, chatState);
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      const saved = this.saveNextPublicState(state, {
        chatState: { ...next },
        ownershipRevision: next.ownershipRevision,
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
    });
  }

  async claimPublicRetention(input: {
    retentionCutoff: number;
    staleClaimCutoff: number;
    claimAt: number;
  }): Promise<boolean> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (
        state.archivedAt === null ||
        state.archivedAt > input.retentionCutoff ||
        (state.purgeStartedAt !== null &&
          state.purgeStartedAt > input.staleClaimCutoff)
      ) return false;
      const saved = this.saveNextPublicState(state, {
        purgeStartedAt: input.claimAt,
        updatedAt: input.claimAt,
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return true;
    });
  }

  async matchesPublicRetentionClaim(purgeStartedAt: number): Promise<boolean> {
    return this.requirePublicState().purgeStartedAt === purgeStartedAt;
  }

  async hasPublicUploadKey(key: string): Promise<boolean> {
    this.requirePublicState();
    return this.readPublicMessages().some((message) =>
      message.imageUrls.some((imageUrl) => getLocalUploadKey(imageUrl) === key)
    );
  }

  async appendSystem(
    input: AppendPublicSystemInput,
  ): Promise<PublicMessageRecord> {
    this.assertPublicInput(input.projectId, input.conversationId);
    const existing = input.idempotencyKey
      ? this.readPublicMessages().find((message) =>
          message.id === input.idempotencyKey
        )
      : null;
    if (existing) return existing;
    return this.appendSystemMessage({
      id: input.idempotencyKey ?? crypto.randomUUID(),
      conversationId: input.conversationId,
      author: "system",
      content: input.content,
      imageUrls: [],
      sources: [],
      senderName: null,
      senderAvatar: null,
      userId: null,
      systemKind: input.kind,
      createdAt: Date.now(),
      deliveredAt: null,
      readAt: null,
      emailedAt: null,
    });
  }

  async claimTeamRequest(
    input: PublicTeamRequestClaimInput,
  ): Promise<PublicTeamRequestClaimResult> {
    return this.runExclusivePublicMutation(async () => {
      this.assertPublicInput(input.projectId, input.conversationId);
      const state = this.requirePublicState();
      if (state.archivedAt !== null) return { status: "unavailable" };
      const chatState = this.parseStoredChatState(state);
      if (
        state.status === "waiting_agent" ||
        state.status === "agent_replied" ||
        chatState.aiParticipation === "human_only"
      ) return { status: "already_requested" };
      if (
        state.status !== "active" ||
        chatState.aiParticipation !== "continuous"
      ) return { status: "unavailable" };
      const requiredFields: Array<"name" | "email"> = [];
      if (!state.visitorName?.trim()) requiredFields.push("name");
      if (!state.visitorEmail?.trim()) requiredFields.push("email");
      if (requiredFields.length > 0 && !chatState.contactDeclined) {
        return { status: "contact_required", requiredFields };
      }
      const acceptedAt = new Date().toISOString();
      const acceptanceToken = crypto.randomUUID();
      const nextChatState = applyChatOwnershipEvent(
        chatState,
        "team_requested",
      );
      const saved = this.saveNextPublicState(state, {
        status: "waiting_agent",
        chatState: { ...nextChatState },
        ownershipRevision: nextChatState.ownershipRevision,
        metadata: {
          ...state.metadata,
          teamRequestSummary:
            input.summary.trim() || "Visitor asked for team follow-up.",
          escalatedAt: acceptedAt,
          reviewSummaryMessageId: crypto.randomUUID(),
          teamRequestSummaryPending: true,
          teamRequestNotificationState: "pending",
          mavenTeamRequestAcceptedAt: acceptedAt,
          mavenTeamRequestAcceptanceToken: acceptanceToken,
        },
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return { status: "claimed" };
    });
  }

  async getTeamRequestAcceptance(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<PublicTeamRequestAcceptance | null> {
    this.assertPublicInput(projectId, conversationId);
    return this.readTeamRequestAcceptance(
      this.requirePublicState(),
      acceptanceToken,
    );
  }

  async claimTeamRequestNotification(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<boolean> {
    return this.runExclusivePublicMutation(async () => {
      this.assertPublicInput(projectId, conversationId);
      const state = this.requirePublicState();
      const acceptance = this.readTeamRequestAcceptance(
        state,
        acceptanceToken,
      );
      if (!acceptance || acceptance.notificationState !== "pending") {
        return false;
      }
      const saved = this.saveNextPublicState(state, {
        metadata: {
          ...state.metadata,
          teamRequestNotificationState: "attempted",
          teamRequestNotificationAttemptedAt: new Date().toISOString(),
        },
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return true;
    });
  }

  async addTeamRequestSummary(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<PublicMessageRecord | null> {
    return this.runExclusivePublicMutation(async () => {
      this.assertPublicInput(projectId, conversationId);
      const state = this.requirePublicState();
      const acceptance = this.readTeamRequestAcceptance(state, acceptanceToken);
      if (!acceptance?.summaryPending) return null;
      const messages = this.readPublicMessages();
      const existing = messages.find((message) =>
        message.id === acceptance.summaryMessageId
      );
      if (existing) return existing;
      const message: PublicMessageRecord = {
        id: acceptance.summaryMessageId,
        conversationId,
        author: "system",
        content: acceptance.summary,
        imageUrls: [],
        sources: [],
        senderName: null,
        senderAvatar: null,
        userId: null,
        systemKind: "review_summary",
        createdAt: Date.now(),
        deliveredAt: null,
        readAt: null,
        emailedAt: null,
      };
      const updated = [...messages, message];
      await this.persistPublicRecords(updated);
      const saved = this.saveNextPublicState(state, {
        updatedAt: Math.max(state.updatedAt, message.createdAt),
      });
      await this.publishPublicProjection(saved, updated);
      return message;
    });
  }

  async completeTeamRequestSummary(
    input: PublicTeamRequestSummaryInput,
  ): Promise<boolean> {
    return this.runExclusivePublicMutation(async () => {
      this.assertPublicInput(input.projectId, input.conversationId);
      const state = this.requirePublicState();
      const acceptance = this.readTeamRequestAcceptance(
        state,
        input.acceptanceToken,
      );
      if (!acceptance) return false;
      if (!acceptance.summaryPending) return true;
      const saved = this.saveNextPublicState(state, {
        metadata: {
          ...state.metadata,
          teamRequestSummaryPending: false,
        },
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return true;
    });
  }

  async updateLegacyEscalationMetadata(
    projectId: string,
    conversationId: string,
    update: PublicLegacyEscalationMetadataUpdate,
  ): Promise<PublicConversationRecord | null> {
    return this.runExclusivePublicMutation(async () => {
      this.assertPublicInput(projectId, conversationId);
      const state = this.requirePublicState();
      if (
        state.archivedAt !== null ||
        (state.metadata.mavenTeamRequestAcceptanceToken ?? null) !==
          update.expectedMavenAcceptanceToken
      ) return null;
      const saved = this.saveNextPublicState(state, {
        metadata: {
          ...state.metadata,
          teamRequestSummary: update.summary,
          reviewSummaryMessageId: update.summaryMessageId,
          ...(update.escalatedAt === undefined
            ? {}
            : { escalatedAt: update.escalatedAt }),
          ...(update.summaryPending === undefined
            ? {}
            : { teamRequestSummaryPending: update.summaryPending }),
        },
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return this.toPublicConversation(saved);
    });
  }

  async persistTeamRequestTelegramThreadId(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
    threadId: string,
  ): Promise<boolean> {
    return this.runExclusivePublicMutation(async () => {
      this.assertPublicInput(projectId, conversationId);
      const state = this.requirePublicState();
      const acceptance = this.readTeamRequestAcceptance(
        state,
        acceptanceToken,
      );
      if (
        !acceptance ||
        acceptance.notificationState !== "attempted" ||
        (state.telegramThreadId !== null && state.telegramThreadId !== threadId)
      ) return false;
      if (
        state.telegramThreadId === threadId &&
        state.metadata.mavenTeamRequestTelegramThreadAcceptanceToken ===
          acceptanceToken
      ) return true;
      const saved = this.saveNextPublicState(state, {
        telegramThreadId: threadId,
        metadata: {
          ...state.metadata,
          mavenTeamRequestTelegramThreadAcceptanceToken: acceptanceToken,
        },
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return true;
    });
  }

  async updatePendingTeamRequestContact(
    projectId: string,
    conversationId: string,
    ownership: { status: string; chatState: string | null },
    update: {
      visitorName?: string;
      visitorEmail?: string;
      awaitingContactFields: Array<"name" | "email">;
      contactDeclined?: boolean;
    },
  ): Promise<PublicConversationRecord | null> {
    return this.runExclusivePublicMutation(async () => {
      this.assertPublicInput(projectId, conversationId);
      const state = this.requirePublicState();
      if (
        state.archivedAt !== null ||
        state.status !== ownership.status ||
        JSON.stringify(state.chatState) !== ownership.chatState
      ) return null;
      const chatState = this.parseStoredChatState(state);
      const nextChatState: ConversationChatState = {
        ...chatState,
        awaitingContactFields: [...update.awaitingContactFields],
        ...(update.contactDeclined === undefined
          ? {}
          : { contactDeclined: update.contactDeclined }),
      };
      const saved = this.saveNextPublicState(state, {
        ...(update.visitorName === undefined
          ? {}
          : { visitorName: update.visitorName }),
        ...(update.visitorEmail === undefined
          ? {}
          : { visitorEmail: update.visitorEmail }),
        chatState: { ...nextChatState },
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
      return this.toPublicConversation(saved);
    });
  }

  async acquireExternalAction(
    input: PublicExternalActionLeaseInput,
  ): Promise<PublicExternalActionLease | null> {
    return this.runExclusivePublicMutation(async () => {
      this.assertPublicInput(input.projectId, input.conversationId);
      const state = this.requirePublicState();
      if (
        state.archivedAt !== null ||
        state.externalActionLeaseId !== null ||
        (input.ownership &&
          (input.ownership.status !== state.status ||
            input.ownership.chatState !== JSON.stringify(state.chatState)))
      ) return null;
      const acquiredAt = input.now ?? Date.now();
      const leaseId = crypto.randomUUID();
      this.saveInternalPublicState(state, {
        externalActionLeaseId: leaseId,
        externalActionStartedAt: acquiredAt,
      });
      return {
        projectId: input.projectId,
        conversationId: input.conversationId,
        leaseId,
        ownershipRevision: state.ownershipRevision,
        acquiredAt,
      };
    });
  }

  async releaseExternalAction(input: PublicExternalActionLease): Promise<void> {
    await this.runExclusivePublicMutation(async () => {
      this.assertPublicInput(input.projectId, input.conversationId);
      const state = this.requirePublicState();
      if (state.externalActionLeaseId !== input.leaseId) return;
      this.saveInternalPublicState(state, {
        externalActionLeaseId: null,
        externalActionStartedAt: null,
      });
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

  async autoClosePublicConversation(payload: {
    lastActivityAt: number;
    autoCloseMinutes: number;
  }): Promise<void> {
    await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (
        state.archivedAt !== null ||
        state.status === "closed" ||
        state.status === "waiting_agent" ||
        state.lastActivityAt !== payload.lastActivityAt ||
        Date.now() <
          payload.lastActivityAt + payload.autoCloseMinutes * 60_000
      ) return;
      const saved = this.saveNextPublicState(state, {
        status: "closed",
        closeReason: "ended",
        autoCloseScheduleId: null,
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
    });
  }

  private async discardPublicSubmission(messageId: string): Promise<void> {
    if (!this.messages.some((message) => message.id === messageId)) return;
    await this.persistMessages(
      this.messages.filter((message) => message.id !== messageId),
      [],
      { _deleteStaleRows: true },
    );
  }

  private async recordAcceptedVisitorActivity(createdAt: number): Promise<void> {
    await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (state.archivedAt !== null) return;
      const saved = this.saveNextPublicState(state, {
        lastActivityAt: Math.max(state.lastActivityAt, createdAt),
        updatedAt: Math.max(state.updatedAt, createdAt),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
    });
  }

  private async reopenPublicConversationForVisitor(): Promise<void> {
    await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (state.archivedAt !== null || state.status !== "closed") return;
      const now = Date.now();
      const saved = this.saveNextPublicState(state, {
        status: "active",
        closeReason: null,
        lastActivityAt: now,
        updatedAt: now,
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
    });
  }

  async reconcilePublicAutoClose(
    autoCloseMinutes: number | null,
  ): Promise<void> {
    await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (state.autoCloseScheduleId) {
        await this.cancelSchedule(state.autoCloseScheduleId);
      }
      if (
        autoCloseMinutes === null ||
        state.archivedAt !== null ||
        state.status === "closed" ||
        state.status === "waiting_agent"
      ) {
        if (state.autoCloseScheduleId) {
          this.saveInternalPublicState(state, { autoCloseScheduleId: null });
        }
        return;
      }
      const delaySeconds = Math.max(
        1,
        Math.ceil(
          (state.lastActivityAt + autoCloseMinutes * 60_000 - Date.now()) /
            1_000,
        ),
      );
      const schedule = await this.schedule(
        delaySeconds,
        "autoClosePublicConversation",
        { lastActivityAt: state.lastActivityAt, autoCloseMinutes },
        { idempotent: true },
      );
      this.saveInternalPublicState(state, { autoCloseScheduleId: schedule.id });
    });
  }

  private readPublicPageContext(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }

  private async loadPublicMessageImage(
    imageUrl: string | null,
  ): Promise<{ base64: string; mimeType: string } | null> {
    if (!imageUrl) return null;
    try {
      const pathname = new URL(imageUrl).pathname;
      const marker = "/api/uploads/";
      const markerIndex = pathname.indexOf(marker);
      if (markerIndex < 0) return null;
      const key = decodeURIComponent(
        pathname.slice(markerIndex + marker.length),
      );
      const object = await this.env.UPLOADS.get(key);
      if (!object) return null;
      const bytes = new Uint8Array(await object.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return {
        base64: btoa(binary),
        mimeType: object.httpMetadata?.contentType ?? "image/jpeg",
      };
    } catch {
      return null;
    }
  }

  private acquirePublicToolRateLimitPermit(): boolean {
    const now = Date.now();
    if (now >= this.publicToolRateLimit.resetAt) {
      this.publicToolRateLimit = { count: 1, resetAt: now + 60_000 };
      return true;
    }
    if (this.publicToolRateLimit.count >= 100) return false;
    this.publicToolRateLimit.count += 1;
    return true;
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
      const existing = messages.find((candidate) => candidate.id === message.id);
      if (existing) {
        if (!this.samePublicMessagePayload(existing, message)) {
          throw new Error("Public message id already exists");
        }
        return existing;
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

  private samePublicMessagePayload(
    left: PublicMessageRecord,
    right: PublicMessageRecord,
  ): boolean {
    return left.author === right.author &&
      left.content === right.content &&
      JSON.stringify(left.imageUrls) === JSON.stringify(right.imageUrls) &&
      JSON.stringify(left.sources) === JSON.stringify(right.sources) &&
      left.senderName === right.senderName &&
      left.senderAvatar === right.senderAvatar &&
      left.userId === right.userId &&
      (left.systemKind ?? null) === (right.systemKind ?? null) &&
      (left.idempotencyKey ?? null) === (right.idempotencyKey ?? null) &&
      (left.origin ?? null) === (right.origin ?? null) &&
      (left.externalReplyTo ?? null) === (right.externalReplyTo ?? null);
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

  private publicTurnOutcomeStore(): PublicTurnOutcomeStore {
    if (this.publicTurnOutcomes) return this.publicTurnOutcomes;
    const durableSql = this.ctx.storage.sql;
    const adapter: PublicTurnOutcomeSql = {
      execute<T>(query: string, bindings: Array<string | number | null>): T[] {
        return durableSql.exec(query, ...bindings).toArray() as T[];
      },
    };
    this.publicTurnOutcomes = new PublicTurnOutcomeStore(adapter);
    return this.publicTurnOutcomes;
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

  private parseStoredChatState(
    state: StoredPublicConversationState,
  ): ConversationChatState {
    return parseChatState(JSON.stringify(state.chatState), {
      fallbackAiParticipation: fallbackAiParticipationForStatus(state.status),
    });
  }

  private readTeamRequestAcceptance(
    state: StoredPublicConversationState,
    acceptanceToken: string,
  ): PublicTeamRequestAcceptance | null {
    if (state.status !== "waiting_agent" || state.archivedAt !== null) {
      return null;
    }
    if (this.parseStoredChatState(state).aiParticipation === "human_only") {
      return null;
    }
    const metadata = state.metadata;
    if (
      metadata.mavenTeamRequestAcceptanceToken !== acceptanceToken ||
      typeof metadata.mavenTeamRequestAcceptedAt !== "string" ||
      typeof metadata.teamRequestSummary !== "string" ||
      typeof metadata.reviewSummaryMessageId !== "string" ||
      typeof metadata.teamRequestNotificationState !== "string"
    ) return null;
    return {
      acceptanceToken,
      acceptedAt: metadata.mavenTeamRequestAcceptedAt,
      notificationState: metadata.teamRequestNotificationState,
      summary: metadata.teamRequestSummary,
      summaryMessageId: metadata.reviewSummaryMessageId,
      summaryPending: metadata.teamRequestSummaryPending === true,
    };
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

  private saveInternalPublicState(
    current: StoredPublicConversationState,
    changes: Partial<StoredPublicConversationState>,
  ): StoredPublicConversationState {
    const next: StoredPublicConversationState = {
      ...current,
      ...changes,
      revision: current.revision,
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
