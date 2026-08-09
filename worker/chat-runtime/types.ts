import { type DrizzleD1Database } from "drizzle-orm/d1";
import {
  type FlexibleSchema,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { type ToolRow } from "../db";
import { type ProjectSettingsRow } from "../db";
import { type AppEnv } from "../types";
import { type SourceReference } from "../services/resource-service";
import { type MavenChannel, type MavenToolAccess } from "../validation";

export type GroundingConfidence = "high" | "low" | "none";

export interface ConversationTurnMessage {
  role: "visitor" | "bot" | "agent";
  content: string;
  // ISO timestamp. Optional — transcripts render time-gap annotations only
  // when present (see prompt/format-transcript.ts).
  createdAt?: string;
}

export interface SupportAgentImage {
  base64: string;
  mimeType: string;
}

export interface SupportToolDefinition {
  name: string;
  displayName: string;
  description: string;
  endpoint: string;
  method: "GET" | "POST";
  headers: string | null;
  parameters: string;
  responseMapping: string | null;
  enabled: boolean;
  timeout: number;
}

export interface SupportPromptOptions {
  channel?: MavenChannel;
  guidelines?: Array<{ condition: string; instruction: string }>;
  agentHandbackInstructions?: string | null;
  pageContext?: Record<string, string>;
  visitorInfo?: { name: string | null; email: string | null };
  faqContext?: string | null;
  faqMatchHint?: { question: string; answer: string; score: number } | null;
  groundingConfidence?: GroundingConfidence;
  topScore?: number;
  // Current time + conversation timing for the <time-context> section. The
  // compose model gets history as a structured message array (no inline gap
  // annotations), so this block carries the timing signal instead.
  timeContext?: {
    nowMs: number;
    conversationHistory: ConversationTurnMessage[];
  } | null;
  toolEvidenceSummary?: string | null;
  retrievalAttempted?: boolean;
  broaderSearchAttempted?: boolean;
  turnContext?: SupportTurnContext;
  aiParticipation?: AiParticipation;
  // True when the conversation has been flagged for human review
  // (status === "waiting_agent"). Suppresses the [RESOLVED] instruction so
  // the model never self-closes a conversation waiting on a teammate.
  escalated?: boolean;
}

export type SupportPromptSettings = Pick<
  ProjectSettingsRow,
  | "toneOfVoice"
  | "customTonePrompt"
  | "companyContext"
  | "botName"
  | "agentName"
  | "workingHours"
  | "avgResponseTime"
>;

export interface RetrievedSearchChunk {
  item?: { key?: string };
  score?: number;
  text?: string;
}

export interface PreparedRagChunk {
  key: string;
  score: number;
  text: string;
}

export interface RagContextResult {
  context: string;
  faqContext: string;
  knowledgeBaseContext: string;
  topScore: number;
  selectedChunkCount: number;
  sources: SourceReference[];
  unresolvedKeys: string[];
}

export type MavenStreamPart =
  | { type: "text-delta"; text: string; [key: string]: unknown }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input?: unknown;
        args?: unknown;
      }
    | {
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: unknown;
      }
    | { type: "finish-step"; finishReason: string }
    | { type: string; [key: string]: unknown };

export type MavenArtifact =
  | { type: "reply_draft"; draft: string }
  | null;

export interface SupportAgentResult {
  fullStream: AsyncIterable<MavenStreamPart>;
}

export interface WidgetStatusPayload {
  phase: "thinking" | "retrieval" | "tool" | "verify" | "compose";
  message: string;
}

export type ConversationChatStateName =
  | "active"
  | "clarifying"
  | "answering"
  | "escalating"
  | "agent_mode";

export type AiParticipation =
  | "continuous"
  | "assist_until_agent"
  | "human_only";

export type ChatOwnershipEvent =
  | "team_requested"
  | "human_joined"
  | "ai_handed_back";

export interface ChatOwnershipSnapshot {
  status: string;
  chatState: string | null;
}

export interface MavenTurnContext {
  channel: MavenChannel;
  projectId: string;
  conversationId: string;
  actorUserId: string | null;
  customerId: string | null;
  ownership: ChatOwnershipSnapshot;
}

export interface MavenToolCapability {
  id: string;
  projectId: string;
  connectionId: string | null;
  modelName: string;
  displayName: string;
  source: "internal" | "http" | "mcp";
  allowedChannels: MavenChannel[];
  access: MavenToolAccess;
  enabled: boolean;
  schemaFingerprint: string;
}

export type MavenToolAuthorizationError =
  | "tool_disabled"
  | "project_mismatch"
  | "channel_not_allowed";

