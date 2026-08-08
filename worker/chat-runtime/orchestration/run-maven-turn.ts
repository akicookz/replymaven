import { type DrizzleD1Database } from "drizzle-orm/d1";
import { type LanguageModel } from "ai";
import { type MessageRow } from "../../db";
import { type ChatService } from "../../services/chat-service";
import { type ProjectService } from "../../services/project-service";
import { type SourceReference } from "../../services/resource-service";
import { type TelegramService } from "../../services/telegram-service";
import { type ToolService } from "../../services/tool-service";
import { type AppEnv } from "../../types";
import { streamMavenAgent } from "../agents/support-agent";
import {
  runWithModelFallback,
  type ModelRuntimeState,
} from "../llm/create-language-model";
import { buildSupportSystemPrompt } from "../prompt/build-support-system-prompt";
import { getSourceReferenceDedupKey } from "../retrieval/build-rag-context";
import {
  type ConversationTurnMessage,
  type MavenStreamPart,
  type MavenTurnContext,
  type SupportAgentImage,
  type SupportPromptOptions,
  type SupportPromptSettings,
} from "../types";
import {
  buildMavenToolRegistry,
  type SafeToolActivity,
} from "../tools/build-maven-tool-registry";
import { createHttpToolDefinition } from "../tools/http-tool-executor";
import { createRequestTeamHelpTool } from "../tools/internal/request-team-help";
import { createSearchKnowledgeTool } from "../tools/internal/search-knowledge";

const MAX_COLLECTED_SOURCES = 5;
const MAX_TOOL_ACTIVITY_EVENTS = 32;

export interface MavenTurnDependencies {
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
  executionCtx: ExecutionContext;
  modelRuntime: ModelRuntimeState;
  createModel?: (config: ModelRuntimeState["activeConfig"]) => LanguageModel;
  toolService: ToolService;
  chatService: ChatService;
  projectService: ProjectService;
  telegramService?: TelegramService;
  projectName: string;
  settings: SupportPromptSettings;
  promptOptions?: Omit<SupportPromptOptions, "channel">;
  ragContext?: string;
  conversationSummary?: string | null;
  abortSignal?: AbortSignal;
  onTeamRequested(): void;
  broadcast(message: MessageRow): void;
}

export interface MavenTurnResult {
  fullStream: AsyncIterable<MavenStreamPart>;
  collectedSources: SourceReference[];
  toolActivity: SafeToolActivity[];
}

export async function runMavenTurn(options: {
  context: MavenTurnContext;
  dependencies: MavenTurnDependencies;
  conversationHistory: ConversationTurnMessage[];
  currentMessage: string;
  image?: SupportAgentImage | null;
}): Promise<MavenTurnResult> {
  const collectedSources: SourceReference[] = [];
  const collectedSourceKeys = new Set<string>();
  const toolActivity: SafeToolActivity[] = [];

  function collectSources(sources: SourceReference[]): void {
    if (collectedSources.length >= MAX_COLLECTED_SOURCES) return;
    for (const source of sources) {
      const key = getSourceReferenceDedupKey(source);
      if (collectedSourceKeys.has(key)) continue;
      collectedSourceKeys.add(key);
      collectedSources.push(source);
      if (collectedSources.length >= MAX_COLLECTED_SOURCES) return;
    }
  }

  function collectActivity(activity: SafeToolActivity): void {
    if (toolActivity.length >= MAX_TOOL_ACTIVITY_EVENTS) return;
    toolActivity.push(activity);
  }

  const httpTools = await options.dependencies.toolService.getEnabledToolsForChannel(
    options.context.projectId,
    options.context.channel,
  );
  const httpDefinitions = await Promise.all(
    httpTools.map((tool) =>
      createHttpToolDefinition({
        context: options.context,
        tool,
        toolService: options.dependencies.toolService,
        encryptionKey: options.dependencies.env.ENCRYPTION_KEY,
      }),
    ),
  );
  const definitions = [
    createSearchKnowledgeTool({
      env: options.dependencies.env,
      db: options.dependencies.db,
      context: options.context,
      collectSources,
    }),
    createRequestTeamHelpTool({
      context: options.context,
      chatService: options.dependencies.chatService,
      projectService: options.dependencies.projectService,
      telegramService: options.dependencies.telegramService,
      env: {
        BETTER_AUTH_URL: options.dependencies.env.BETTER_AUTH_URL,
        RESEND_API_KEY: options.dependencies.env.RESEND_API_KEY,
      },
      executionCtx: options.dependencies.executionCtx,
      onTeamRequested: options.dependencies.onTeamRequested,
      broadcast: options.dependencies.broadcast,
    }),
    ...httpDefinitions,
  ];
  const registry = buildMavenToolRegistry({
    context: options.context,
    definitions,
    onStart: collectActivity,
    onFinish: collectActivity,
  });
  const systemPrompt = buildSupportSystemPrompt(
    options.dependencies.settings,
    options.dependencies.projectName,
    options.dependencies.ragContext ?? "",
    options.dependencies.conversationSummary ?? null,
    {
      ...options.dependencies.promptOptions,
      channel: options.context.channel,
    },
  );
  const agentResult = await runWithModelFallback({
    runtime: options.dependencies.modelRuntime,
    stage: "maven_turn",
    operation: async (activeConfig) =>
      streamMavenAgent(
        {
          modelConfig: activeConfig,
          createModel: options.dependencies.createModel,
        },
        {
          systemPrompt,
          conversationHistory: options.conversationHistory,
          userMessage: options.currentMessage,
          image: options.image,
          tools: registry.tools,
          abortSignal: options.dependencies.abortSignal,
        },
      ),
  });

  return {
    fullStream: agentResult.fullStream,
    collectedSources,
    toolActivity,
  };
}
