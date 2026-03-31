import { CannedResponseService } from "../../services/canned-response-service";
import { ChatService } from "../../services/chat-service";
import { ProjectService } from "../../services/project-service";
import { AiService } from "../../services/ai-service";
import { logError, logInfo } from "../../observability";

export async function triggerAutoDraftIfEnabled(options: {
  projectId: string;
  conversationId: string;
  db: import("drizzle-orm/d1").DrizzleD1Database<Record<string, unknown>>;
  env: { AI_MODEL: string; GEMINI_API_KEY: string; OPENAI_API_KEY: string };
  kv: KVNamespace;
  source?: string;
}): Promise<void> {
  const source = options.source ?? "unknown";
  const projectService = new ProjectService(options.db);
  const settings = await projectService.getSettings(options.projectId);
  if (!settings?.autoCannedDraft) {
    logInfo("auto_draft.skipped", {
      projectId: options.projectId,
      conversationId: options.conversationId,
      source,
      reason: "disabled",
    });
    return;
  }

  const chatService = new ChatService(options.db, options.kv);
  const messages = await chatService.getMessages(options.conversationId);
  if (messages.length < 2) {
    logInfo("auto_draft.skipped", {
      projectId: options.projectId,
      conversationId: options.conversationId,
      source,
      reason: "insufficient_messages",
      messageCount: messages.length,
    });
    return;
  }

  const aiService = new AiService({
    model: options.env.AI_MODEL,
    geminiApiKey: options.env.GEMINI_API_KEY,
    openaiApiKey: options.env.OPENAI_API_KEY,
  });

  logInfo("auto_draft.started", {
    projectId: options.projectId,
    conversationId: options.conversationId,
    source,
    messageCount: messages.length,
    model: options.env.AI_MODEL,
  });

  aiService
    .generateCannedDraft(
      messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    )
    .then(async (draft) => {
      if (!draft) {
        logInfo("auto_draft.skipped", {
          projectId: options.projectId,
          conversationId: options.conversationId,
          source,
          reason: "no_draft_generated",
          messageCount: messages.length,
        });
        return;
      }

      logInfo("auto_draft.generated", {
        projectId: options.projectId,
        conversationId: options.conversationId,
        source,
        triggerLength: draft.trigger.length,
        responseLength: draft.response.length,
      });

      const cannedService = new CannedResponseService(options.db);
      const savedDraft = await cannedService.createDraft(
        options.projectId,
        draft.trigger,
        draft.response,
        options.conversationId,
      );

      logInfo("auto_draft.saved", {
        projectId: options.projectId,
        conversationId: options.conversationId,
        cannedResponseId: savedDraft.id,
        source,
        triggerLength: draft.trigger.length,
        responseLength: draft.response.length,
      });
    })
    .catch((error) => {
      logError("auto_draft.failed", error, {
        projectId: options.projectId,
        conversationId: options.conversationId,
        source,
        messageCount: messages.length,
        model: options.env.AI_MODEL,
      });
    });
}
