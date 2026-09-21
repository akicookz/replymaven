import { type DrizzleD1Database } from "drizzle-orm/d1";
import type {
  ConversationChannel,
  PublicConversationRecord,
  PublicMessageRecord,
  PublicSourceReference,
} from "../../../shared/maven-conversation";
import { type PublicConversationStore } from "../../conversations/public-conversation-store";
import { BillingService } from "../../services/billing-service";
import { GuidelineService } from "../../services/guideline-service";
import { type ProjectService } from "../../services/project-service";
import { TelegramService } from "../../services/telegram-service";
import { SlackService } from "../../services/slack-service";
import { ToolService } from "../../services/tool-service";
import { type AppEnv } from "../../types";
import {
  createLanguageModel,
  createModelRuntimeState,
  runWithModelFallback,
} from "../llm/create-language-model";
import {
  fallbackRenderContactTimingMessage,
  renderContactTimingMessage,
} from "../llm/render-contact-timing-message";
import { buildContactFallbackMessage } from "../contact-support/contact-support";
import { buildSupportTurnOpening } from "../prompt/sections";
import {
  createStreamingStripState,
  flushStreamingStripState,
  stripInternalTokensStreaming,
} from "../streaming/internal-tokens";
import {
  type AiParticipation,
  type MavenStreamPart,
  type SupportPromptSettings,
} from "../types";
import { logWarn } from "../../observability";
import { normalizeConversationHistory } from "./normalize-history";
import { runMavenTurn } from "./run-maven-turn";

export interface ChannelTurnOptions {
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
  executionCtx: ExecutionContext;
  chatService: PublicConversationStore;
  projectService: ProjectService;
  project: { id: string; userId: string; name: string };
  settings: (SupportPromptSettings & Record<string, unknown>) | null;
  conversation: PublicConversationRecord;
  currentMessage: string;
  isFirstVisitorTurn: boolean;
  isReturningVisitor: boolean;
  channel?: ConversationChannel;
  aiParticipation?: AiParticipation;
  /**
   * "contact_support" opens with a greeting and a response-time line, and
   * falls back to a holding message when the model produces nothing. Standard
   * turns stay silent instead.
   */
  turnKind?: "standard" | "contact_support";
}

async function collectVisibleText(
  stream: AsyncIterable<MavenStreamPart>,
): Promise<string> {
  const stripState = createStreamingStripState();
  let text = "";
  for await (const part of stream) {
    if (part.type !== "text-delta" || typeof part.text !== "string") continue;
    const stripped = stripInternalTokensStreaming(stripState, part.text);
    if (stripped.emit) text += stripped.emit;
  }
  const flushed = flushStreamingStripState(stripState);
  if (flushed.emit) text += flushed.emit;
  return text.trim();
}

function getMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export async function runChannelTurn(
  options: ChannelTurnOptions,
): Promise<PublicMessageRecord | null> {
  const { db, env, conversation, project, settings } = options;
  const channel = options.channel ?? "widget";
  const logContext = {
    projectId: project.id,
    conversationId: conversation.id,
  };
  const ownershipSnapshot = {
    status: conversation.status,
    chatState: JSON.stringify(conversation.chatState),
  };
  const aiParticipation = options.aiParticipation ?? "continuous";
  const visitorInfo = {
    name: conversation.visitorName,
    email: conversation.visitorEmail,
  };
  const modelRuntime = createModelRuntimeState({
    model: env.AI_MODEL,
    geminiApiKey: env.GEMINI_API_KEY || null,
    openaiApiKey: env.OPENAI_API_KEY || null,
  });

  const turnKind = options.turnKind ?? "standard";
  const turnContext = {
    kind: turnKind,
    isFirstVisitorTurn: options.isFirstVisitorTurn,
    isReturningVisitor: options.isReturningVisitor,
  } as const;

  let responseOpening = "";
  if (turnKind === "contact_support") {
    const baseOpening = buildSupportTurnOpening(turnContext, visitorInfo);
    responseOpening = `${baseOpening}${fallbackRenderContactTimingMessage()}\n\n`;
    if (settings?.avgResponseTime?.trim()) {
      try {
        const timingMessage = await runWithModelFallback({
          runtime: modelRuntime,
          stage: "render_contact_timing",
          operation: (config) =>
            renderContactTimingMessage(createLanguageModel(config), {
              nowMs: Date.now(),
              currentMessage: options.currentMessage,
              workingHours: settings.workingHours,
              avgResponseTime: settings.avgResponseTime,
              companyContext: settings.companyContext,
              visitorLocation: {
                timezone: getMetadataString(conversation.metadata, "timezone"),
                city: getMetadataString(conversation.metadata, "city"),
                region: getMetadataString(conversation.metadata, "region"),
                country: getMetadataString(conversation.metadata, "country"),
              },
            }, { throwOnModelError: true }),
          logContext,
        });
        responseOpening = `${baseOpening}${timingMessage}\n\n`;
      } catch (error) {
        logWarn("channel_turn.timing_fallback", {
          ...logContext,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  let content: string | null;
  let sources: PublicSourceReference[] = [];
  try {
    const rawHistory = (
      await options.chatService.getMessages(project.id, conversation.id)
    ).map((message) => ({
      role: message.author,
      content: message.content,
      createdAt: message.createdAt,
    }));
    const conversationHistory = normalizeConversationHistory({
      rawHistory,
      currentMessage: options.currentMessage,
      persistedCurrentMessage: options.currentMessage,
    });
    const guidelines = await new GuidelineService(db).getEnabledByProject(
      project.id,
    );
    let toolPermits = 0;
    const turn = await runMavenTurn({
      context: {
        channel: "public",
        projectId: project.id,
        conversationId: conversation.id,
        actorUserId: null,
        customerId: conversation.customerId,
        ownership: ownershipSnapshot,
      },
      dependencies: {
        db,
        env,
        modelRuntime,
        toolService: new ToolService(db),
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
        promptOptions: {
          channel,
          guidelines: guidelines.map((guideline) => ({
            condition: guideline.condition,
            instruction: guideline.instruction,
          })),
          agentHandbackInstructions: getMetadataString(
            conversation.metadata,
            "agentHandbackInstructions",
          ),
          visitorInfo,
          timeContext: { nowMs: Date.now(), conversationHistory },
          turnContext,
          aiParticipation,
          escalated: turnKind === "contact_support" ||
            conversation.status === "waiting_agent",
        },
        publicToolDependencies: {
          executionCtx: options.executionCtx,
          chatService: options.chatService,
          projectService: options.projectService,
          telegramService: new TelegramService(db, env.ENCRYPTION_KEY),
          slackService: new SlackService(db, env.ENCRYPTION_KEY),
          acquireHttpRateLimitPermit: () => (toolPermits += 1) <= 100,
          onTeamRequested() {},
        },
      },
      conversationHistory,
      currentMessage: options.currentMessage,
    });
    const visibleText = await collectVisibleText(turn.fullStream);
    sources = turn.collectedSources.map((source) => ({
      title: source.title,
      url: source.url ?? null,
      type: source.type,
    }));
    if (visibleText) {
      content = `${responseOpening}${visibleText}`;
    } else if (turnKind === "contact_support") {
      content = buildContactFallbackMessage(responseOpening);
    } else {
      content = null;
    }
    if (!visibleText) sources = [];
  } catch (error) {
    logWarn("channel_turn.turn_failed", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
    content = turnKind === "contact_support"
      ? buildContactFallbackMessage(responseOpening)
      : null;
    sources = [];
  }
  if (!content) return null;

  const botMessage = await options.chatService
    .addPublicBotMessageIfOwnershipMatches(
      {
        conversationId: conversation.id,
        content,
        sources: sources.length > 0 ? JSON.stringify(sources) : null,
        senderName: typeof settings?.botName === "string"
          ? settings.botName
          : null,
      },
      project.id,
      ownershipSnapshot,
    );
  if (!botMessage) {
    logWarn("channel_turn.skipped_ownership_changed", logContext);
    return null;
  }

  const billingService = new BillingService(db, env);
  const subscription = await billingService.getSubscriptionByUserId(
    project.userId,
  );
  await billingService.incrementMessageUsageOnce(
    botMessage.id,
    project.userId,
    subscription,
  );
  return botMessage;
}
