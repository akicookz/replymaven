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
  readUIMessageStream,
  type ToolSet,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import type {
  ExecuteProjectToolResult,
  MavenConversationSummary,
  PendingSidechatApprovalScope,
  SidechatCustomerContext,
  SidechatStatus,
  SidechatToolApprovalContext,
  SidechatToolPresentation,
} from "../../../shared/sidechat-agent";
import {
  parseMavenChildName,
  publicChannelThreads,
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
  PublicMessagePage,
  PublicOwnershipTransitionResult,
  PublicPresenceUpdateInput,
  PublicConversationStore,
  PublicTeamRequestAcceptance,
  PublicTeamRequestClaimInput,
  PublicTeamRequestClaimResult,
  PublicTeamRequestSummaryInput,
} from "../../conversations/public-conversation-store";
import { canAutoCloseConversationStatus } from "../../conversations/conversation-staleness";
import {
  clearHumanCommandClock,
  preserveReservedPublicMetadata,
} from "../../services/bot-name-decision";
import {
  activeHumanRouteFromMessage,
  applyChatOwnershipEvent,
  fallbackAiParticipationForStatus,
  inferLegacyActiveHumanRoutes,
  isReturningVisitorGap,
  joinActiveHumanRoute,
  mergeChatStateForPersistence,
  parseChatState,
  type ChatOwnershipEvent,
  type ConversationChatState,
} from "../../chat-runtime/types";
import {
  readVerifiedSidechatClaims,
  resolveSidechatChatTurnClaims,
} from "../sidechat/agent-auth";
import { MavenProjectAgent } from "./maven-project-agent";
import {
  createPrivateToolChunkProjector,
  removeLegacyProjectToolParts,
  removeAbandonedApprovalParts,
  sanitizePrivateMessageForPersistence,
} from "../sidechat/private-tool-payload";
import {
  createReplyDraftTool,
  persistCompletedReplyDraft,
  readSettledReplyDraft,
} from "../sidechat/reply-draft-tool";
import { buildSidechatSystemPrompt } from "../sidechat/sidechat-prompt";
import {
  hasVisibleSidechatAssistantText,
  resolveCompletedSidechatSummary,
  summarizeStreamFinish,
} from "../sidechat/sidechat-turn-outcome";
import {
  buildSidechatGatewayTools,
  type ExecuteSidechatGatewayToolRequest,
  type ExecuteSidechatKnowledgeRequest,
  type SidechatArgumentGuide,
  type SidechatGatewayContext,
  type SidechatGatewayResolvedTool,
  type SidechatGatewaySearchResult,
} from "../sidechat/project-tool-gateway";
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
  getLocalUploadKey,
  isConversationUploadKeyOwnedByConversation,
} from "../../../shared/upload-ownership";
import {
  readPublicChatConnectionOrigin,
  readPublicChatConnectionClaims,
  readVerifiedPublicChatClaims,
} from "./public/public-agent-auth";
import {
  buildPublicProtocolErrorFrame,
  guardPublicChatProtocolMessage,
  PUBLIC_SUBMIT_HISTORY_WINDOW,
} from "./public/public-chat-protocol-guard";
import {
  createPublicTurnResponse,
  evaluatePublicTurnGate,
  shouldResumeAiAfterHumanIdle,
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
import { SlackService } from "../../services/slack-service";
import { listEnabledAgentChannels } from "../../services/enabled-agent-channels";
import { forwardVisitorToJoinedHumans } from "../../services/run-agent-channel-outbound";
import { EmailService } from "../../services/email-service";
import { ToolService } from "../../services/tool-service";
import { VisitorBanService } from "../../services/visitor-ban-service";
import { MAVEN_ASSIGNEE_ID } from "../../../shared/maven-assignee";
import { mavenAssignedSystemContent } from "../../services/maven-assignment";
import { logError, logInfo, logWarn } from "../../observability";
import { resolvePendingPublicContactUpdate } from "./public/public-human-mode";
import { hasSettledReplyDraft } from "../../services/sidechat-status";
import type { SidechatTurnOrigin } from "../../services/start-sidechat-turn";

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
const MAX_PUBLIC_MESSAGE_PAGE = 100;
const EXTERNAL_ACTION_LEASE_MS = 2 * 60 * 1_000;

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

interface SidechatTurnParent extends SidechatStatusUpdater {
  getSidechatContext(
    childName: string,
    conversationId: string,
  ): Promise<SidechatCustomerContext>;
  searchSidechatProjectTools(
    input: SidechatGatewayContext & {
      query: string;
      cursor: string | null;
      limit: number;
    },
  ): Promise<SidechatGatewaySearchResult>;
  describeSidechatProjectTool(
    input: SidechatGatewayContext & {
      toolRef: string;
      cursor: string | null;
      limit: number;
    },
  ): Promise<SidechatArgumentGuide | null>;
  resolveSidechatProjectTool(
    input: SidechatGatewayContext & { toolRef: string },
  ): Promise<SidechatGatewayResolvedTool | null>;
  executeProjectTool(
    request: ExecuteSidechatGatewayToolRequest,
  ): Promise<ExecuteProjectToolResult>;
  stageProjectToolApproval(
    request: SidechatGatewayContext & {
      toolCallId: string;
      toolRef: string;
      argumentsJson: string;
    },
  ): Promise<boolean>;
  executeSidechatKnowledge(
    request: ExecuteSidechatKnowledgeRequest,
  ): Promise<ExecuteProjectToolResult>;
}

interface SidechatMessageStore {
  name: string;
  messages: UIMessage[];
  persistMessages(
    messages: UIMessage[],
    excludeBroadcastIds?: string[],
    options?: { _deleteStaleRows?: boolean },
  ): Promise<void>;
}

interface SidechatTurnAgent extends SidechatMessageStore {
  createSidechatLanguageModel(): LanguageModel;
}

const SIDECHAT_MAX_TURN_STEPS = 24;
const CONNECTION_ACTOR_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

async function executeSidechatTurn(input: {
  agent: SidechatTurnAgent;
  writer: {
    write(part: unknown): void;
    merge(stream: ReadableStream<unknown>): void;
  };
  parent: SidechatTurnParent;
  conversationId: string;
  actorUserId: string;
  submittedMessageId: string | null;
  continuation: boolean;
  abortSignal: AbortSignal | undefined;
  onFinish: Parameters<AIChatAgent<AppEnv>["onChatMessage"]>[0];
}): Promise<void> {
  const parentForFailure: SidechatStatusUpdater = input.parent;
  try {
    if (!await input.parent.isSidechatOperational(
      input.agent.name,
      input.conversationId,
    )) {
      await discardArchivedSubmission(input.agent, input.submittedMessageId);
      throw new Error("Sidechat conversation is archived");
    }
    if (input.submittedMessageId) {
      input.writer.write(buildTurnAcceptedPart(input.submittedMessageId));
    }
    await input.parent.updateSidechatSummary(input.conversationId, "working");
    const context = await input.parent.getSidechatContext(
      input.agent.name,
      input.conversationId,
    );
    if (context.archivedAt !== null) {
      await discardArchivedSubmission(input.agent, input.submittedMessageId);
      throw new Error("Sidechat conversation is archived");
    }
    const model = input.agent.createSidechatLanguageModel();
    const gatewayContext: SidechatGatewayContext = {
      childName: input.agent.name,
      conversationId: input.conversationId,
      actorUserId: input.actorUserId,
    };
    const contextByToolCallId = new Map<string, SidechatToolApprovalContext>();
    const approvedToolCallIds = approvedSidechatToolCallIds(
      input.agent.messages,
    );
    const tools: ToolSet = {
      present_reply_draft: createReplyDraftTool(),
      ...buildSidechatGatewayTools({
        search: (request) => input.parent.searchSidechatProjectTools({
          ...gatewayContext,
          ...request,
        }),
        describe: (request) => input.parent.describeSidechatProjectTool({
          ...gatewayContext,
          ...request,
        }),
        resolve: (toolRef) => input.parent.resolveSidechatProjectTool({
          ...gatewayContext,
          toolRef,
        }),
        execute: (request) => input.parent.executeProjectTool({
          ...gatewayContext,
          ...request,
        }),
        stageApproval: (request) =>
          input.parent.stageProjectToolApproval({
            ...gatewayContext,
            ...request,
          }),
        approvedToolCallIds,
        executeKnowledge: (knowledgeInput) =>
          input.parent.executeSidechatKnowledge({
            ...gatewayContext,
            input: knowledgeInput,
          }),
        emitActivity(part) {
          input.writer.write(part);
        },
        rememberToolContext(toolCallId, toolContext) {
          contextByToolCallId.set(toolCallId, toolContext);
        },
      }),
    };
    logInfo("sidechat_turn.started", {
      childName: input.agent.name,
      conversationId: input.conversationId,
      continuation: input.continuation,
      toolCount: Object.keys(tools).length,
    });
    const result = streamText({
      model,
      system: buildSidechatSystemPrompt(context),
      messages: await convertToModelMessages(
        selectSidechatModelMessages(input.agent.messages, input.continuation),
      ),
      tools,
      maxRetries: 4,
      onError({ error }) {
        logError("sidechat_turn.stream_error", error, {
          childName: input.agent.name,
          conversationId: input.conversationId,
          continuation: input.continuation,
          model: (model as { modelId?: string }).modelId ?? null,
        });
      },
      providerOptions: {
        openai: { reasoningSummary: "auto" },
        google: { thinkingConfig: { includeThoughts: true } },
      },
      stopWhen: stepCountIs(SIDECHAT_MAX_TURN_STEPS),
      prepareStep({ stepNumber }) {
        // Last allowed step runs without tools so the turn always ends in text.
        if (stepNumber >= SIDECHAT_MAX_TURN_STEPS - 1) {
          return { toolChoice: "none" as const };
        }
        return {};
      },
      abortSignal: input.abortSignal,
      onFinish(event) {
        logInfo("sidechat_turn.model_finished", {
          childName: input.agent.name,
          conversationId: input.conversationId,
          continuation: input.continuation,
          ...summarizeStreamFinish(event),
        });
        return input.onFinish(
          event as unknown as Parameters<typeof input.onFinish>[0],
        );
      },
    });
    const seedToolCalls = new Map<string, string>();
    const gatewayToolRefByCallId = new Map<string, string>();
    for (const message of input.agent.messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (isToolUIPart(part)) {
          seedToolCalls.set(part.toolCallId, getToolName(part));
          if (
            getToolName(part) === "call_project_tool" &&
            part.input &&
            typeof part.input === "object" &&
            !Array.isArray(part.input)
          ) {
            const toolRef = (part.input as Record<string, unknown>).toolRef;
            if (typeof toolRef === "string") {
              gatewayToolRefByCallId.set(part.toolCallId, toolRef);
            }
          }
        }
      }
    }
    const projectChunk = createPrivateToolChunkProjector(
      new Map([[
        "search_knowledge",
        {
          safety: "read",
          tool: {
            displayName: "Search",
            source: { kind: "http", name: "Docs", icon: null },
          },
        },
      ]]),
      Date.now,
      seedToolCalls,
      async (toolCallId, toolName, toolInput) => {
        const cached = contextByToolCallId.get(toolCallId);
        if (cached) return cached;
        if (
          toolName === "call_project_tool" &&
          toolInput &&
          typeof toolInput === "object" &&
          !Array.isArray(toolInput)
        ) {
          const toolRef = (toolInput as Record<string, unknown>).toolRef;
          if (typeof toolRef === "string") {
            gatewayToolRefByCallId.set(toolCallId, toolRef);
          }
        }
        const toolRef = gatewayToolRefByCallId.get(toolCallId);
        if (!toolRef) return null;
        const tool = await input.parent.resolveSidechatProjectTool({
          ...gatewayContext,
          toolRef,
        });
        if (!tool) return null;
        const resolvedContext: SidechatToolApprovalContext = {
          safety: tool.safety,
          tool: tool.presentation,
        };
        contextByToolCallId.set(toolCallId, resolvedContext);
        return resolvedContext;
      },
    );
    input.writer.merge(
      result
        .toUIMessageStream<SidechatUIMessage>({
          sendReasoning: true,
        })
        .pipeThrough(
          new TransformStream({
            async transform(chunk, controller) {
              for (const projected of await projectChunk(chunk)) {
                controller.enqueue(projected as typeof chunk);
              }
            },
          }),
        ),
    );
  } catch (error) {
    logError("sidechat_turn.setup_failed", error, {
      childName: input.agent.name,
      conversationId: input.conversationId,
      continuation: input.continuation,
    });
    if (await parentForFailure.isSidechatOperational(
      input.agent.name,
      input.conversationId,
    )) {
      await parentForFailure.updateSidechatSummary(
        input.conversationId,
        "failed",
      );
    }
    throw new Error("Sidechat turn setup failed");
  }
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
  const eligible = removeAbandonedApprovalParts(
    removeLegacyProjectToolParts(messages),
    continuation,
  );
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
        getToolName(part) !== "call_project_tool" ||
        part.state !== "approval-requested" ||
        part.approval.id !== approvalId
      ) return null;
      const toolRef = (
        part.input &&
        typeof part.input === "object" &&
        !Array.isArray(part.input)
      )
        ? (part.input as Record<string, unknown>).toolRef
        : null;
      if (
        typeof toolRef !== "string" ||
        toolRef.length === 0 ||
        toolRef.length > 1_500
      ) return null;
      return {
        approvalId,
        toolCallId,
        toolRef,
      };
    }
  }
  return null;
}

