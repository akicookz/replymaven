import { type DrizzleD1Database } from "drizzle-orm/d1";
import { type CustomerDetail } from "../../../shared/customer-types";
import {
  type ConversationRow,
  type GuidelineRow,
  type MessageRow,
  type ProjectRow,
  type ProjectSettingsRow,
} from "../../db";
import { ChatService } from "../../services/chat-service";
import { CustomerService } from "../../services/customer-service";
import { GuidelineService } from "../../services/guideline-service";
import { ProjectService } from "../../services/project-service";
import { ToolService } from "../../services/tool-service";
import { type AppEnv } from "../../types";
import {
  broadcastSidechatActivity,
  broadcastSidechatDelta,
  broadcastSidechatMessage,
  broadcastSidechatStatus,
} from "../../realtime/broadcast";
import {
  createModelRuntimeState,
  type ModelRuntimeState,
} from "../llm/create-language-model";
import { formatTranscript } from "../prompt/format-transcript";
import {
  createStreamingStripState,
  flushStreamingStripState,
  stripInternalTokensStreaming,
} from "../streaming/internal-tokens";
import {
  type ConversationTurnMessage,
  type SupportPromptSettings,
} from "../types";
import {
  runMavenTurn,
  type MavenTurnResult,
} from "./run-maven-turn";

const MAX_PUBLIC_TRANSCRIPT_MESSAGES = 25;
const MAX_PRIVATE_HISTORY_MESSAGES = 40;
const MAX_ORDINARY_TEXT_CHARS = 5_000;
const MAX_ACTIVITY_LABEL_CHARS = 100;

type SidechatConversation = Pick<
  ConversationRow,
  | "id"
  | "projectId"
  | "customerId"
  | "visitorName"
  | "visitorEmail"
  | "status"
  | "chatState"
  | "archivedAt"
  | "sidechatStatus"
  | "sidechatRunId"
  | "sidechatLeaseExpiresAt"
>;

interface SidechatMessagePage {
  messages: MessageRow[];
  hasMore: boolean;
}

interface SidechatTurnChatService {
  getOperationalConversationById(
    id: string,
    projectId: string,
  ): Promise<SidechatConversation | null>;
  getRecentPublicMessages(
    conversationId: string,
    limit: number,
  ): Promise<SidechatMessagePage>;
  getRecentSidechatMessages(
    conversationId: string,
    limit: number,
  ): Promise<SidechatMessagePage>;
  addSidechatMavenMessage(input: {
    projectId: string;
    conversationId: string;
    runId: string;
    content: string;
    kind?: MessageRow["kind"];
    metadata?: string | null;
    senderName?: string | null;
  }): Promise<MessageRow | null>;
  settleSidechatRun(input: {
    projectId: string;
    conversationId: string;
    runId: string;
    status: "idle" | "ready" | "failed" | "waiting_approval";
  }): Promise<boolean>;
}

interface SidechatTurnProjectService {
  getProjectById(
    id: string,
  ): Promise<Pick<ProjectRow, "id" | "name"> | null>;
  getSettings(projectId: string): Promise<ProjectSettingsRow | null>;
}

interface SidechatTurnCustomerService {
  getCustomerDetail(
    projectId: string,
    customerId: string,
  ): Promise<Pick<CustomerDetail, "id" | "name" | "email"> | null>;
}

interface SidechatTurnGuidelineService {
  getEnabledByProject(
    projectId: string,
  ): Promise<Array<Pick<GuidelineRow, "condition" | "instruction">>>;
}

