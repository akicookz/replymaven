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
import {
  createStreamingStripState,
  flushStreamingStripState,
  stripInternalTokensStreaming,
} from "../streaming/internal-tokens";
import {
  fallbackAiParticipationForStatus,
  parseChatState,
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
  isNewConversation: boolean;
  channel?: ConversationChannel;
  aiParticipation?: AiParticipation;
  /**
   * "contact_support" hands the model today's reply expectation and falls back
   * to a holding message when the model produces nothing. Standard turns stay
   * silent instead.
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

interface OwnershipSnapshot {
  status: ChannelTurnOptions["conversation"]["status"];
  chatState: string;
}

// This turn's own request_team_help moves ownership one step to
// waiting_agent; its reply still belongs in the thread (same rule as the
// widget's decidePublicPostTurn). Anything else keeps the original snapshot,
// so the append is refused.
async function ownershipAfterOwnTeamRequest(
  options: ChannelTurnOptions,
  snapshot: OwnershipSnapshot,
): Promise<OwnershipSnapshot> {
  const current = await options.chatService.getOperational(
    options.project.id,
    options.conversation.id,
  );
  if (!current) return snapshot;
  const before = parseChatState(snapshot.chatState, {
    fallbackAiParticipation: fallbackAiParticipationForStatus(snapshot.status),
  });
  const now = parseChatState(JSON.stringify(current.chatState), {
    fallbackAiParticipation: fallbackAiParticipationForStatus(current.status),
  });
  const accepted = current.status === "waiting_agent" &&
    now.aiParticipation === "assist_until_agent" &&
    now.ownershipRevision === before.ownershipRevision + 1;
  return accepted
    ? { status: current.status, chatState: JSON.stringify(current.chatState) }
    : snapshot;
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
  const ownershipSnapshot: OwnershipSnapshot = {
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

  // Rendered up front so the compose model can weave today's expectation into
  // its own sentences. It is never prepended to the reply.
  let contactTimingMessage: string | null = null;
  if (turnKind === "contact_support") {
    if (settings?.avgResponseTime?.trim() || settings?.workingHours?.trim()) {
      try {
        contactTimingMessage = await runWithModelFallback({
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
      } catch (error) {
        logWarn("channel_turn.timing_fallback", {
          ...logContext,
          error: error instanceof Error ? error.message : String(error),
        });
        contactTimingMessage = fallbackRenderContactTimingMessage();
      }
    } else {
      contactTimingMessage = fallbackRenderContactTimingMessage();
    }
  }

  const turnContext = {
    kind: turnKind,
    isNewConversation: options.isNewConversation,
    contactTimingMessage,
  } as const;

  let content: string | null;
  let sources: PublicSourceReference[] = [];
  let teamRequested = false;
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
          timeContext: {
            nowMs: Date.now(),
            conversationHistory,
            visitorTimezone: getMetadataString(
              conversation.metadata,
              "timezone",
            ),
          },
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
          onTeamRequested() {
            teamRequested = true;
          },
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
      content = visibleText;
    } else if (turnKind === "contact_support") {
      content = buildContactFallbackMessage(contactTimingMessage);
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
      ? buildContactFallbackMessage(contactTimingMessage)
      : null;
    sources = [];
  }
  if (!content) return null;

  const expectedOwnership = teamRequested
    ? await ownershipAfterOwnTeamRequest(options, ownershipSnapshot)
    : ownershipSnapshot;
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
      expectedOwnership,
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
