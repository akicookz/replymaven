import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  knowledgeSuggestions,
  type KnowledgeSuggestionRow,
  type NewKnowledgeSuggestionRow,
} from "../db";
import { ResourceService, type FaqPair } from "./resource-service";
import { GuidelineService } from "./guideline-service";
import { ProjectService } from "./project-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SuggestionType =
  | "new_faq"
  | "add_faq_pair"
  | "refine_faq_pair"
  | "new_sop"
  | "add_sop"
  | "refine_sop"
  | "update_pdf"
  | "update_webpage"
  | "update_context";

export interface SuggestionCounts {
  total: number;
  newFaq: number;
  addFaqPair: number;
  refineFaqPair: number;
  newSop: number;
  addSop: number;
  refineSop: number;
  updatePdf: number;
  updateWebpage: number;
  updateContext: number;
}

interface NewFaqPayload {
  title: string;
  pairs: FaqPair[];
}

interface AddFaqPairPayload {
  pair: FaqPair;
}

interface RefineFaqPairPayload {
  pairIndex: number;
  originalPair: FaqPair;
  refinedPair: FaqPair;
}

interface SopPayload {
  condition: string;
  instruction: string;
}

interface RefineSopPayload {
  originalCondition: string;
  originalInstruction: string;
  refinedCondition: string;
  refinedInstruction: string;
}

interface UpdateResourcePayload {
  mode: "replace" | "append";
  currentText?: string;
  updatedText?: string;
  appendText?: string;
  pageUrl?: string;
}

interface UpdateContextPayload {
  appendText: string;
}

