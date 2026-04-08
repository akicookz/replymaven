import { KnowledgeSuggestionService } from "../../services/knowledge-suggestion-service";
import { ChatService } from "../../services/chat-service";
import { ProjectService } from "../../services/project-service";
import { GuidelineService } from "../../services/guideline-service";
import { AiService } from "../../services/ai-service";
import { logError, logInfo } from "../../observability";
import { type FaqPair } from "../../services/resource-service";

export async function triggerAutoRefinementIfEnabled(options: {
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
  if (!settings?.autoRefinement) {
    logInfo("auto_refine.skipped", {
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
    logInfo("auto_refine.skipped", {
      projectId: options.projectId,
      conversationId: options.conversationId,
      source,
      reason: "insufficient_messages",
      messageCount: messages.length,
    });
    return;
  }

  // Load existing knowledge context for the AI to compare against
  const guidelineService = new GuidelineService(options.db);
  const enabledGuidelines = await guidelineService.getEnabledByProject(
    options.projectId,
  );

  // We need an R2 bucket for ResourceService, but we don't have it here.
  // Instead, load FAQ resources directly from D1 (content column has JSON pairs).
  const { resources } = await import("../../db/schema");
  const { eq, and } = await import("drizzle-orm");
  const faqResources = await options.db
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.projectId, options.projectId),
        eq(resources.type, "faq"),
      ),
    );

  const faqResourcesWithPairs = faqResources
    .filter((r) => r.content)
    .map((r) => {
      let pairs: FaqPair[] = [];
      try {
        pairs = JSON.parse(r.content!) as FaqPair[];
      } catch {
        pairs = [];
      }
      return { id: r.id, title: r.title, pairs };
    });

  const aiService = new AiService({
    model: options.env.AI_MODEL,
    geminiApiKey: options.env.GEMINI_API_KEY,
    openaiApiKey: options.env.OPENAI_API_KEY,
  });

  logInfo("auto_refine.started", {
    projectId: options.projectId,
    conversationId: options.conversationId,
    source,
    messageCount: messages.length,
    faqCount: faqResourcesWithPairs.length,
    guidelineCount: enabledGuidelines.length,
    model: options.env.AI_MODEL,
  });

  try {
    const suggestions = await aiService.generateKnowledgeRefinement(
      messages.map((m) => ({ role: m.role, content: m.content })),
      {
        companyContext: settings.companyContext,
        faqResources: faqResourcesWithPairs,
        guidelines: enabledGuidelines.map((g) => ({
          id: g.id,
          condition: g.condition,
          instruction: g.instruction,
        })),
      },
    );

    if (!suggestions || suggestions.length === 0) {
      logInfo("auto_refine.skipped", {
        projectId: options.projectId,
        conversationId: options.conversationId,
        source,
        reason: "no_suggestions",
        messageCount: messages.length,
      });
      return;
    }

    logInfo("auto_refine.generated", {
      projectId: options.projectId,
      conversationId: options.conversationId,
      source,
      suggestionCount: suggestions.length,
      types: suggestions.map((s) => s.type),
    });

    const suggestionService = new KnowledgeSuggestionService(options.db);
    for (const s of suggestions) {
      const saved = await suggestionService.create({
        projectId: options.projectId,
        type: s.type,
        status: "pending",
        targetResourceId: s.targetResourceId ?? null,
        targetGuidelineId: s.targetGuidelineId ?? null,
        sourceConversationId: options.conversationId,
        suggestion: JSON.stringify(s.suggestion),
        reasoning: s.reasoning,
      });

      logInfo("auto_refine.saved", {
        projectId: options.projectId,
        conversationId: options.conversationId,
        suggestionId: saved.id,
        type: s.type,
        source,
      });
    }
  } catch (error) {
    logError("auto_refine.failed", error, {
      projectId: options.projectId,
      conversationId: options.conversationId,
      source,
      messageCount: messages.length,
      model: options.env.AI_MODEL,
    });
  }
}