export function approvedSidechatToolCallIds(
  messages: UIMessage[],
): ReadonlySet<string> {
  const approved = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (
        isToolUIPart(part) &&
        getToolName(part) === "call_project_tool" &&
        part.state === "approval-responded" &&
        part.approval.approved
      ) {
        approved.add(part.toolCallId);
      }
    }
  }
  return approved;
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
      if (
        getToolName(part) === "call_project_tool" &&
        part.state === "approval-requested"
      ) return true;
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
  chatRecovery = true as const;
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
      // Reassignments, not overrides: a prototype override runs inside the
      // SDK's own wrappers and never sees the chat-request frames.
      const sdkOnMessage = this.onMessage.bind(this);
      this.onMessage = async (connection, message) => {
        if (typeof message !== "string") {
          connection.close(4003, "Invalid public chat protocol");
          return;
        }
        const actorState = this.readConnectionActor(connection.id);
        const guarded = guardPublicChatProtocolMessage({
          raw: message,
          authoritativeMessages: this.messages,
          claims: readPublicChatConnectionClaims(actorState),
          expectedOrigin: readPublicChatConnectionOrigin(actorState),
        });
        if (!guarded.allowed) {
          // Content-free: reasons and structural shapes only, never text.
          console.log(JSON.stringify({
            event: "public_chat_guard_rejected",
            child: this.name,
            reason: guarded.reason,
            detail: guarded.detail ?? null,
          }));
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
      // Hand the browser only the newest window. Older messages stay stored and
      // are read through the dashboard and transcript endpoints.
      const sdkOnRequest = this.onRequest.bind(this);
      this.onRequest = async (request) => {
        if (new URL(request.url).pathname.endsWith("/get-messages")) {
          return Response.json(
            this.messages.slice(-PUBLIC_SUBMIT_HISTORY_WINDOW),
          );
        }
        return sdkOnRequest(request);
      };
    }
  }

  // agents 0.22 drops sub-agent connection.state writes between events, so
  // claims live in this child's SQLite instead.
  private connectionActorTableReady = false;

  private ensureConnectionActorTable(): void {
    if (this.connectionActorTableReady) return;
    void this.sql`
      CREATE TABLE IF NOT EXISTS maven_connection_actors (
        connection_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
    this.connectionActorTableReady = true;
  }

  private storeConnectionActor(
    connectionId: string,
    payload: Record<string, unknown>,
  ): void {
    this.ensureConnectionActorTable();
    const now = Date.now();
    void this.sql`
      INSERT OR REPLACE INTO maven_connection_actors
        (connection_id, payload, created_at)
      VALUES (${connectionId}, ${JSON.stringify(payload)}, ${now})
    `;
    void this.sql`
      DELETE FROM maven_connection_actors
      WHERE created_at < ${now - CONNECTION_ACTOR_TTL_MS}
    `;
  }

  private readConnectionActor(
    connectionId: string | undefined,
  ): Record<string, unknown> | null {
    if (!connectionId) return null;
    this.ensureConnectionActorTable();
    const rows = this.sql<{ payload: string }>`
      SELECT payload FROM maven_connection_actors
      WHERE connection_id = ${connectionId}
    `;
    const payload = rows[0]?.payload;
    if (!payload) return null;
    try {
      const parsed: unknown = JSON.parse(payload);
      return parsed !== null && typeof parsed === "object" &&
          !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
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
      this.storeConnectionActor(connection.id, {
        publicChatActor: claims,
        publicChatOrigin: new URL(context.request.url).origin,
      });
      return;
    }
    const claims = readVerifiedSidechatClaims(context.request);
    if (!claims || claims.scope !== "child" || claims.childName !== this.name) {
      throw new Error("Unauthorized Sidechat child connection");
    }
    await super.onConnect(connection, context);
    this.storeConnectionActor(connection.id, { sidechatActor: claims });
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
      model: this.env.SIDECHAT_AI_MODEL || this.env.AI_MODEL,
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
      connectionState: this.readConnectionActor(
        getCurrentAgent<MavenChatAgent>().connection?.id,
      ),
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
    if (
      options.continuation !== true &&
      typeof parent.setLastSidechatTurnOrigin === "function"
    ) {
      await parent.setLastSidechatTurnOrigin(conversationId, null);
    }

    const childName = this.name;
    const stream = createUIMessageStream<SidechatUIMessage>({
      originalMessages: this.messages as SidechatUIMessage[],
      onError(error) {
        logError("sidechat_turn.response_stream_error", error, {
          childName,
          conversationId,
          continuation: options.continuation === true,
        });
        return "The Sidechat response failed.";
      },
      execute: async ({ writer }) => {
        await executeSidechatTurn({
          agent: this as unknown as SidechatTurnAgent,
          writer,
          parent: parent as unknown as SidechatTurnParent,
          conversationId,
          actorUserId: claims.userId,
          submittedMessageId,
          continuation: options.continuation === true,
          abortSignal: options.abortSignal,
          onFinish,
        });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  async submitServerSidechatTurn(input: {
    text: string;
    actorUserId: string;
  }): Promise<{ accepted: true } | { accepted: false }> {
    if (parseMavenChildName(this.name).kind !== "sidechat") {
      return { accepted: false };
    }
    const conversationId = conversationIdFromChildName(this.name);
    const parent = await this.parentAgent(MavenProjectAgent);
    if (!await parent.isSidechatOperational(this.name, conversationId)) {
      return { accepted: false };
    }
    const userMessage: SidechatUIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: input.text }],
    };
    await this.persistMessages([...this.messages, userMessage]);
    this.ctx.waitUntil(this.runServerSidechatTurn({
      actorUserId: input.actorUserId,
      submittedMessageId: userMessage.id,
    }));
    return { accepted: true };
  }

  async hasSettledReplyDraft(): Promise<boolean> {
    return hasSettledReplyDraft(this.messages);
  }

  async getSettledReplyDraft(messageId: string): Promise<string | null> {
    if (
      parseMavenChildName(this.name).kind !== "sidechat" ||
      messageId.length === 0 ||
      messageId.length > 200
    ) {
      return null;
    }
    const message = this.messages.find(
      (candidate) =>
        candidate.id === messageId && candidate.role === "assistant",
    );
    return message ? readSettledReplyDraft(message) : null;
  }

  async setLastSidechatTurnOrigin(
    origin: SidechatTurnOrigin | null,
  ): Promise<void> {
    this.assertPublicChild();
    await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      const metadata = { ...state.metadata };
      if (origin) {
        metadata.lastSidechatTurnOrigin = origin;
      } else {
        delete metadata.lastSidechatTurnOrigin;
      }
      if (JSON.stringify(metadata) === JSON.stringify(state.metadata)) return;
      const saved = this.saveNextPublicState(state, {
        metadata,
        updatedAt: Date.now(),
      });
      await this.publishPublicProjection(saved, this.readPublicMessages());
    });
  }

  private async runServerSidechatTurn(input: {
    actorUserId: string;
    submittedMessageId: string;
  }): Promise<void> {
    const conversationId = conversationIdFromChildName(this.name);
    const parent = await this.parentAgent(MavenProjectAgent);
    const childName = this.name;
    try {
      const stream = createUIMessageStream<SidechatUIMessage>({
        originalMessages: this.messages as SidechatUIMessage[],
        onError(error) {
          logError("sidechat_turn.response_stream_error", error, {
            childName,
            conversationId,
            continuation: false,
          });
          return "The Sidechat response failed.";
        },
        execute: async ({ writer }) => {
          await executeSidechatTurn({
            agent: this as unknown as SidechatTurnAgent,
            writer,
            parent: parent as unknown as SidechatTurnParent,
            conversationId,
            actorUserId: input.actorUserId,
            submittedMessageId: input.submittedMessageId,
            continuation: false,
            abortSignal: undefined,
            onFinish: async () => undefined,
          });
        },
      });
      let last: SidechatUIMessage | undefined;
      for await (const message of readUIMessageStream({ stream })) {
        last = message;
      }
      if (!last) {
        if (await parent.isSidechatOperational(this.name, conversationId)) {
          await parent.updateSidechatSummary(conversationId, "failed");
        }
        return;
      }
      const persisted = this.messages.some((message) => message.id === last.id)
        ? this.messages.map((message) =>
          message.id === last.id ? last : message
        )
        : [...this.messages, last];
      await this.persistMessages(persisted);
      await this.onChatResponse({
        message: last,
        requestId: input.submittedMessageId,
        continuation: false,
        status: "completed",
      });
    } catch (error) {
      logError("sidechat_turn.server_failed", error, {
        childName: this.name,
        conversationId,
      });
      if (await parent.isSidechatOperational(this.name, conversationId)) {
        await parent.updateSidechatSummary(conversationId, "failed");
      }
    }
  }

  private async handlePublicChatMessage(
    options?: Parameters<AIChatAgent<AppEnv>["onChatMessage"]>[1],
  ): Promise<Response> {
    const identity = this.assertPublicChild();
    const projectId = this.publicProjectId();
    const claims = readPublicChatConnectionClaims(
      this.readConnectionActor(
        getCurrentAgent<MavenChatAgent>().connection?.id,
      ),
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
    if (
      gate === "human_mode" &&
      shouldResumeAiAfterHumanIdle({
        messages: this.readPublicMessages(),
        submittedMessageId: submitted.id,
        botName: settings?.botName,
        snoozedUntil: currentState.snoozedUntil,
        lastHumanCommandAt: typeof currentState.metadata.lastHumanCommandAt ===
            "number"
          ? currentState.metadata.lastHumanCommandAt
          : null,
      })
    ) {
      try {
        if (!options?.abortSignal?.aborted) {
          const handback = await this.transitionPublicOwnership(
            "ai_handed_back",
            currentState.revision,
          );
          if (handback.status === "active") {
            currentState = this.requirePublicState();
            currentChatState = this.parseStoredChatState(currentState);
            gate = evaluatePublicTurnGate({
              subscriptionActive,
              messageAllowed,
              banned: false,
              archived: currentState.archivedAt !== null,
              status: currentState.status,
              closeReason: currentState.closeReason,
              aiParticipation: currentChatState.aiParticipation,
              aiInvoked: false,
            });
            await this.applyConversationAction({
              action: "assign",
              assigneeId: MAVEN_ASSIGNEE_ID,
            });
            await this.appendSystem({
              projectId,
              conversationId: currentState.id,
              kind: "assigned",
              content: mavenAssignedSystemContent({
                botName: settings?.botName,
                reason: "idle",
              }),
            });
          }
        }
      } catch (error) {
        logError("agent_public_turn.idle_handback_failed", error, {
          projectId,
          conversationId: currentState.id,
        });
      }
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
        ).then(async () => {
          // Keep dashboard customer views live: the visitor-message path is
          // the main mover of lastSeenAt.
          const parent = await this.parentAgent(MavenProjectAgent);
          await parent.notifyCustomerUpdated([customerId]);
        }).catch((error) => {
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
      const channels = listEnabledAgentChannels({
        telegram: settings?.telegramBotToken && settings.telegramChatId
          ? {
              storedBotToken: settings.telegramBotToken,
              chatId: settings.telegramChatId,
              botName: settings.botName,
              service: new TelegramService(db, this.env.ENCRYPTION_KEY),
            }
          : null,
        slack: settings?.slackBotToken && settings.slackChannelId
          ? {
              storedBotToken: settings.slackBotToken,
              channelId: settings.slackChannelId,
              botName: settings.botName,
              service: new SlackService(db, this.env.ENCRYPTION_KEY),
            }
          : null,
      });
      if (
        currentChatState.activeHumanRoutes.length > 0 &&
        currentState.status !== "closed"
      ) {
        this.ctx.waitUntil((async () => {
          await forwardVisitorToJoinedHumans({
            channels,
            activeHumanRoutes: currentChatState.activeHumanRoutes,
            conversationId: currentState.id,
            visitorName: currentState.visitorName,
            content: submitted.content,
            channelThreads: currentState.channelThreads,
            telegramThreadId: currentState.telegramThreadId,
            email: this.env.RESEND_API_KEY && project
              ? {
                  db,
                  service: new EmailService(this.env.RESEND_API_KEY),
                  projectId: project.id,
                  projectSlug: project.slug,
                  projectName: project.name,
                  messageId: submitted.id,
                  visitorDisplayName:
                    currentState.visitorName?.trim() ||
                    currentState.visitorEmail?.trim() ||
                    "Visitor",
                  dashboardUrl:
                    `${this.env.BETTER_AUTH_URL}/app/projects/${project.id}/conversations/${currentState.id}`,
                  accentColor: null,
                }
              : undefined,
          });
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
      isReturningVisitor: !isFirstVisitorTurn && isReturningVisitorGap(
        rawHistory.at(-2)?.createdAt ?? null,
        Date.now(),
      ),
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
    const telegramService = new TelegramService(db, this.env.ENCRYPTION_KEY);
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
                slackService: new SlackService(db, this.env.ENCRYPTION_KEY),
                acquireHttpRateLimitPermit: () =>
                  this.acquirePublicToolRateLimitPermit(),
                onTeamRequested() {},
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
      logWarn("sidechat_turn.response_not_completed", {
        childName: this.name,
        conversationId,
        requestId: result.requestId,
        continuation: result.continuation,
        status: result.status,
        error: result.error ?? null,
      });
      await parent.updateSidechatSummary(conversationId, "failed");
      return;
    }

    if (hasPendingSidechatApproval([...this.messages, result.message])) {
      logInfo("sidechat_turn.completed", {
        childName: this.name,
        conversationId,
        requestId: result.requestId,
        continuation: result.continuation,
        status: "waiting_approval",
      });
      await parent.updateSidechatSummary(conversationId, "waiting_approval");
      return;
    }

    try {
      const published = await persistCompletedReplyDraft({
        result,
        messages: this.messages,
        persistMessages: (messages) => this.persistMessages(messages),
      });
      const hasText = hasVisibleSidechatAssistantText(result.message);
      const status = resolveCompletedSidechatSummary({
        publishedDraft: published,
        hasAssistantText: hasText,
      });
      const turnContext = {
        childName: this.name,
        conversationId,
        requestId: result.requestId,
        continuation: result.continuation,
        status,
        published,
        hasText,
        partTypes: result.message.parts.map((part) => part.type),
      };
      if (status === "failed") {
        logWarn("sidechat_turn.empty_complete", turnContext);
      } else {
        logInfo("sidechat_turn.completed", turnContext);
      }
      await parent.updateSidechatSummary(conversationId, status);
    } catch (error) {
      logError("sidechat_turn.complete_failed", error, {
        childName: this.name,
        conversationId,
        requestId: result.requestId,
        continuation: result.continuation,
      });
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

  async getPublicConversationRecord(): Promise<PublicConversationRecord> {
    return this.toPublicConversation(this.requirePublicState());
  }

  async hasPublicConversation(): Promise<boolean> {
    this.assertPublicChild();
    return this.publicStateStore().get() !== null;
  }

  async getPublicMessages(): Promise<PublicMessageRecord[]> {
    this.assertPublicChild();
    return this.readPublicMessages();
  }

  async getRecentPublicMessages(input: {
    limit: number;
  }): Promise<PublicMessagePage> {
    this.assertPublicChild();
    const limit = Math.max(1, Math.min(MAX_PUBLIC_MESSAGE_PAGE, input.limit));
    const rows = this.sql<{ message: string }>`
      SELECT message
      FROM cf_ai_chat_agent_messages
      WHERE json_extract(message, '$.metadata.channel') = 'public'
      ORDER BY CAST(json_extract(message, '$.metadata.createdAt') AS INTEGER) DESC,
               id DESC
      LIMIT ${limit + 1}
    `;
    return {
      messages: rows.slice(0, limit)
        .map((row) => this.publicRecordFromSerialized(row.message))
        .reverse(),
      hasMore: rows.length > limit,
    };
  }

  async getPublicMessagesBefore(input: {
    beforeCreatedAt: number;
    limit: number;
  }): Promise<PublicMessagePage> {
    this.assertPublicChild();
    const limit = Math.max(1, Math.min(MAX_PUBLIC_MESSAGE_PAGE, input.limit));
    const rows = this.sql<{ message: string }>`
      SELECT message
      FROM cf_ai_chat_agent_messages
      WHERE json_extract(message, '$.metadata.channel') = 'public'
        AND CAST(json_extract(message, '$.metadata.createdAt') AS INTEGER) < ${input.beforeCreatedAt}
      ORDER BY CAST(json_extract(message, '$.metadata.createdAt') AS INTEGER) DESC,
               id DESC
      LIMIT ${limit + 1}
    `;
    return {
      messages: rows.slice(0, limit)
        .map((row) => this.publicRecordFromSerialized(row.message))
        .reverse(),
      hasMore: rows.length > limit,
    };
  }

  async getPublicMessagesSince(input: {
    since: number;
    limit: number;
  }): Promise<PublicMessageRecord[]> {
    this.assertPublicChild();
    const limit = Math.max(1, Math.min(250, input.limit));
    return this.sql<{ message: string }>`
      SELECT message
      FROM cf_ai_chat_agent_messages
      WHERE json_extract(message, '$.metadata.channel') = 'public'
        AND CAST(json_extract(message, '$.metadata.createdAt') AS INTEGER) >= ${input.since}
      ORDER BY CAST(json_extract(message, '$.metadata.createdAt') AS INTEGER) ASC,
               id ASC
      LIMIT ${limit}
    `.map((row) => this.publicRecordFromSerialized(row.message));
  }

  async getPublicMessage(messageId: string): Promise<PublicMessageRecord | null> {
    this.assertPublicChild();
    const row = this.sql<{ message: string }>`
      SELECT message
      FROM cf_ai_chat_agent_messages
      WHERE id = ${messageId}
        AND json_extract(message, '$.metadata.channel') = 'public'
      LIMIT 1
    `.at(0);
    return row ? this.publicRecordFromSerialized(row.message) : null;
  }

  async hasPublicVisitorMessages(): Promise<boolean> {
    this.assertPublicChild();
    return this.sql<{ found: number }>`
      SELECT 1 AS found
      FROM cf_ai_chat_agent_messages
      WHERE json_extract(message, '$.metadata.channel') = 'public'
        AND json_extract(message, '$.metadata.author') = 'visitor'
      LIMIT 1
    `.length > 0;
  }

  async getLatestEmailedPublicHumanMessage(): Promise<PublicMessageRecord | null> {
    this.assertPublicChild();
    const row = this.sql<{ message: string }>`
      SELECT message
      FROM cf_ai_chat_agent_messages
      WHERE json_extract(message, '$.metadata.channel') = 'public'
        AND json_extract(message, '$.metadata.author') = 'agent'
        AND json_extract(message, '$.metadata.emailedAt') IS NOT NULL
      ORDER BY CAST(json_extract(message, '$.metadata.createdAt') AS INTEGER) DESC,
               id DESC
      LIMIT 1
    `.at(0);
    return row ? this.publicRecordFromSerialized(row.message) : null;
  }

  async getPublicContextSnapshot(input: { newestMessages: number }): Promise<{
    conversation: PublicConversationRecord;
    messages: PublicMessageRecord[];
  }> {
    const state = this.requirePublicState();
    const limit = Math.max(0, Math.min(100, input.newestMessages));
    return {
      conversation: this.toPublicConversation(state),
      messages: this.readPublicMessages().slice(-limit),
    };
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

  async refreshLegacyPublicConversation(
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
      if (!existing) {
        await this.persistPublicRecords(input.messages);
        const initialized = this.publicStateStore().initialize(
          input.conversation,
          input.checksum,
        );
        this.setState(this.safePublicState(initialized.state));
        return {
          status: initialized.created ? "imported" : "noop",
          revision: initialized.state.revision,
        };
      }
      if (existing.revision !== 0) {
        return { status: "conflict", revision: existing.revision };
      }
      if (existing.legacyChecksum === input.checksum) {
        return { status: "noop", revision: existing.revision };
      }
      if (existing.retentionScheduleId) {
        try {
          const parent = await this.parentAgent(MavenProjectAgent);
          await parent.cancelPublicRetention(existing.retentionScheduleId);
        } catch {
          // A stale callback rechecks archivedAt before deleting anything.
        }
      }
      if (existing.autoCloseScheduleId) {
        await this.cancelSchedule(existing.autoCloseScheduleId);
      }
      await this.persistPublicRecords(input.messages);
      const saved = this.saveInternalPublicState(existing, {
        ...structuredClone(input.conversation),
        revision: 0,
        legacyChecksum: input.checksum,
        externalActionLeaseId: null,
        retentionScheduleId: null,
        autoCloseScheduleId: null,
      });
      this.setState(this.safePublicState(saved));
      return { status: "imported", revision: saved.revision };
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
      nextChatState.activeHumanRoutes = joinActiveHumanRoute(
        nextChatState.activeHumanRoutes,
        activeHumanRouteFromMessage(message),
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
        assigneeId: message.userId ?? null,
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

  async appendSidechatDraftAsBot(input: {
    messageId: string;
    text: string;
    senderName: string | null;
    autoCloseMinutes: number | null;
  }): Promise<PublicMessageRecord | null> {
    const identity = this.assertPublicChild();
    const message = await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (
        state.archivedAt !== null ||
        state.purgeStartedAt !== null
      ) {
        return null;
      }
      const message: PublicMessageRecord = {
        id: input.messageId,
        conversationId: identity.conversationId,
        author: "bot",
        content: input.text,
        imageUrls: [],
        sources: [],
        senderName: input.senderName,
        senderAvatar: null,
        userId: null,
        systemKind: null,
        createdAt: Date.now(),
        deliveredAt: null,
        readAt: null,
        emailedAt: null,
        idempotencyKey: input.messageId,
        origin: "dashboard",
        externalReplyTo: null,
      };
      const messages = this.readPublicMessages();
      const existing = messages.find(
        (candidate) => candidate.id === input.messageId,
      );
      if (existing) {
        return existing.author === "bot" &&
            this.samePublicMessagePayload(existing, message)
          ? existing
          : null;
      }

      const chatState = this.parseStoredChatState(state);
      let status = state.status;
      if (status === "closed") {
        if (chatState.aiParticipation === "human_only") {
          status = "agent_replied";
        } else if (chatState.aiParticipation === "assist_until_agent") {
          status = "waiting_agent";
        } else {
          status = "active";
        }
      }
      const updated = [...messages, structuredClone(message)];
      await this.persistPublicRecords(updated);
      const saved = this.saveNextPublicState(state, {
        status,
        closeReason: status === state.status ? state.closeReason : null,
        lastActivityAt: Math.max(state.lastActivityAt, message.createdAt),
        updatedAt: Math.max(state.updatedAt, message.createdAt),
      });
      await this.publishPublicProjection(saved, updated);
      return structuredClone(message);
    });
    if (message) {
      await this.reconcilePublicAutoClose(input.autoCloseMinutes);
    }
    return message;
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
      const retentionScheduleToCancel = action.action === "unarchive"
        ? state.retentionScheduleId
        : null;
      if (state.archivedAt !== null && action.action !== "unarchive") {
        return null;
      }
      const changes: Partial<StoredPublicConversationState> = {
        updatedAt: now,
      };
      switch (action.action) {
        case "archive":
          if (state.archivedAt !== null) return null;
          if (
            state.externalActionStartedAt !== null &&
            state.externalActionStartedAt > now - EXTERNAL_ACTION_LEASE_MS
          ) return null;
          changes.archivedAt = now;
          changes.purgeStartedAt = null;
          changes.retentionScheduleId = null;
          break;
        case "unarchive":
          if (state.archivedAt === null || state.purgeStartedAt !== null) {
            return null;
          }
          changes.archivedAt = null;
          changes.retentionScheduleId = null;
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
      // Abort only after the guards accept the action, so a declined archive
      // never destroys the visitor's in-flight stream.
      if (
        action.action === "archive" ||
        action.action === "resolve" ||
        action.action === "flag_spam"
      ) {
        this.abortAllRequests(`Conversation action: ${action.action}`);
      }
      let saved = this.saveNextPublicState(state, changes);
      const messages = this.readPublicMessages();
      await this.publishPublicProjection(saved, messages);
      const parent = await this.parentAgent(MavenProjectAgent);
      if (action.action === "archive" && saved.archivedAt !== null) {
        try {
          const scheduleId = await parent.schedulePublicRetention({
            conversationId: saved.id,
            archivedAt: saved.archivedAt,
          });
          const latest = this.requirePublicState();
          if (
            latest.archivedAt === saved.archivedAt &&
            latest.retentionScheduleId === null
          ) {
            saved = this.saveNextPublicState(latest, {
              retentionScheduleId: scheduleId,
            });
            await this.publishPublicProjection(saved, messages);
          }
        } catch {
          // The project reconciliation sweep can recreate a missing schedule.
        }
      } else if (retentionScheduleToCancel) {
        try {
          await parent.cancelPublicRetention(retentionScheduleToCancel);
        } catch {
          // A stale callback rechecks archivedAt before deleting anything.
        }
      }
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
    expectedRevision?: number,
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
      if (
        expectedRevision !== undefined &&
        state.revision !== expectedRevision
      ) {
        const conversation = this.toPublicConversation(state);
        return { status: conversation.status, conversation };
      }
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
        ...(event === "human_joined"
          ? { metadata: clearHumanCommandClock(state.metadata) }
          : {}),
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
      if (!canAutoCloseConversationStatus(state.status)) {
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
    await this.updatePublicChannelThread("telegram", threadId);
  }

  async updatePublicChannelThread(
    channel: "telegram" | "slack",
    threadId: string,
  ): Promise<void> {
    await this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (state.archivedAt !== null || state.purgeStartedAt !== null) return;
      if (channel === "telegram") {
        if (state.telegramThreadId === threadId) return;
        if (
          state.telegramThreadId !== null &&
          state.telegramThreadId !== threadId
        ) return;
        const saved = this.saveNextPublicState(state, {
          telegramThreadId: threadId,
          channelThreads: publicChannelThreads(threadId, state.channelThreads),
          updatedAt: Date.now(),
        });
        await this.publishPublicProjection(saved, this.readPublicMessages());
        return;
      }
      if (state.channelThreads.slack === threadId) return;
      if (
        state.channelThreads.slack !== undefined &&
        state.channelThreads.slack !== threadId
      ) return;
      const saved = this.saveNextPublicState(state, {
        channelThreads: {
          ...state.channelThreads,
          slack: threadId,
        },
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

  async claimScheduledPublicRetention(input: {
    archivedAt: number;
    claimAt: number;
  }): Promise<boolean> {
    return this.runExclusivePublicMutation(async () => {
      const state = this.requirePublicState();
      if (
        state.archivedAt !== input.archivedAt ||
        state.purgeStartedAt !== null
      ) return false;
      this.saveNextPublicState(state, {
        purgeStartedAt: input.claimAt,
        updatedAt: input.claimAt,
      });
      return true;
    });
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

  async releaseTeamRequestNotification(
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
      if (!acceptance || acceptance.notificationState !== "attempted") {
        return false;
      }
      const saved = this.saveNextPublicState(state, {
        metadata: {
          ...state.metadata,
          teamRequestNotificationState: "pending",
          teamRequestNotificationAttemptedAt: null,
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
        channelThreads: publicChannelThreads(threadId, state.channelThreads),
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
      const staleBefore = (input.now ?? Date.now()) - EXTERNAL_ACTION_LEASE_MS;
      if (
        state.archivedAt !== null ||
        (state.externalActionLeaseId !== null &&
          state.externalActionStartedAt !== null &&
          state.externalActionStartedAt > staleBefore) ||
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
      const nextMetadata = input.metadata === undefined
        ? state.metadata
        : preserveReservedPublicMetadata(input.metadata, state.metadata);
      if (
        (input.visitorName === undefined ||
          input.visitorName === state.visitorName) &&
        (input.visitorEmail === undefined ||
          input.visitorEmail === state.visitorEmail) &&
        JSON.stringify(nextMetadata) === JSON.stringify(state.metadata)
      ) return this.toPublicConversation(state);
      const saved = this.saveNextPublicState(state, {
        ...(input.visitorName !== undefined
          ? { visitorName: input.visitorName }
          : {}),
        ...(input.visitorEmail !== undefined
          ? { visitorEmail: input.visitorEmail }
          : {}),
        ...(input.metadata !== undefined ? { metadata: nextMetadata } : {}),
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
      if (state.customerId === input.customerId) {
        return this.toPublicConversation(state);
      }
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
        !canAutoCloseConversationStatus(state.status) ||
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
        !canAutoCloseConversationStatus(state.status)
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
      const state = this.requirePublicState();
      const key = getLocalUploadKey(imageUrl);
      if (
        !pathname.startsWith("/api/uploads/") ||
        !key?.startsWith(`${state.projectId}/`) ||
        !isConversationUploadKeyOwnedByConversation(key, state.id)
      ) return null;
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
    const chatState = parseChatState(JSON.stringify(state.chatState), {
      fallbackAiParticipation: fallbackAiParticipationForStatus(state.status),
    });
    if (
      chatState.aiParticipation !== "human_only" ||
      chatState.activeHumanRoutes.length > 0
    ) {
      return chatState;
    }
    const escalatedAt = typeof state.metadata.escalatedAt === "string"
      ? Date.parse(state.metadata.escalatedAt)
      : Number.NaN;
    if (!Number.isFinite(escalatedAt)) return chatState;
    return {
      ...chatState,
      activeHumanRoutes: inferLegacyActiveHumanRoutes(
        this.readPublicMessages(),
        escalatedAt,
      ),
    };
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

  private publicRecordFromSerialized(serialized: string): PublicMessageRecord {
    const identity = this.assertPublicChild();
    return fromPublicUiMessage(
      JSON.parse(serialized) as UIMessage,
      this.publicProjectId(),
      identity.conversationId,
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
      channelThreads: publicChannelThreads(
        state.telegramThreadId,
        state.channelThreads,
      ),
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
      slackThreadId: state.channelThreads.slack ?? null,
      status: state.status,
      closeReason: state.closeReason,
      metadata: structuredClone(state.metadata),
      priority: state.priority,
      assigneeId: state.assigneeId,
      snoozedUntil: state.snoozedUntil,
      archivedAt: state.archivedAt,
      purgeStartedAt: state.purgeStartedAt,
      retentionScheduleId: state.retentionScheduleId,
      visitorLastSeenAt: state.visitorLastSeenAt,
      visitorPresence: state.visitorPresence,
      visitorLastOnlineAt: state.visitorLastOnlineAt,
      lastMessageId: last?.id ?? null,
      lastMessageAuthor: last?.author ?? null,
      lastMessagePreview: last?.content ?? null,
      lastMessageSenderName: last?.senderName ?? null,
      lastMessageEmailedAt: last?.emailedAt ?? null,
      lastMessageCreatedAt: last?.createdAt ?? null,
      lastActivityAt: state.lastActivityAt,
      messageCount: messages.length,
      botMessageCount: messages.filter((message) => message.author === "bot").length,
      childRevision: state.revision,
      sourceChecksum: null,
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
