import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql } from "drizzle-orm";
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
  | "add_faq_entry"
  | "new_sop"
  | "update_sop"
  | "update_context";

export interface SuggestionCounts {
  total: number;
  newFaq: number;
  addFaqEntry: number;
  newSop: number;
  updateSop: number;
  updateContext: number;
}

interface NewFaqPayload {
  title: string;
  pairs: FaqPair[];
}

interface AddFaqEntryPayload {
  pairs: FaqPair[];
}

interface SopPayload {
  condition: string;
  instruction: string;
}

interface UpdateContextPayload {
  appendText: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class KnowledgeSuggestionService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getPendingByProject(
    projectId: string,
    typeFilter?: SuggestionType,
  ): Promise<KnowledgeSuggestionRow[]> {
    if (typeFilter) {
      return this.db
        .select()
        .from(knowledgeSuggestions)
        .where(
          and(
            eq(knowledgeSuggestions.projectId, projectId),
            eq(knowledgeSuggestions.status, "pending"),
            eq(knowledgeSuggestions.type, typeFilter),
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
      addFaqEntry: 0,
      newSop: 0,
      updateSop: 0,
      updateContext: 0,
    };

    for (const row of rows) {
      const c = Number(row.count);
      counts.total += c;
      switch (row.type) {
        case "new_faq":
          counts.newFaq = c;
          break;
        case "add_faq_entry":
          counts.addFaqEntry = c;
          break;
        case "new_sop":
          counts.newSop = c;
          break;
        case "update_sop":
          counts.updateSop = c;
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

    await this.db
      .update(knowledgeSuggestions)
      .set({ status: "rejected" })
      .where(eq(knowledgeSuggestions.id, id));
    return true;
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
      case "add_faq_entry":
        await this.applyAddFaqEntry(
          payload as unknown as AddFaqEntryPayload,
          projectId,
          suggestion.targetResourceId!,
          r2,
        );
        break;
      case "new_sop":
        await this.applyNewSop(payload as unknown as SopPayload, projectId);
        break;
      case "update_sop":
        await this.applyUpdateSop(
          payload as unknown as SopPayload,
          projectId,
          suggestion.targetGuidelineId!,
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

  private async applyAddFaqEntry(
    payload: AddFaqEntryPayload,
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

    const existingPairs: FaqPair[] = resource.content
      ? JSON.parse(resource.content)
      : [];
    const mergedPairs = [...existingPairs, ...payload.pairs];
    await resourceService.updateFaqResource(
      targetResourceId,
      projectId,
      undefined,
      mergedPairs,
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

  private async applyUpdateSop(
    payload: SopPayload,
    projectId: string,
    targetGuidelineId: string,
  ): Promise<void> {
    const guidelineService = new GuidelineService(this.db);
    await guidelineService.update(targetGuidelineId, projectId, {
      condition: payload.condition,
      instruction: payload.instruction,
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
}
