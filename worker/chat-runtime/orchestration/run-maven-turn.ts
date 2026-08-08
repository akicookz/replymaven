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
  modelRuntime: ModelRuntimeState;
  createModel?: (config: ModelRuntimeState["activeConfig"]) => LanguageModel;
  toolService: ToolService;
  projectName: string;
  settings: SupportPromptSettings;
  promptOptions?: Omit<SupportPromptOptions, "channel">;
  ragContext?: string;
  conversationSummary?: string | null;
  abortSignal?: AbortSignal;
  publicToolDependencies?: MavenPublicToolDependencies;
}

export interface MavenPublicToolDependencies {
  executionCtx: ExecutionContext;
  chatService: ChatService;
  projectService: ProjectService;
  telegramService?: TelegramService;
  onTeamRequested(): void;
  broadcast(message: MessageRow): void;
}

export interface MavenTurnResult {
  fullStream: AsyncIterable<MavenStreamPart>;
  collectedSources: SourceReference[];
  toolActivity: SafeToolActivity[];
}

function isStreamError(part: MavenStreamPart): part is MavenStreamPart & {
  error: unknown;
} {
  return part.type === "error" && "error" in part;
}

function isVisibleText(part: MavenStreamPart): boolean {
  return part.type === "text-delta" &&
    typeof part.text === "string" &&
    part.text.length > 0;
}

function isToolCommitment(part: MavenStreamPart): boolean {
  return part.type === "tool-call" ||
    part.type === "tool-result" ||
    part.type === "tool-error";
}

async function primeAgentStream(options: {
  result: Awaited<ReturnType<typeof streamMavenAgent>>;
  onVisibleText(): void;
  onToolCommitment(): void;
}): Promise<Awaited<ReturnType<typeof streamMavenAgent>>> {
  const iterator = options.result.fullStream[Symbol.asyncIterator]();
  const bufferedParts: MavenStreamPart[] = [];

  while (true) {
    const next = await iterator.next();
    if (next.done) break;

    const part = next.value;
    if (isStreamError(part)) throw part.error;
    bufferedParts.push(part);

    if (isVisibleText(part)) {
      options.onVisibleText();
      break;
    }
    if (isToolCommitment(part)) {
      options.onToolCommitment();
      break;
    }
  }

  async function* replayPrimedStream(): AsyncGenerator<MavenStreamPart> {
    yield* bufferedParts;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }

  return { fullStream: replayPrimedStream() };
}

function requirePublicToolDependencies(
  dependencies: MavenTurnDependencies,
): MavenPublicToolDependencies {
  if (!dependencies.publicToolDependencies) {
    throw new Error("Public Maven turns require public tool dependencies");
  }
  return dependencies.publicToolDependencies;
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
  let visibleTextStarted = false;
  let toolExecutionCommitted = false;

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
    ...httpDefinitions,
  ];
  if (options.context.channel === "public") {
    const publicDependencies = requirePublicToolDependencies(
      options.dependencies,
    );
    definitions.splice(
      1,
      0,
      createRequestTeamHelpTool({
        context: options.context,
        chatService: publicDependencies.chatService,
        projectService: publicDependencies.projectService,
        telegramService: publicDependencies.telegramService,
        env: {
          BETTER_AUTH_URL: options.dependencies.env.BETTER_AUTH_URL,
          RESEND_API_KEY: options.dependencies.env.RESEND_API_KEY,
        },
        executionCtx: publicDependencies.executionCtx,
        onTeamRequested: publicDependencies.onTeamRequested,
        broadcast: publicDependencies.broadcast,
      }),
    );
  }
  const registry = buildMavenToolRegistry({
    context: options.context,
    definitions,
    onStart(activity) {
      toolExecutionCommitted = true;
      collectActivity(activity);
    },
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
    canRetry: () => !visibleTextStarted && !toolExecutionCommitted,
    getRetryContext: () => ({
      visibleTextStarted,
      toolExecutionCommitted,
    }),
    operation: async (activeConfig) => {
      const result = await streamMavenAgent(
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
      );
      return primeAgentStream({
        result,
        onVisibleText() {
          visibleTextStarted = true;
        },
        onToolCommitment() {
          toolExecutionCommitted = true;
        },
      });
    },
  });

  return {
    fullStream: agentResult.fullStream,
    collectedSources,
    toolActivity,
  };
}
