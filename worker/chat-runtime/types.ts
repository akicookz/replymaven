import { type DrizzleD1Database } from "drizzle-orm/d1";
import { type ModelMessage } from "ai";
import { type ToolRow } from "../db";
import { type ProjectSettingsRow } from "../db";
import { type AppEnv } from "../types";
import { type SourceReference } from "../services/resource-service";

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

export interface SupportPromptOptions {
  guidelines?: Array<{ condition: string; instruction: string }>;
  agentHandbackInstructions?: string | null;
  pageContext?: Record<string, string>;
  visitorInfo?: { name: string | null; email: string | null };
  faqContext?: string | null;
  groundingConfidence?: GroundingConfidence;
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
  phase: "retrieval" | "tool" | "verify" | "compose";
  message: string;
}

export interface ChatRuntimeAiConfig {
  model: string;
  geminiApiKey: string;
  openaiApiKey: string;
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
  | "create_inquiry"
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

export interface PlannerCreateInquiryAction {
  type: "create_inquiry";
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
  | PlannerCreateInquiryAction
  | PlannerComposeAction
  | PlannerStopAction;

export interface PlannerDecision {
  goal: string;
  nextAction: PlannerNextAction;
}

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