export interface SidechatTurnRuntime {
  createChatService(
    db: DrizzleD1Database<Record<string, unknown>>,
  ): SidechatTurnChatService;
  createProjectService(
    db: DrizzleD1Database<Record<string, unknown>>,
  ): SidechatTurnProjectService;
  createCustomerService(
    db: DrizzleD1Database<Record<string, unknown>>,
  ): SidechatTurnCustomerService;
  createGuidelineService(
    db: DrizzleD1Database<Record<string, unknown>>,
  ): SidechatTurnGuidelineService;
  createToolService(db: DrizzleD1Database<Record<string, unknown>>): ToolService;
  createModelRuntimeState(input: {
    model: string;
    geminiApiKey: string;
    openaiApiKey: string;
  }): ModelRuntimeState;
  runMavenTurn(options: Parameters<typeof runMavenTurn>[0]): Promise<MavenTurnResult>;
  broadcastMessage(
    env: AppEnv,
    ctx: ExecutionContext,
    conversationId: string,
    row: MessageRow,
  ): void;
  broadcastDelta(
    env: AppEnv,
    ctx: ExecutionContext,
    conversationId: string,
    runId: string,
    delta: string,
  ): void;
  broadcastActivity(
    env: AppEnv,
    ctx: ExecutionContext,
    conversationId: string,
    runId: string,
    label: string,
    phase: "start" | "finish",
  ): void;
  broadcastStatus(
    env: AppEnv,
    ctx: ExecutionContext,
    conversationId: string,
    status: "idle" | "working" | "waiting_approval" | "ready" | "failed",
    runId: string | null,
  ): void;
  now(): Date;
}

const defaultSidechatTurnRuntime: SidechatTurnRuntime = {
  createChatService(db) {
    return new ChatService(db);
  },
  createProjectService(db) {
    return new ProjectService(db);
  },
  createCustomerService(db) {
    return new CustomerService(db);
  },
  createGuidelineService(db) {
    return new GuidelineService(db);
  },
  createToolService(db) {
    return new ToolService(db);
  },
  createModelRuntimeState,
  runMavenTurn,
  broadcastMessage: broadcastSidechatMessage,
  broadcastDelta: broadcastSidechatDelta,
  broadcastActivity: broadcastSidechatActivity,
  broadcastStatus: broadcastSidechatStatus,
  now() {
    return new Date();
  },
};

export interface RunSidechatTurnOptions {
  projectId: string;
  conversationId: string;
  humanMessageId: string;
  runId: string;
  actorUserId: string;
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
  executionCtx: ExecutionContext;
  runtime?: SidechatTurnRuntime;
}

function isCurrentRun(
  conversation: SidechatConversation | null,
  runId: string,
  now: Date,
): conversation is SidechatConversation {
  return Boolean(
    conversation &&
      !conversation.archivedAt &&
      conversation.sidechatStatus === "working" &&
      conversation.sidechatRunId === runId &&
      conversation.sidechatLeaseExpiresAt &&
      conversation.sidechatLeaseExpiresAt.getTime() > now.getTime(),
  );
}

