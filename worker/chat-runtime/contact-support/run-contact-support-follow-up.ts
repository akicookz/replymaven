import { type DrizzleD1Database } from "drizzle-orm/d1";
import type {
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
import { logWarn } from "../../observability";
import { normalizeConversationHistory } from "../orchestration/normalize-history";
import { runMavenTurn } from "../orchestration/run-maven-turn";
import { buildSupportTurnOpening } from "../prompt/sections";
import {
  createStreamingStripState,
  flushStreamingStripState,
  stripInternalTokensStreaming,
} from "../streaming/internal-tokens";
import {
  type MavenStreamPart,
  type SupportPromptSettings,
} from "../types";
import { buildContactFallbackMessage } from "./contact-support";

export interface ContactSupportFollowUpOptions {
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
  executionCtx: ExecutionContext;
  chatService: PublicConversationStore;
  projectService: ProjectService;
  project: { id: string; userId: string; name: string };
  settings: (SupportPromptSettings & Record<string, unknown>) | null;
  conversation: PublicConversationRecord;
  formMessage: string;
  isFirstVisitorTurn: boolean;
  isReturningVisitor: boolean;
  mode?: "contact_support" | "pending_review_email";
}

function getMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
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

// The route responds before this runs; deliver the reply through the child so
// a connected widget receives it over its live agent session.
export async function runContactSupportFollowUp(
  options: ContactSupportFollowUpOptions,
): Promise<PublicMessageRecord | null> {
  const { db, env, conversation, project, settings } = options;
  const mode = options.mode ?? "contact_support";
  const logContext = {
    projectId: project.id,
    conversationId: conversation.id,
  };
  // Ownership snapshot from right after team_requested; a human joining while
  // the model composes advances the chat state and voids the append below.
  const ownershipSnapshot = {
    status: conversation.status,
    chatState: JSON.stringify(conversation.chatState),
  };
  const turnContext = {
    kind: mode === "contact_support" ? "contact_support" : "standard",
    isFirstVisitorTurn: options.isFirstVisitorTurn,
    isReturningVisitor: options.isReturningVisitor,
  } as const;
  const visitorInfo = {
    name: conversation.visitorName,
    email: conversation.visitorEmail,
  };
  const modelRuntime = createModelRuntimeState({
    model: env.AI_MODEL,
    geminiApiKey: env.GEMINI_API_KEY || null,
    openaiApiKey: env.OPENAI_API_KEY || null,
  });

  let responseOpening = "";
  if (mode === "contact_support") {
    const baseOpening = buildSupportTurnOpening(turnContext, visitorInfo);
    const timingMessage = fallbackRenderContactTimingMessage();
    responseOpening = `${baseOpening}${timingMessage}\n\n`;
  }
  if (mode === "contact_support" && settings?.avgResponseTime?.trim()) {
    try {
      const timingMessage = await runWithModelFallback({
        runtime: modelRuntime,
        stage: "render_contact_timing",
        operation: (config) =>
          renderContactTimingMessage(createLanguageModel(config), {
            nowMs: Date.now(),
            currentMessage: options.formMessage,
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
      const baseOpening = buildSupportTurnOpening(turnContext, visitorInfo);
      responseOpening = `${baseOpening}${timingMessage}\n\n`;
    } catch (error) {
      logWarn("contact_follow_up.timing_fallback", {
        ...logContext,
        error: error instanceof Error ? error.message : String(error),
      });
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
      currentMessage: options.formMessage,
      persistedCurrentMessage: options.formMessage,
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
          aiParticipation: "assist_until_agent",
          escalated: true,
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
      currentMessage: options.formMessage,
    });
    const visibleText = await collectVisibleText(turn.fullStream);
    sources = turn.collectedSources.map((source) => ({
      title: source.title,
      url: source.url ?? null,
      type: source.type,
    }));
    if (visibleText) {
      content = `${responseOpening}${visibleText}`;
    } else if (mode === "contact_support") {
      content = buildContactFallbackMessage(responseOpening);
    } else {
      content = null;
    }
    if (!visibleText) sources = [];
  } catch (error) {
    logWarn("contact_follow_up.turn_failed", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
    content = mode === "contact_support"
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
    logWarn("contact_follow_up.skipped_ownership_changed", logContext);
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