export interface MavenToolDefinition {
  capability: MavenToolCapability;
  description: string;
  inputSchema: FlexibleSchema<unknown>;
  execute(
    input: unknown,
    options: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
  reauthorize(): Promise<MavenToolCapability | null>;
}

export function isChatOwnershipSnapshotCurrent(
  expected: ChatOwnershipSnapshot,
  current: ChatOwnershipSnapshot,
): boolean {
  return (
    expected.status === current.status &&
    expected.chatState === current.chatState
  );
}

export function canPersistAiOutput(options: {
  participationAtTurnStart: AiParticipation;
  currentParticipation: AiParticipation;
  currentStatus: string;
  aiInvoked: boolean;
  resolvedByThisTurn: boolean;
}): boolean {
  if (options.currentStatus === "closed" && !options.resolvedByThisTurn) {
    return false;
  }
  if (options.currentParticipation !== "human_only") return true;
  return (
    options.participationAtTurnStart === "human_only" && options.aiInvoked
  );
}

export interface SupportTurnContext {
  kind: "standard" | "contact_support";
  isFirstVisitorTurn: boolean;
}

export interface ContactAcceptedPayload {
  conversationId: string;
  visitorMessageId: string;
  conversationStatus: "waiting_agent" | "agent_replied";
  aiWillRespond: boolean;
  visitorName: string | null;
  visitorEmail: string | null;
  assistantName: string;
  fallbackMessage: string;
}

export interface ConversationChatState {
  state: ConversationChatStateName;
  aiParticipation: AiParticipation;
  ownershipRevision: number;
  askedClarifications: string[];
  clarificationAttempts: number;
  lastBotQuestion: string | null;
  frustrationScore: number;
  lastIntent: string | null;
  pendingHandoffReason: string | null;
  // Escalation continuity, persisted across turns so the runtime no longer
  // has to regex-match its own (now LLM-rendered, possibly non-English)
  // handoff wording back out of the transcript to know where it left off.
  awaitingContactFields: Array<"name" | "email">;
  awaitingHandoffConfirmation: boolean;
  contactDeclined: boolean;
}

export function createInitialChatState(): ConversationChatState {
  return {
    state: "active",
    aiParticipation: "continuous",
    ownershipRevision: 0,
    askedClarifications: [],
    clarificationAttempts: 0,
    lastBotQuestion: null,
    frustrationScore: 0,
    lastIntent: null,
    pendingHandoffReason: null,
    awaitingContactFields: [],
    awaitingHandoffConfirmation: false,
    contactDeclined: false,
  };
}

export function fallbackAiParticipationForStatus(
  status: string,
): AiParticipation {
  if (status === "waiting_agent") return "assist_until_agent";
  if (status === "agent_replied") return "human_only";
  return "continuous";
}

export function applyChatOwnershipEvent(
  chatState: ConversationChatState,
  event: ChatOwnershipEvent,
): ConversationChatState {
  if (event === "human_joined") {
    return {
      ...chatState,
      state: "agent_mode",
      aiParticipation: "human_only",
      ownershipRevision: chatState.ownershipRevision + 1,
    };
  }

  if (event === "ai_handed_back") {
    return {
      ...chatState,
      state: "active",
      aiParticipation: "continuous",
      ownershipRevision: chatState.ownershipRevision + 1,
    };
  }

  if (chatState.aiParticipation === "human_only") return chatState;
  return {
    ...chatState,
    state: "escalating",
    aiParticipation: "assist_until_agent",
    ownershipRevision: chatState.ownershipRevision + 1,
  };
}

export function mergeChatStateForPersistence(
  currentState: ConversationChatState,
  incomingState: ConversationChatState,
): ConversationChatState {
  if (currentState.aiParticipation === "human_only") {
    return {
      ...incomingState,
      state: "agent_mode",
      aiParticipation: "human_only",
      ownershipRevision: currentState.ownershipRevision,
    };
  }
  if (currentState.aiParticipation !== incomingState.aiParticipation) {
    return {
      ...incomingState,
      state: currentState.state,
      aiParticipation: currentState.aiParticipation,
      ownershipRevision: currentState.ownershipRevision,
    };
  }
  return {
    ...incomingState,
    ownershipRevision: currentState.ownershipRevision,
  };
}

export function parseChatState(
  raw: string | null,
  options?: { fallbackAiParticipation?: AiParticipation },
): ConversationChatState {
  const fallbackAiParticipation =
    options?.fallbackAiParticipation ?? "continuous";
  if (!raw) {
    return {
      ...createInitialChatState(),
      aiParticipation: fallbackAiParticipation,
    };
  }
  try {
    const chat = JSON.parse(raw) as Partial<ConversationChatState>;
    if (!chat || typeof chat !== "object") {
      return {
        ...createInitialChatState(),
        aiParticipation: fallbackAiParticipation,
      };
    }
    return {
      state:
        typeof chat.state === "string"
          ? (chat.state as ConversationChatStateName)
          : "active",
      aiParticipation:
        chat.aiParticipation === "continuous" ||
        chat.aiParticipation === "assist_until_agent" ||
        chat.aiParticipation === "human_only"
          ? chat.aiParticipation
          : fallbackAiParticipation,
      ownershipRevision:
        typeof chat.ownershipRevision === "number" &&
        Number.isFinite(chat.ownershipRevision)
          ? Math.max(0, Math.floor(chat.ownershipRevision))
          : 0,
      askedClarifications: Array.isArray(chat.askedClarifications)
        ? chat.askedClarifications.filter((q): q is string => typeof q === "string")
        : [],
      clarificationAttempts:
        typeof chat.clarificationAttempts === "number"
          ? chat.clarificationAttempts
          : 0,
      lastBotQuestion:
        typeof chat.lastBotQuestion === "string" ? chat.lastBotQuestion : null,
      frustrationScore:
        typeof chat.frustrationScore === "number" ? chat.frustrationScore : 0,
      lastIntent:
        typeof chat.lastIntent === "string" ? chat.lastIntent : null,
      pendingHandoffReason:
        typeof chat.pendingHandoffReason === "string"
          ? chat.pendingHandoffReason
          : null,
      // Defensive reads: rows written before these fields existed simply
      // parse to the defaults, so no migration is needed for the opaque
      // `chat_state` JSON column.
      awaitingContactFields: Array.isArray(chat.awaitingContactFields)
        ? chat.awaitingContactFields.filter(
            (field): field is "name" | "email" =>
              field === "name" || field === "email",
          )
        : [],
      awaitingHandoffConfirmation:
        typeof chat.awaitingHandoffConfirmation === "boolean"
          ? chat.awaitingHandoffConfirmation
          : false,
      contactDeclined:
        typeof chat.contactDeclined === "boolean"
          ? chat.contactDeclined
          : false,
    };
  } catch {
    return {
      ...createInitialChatState(),
      aiParticipation: fallbackAiParticipation,
    };
  }
}

export interface ChatRuntimeAiConfig {
  model: string;
  geminiApiKey: string | null;
  openaiApiKey: string | null;
}

// What the runtime decides to say at an escalation step, before any wording is
// chosen. The runtime owns this decision (whether to hand off, which contact
// fields to collect, whether the forward already happened); a scoped model call
// renders it into the bot's tone and the visitor's language. `agentLabel` is the
// already-resolved human-team label (e.g. settings.agentName ?? "the team").
export type HandoffRenderDirective =
  | {
      kind: "offer_handoff";
      hasIssueContext: boolean;
      agentLabel: string;
    }
  | {
      kind: "collect_contact";
      missingFields: Array<"name" | "email">;
      agentLabel: string;
    }
  | {
      kind: "escalated";
      variant: "created" | "already_forwarded";
      agentLabel: string;
    };

export interface SupportAgentDependencies {
  modelConfig: ChatRuntimeAiConfig;
  createModel?: (config: ChatRuntimeAiConfig) => LanguageModel;
}

export interface WidgetMessageTurnContext {
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
  executionCtx: ExecutionContext;
  routeStartedAt: number;
  streamProtocolVersion: 1 | 2;
  abortSignal?: AbortSignal;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => boolean;
  project: {
    id: string;
    userId: string;
    name: string;
  };
  conversationId: string;
  turnKind?: SupportTurnContext["kind"];
  visitorMessageAlreadySaved?: boolean;
  isFirstVisitorTurn?: boolean;
  suppressAgentForward?: boolean;
  contactAccepted?: ContactAcceptedPayload;
  payload: {
    content: string;
    imageUrl?: string | null;
    pageContext?: Record<string, string>;
    history?: ConversationTurnMessage[];
  };
}

export interface WidgetMessageTurnResult {
  response: Response;
}

export interface TurnTelemetry {
  startedAt: number;
  routeStartedAt: number;
  firstStatusAt?: number;
  firstTextAt?: number;
  verifierRan?: boolean;
  verifierVerdict?: "supported" | "unsupported" | "revised";
  routerMs?: number;
  loopMs?: number;
  composeMs?: number;
  verifierMs?: number;
  retrievalMs?: number[];
  toolCallMs?: number[];
  modelCallCount?: number;
  modelCallsByStage?: Record<string, number>;
}

export function toToolDefinition(tool: ToolRow): SupportToolDefinition {
  return {
    name: tool.name,
    displayName: tool.displayName,
    description: tool.description,
    endpoint: tool.endpoint,
    method: tool.method,
    headers: tool.headers,
    parameters: tool.parameters,
    responseMapping: tool.responseMapping,
    enabled: tool.enabled,
    timeout: tool.timeout,
  };
}

export function toSdkConversationMessages(
  conversationHistory: ConversationTurnMessage[],
  channel: MavenChannel,
): ModelMessage[] {
  return conversationHistory.map((message) => {
    if (channel === "public") {
      if (message.role === "visitor") {
        return { role: "user", content: message.content };
      }
      if (message.role === "bot" || message.role === "agent") {
        return { role: "assistant", content: message.content };
      }
      throw new Error(`Invalid public conversation role: ${message.role}`);
    }

    if (message.role === "agent") {
      return { role: "user", content: message.content };
    }
    if (message.role === "bot") {
      return { role: "assistant", content: message.content };
    }
    throw new Error(`Invalid sidechat conversation role: ${message.role}`);
  });
}
