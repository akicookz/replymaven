import { type DrizzleD1Database } from "drizzle-orm/d1";
import { type ModelMessage } from "ai";
import { type ToolRow } from "../db";
import { type ProjectSettingsRow } from "../db";
import { type AppEnv } from "../types";
import { type SourceReference } from "../services/resource-service";
import { type InternalToken } from "./streaming/internal-tokens";

export type GroundingConfidence = "high" | "low" | "none";
export type SupportIntent =
  | "how_to"
  | "troubleshoot"
  | "lookup"
  | "policy"
  | "clarify"
  | "handoff";
export type AgentToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; toolName: string };

export interface ConversationTurnMessage {
  role: "visitor" | "bot" | "agent";
  content: string;
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

export interface ToolCallLifecycleInfo {
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolCallFinishInfo extends ToolCallLifecycleInfo {
  output: unknown;
  error: unknown;
  durationMs: number;
  success: boolean;
}

export interface SupportAgentStreamOptions {
  systemPrompt: string;
  conversationHistory: ConversationTurnMessage[];
  userMessage: string;
  image?: SupportAgentImage | null;
  tools?: SupportToolDefinition[];
  toolChoice?: AgentToolChoice;
  prepareStep?: (options: {
    stepNumber: number;
    availableToolNames: string[];
  }) => {
    toolChoice?: AgentToolChoice;
    activeTools?: string[];
  } | undefined;
  abortSignal?: AbortSignal;
  onToolCallStart?: (info: ToolCallLifecycleInfo) => void;
  onToolCallFinish?: (info: ToolCallFinishInfo) => void;
}

export interface TicketFieldSpec {
  label: string;
  type: string;
  required: boolean;
}

export interface SupportPromptOptions {
  guidelines?: Array<{ condition: string; instruction: string }>;
  agentHandbackInstructions?: string | null;
  pageContext?: Record<string, string>;
  visitorInfo?: { name: string | null; email: string | null };
  faqContext?: string | null;
  faqMatchHint?: { question: string; answer: string; score: number } | null;
  groundingConfidence?: GroundingConfidence;
  topScore?: number;
  turnPlan?: {
    intent: SupportIntent;
    summary: string;
    followUpQuestion?: string | null;
  } | null;
  plannerGoal?: string | null;
  plannerActionHistory?: PlannerActionHistoryEntry[];
  toolEvidenceSummary?: string | null;
  retrievalAttempted?: boolean;
  broaderSearchAttempted?: boolean;
  existingTicket?: Record<string, string> | null;
  ticketFields?: TicketFieldSpec[] | null;
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

export interface SupportAgentResult {
  fullStream: AsyncIterable<
    | { type: "text-delta"; text: string }
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
    | { type: string; [key: string]: unknown }
  >;
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

export interface ConversationChatState {
  state: ConversationChatStateName;
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

export function parseChatState(
  raw: string | null,
): ConversationChatState {
  if (!raw) return createInitialChatState();
  try {
    const chat = JSON.parse(raw) as Partial<ConversationChatState>;
    if (!chat || typeof chat !== "object") return createInitialChatState();
    return {
      state:
        typeof chat.state === "string"
          ? (chat.state as ConversationChatStateName)
          : "active",
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
    return createInitialChatState();
  }
}

export interface ChatRuntimeAiConfig {
  model: string;
  geminiApiKey: string | null;
  openaiApiKey: string | null;
}

export interface SupportTurnPlan {
  intent: SupportIntent;
  summary: string;
  retrievalQueries: string[];
  broaderQueries: string[];
  followUpQuestion: string | null;
}

export type PlannerActionType =
  | "search_docs"
  | "call_tool"
  | "ask_user"
  | "offer_handoff"
  | "collect_contact"
  | "create_ticket"
  | "compose"
  | "stop";

export interface PlannerSearchDocsAction {
  type: "search_docs";
  reason: string;
  query: string;
  broaderQueries?: string[];
}

export interface PlannerCallToolAction {
  type: "call_tool";
  reason: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface PlannerAskUserAction {
  type: "ask_user";
  reason: string;
  question: string;
}

export interface PlannerOfferHandoffAction {
  type: "offer_handoff";
  reason: string;
}

export interface PlannerCollectContactAction {
  type: "collect_contact";
  reason: string;
  missingFields: Array<"name" | "email">;
}

export interface PlannerCreateTicketAction {
  type: "create_ticket";
  reason: string;
}

export interface PlannerComposeAction {
  type: "compose";
  reason: string;
  answerStyle?: "direct" | "step_by_step" | "summary";
}

export interface PlannerStopAction {
  type: "stop";
  reason: string;
}

export type PlannerNextAction =
  | PlannerSearchDocsAction
  | PlannerCallToolAction
  | PlannerAskUserAction
  | PlannerOfferHandoffAction
  | PlannerCollectContactAction
  | PlannerCreateTicketAction
  | PlannerComposeAction
  | PlannerStopAction;

export interface PlannerDecision {
  goal: string;
  nextAction: PlannerNextAction;
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

export interface PlannerActionHistoryEntry {
  type: PlannerActionType;
  reason: string;
  query?: string;
  broaderQueries?: string[];
  toolName?: string;
  input?: Record<string, unknown>;
  outcome: "executed" | "completed" | "rejected";
  note?: string | null;
}

export interface PlannerToolEvidence {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  error: string | null;
  success: boolean;
  durationMs: number;
}

export interface PlannerDocsEvidence {
  ragContext: string;
  faqContext: string;
  knowledgeBaseContext: string;
  sourceReferences: SourceReference[];
  groundingConfidence: GroundingConfidence;
  topScore: number;
  unresolvedKeys: string[];
  droppedCrossTenant: number;
  retrievalAttempted: boolean;
  broaderSearchAttempted: boolean;
  queries: string[];
  broaderQueries: string[];
}

export interface PlannerLoopState {
  goal: string;
  stepCount: number;
  conversationSummary: string | null;
  initialTurnPlan: SupportTurnPlan;
  actionHistory: PlannerActionHistoryEntry[];
  docsEvidence: PlannerDocsEvidence;
  toolEvidence: PlannerToolEvidence[];
  missingInputs: string[];
  knownVisitorName: string | null;
  knownVisitorEmail: string | null;
  handoffRequested: boolean;
  awaitingHandoffConfirmation: boolean;
  awaitingContactFields: Array<"name" | "email">;
  contactDeclined: boolean;
  handoffSummary: string | null;
  finalDraft: string | null;
  terminationReason: string | null;
  reformulationUsed: boolean;
  queryTracker: {
    normalizedQueries: Map<string, number>; // normalized query -> search count
    semanticGroups: string[]; // track semantic groups of similar queries
  };
}

export interface PlannerLoopResult {
  fullResponse: string;
  retrieval: PlannerDocsEvidence;
  hadToolCalls: boolean;
  lastToolOutput: unknown;
  lastToolError: string | null;
  stepCount: number;
  terminationAction: PlannerActionType;
  loopState: PlannerLoopState;
  detectedInternalTokens: InternalToken[];
}

export interface SupportAgentDependencies {
  modelConfig: ChatRuntimeAiConfig;
}

export interface WidgetMessageTurnContext {
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
  executionCtx: ExecutionContext;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => boolean;
  project: {
    id: string;
    userId: string;
    name: string;
  };
  conversationId: string;
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

export interface AgentTurnArtifacts {
  conversationHistory: ConversationTurnMessage[];
  systemPrompt: string;
  groundingConfidence: GroundingConfidence;
  sourceReferences: SourceReference[];
  searchQueries: string[];
}

export interface TurnTelemetry {
  startedAt: number;
  firstStatusAt?: number;
  firstTextAt?: number;
  verifierRan?: boolean;
  verifierVerdict?: "supported" | "unsupported" | "revised";
  routerMs?: number;
  loopMs?: number;
  composeMs?: number;
  verifierMs?: number;
  plannerStepMs?: number[];
  retrievalMs?: number[];
  toolCallMs?: number[];
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
): ModelMessage[] {
  return conversationHistory.map((message) => ({
    role: message.role === "visitor" ? "user" : "assistant",
    content: message.content,
  }));
}
