import { type DrizzleD1Database } from "drizzle-orm/d1";
import type { PublicConversationStore } from "../conversations/public-conversation-store";
import { parseAgentBotNameCommand } from "../chat-runtime/routing/public-turn-gates";
import type { ProjectSettingsRow } from "../db";
import type { AppEnv } from "../types";
import { AiService } from "./ai-service";
import {
  applyBotNameCommand,
  type ApplyBotNameCommandDeps,
} from "./apply-bot-name-command";
import type { BotNameDecision } from "./bot-name-decision";
import { emailLastAgentReply } from "./email-last-reply";
import { EmailService } from "./email-service";
import { recordMavenAssignment } from "./maven-assignment";
import { ProjectService } from "./project-service";
import { WidgetService } from "./widget-service";
import {
  startSidechatTurn,
  type BotNameCommandOrigin,
} from "./start-sidechat-turn";
import { VisitorBanService } from "./visitor-ban-service";

const BARE_HANDBACK_DECISION: BotNameDecision = {
  ownership: "ai",
  instructions: "clear",
  speak: "silent",
  effect: "none",
  investigate: "none",
  email: "none",
  reason: null,
};

const DEFAULT_DIRECTED_SETTINGS = {
  toneOfVoice: "professional" as const,
  customTonePrompt: null,
  companyContext: null,
  botName: null,
  agentName: null,
  workingHours: null,
  avgResponseTime: null,
};

interface BotNameCommandEnv {
  AI_MODEL: string;
  GEMINI_API_KEY: string;
  OPENAI_API_KEY: string;
  MAVEN_PROJECT_AGENT: AppEnv["MAVEN_PROJECT_AGENT"];
  RESEND_API_KEY: string;
  BETTER_AUTH_URL: string;
}

interface BotNameCommandConversation {
  id: string;
  visitorId: string;
  visitorEmail: string | null;
  metadata: Record<string, unknown>;
}

export async function executeChannelBotNameCommand(input: {
  text: string;
  botName: string | null | undefined;
  actorName: string | null;
  commandId: string;
  now: number;
  projectId: string;
  conversation: BotNameCommandConversation;
  chatService: PublicConversationStore;
  db: DrizzleD1Database<Record<string, unknown>>;
  env: BotNameCommandEnv;
  projectSettings: ProjectSettingsRow | null;
  projectName: string;
  actorUserId: string;
  origin: BotNameCommandOrigin;
}): Promise<
  | { handled: false }
  | { handled: true; confirmation: string; handedToAi: boolean }
> {
  const command = parseAgentBotNameCommand(input.text, input.botName);
  if (!command.isCommand) return { handled: false };

  const aiService = new AiService({
    model: input.env.AI_MODEL,
    geminiApiKey: input.env.GEMINI_API_KEY,
    openaiApiKey: input.env.OPENAI_API_KEY,
  });
  const decision = command.commandText
    ? await aiService.interpretBotNameCommand(command.commandText)
    : BARE_HANDBACK_DECISION;
  const applied = await applyBotNameCommand({
    rawAgentText: command.commandText,
    decision,
    metadata: input.conversation.metadata,
    now: input.now,
    commandId: input.commandId,
    origin: input.origin,
    deps: createBotNameCommandDeps(input, aiService),
  });
  if (applied.handedToAi) {
    await recordMavenAssignment({
      chatService: input.chatService,
      conversationId: input.conversation.id,
      projectId: input.projectId,
      botName: input.botName,
      actorName: input.actorName,
      reason: "manual",
    });
  }
  return {
    handled: true,
    confirmation: applied.confirmation,
    handedToAi: applied.handedToAi,
  };
}

function createBotNameCommandDeps(
  input: {
    projectId: string;
    conversation: BotNameCommandConversation;
    chatService: PublicConversationStore;
    db: DrizzleD1Database<Record<string, unknown>>;
    env: BotNameCommandEnv;
    projectSettings: ProjectSettingsRow | null;
    projectName: string;
    actorName: string | null;
    actorUserId: string;
    origin: BotNameCommandOrigin;
  },
  aiService: AiService,
): ApplyBotNameCommandDeps {
  const { projectId, conversation, chatService } = input;
  return {
    async transitionChatOwnership(event) {
      const result = await chatService.transitionOwnership({
        projectId,
        conversationId: conversation.id,
        event,
      });
      return result.conversation
        ? {
            status: result.conversation.status,
            chatState: JSON.stringify(result.conversation.chatState),
          }
        : null;
    },
    async takeHumanOwnership() {
      return chatService.takeHumanOwnership(projectId, conversation.id);
    },
    async updateConversation(fields) {
      await chatService.updateConversation(conversation.id, projectId, fields);
    },
    async updateConversationStatus(status, closeReason) {
      await chatService.setStatus(
        projectId,
        conversation.id,
        status,
        closeReason,
      );
    },
    async closeOpenConversationsAsSpam() {
      await chatService.closeOpenAsSpam(
        projectId,
        conversation.visitorId,
        conversation.visitorEmail,
      );
    },
    async banVisitor(reason) {
      await new VisitorBanService(input.db).banVisitor({
        projectId,
        visitorId: conversation.visitorId,
        visitorEmail: conversation.visitorEmail,
        reason,
        bannedBy: "agent",
        bannedFromConversationId: conversation.id,
        expiresAt: null,
      });
    },
    async generateDirectedResponse(instruction) {
      const msgs = await chatService.getMessages(
        projectId,
        conversation.id,
      );
      return aiService.generateDirectedResponse(
        input.projectSettings ?? DEFAULT_DIRECTED_SETTINGS,
        input.projectName,
        msgs
          .filter((entry) => entry.author !== "bot" || entry.content)
          .slice(-20)
          .map((entry) => ({
            role: entry.author,
            content: entry.content,
          })),
        instruction,
      );
    },
    async addPublicBotMessage(fields) {
      const botMessage = await chatService.addPublicBotMessageIfOwnershipMatches(
        {
          conversationId: conversation.id,
          content: fields.content,
          senderName: input.projectSettings?.botName ?? null,
        },
        projectId,
        fields.expected,
      );
      return Boolean(botMessage);
    },
    async startSidechatTurn(fields) {
      return startSidechatTurn({
        projectId,
        conversationId: conversation.id,
        text: fields.text,
        actorUserId: input.actorUserId,
        origin: input.origin,
        env: input.env,
      });
    },
    async emailLastReply() {
      const [project, widgetCfg] = await Promise.all([
        new ProjectService(input.db).getProjectById(projectId),
        new WidgetService(input.db).getWidgetConfig(projectId),
      ]);
      const base = input.env.BETTER_AUTH_URL || "https://replymaven.com";
      return emailLastAgentReply({
        chatService,
        emailService: new EmailService(input.env.RESEND_API_KEY),
        projectId,
        projectSlug: project?.slug ?? "support",
        projectName: input.projectName,
        conversationId: conversation.id,
        visitorEmail: conversation.visitorEmail,
        actorName: input.actorName,
        dashboardUrl: `${base}/app/projects/${projectId}/conversations/${conversation.id}`,
        accentColor: widgetCfg?.primaryColor ?? null,
      });
    },
  };
}
