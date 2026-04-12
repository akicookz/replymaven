import { type DrizzleD1Database } from "drizzle-orm/d1";
import {
  buildSuggestionFingerprint,
  isSemanticallyDuplicate,
  KnowledgeSuggestionService,
  type SuggestionType,
} from "../../services/knowledge-suggestion-service";
import { ChatService } from "../../services/chat-service";
import { ProjectService } from "../../services/project-service";
import { GuidelineService } from "../../services/guideline-service";
import {
  AiService,
  type KnowledgeRefinementPlan,
  type KnowledgeRefinementSuggestion,
} from "../../services/ai-service";
import { logError, logInfo } from "../../observability";
import { ResourceService, type FaqPair } from "../../services/resource-service";
import { type AppEnv } from "../../types";
import {
  buildRelevantContentSnippet,
  selectRefinementShortlist,
} from "./refinement-selection";

export async function triggerAutoRefinementIfEnabled(options: {
  projectId: string;
  conversationId: string;
  db: DrizzleD1Database<Record<string, unknown>>;
  env: Pick<
    AppEnv,
    "AI_MODEL" | "GEMINI_API_KEY" | "OPENAI_API_KEY" | "UPLOADS"
  >;
  kv: KVNamespace;
  source?: string;
}): Promise<void> {
  const source = options.source ?? "unknown";
  const projectService = new ProjectService(options.db);
  const suggestionService = new KnowledgeSuggestionService(options.db);

  const settings = await projectService.getSettings(options.projectId);
  const count = await suggestionService.getPendingCountsByProject(
    options.projectId,
  );

  if (!settings?.autoRefinement || count.total >= 10) {
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

  const resourceService = new ResourceService(options.db, options.env.UPLOADS);
  const guidelineService = new GuidelineService(options.db);
  const enabledGuidelines = await guidelineService.getEnabledByProject(
    options.projectId,
  );
  const resources = await resourceService.getResourcesByProject(
    options.projectId,
  );

  const faqResources = resources
    .filter((resource) => resource.type === "faq")
    .map((resource) => ({
      id: resource.id,
      title: resource.title,
      pairs: parseFaqPairs(resource.content),
    }));
  const pdfResources = resources
    .filter((resource) => resource.type === "pdf")
    .map((resource) => ({
      id: resource.id,
      title: resource.title,
      content: resource.content,
    }));
  const webpageResources = resources.filter(
    (resource) => resource.type === "webpage",
  );
  const webpageCandidates = (
    await Promise.all(
      webpageResources.map(async (resource) => {
        const pages = await resourceService.getCrawledPages(
          resource.id,
          options.projectId,
        );
        return pages
          .filter((page) => page.status === "crawled")
          .map((page) => ({
            pageId: page.id,
            resourceId: resource.id,
            resourceTitle: resource.title,
            pageTitle: page.pageTitle,
            url: page.url,
          }));
      }),
    )
  ).flat();

  const pendingSuggestions = await suggestionService.getPendingByProject(
    options.projectId,
  );

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
    faqCount: faqResources.length,
    guidelineCount: enabledGuidelines.length,
    pdfCount: pdfResources.length,
    webpageCount: webpageCandidates.length,
    pendingSuggestionCount: pendingSuggestions.length,
    model: options.env.AI_MODEL,
  });

  try {
    const conversationMessages = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const shortlist = selectRefinementShortlist({
      messages: conversationMessages,
      faqs: faqResources,
      sops: enabledGuidelines.map((guideline) => ({
        id: guideline.id,
        condition: guideline.condition,
        instruction: guideline.instruction,
      })),
      pdfs: pdfResources,
      webpages: webpageCandidates,
      pendingSuggestions: pendingSuggestions.map((suggestion) => ({
        id: suggestion.id,
        type: suggestion.type,
        summary: summarizePendingSuggestion(suggestion),
      })),
    });
    const plans = await aiService.planKnowledgeRefinement(
      conversationMessages,
      {
        companyContext: settings.companyContext,
        faqCandidates: shortlist.faqCandidates,
        guidelineCandidates: shortlist.sopCandidates,
        pdfCandidates: shortlist.pdfCandidates.map((pdf) => ({
          id: pdf.id,
          title: pdf.title,
          excerpt: buildRelevantContentSnippet(
            pdf.content ?? "",
            shortlist.conversationQuery,
            1200,
          ),
        })),
        webpageCandidates: shortlist.webpageCandidates,
        pendingSuggestions: shortlist.pendingSuggestions,
      },
    );

    if (!plans || plans.length === 0) {
      logInfo("auto_refine.skipped", {
        projectId: options.projectId,
        conversationId: options.conversationId,
        source,
        reason: "no_plans",
        messageCount: messages.length,
      });
      return;
    }

    logInfo("auto_refine.planned", {
      projectId: options.projectId,
      conversationId: options.conversationId,
      source,
      planCount: plans.length,
      types: plans.map((plan) => plan.type),
    });

    const existingFingerprints = new Set(
      pendingSuggestions.map((suggestion) =>
        buildSuggestionFingerprint({
          type: suggestion.type as SuggestionType,
          targetResourceId: suggestion.targetResourceId,
          targetGuidelineId: suggestion.targetGuidelineId,
          targetPageId: suggestion.targetPageId,
          suggestion: suggestion.suggestion,
        }),
      ),
    );
    const batchFingerprints = new Set<string>();
    const guidelineMap = new Map(
      enabledGuidelines.map((guideline) => [guideline.id, guideline]),
    );
    const faqMap = new Map(faqResources.map((faq) => [faq.id, faq]));
    const pdfMap = new Map(pdfResources.map((pdf) => [pdf.id, pdf]));
    const webpageMap = new Map(
      webpageCandidates.map((page) => [page.pageId, page]),
    );

    for (const plan of plans) {
      const generated = await generateSuggestionForPlan({
        aiService,
        conversationMessages,
        companyContext: settings.companyContext,
        conversationQuery: shortlist.conversationQuery,
        plan,
        faqMap,
        guidelineMap,
        pdfMap,
        webpageMap,
        resourceService,
        projectId: options.projectId,
      });
      if (!generated) continue;

      const fingerprint = buildSuggestionFingerprint({
        type: generated.type as SuggestionType,
        targetResourceId: generated.targetResourceId ?? null,
        targetGuidelineId: generated.targetGuidelineId ?? null,
        targetPageId: generated.targetPageId ?? null,
        suggestion: generated.suggestion,
      });

      if (
        existingFingerprints.has(fingerprint) ||
        batchFingerprints.has(fingerprint)
      ) {
        logInfo("auto_refine.skipped_duplicate", {
          projectId: options.projectId,
          conversationId: options.conversationId,
          type: generated.type,
          source,
          fingerprint,
        });
        continue;
      }

      if (
        isSemanticallyDuplicate(
          {
            type: generated.type,
            suggestion: generated.suggestion,
            reasoning: generated.reasoning,
          },
          pendingSuggestions.map((s) => ({
            type: s.type,
            suggestion: s.suggestion,
            reasoning: s.reasoning,
          })),
        )
      ) {
        logInfo("auto_refine.skipped_semantic_duplicate", {
          projectId: options.projectId,
          conversationId: options.conversationId,
          type: generated.type,
          source,
        });
        continue;
      }

      const saved = await suggestionService.create({
        projectId: options.projectId,
        type: generated.type,
        status: "pending",
        targetResourceId: generated.targetResourceId ?? null,
        targetGuidelineId: generated.targetGuidelineId ?? null,
        targetPageId: generated.targetPageId ?? null,
        sourceConversationId: options.conversationId,
        suggestion: JSON.stringify(generated.suggestion),
        reasoning: generated.reasoning,
      });
      batchFingerprints.add(fingerprint);

      logInfo("auto_refine.saved", {
        projectId: options.projectId,
        conversationId: options.conversationId,
        suggestionId: saved.id,
        type: generated.type,
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

async function generateSuggestionForPlan(options: {
  aiService: AiService;
  conversationMessages: Array<{ role: string; content: string }>;
  companyContext: string | null;
  conversationQuery: string;
  plan: KnowledgeRefinementPlan;
  faqMap: Map<string, { id: string; title: string; pairs: FaqPair[] }>;
  guidelineMap: Map<
    string,
    { id: string; condition: string; instruction: string }
  >;
  pdfMap: Map<string, { id: string; title: string; content: string | null }>;
  webpageMap: Map<
    string,
    {
      pageId: string;
      resourceId: string;
      resourceTitle: string;
      pageTitle: string | null;
      url: string;
    }
  >;
  resourceService: ResourceService;
  projectId: string;
}): Promise<KnowledgeRefinementSuggestion | null> {
  const plan = options.plan;
  const faqTarget = plan.targetResourceId
    ? options.faqMap.get(plan.targetResourceId)
    : undefined;
  const guidelineTarget = plan.targetGuidelineId
    ? options.guidelineMap.get(plan.targetGuidelineId)
    : undefined;
  const pdfTarget = plan.targetResourceId
    ? options.pdfMap.get(plan.targetResourceId)
    : undefined;
  const webpageTarget = plan.targetPageId
    ? options.webpageMap.get(plan.targetPageId)
    : undefined;

  const webpageExcerpt =
    plan.type === "update_webpage" && webpageTarget
      ? buildRelevantContentSnippet(
          (await options.resourceService.getCrawledPageContent(
            webpageTarget.pageId,
            webpageTarget.resourceId,
            options.projectId,
          )) ?? "",
          options.conversationQuery,
          2500,
        )
      : undefined;
  const pdfExcerpt =
    plan.type === "update_pdf" && pdfTarget
      ? buildRelevantContentSnippet(
          pdfTarget.content ?? "",
          options.conversationQuery,
          2500,
        )
      : undefined;

  const generated = await options.aiService.generateKnowledgeSuggestionPayload(
    options.conversationMessages,
    plan,
    {
      companyContext: options.companyContext,
      faqTarget,
      guidelineTarget,
      pdfTarget: pdfTarget
        ? {
            id: pdfTarget.id,
            title: pdfTarget.title,
            excerpt: pdfExcerpt ?? "",
          }
        : undefined,
      webpageTarget:
        webpageTarget && webpageExcerpt !== undefined
          ? {
              ...webpageTarget,
              excerpt: webpageExcerpt,
            }
          : undefined,
    },
  );
  if (!generated) return null;

  return sanitizeGeneratedSuggestion(generated, {
    faqTarget,
    guidelineTarget,
    pdfContent: pdfTarget?.content ?? "",
    webpageContent: webpageExcerpt,
  });
}

function sanitizeGeneratedSuggestion(
  suggestion: KnowledgeRefinementSuggestion,
  context: {
    faqTarget?: { title: string; pairs: FaqPair[] };
    guidelineTarget?: { condition: string; instruction: string };
    pdfContent?: string;
    webpageContent?: string;
  },
): KnowledgeRefinementSuggestion | null {
  switch (suggestion.type) {
    case "new_faq": {
      const title = getTrimmedString(suggestion.suggestion, "title");
      const pairs = sanitizeFaqPairs(
        (suggestion.suggestion.pairs as unknown[]) ?? [],
      );
      if (!title || pairs.length === 0) return null;
      return {
        ...suggestion,
        suggestion: { title, pairs },
      };
    }
    case "add_faq_pair": {
      const pair = suggestion.suggestion.pair as unknown;
      if (!pair || typeof pair !== "object") return null;
      const question = getTrimmedString(
        pair as Record<string, unknown>,
        "question",
      );
      const answer = getTrimmedString(
        pair as Record<string, unknown>,
        "answer",
      );
      if (!question || !answer) return null;
      return {
        ...suggestion,
        suggestion: { pair: { question, answer } },
      };
    }
    case "refine_faq_pair": {
      const originalPair = suggestion.suggestion.originalPair as unknown;
      const refinedPair = suggestion.suggestion.refinedPair as unknown;
      if (!originalPair || typeof originalPair !== "object") return null;
      if (!refinedPair || typeof refinedPair !== "object") return null;

      const origQuestion = getTrimmedString(
        originalPair as Record<string, unknown>,
        "question",
      );
      const origAnswer = getTrimmedString(
        originalPair as Record<string, unknown>,
        "answer",
      );
      const refQuestion = getTrimmedString(
        refinedPair as Record<string, unknown>,
        "question",
      );
      const refAnswer = getTrimmedString(
        refinedPair as Record<string, unknown>,
        "answer",
      );

      if (!origQuestion || !origAnswer || !refQuestion || !refAnswer)
        return null;
      if (origQuestion === refQuestion && origAnswer === refAnswer) return null;

      return {
        ...suggestion,
        suggestion: {
          originalPair: { question: origQuestion, answer: origAnswer },
          refinedPair: { question: refQuestion, answer: refAnswer },
        },
      };
    }
    case "new_sop": {
      const condition = getTrimmedString(suggestion.suggestion, "condition");
      const instruction = getTrimmedString(
        suggestion.suggestion,
        "instruction",
      );
      if (!condition || !instruction) return null;
      return {
        ...suggestion,
        suggestion: { condition, instruction },
      };
    }
    case "add_sop": {
      const condition = getTrimmedString(suggestion.suggestion, "condition");
      const instruction = getTrimmedString(
        suggestion.suggestion,
        "instruction",
      );
      if (!condition || !instruction) return null;
      return {
        ...suggestion,
        suggestion: { condition, instruction },
      };
    }
    case "refine_sop": {
      const originalCondition = getTrimmedString(
        suggestion.suggestion,
        "originalCondition",
      );
      const originalInstruction = getTrimmedString(
        suggestion.suggestion,
        "originalInstruction",
      );
      const refinedCondition = getTrimmedString(
        suggestion.suggestion,
        "refinedCondition",
      );
      const refinedInstruction = getTrimmedString(
        suggestion.suggestion,
        "refinedInstruction",
      );

      if (
        !originalCondition ||
        !originalInstruction ||
        !refinedCondition ||
        !refinedInstruction
      )
        return null;
      if (
        originalCondition === refinedCondition &&
        originalInstruction === refinedInstruction
      )
        return null;

      return {
        ...suggestion,
        suggestion: {
          originalCondition,
          originalInstruction,
          refinedCondition,
          refinedInstruction,
        },
      };
    }
    case "update_pdf":
    case "update_webpage": {
      const mode = getTrimmedString(suggestion.suggestion, "mode");
      if (mode === "append") {
        const appendText = getTrimmedString(
          suggestion.suggestion,
          "appendText",
        );
        if (!appendText) return null;
        return {
          ...suggestion,
          suggestion: {
            mode,
            appendText,
            pageUrl: getTrimmedString(suggestion.suggestion, "pageUrl"),
          },
        };
      }
      if (mode !== "replace") return null;
      const currentText = getTrimmedString(
        suggestion.suggestion,
        "currentText",
      );
      const updatedText = getTrimmedString(
        suggestion.suggestion,
        "updatedText",
      );
      if (!currentText || !updatedText || currentText === updatedText) {
        return null;
      }
      const content =
        suggestion.type === "update_pdf"
          ? (context.pdfContent ?? "")
          : (context.webpageContent ?? "");
      if (content && !content.includes(currentText)) {
        return null;
      }
      return {
        ...suggestion,
        suggestion: {
          mode,
          currentText,
          updatedText,
          pageUrl: getTrimmedString(suggestion.suggestion, "pageUrl"),
        },
      };
    }
    case "update_context": {
      const appendText = getTrimmedString(suggestion.suggestion, "appendText");
      if (!appendText) return null;
      return {
        ...suggestion,
        suggestion: { appendText },
      };
    }
  }
}

function sanitizeFaqPairs(rawPairs: unknown[]): FaqPair[] {
  const seenQuestions = new Set<string>();
  const pairs: FaqPair[] = [];

  for (const pair of rawPairs) {
    if (!pair || typeof pair !== "object") continue;
    const question = getTrimmedString(
      pair as Record<string, unknown>,
      "question",
    );
    const answer = getTrimmedString(pair as Record<string, unknown>, "answer");
    if (!question || !answer) continue;

    const normalizedQuestion = normalizeText(question);
    if (seenQuestions.has(normalizedQuestion)) continue;

    seenQuestions.add(normalizedQuestion);
    pairs.push({ question, answer });
    if (pairs.length >= 50) break;
  }

  return pairs;
}

function summarizePendingSuggestion(suggestion: {
  type: string;
  suggestion: string;
  reasoning: string | null;
}): string {
  const payload = safeParseJson(suggestion.suggestion);

  switch (suggestion.type) {
    case "new_faq":
      return `${getTrimmedString(payload, "title") ?? ""} ${extractPairQuestions(payload)}`.trim();
    case "add_faq_pair": {
      const pair = payload.pair as Record<string, unknown> | undefined;
      const question = pair ? getTrimmedString(pair, "question") : null;
      return question ?? suggestion.reasoning ?? "";
    }
    case "refine_faq_pair": {
      const origPair = payload.originalPair as
        | Record<string, unknown>
        | undefined;
      const refPair = payload.refinedPair as
        | Record<string, unknown>
        | undefined;
      const origQuestion = origPair
        ? getTrimmedString(origPair, "question")
        : null;
      const refQuestion = refPair
        ? getTrimmedString(refPair, "question")
        : null;
      return (
        `${origQuestion ?? ""} → ${refQuestion ?? ""}`.trim() ||
        suggestion.reasoning ||
        ""
      );
    }
    case "new_sop":
      return `${getTrimmedString(payload, "condition") ?? ""} ${getTrimmedString(payload, "instruction") ?? ""}`.trim();
    case "add_sop":
      return (
        getTrimmedString(payload, "condition") ?? suggestion.reasoning ?? ""
      );
    case "refine_sop": {
      const origCondition = getTrimmedString(payload, "originalCondition");
      const refCondition = getTrimmedString(payload, "refinedCondition");
      return (
        `${origCondition ?? ""} → ${refCondition ?? ""}`.trim() ||
        suggestion.reasoning ||
        ""
      );
    }
    case "update_pdf":
    case "update_webpage":
      return `${getTrimmedString(payload, "appendText") ?? ""} ${getTrimmedString(payload, "updatedText") ?? ""}`.trim();
    case "update_context":
      return (
        getTrimmedString(payload, "appendText") ?? suggestion.reasoning ?? ""
      );
    default:
      return suggestion.reasoning ?? "";
  }
}

function parseFaqPairs(content: string | null): FaqPair[] {
  if (!content) return [];

  try {
    const parsed = JSON.parse(content) as FaqPair[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractPairQuestions(payload: Record<string, unknown>): string {
  const rawPairs = Array.isArray(payload.pairs) ? payload.pairs : [];
  return rawPairs
    .map((pair) =>
      pair && typeof pair === "object"
        ? getTrimmedString(pair as Record<string, unknown>, "question")
        : null,
    )
    .filter((question): question is string => !!question)
    .join(" ");
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getTrimmedString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
