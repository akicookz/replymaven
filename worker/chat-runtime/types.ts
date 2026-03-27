import { type DrizzleD1Database } from "drizzle-orm/d1";
import { type ModelMessage } from "ai";
import { type ToolRow } from "../db";
import { type ProjectSettingsRow } from "../db";
import { type AppEnv } from "../types";
import { type SourceReference } from "../services/resource-service";

export type GroundingConfidence = "high" | "low" | "none";

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
  abortSignal?: AbortSignal;
  onToolCallStart?: (info: ToolCallLifecycleInfo) => void;
  onToolCallFinish?: (info: ToolCallFinishInfo) => void;
}

export interface SupportPromptOptions {
  hasTools?: boolean;
  guidelines?: Array<{ condition: string; instruction: string }>;
  agentHandbackInstructions?: string | null;
  pageContext?: Record<string, string>;
  visitorInfo?: { name: string | null; email: string | null };
  groundingConfidence?: GroundingConfidence;
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
