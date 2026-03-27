import { CannedResponseService } from "../../services/canned-response-service";
import { ChatService } from "../../services/chat-service";
import { ProjectService } from "../../services/project-service";
import { AiService } from "../../services/ai-service";

export async function triggerAutoDraftIfEnabled(options: {
  projectId: string;
  conversationId: string;
  db: import("drizzle-orm/d1").DrizzleD1Database<Record<string, unknown>>;
  env: { AI_MODEL: string; GEMINI_API_KEY: string; OPENAI_API_KEY: string };
  kv: KVNamespace;
}): Promise<void> {
  const projectService = new ProjectService(options.db);
  const settings = await projectService.getSettings(options.projectId);
  if (!settings?.autoCannedDraft) return;

  const chatService = new ChatService(options.db, options.kv);
  const messages = await chatService.getMessages(options.conversationId);
  if (messages.length < 2) return;

  const aiService = new AiService({
    model: options.env.AI_MODEL,
    geminiApiKey: options.env.GEMINI_API_KEY,
    openaiApiKey: options.env.OPENAI_API_KEY,
  });

  aiService
    .generateCannedDraft(
      messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    )
    .then(async (draft) => {
      if (!draft) return;

      const cannedService = new CannedResponseService(options.db);
      await cannedService.createDraft(
        options.projectId,
        draft.trigger,
        draft.response,
        options.conversationId,
      );
    })
    .catch(() => {
      // Ignore background draft failures.
    });
}