function toConversationTurnMessage(row: MessageRow): ConversationTurnMessage {
  if (row.role !== "agent" && row.role !== "bot") {
    throw new Error("Unsafe sidechat history role");
  }
  return {
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

function publicTranscriptRole(row: MessageRow): string {
  if (row.role === "visitor") return "Visitor";
  if (row.role === "agent") return "Human agent";
  if (row.role === "bot") return "Support bot";
  return "System";
}

function buildPublicTranscript(rows: MessageRow[]): string | null {
  const visibleRows = rows.filter((row) => row.role !== "system");
  if (visibleRows.length === 0) return null;
  return formatTranscript(
    visibleRows.map((row) => ({
      role: publicTranscriptRole(row),
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    })),
  );
}

function getPromptSettings(
  settings: ProjectSettingsRow | null,
): SupportPromptSettings {
  return settings ?? {
    toneOfVoice: "friendly",
    customTonePrompt: null,
    companyContext: null,
    botName: null,
    agentName: null,
    workingHours: null,
    avgResponseTime: null,
  };
}

function safeActivityLabel(label: string): string | null {
  const normalized = label.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, MAX_ACTIVITY_LABEL_CHARS) : null;
}

async function settleFailureIfCurrent(
  options: RunSidechatTurnOptions,
  runtime: SidechatTurnRuntime,
  chatService: SidechatTurnChatService,
): Promise<void> {
  try {
    const conversation = await chatService.getOperationalConversationById(
      options.conversationId,
      options.projectId,
    );
    if (!isCurrentRun(conversation, options.runId, runtime.now())) return;
    const settled = await chatService.settleSidechatRun({
      projectId: options.projectId,
      conversationId: options.conversationId,
      runId: options.runId,
      status: "failed",
    });
    if (settled) {
      runtime.broadcastStatus(
        options.env,
        options.executionCtx,
        options.conversationId,
        "failed",
        null,
      );
    }
  } catch {
    // Background cleanup is deliberately rejection-contained.
  }
}

export async function runSidechatTurn(
  options: RunSidechatTurnOptions,
): Promise<void> {
  const runtime = options.runtime ?? defaultSidechatTurnRuntime;
  const chatService = runtime.createChatService(options.db);

  try {
    const initialConversation = await chatService.getOperationalConversationById(
      options.conversationId,
      options.projectId,
    );
    if (!isCurrentRun(initialConversation, options.runId, runtime.now())) return;

    const projectService = runtime.createProjectService(options.db);
    const customerService = runtime.createCustomerService(options.db);
    const guidelineService = runtime.createGuidelineService(options.db);
    const [project, settings, publicPage, privatePage, guidelines, customer] =
      await Promise.all([
        projectService.getProjectById(options.projectId),
        projectService.getSettings(options.projectId),
        chatService.getRecentPublicMessages(
          options.conversationId,
          MAX_PUBLIC_TRANSCRIPT_MESSAGES,
        ),
        chatService.getRecentSidechatMessages(
          options.conversationId,
          MAX_PRIVATE_HISTORY_MESSAGES,
        ),
        guidelineService.getEnabledByProject(options.projectId),
        initialConversation.customerId
          ? customerService.getCustomerDetail(
              options.projectId,
              initialConversation.customerId,
            )
          : Promise.resolve(null),
      ]);
    if (!project) {
      await settleFailureIfCurrent(options, runtime, chatService);
      return;
    }

    const currentHumanMessage = privatePage.messages.find(
      (message) =>
        message.id === options.humanMessageId && message.role === "agent",
    );
    if (!currentHumanMessage) {
      await settleFailureIfCurrent(options, runtime, chatService);
      return;
    }
    const conversationHistory = privatePage.messages
      .filter((message) => message.id !== currentHumanMessage.id)
      .map(toConversationTurnMessage);

    const authoritativeConversation =
      await chatService.getOperationalConversationById(
        options.conversationId,
        options.projectId,
      );
    if (
      !isCurrentRun(authoritativeConversation, options.runId, runtime.now())
    ) {
      return;
    }

    const turn = await runtime.runMavenTurn({
      context: {
        channel: "sidechat",
        projectId: options.projectId,
        conversationId: options.conversationId,
        actorUserId: options.actorUserId,
        customerId: customer?.id ?? null,
        ownership: {
          status: authoritativeConversation.status,
          chatState: authoritativeConversation.chatState,
        },
      },
      dependencies: {
        db: options.db,
        env: options.env,
        modelRuntime: runtime.createModelRuntimeState({
          model: options.env.AI_MODEL,
          geminiApiKey: options.env.GEMINI_API_KEY,
          openaiApiKey: options.env.OPENAI_API_KEY,
        }),
        toolService: runtime.createToolService(options.db),
        projectName: project.name,
        settings: getPromptSettings(settings),
        conversationSummary: buildPublicTranscript(publicPage.messages),
        promptOptions: {
          guidelines: guidelines.map((guideline) => ({
            condition: guideline.condition,
            instruction: guideline.instruction,
          })),
          visitorInfo: {
            name: customer?.name ?? authoritativeConversation.visitorName,
            email: customer?.email ?? authoritativeConversation.visitorEmail,
          },
          timeContext: {
            nowMs: runtime.now().getTime(),
            conversationHistory: publicPage.messages
              .filter(
                (message) =>
                  message.role === "visitor" ||
                  message.role === "agent" ||
                  message.role === "bot",
              )
              .map((message) => ({
                role: message.role as "visitor" | "agent" | "bot",
                content: message.content,
                createdAt: message.createdAt.toISOString(),
              })),
          },
        },
      },
      conversationHistory,
      currentMessage: currentHumanMessage.content,
    });

    let activityIndex = 0;
    let ordinaryText = "";
    let streamFailed = false;
    const stripState = createStreamingStripState();

    function flushActivities(): void {
      while (activityIndex < turn.toolActivity.length) {
        const activity = turn.toolActivity[activityIndex];
        activityIndex += 1;
        if (!activity) continue;
        const label = safeActivityLabel(activity.displayName);
        if (!label) continue;
        runtime.broadcastActivity(
          options.env,
          options.executionCtx,
          options.conversationId,
          options.runId,
          label,
          activity.status === "started" ? "start" : "finish",
        );
      }
    }

    function appendOrdinaryDelta(delta: string): void {
      if (!delta || ordinaryText.length >= MAX_ORDINARY_TEXT_CHARS) return;
      const safeDelta = delta.slice(
        0,
        MAX_ORDINARY_TEXT_CHARS - ordinaryText.length,
      );
      if (!safeDelta) return;
      ordinaryText += safeDelta;
      runtime.broadcastDelta(
        options.env,
        options.executionCtx,
        options.conversationId,
        options.runId,
        safeDelta,
      );
    }

    flushActivities();
    for await (const part of turn.fullStream) {
      flushActivities();
      if (part.type === "abort" || part.type === "error") {
        streamFailed = true;
        continue;
      }
      if (part.type !== "text-delta") continue;
      const text = Reflect.get(part, "text");
      if (typeof text !== "string") continue;
      const stripped = stripInternalTokensStreaming(stripState, text);
      appendOrdinaryDelta(stripped.emit);
    }
    flushActivities();
    appendOrdinaryDelta(flushStreamingStripState(stripState).emit);

    if (streamFailed) {
      await settleFailureIfCurrent(options, runtime, chatService);
      return;
    }

    const artifact = turn.artifact;
    const hasSafeDraft =
      artifact?.type === "reply_draft" &&
      artifact.draft.length >= 1 &&
      artifact.draft.length <= MAX_ORDINARY_TEXT_CHARS;
    const ordinaryOutput = ordinaryText.trim().length > 0
      ? ordinaryText
      : null;
    if (!hasSafeDraft && !ordinaryOutput) {
      await settleFailureIfCurrent(options, runtime, chatService);
      return;
    }

    const beforePersist = await chatService.getOperationalConversationById(
      options.conversationId,
      options.projectId,
    );
    if (!isCurrentRun(beforePersist, options.runId, runtime.now())) return;

    const finalContent = hasSafeDraft ? artifact.draft : ordinaryOutput!;
    const finalKind = hasSafeDraft ? "reply_draft" : "text";
    const finalMetadata = hasSafeDraft
      ? JSON.stringify({ draft: artifact.draft })
      : null;
    const message = await chatService.addSidechatMavenMessage({
      projectId: options.projectId,
      conversationId: options.conversationId,
      runId: options.runId,
      content: finalContent,
      kind: finalKind,
      metadata: finalMetadata,
      senderName: "Maven",
    });
    if (!message) return;

    const afterPersist = await chatService.getOperationalConversationById(
      options.conversationId,
      options.projectId,
    );
    if (!isCurrentRun(afterPersist, options.runId, runtime.now())) return;

    const finalStatus = hasSafeDraft ? "ready" : "idle";
    const settled = await chatService.settleSidechatRun({
      projectId: options.projectId,
      conversationId: options.conversationId,
      runId: options.runId,
      status: finalStatus,
    });
    if (!settled) return;
    runtime.broadcastMessage(
      options.env,
      options.executionCtx,
      options.conversationId,
      message,
    );
    runtime.broadcastStatus(
      options.env,
      options.executionCtx,
      options.conversationId,
      finalStatus,
      null,
    );
  } catch {
    await settleFailureIfCurrent(options, runtime, chatService);
  }
}