export function buildSuggestionFingerprint(options: {
  type: SuggestionType;
  targetResourceId?: string | null;
  targetGuidelineId?: string | null;
  targetPageId?: string | null;
  suggestion: string | Record<string, unknown>;
}): string {
  const payload =
    typeof options.suggestion === "string"
      ? safeParseJson(options.suggestion)
      : options.suggestion;

  switch (options.type) {
    case "add_faq_pair":
      return `add_faq_pair:${options.targetResourceId}:${normalizeFingerprintText(
        getStringValue((payload as Record<string, unknown>)?.pair, "question"),
      )}`;
    case "refine_faq_pair":
      return `refine_faq_pair:${options.targetResourceId}:${normalizeFingerprintText(
        getStringValue((payload as Record<string, unknown>)?.originalPair, "question"),
      )}`;
    case "add_sop":
      return `add_sop:${normalizeFingerprintText(
        getStringValue(payload, "condition"),
      )}`;
    case "refine_sop":
      return `refine_sop:${options.targetGuidelineId}:${normalizeFingerprintText(
        getStringValue(payload, "originalCondition"),
      )}`;
    case "update_pdf":
      return `update_pdf:${options.targetResourceId ?? "unknown"}`;
    case "update_webpage":
      return `update_webpage:${options.targetPageId ?? "unknown"}`;
    case "update_context":
      return "update_context";
    case "new_faq":
      return `new_faq:${normalizeFingerprintText(
        getStringValue(payload, "title"),
      )}`;
    case "new_sop":
      return `new_sop:${normalizeFingerprintText(
        getStringValue(payload, "condition"),
      )}`;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class KnowledgeSuggestionService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getPendingByProject(
    projectId: string,
    typeFilter?: SuggestionType | SuggestionType[],
  ): Promise<KnowledgeSuggestionRow[]> {
    if (typeFilter) {
      // Handle both single type and array of types
      const types = Array.isArray(typeFilter) ? typeFilter : [typeFilter];
      return this.db
        .select()
        .from(knowledgeSuggestions)
        .where(
          and(
            eq(knowledgeSuggestions.projectId, projectId),
            eq(knowledgeSuggestions.status, "pending"),
            inArray(knowledgeSuggestions.type, types),
          ),
        );
    }
    return this.db
      .select()
      .from(knowledgeSuggestions)
      .where(
        and(
          eq(knowledgeSuggestions.projectId, projectId),
          eq(knowledgeSuggestions.status, "pending"),
        ),
      );
  }

  async getPendingCountsByProject(
    projectId: string,
  ): Promise<SuggestionCounts> {
    const rows = await this.db
      .select({
        type: knowledgeSuggestions.type,
        count: sql<number>`count(*)`,
      })
      .from(knowledgeSuggestions)
      .where(
        and(
          eq(knowledgeSuggestions.projectId, projectId),
          eq(knowledgeSuggestions.status, "pending"),
        ),
      )
      .groupBy(knowledgeSuggestions.type);

    const counts: SuggestionCounts = {
      total: 0,
      newFaq: 0,
      addFaqPair: 0,
      refineFaqPair: 0,
      newSop: 0,
      addSop: 0,
      refineSop: 0,
      updatePdf: 0,
      updateWebpage: 0,
      updateContext: 0,
    };

    for (const row of rows) {
      const c = Number(row.count);
      counts.total += c;
      switch (row.type) {
        case "new_faq":
          counts.newFaq = c;
          break;
        case "add_faq_pair":
          counts.addFaqPair = c;
          break;
        case "refine_faq_pair":
          counts.refineFaqPair = c;
          break;
        case "new_sop":
          counts.newSop = c;
          break;
        case "add_sop":
          counts.addSop = c;
          break;
        case "refine_sop":
          counts.refineSop = c;
          break;
        case "update_pdf":
          counts.updatePdf = c;
          break;
        case "update_webpage":
          counts.updateWebpage = c;
          break;
        case "update_context":
          counts.updateContext = c;
          break;
      }
    }

    return counts;
  }

  async getById(
    id: string,
    projectId: string,
  ): Promise<KnowledgeSuggestionRow | null> {
    const rows = await this.db
      .select()
      .from(knowledgeSuggestions)
      .where(
        and(
          eq(knowledgeSuggestions.id, id),
          eq(knowledgeSuggestions.projectId, projectId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async create(
    data: Omit<NewKnowledgeSuggestionRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<KnowledgeSuggestionRow> {
    const id = crypto.randomUUID();
    await this.db.insert(knowledgeSuggestions).values({ id, ...data });
    return (await this.getById(id, data.projectId))!;
  }

  // ─── Approve + Auto-Apply ──────────────────────────────────────────────────

  async approve(
    id: string,
    projectId: string,
    r2: R2Bucket,
  ): Promise<{ success: boolean; error?: string }> {
    const suggestion = await this.getById(id, projectId);
    if (!suggestion) return { success: false, error: "Not found" };
    if (suggestion.status !== "pending")
      return { success: false, error: "Already processed" };

    try {
      const payload = JSON.parse(suggestion.suggestion);
      await this.applySuggestion(suggestion.type as SuggestionType, payload, projectId, suggestion, r2);

      await this.db
        .update(knowledgeSuggestions)
        .set({ status: "approved" })
        .where(eq(knowledgeSuggestions.id, id));

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  async reject(
    id: string,
    projectId: string,
  ): Promise<boolean> {
    const existing = await this.getById(id, projectId);
    if (!existing || existing.status !== "pending") return false;

    // Delete rejected suggestion from database
    await this.db
      .delete(knowledgeSuggestions)
      .where(eq(knowledgeSuggestions.id, id));
    return true;
  }

  async bulkApprove(
    ids: string[],
    projectId: string,
    r2: R2Bucket,
  ): Promise<{ succeeded: string[]; failed: Array<{ id: string; error: string }> }> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      const result = await this.approve(id, projectId, r2);
      if (result.success) {
        succeeded.push(id);
      } else {
        failed.push({ id, error: result.error ?? "Unknown error" });
      }
    }

    return { succeeded, failed };
  }

  async bulkReject(
    ids: string[],
    projectId: string,
  ): Promise<{ succeeded: string[]; failed: string[] }> {
    const succeeded: string[] = [];
    const failed: string[] = [];

    for (const id of ids) {
      const rejected = await this.reject(id, projectId);
      if (rejected) {
        succeeded.push(id);
      } else {
        failed.push(id);
      }
    }

    return { succeeded, failed };
  }

  // ─── Apply Logic ────────────────────────────────────────────────────────────

  private async applySuggestion(
    type: SuggestionType,
    payload: Record<string, unknown>,
    projectId: string,
    suggestion: KnowledgeSuggestionRow,
    r2: R2Bucket,
  ): Promise<void> {
    switch (type) {
      case "new_faq":
        await this.applyNewFaq(payload as unknown as NewFaqPayload, projectId, r2);
        break;
      case "add_faq_pair":
        await this.applyAddFaqPair(
          payload as unknown as AddFaqPairPayload,
          projectId,
          suggestion.targetResourceId!,
          r2,
        );
        break;
      case "refine_faq_pair":
        await this.applyRefineFaqPair(
          payload as unknown as RefineFaqPairPayload,
          projectId,
          suggestion.targetResourceId!,
          r2,
        );
        break;
      case "new_sop":
        await this.applyNewSop(payload as unknown as SopPayload, projectId);
        break;
      case "add_sop":
        await this.applyAddSop(payload as unknown as SopPayload, projectId);
        break;
      case "refine_sop":
        await this.applyRefineSop(
          payload as unknown as RefineSopPayload,
          projectId,
          suggestion.targetGuidelineId!,
        );
        break;
      case "update_pdf":
        await this.applyUpdatePdf(
          payload as unknown as UpdateResourcePayload,
          projectId,
          suggestion.targetResourceId!,
          r2,
        );
        break;
      case "update_webpage":
        await this.applyUpdateWebpage(
          payload as unknown as UpdateResourcePayload,
          projectId,
          suggestion.targetResourceId!,
          suggestion.targetPageId!,
          r2,
        );
        break;
      case "update_context":
        await this.applyUpdateContext(
          payload as unknown as UpdateContextPayload,
          projectId,
        );
        break;
    }
  }

  private async applyNewFaq(
    payload: NewFaqPayload,
    projectId: string,
    r2: R2Bucket,
  ): Promise<void> {
    const resourceService = new ResourceService(this.db, r2);
    const resource = await resourceService.createResource({
      projectId,
      type: "faq",
      title: payload.title,
      content: JSON.stringify(payload.pairs),
      status: "pending",
    });
    await resourceService.ingestFaqFromPairs(
      projectId,
      resource.id,
      payload.title,
      payload.pairs,
    );
  }

  private async applyAddFaqPair(
    payload: AddFaqPairPayload,
    projectId: string,
    targetResourceId: string,
    r2: R2Bucket,
  ): Promise<void> {
    const resourceService = new ResourceService(this.db, r2);
    const resource = await resourceService.getResourceById(
      targetResourceId,
      projectId,
    );
    if (!resource || resource.type !== "faq") {
      throw new Error("Target FAQ resource not found");
    }

    // Parse existing FAQ content
    const existingContent = resource.content ? JSON.parse(resource.content) : { pairs: [] };
    const updatedPairs = [...existingContent.pairs, payload.pair];

    // Update with the new pair added
    await resourceService.updateFaqResource(
      targetResourceId,
      projectId,
      resource.title,
      updatedPairs,
    );
  }

  private async applyRefineFaqPair(
    payload: RefineFaqPairPayload,
    projectId: string,
    targetResourceId: string,
    r2: R2Bucket,
  ): Promise<void> {
    const resourceService = new ResourceService(this.db, r2);
    const resource = await resourceService.getResourceById(
      targetResourceId,
      projectId,
    );
    if (!resource || resource.type !== "faq") {
      throw new Error("Target FAQ resource not found");
    }

    // Parse existing FAQ content
    const existingContent = resource.content ? JSON.parse(resource.content) : { pairs: [] };
    const updatedPairs = [...existingContent.pairs];

    // Find and update the specific pair
    if (payload.pairIndex >= 0 && payload.pairIndex < updatedPairs.length) {
      updatedPairs[payload.pairIndex] = payload.refinedPair;
    } else {
      // Fallback: find by matching original question
      const index = updatedPairs.findIndex(
        p => p.question === payload.originalPair.question
      );
      if (index !== -1) {
        updatedPairs[index] = payload.refinedPair;
      } else {
        throw new Error("FAQ pair to refine not found");
      }
    }

    // Update with the refined pair
    await resourceService.updateFaqResource(
      targetResourceId,
      projectId,
      resource.title,
      updatedPairs,
    );
  }

  private async applyNewSop(
    payload: SopPayload,
    projectId: string,
  ): Promise<void> {
    const guidelineService = new GuidelineService(this.db);
    await guidelineService.create({
      projectId,
      condition: payload.condition,
      instruction: payload.instruction,
      enabled: true,
    });
  }

  private async applyAddSop(
    payload: SopPayload,
    projectId: string,
  ): Promise<void> {
    const guidelineService = new GuidelineService(this.db);
    await guidelineService.create({
      projectId,
      condition: payload.condition,
      instruction: payload.instruction,
      enabled: true,
    });
  }

  private async applyRefineSop(
    payload: RefineSopPayload,
    projectId: string,
    targetGuidelineId: string,
  ): Promise<void> {
    const guidelineService = new GuidelineService(this.db);
    await guidelineService.update(targetGuidelineId, projectId, {
      condition: payload.refinedCondition,
      instruction: payload.refinedInstruction,
    });
  }

  private async applyUpdateContext(
    payload: UpdateContextPayload,
    projectId: string,
  ): Promise<void> {
    const projectService = new ProjectService(this.db);
    const settings = await projectService.getSettings(projectId);
    const currentContext = settings?.companyContext ?? "";
    const newContext = currentContext
      ? `${currentContext}\n\n${payload.appendText}`
      : payload.appendText;
    await projectService.updateSettings(projectId, {
      companyContext: newContext,
    });
  }

  private async applyUpdatePdf(
    payload: UpdateResourcePayload,
    projectId: string,
    targetResourceId: string,
    r2: R2Bucket,
  ): Promise<void> {
    const resourceService = new ResourceService(this.db, r2);
    const resource = await resourceService.getResourceById(
      targetResourceId,
      projectId,
    );
    if (!resource || resource.type !== "pdf") {
      throw new Error("Target PDF resource not found");
    }

    const currentContent = resource.content ?? "";
    const nextContent = applyTextSuggestion(currentContent, payload);
    await resourceService.updateResourceContent(
      targetResourceId,
      projectId,
      undefined,
      nextContent,
    );
  }

  private async applyUpdateWebpage(
    payload: UpdateResourcePayload,
    projectId: string,
    targetResourceId: string,
    targetPageId: string,
    r2: R2Bucket,
  ): Promise<void> {
    const resourceService = new ResourceService(this.db, r2);
    const resource = await resourceService.getResourceById(
      targetResourceId,
      projectId,
    );
    if (!resource || resource.type !== "webpage") {
      throw new Error("Target webpage resource not found");
    }

    const pageContent = await resourceService.getCrawledPageContent(
      targetPageId,
      targetResourceId,
      projectId,
    );
    if (pageContent === null) {
      throw new Error("Target webpage page not found");
    }

    const nextContent = applyTextSuggestion(pageContent, payload);
    const updated = await resourceService.updateCrawledPageContent(
      targetPageId,
      targetResourceId,
      projectId,
      nextContent,
    );
    if (!updated) {
      throw new Error("Failed to update webpage page content");
    }
  }
}

function applyTextSuggestion(
  content: string,
  payload: UpdateResourcePayload,
): string {
  if (payload.mode === "append") {
    if (!payload.appendText?.trim()) {
      throw new Error("Append suggestion is missing appendText");
    }

    return content.trim()
      ? `${content.trimEnd()}\n\n${payload.appendText.trim()}`
      : payload.appendText.trim();
  }

  if (!payload.currentText?.trim() || !payload.updatedText?.trim()) {
    throw new Error("Replace suggestion is missing currentText or updatedText");
  }

  if (!content.includes(payload.currentText)) {
    throw new Error("Target text snippet no longer matches current content");
  }

  return content.replace(payload.currentText, payload.updatedText);
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getStringValue(
  payload: Record<string, unknown> | unknown,
  key: string,
): string {
  if (!payload || typeof payload !== "object") return "";
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function normalizeFingerprintText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
