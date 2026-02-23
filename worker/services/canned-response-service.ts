import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import {
  cannedResponses,
  type CannedResponseRow,
  type NewCannedResponseRow,
} from "../db";

export class CannedResponseService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getByProject(projectId: string): Promise<CannedResponseRow[]> {
    return this.db
      .select()
      .from(cannedResponses)
      .where(eq(cannedResponses.projectId, projectId));
  }

  async getById(
    id: string,
    projectId: string,
  ): Promise<CannedResponseRow | null> {
    const rows = await this.db
      .select()
      .from(cannedResponses)
      .where(
        and(
          eq(cannedResponses.id, id),
          eq(cannedResponses.projectId, projectId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async create(
    data: Omit<NewCannedResponseRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<CannedResponseRow> {
    const id = crypto.randomUUID();
    await this.db.insert(cannedResponses).values({ id, ...data });
    return (await this.getById(id, data.projectId))!;
  }

  async update(
    id: string,
    projectId: string,
    updates: Partial<
      Pick<CannedResponseRow, "trigger" | "response" | "status">
    >,
  ): Promise<CannedResponseRow | null> {
    const existing = await this.getById(id, projectId);
    if (!existing) return null;

    await this.db
      .update(cannedResponses)
      .set(updates)
      .where(
        and(
          eq(cannedResponses.id, id),
          eq(cannedResponses.projectId, projectId),
        ),
      );

    return (await this.getById(id, projectId))!;
  }

  async approve(id: string, projectId: string): Promise<boolean> {
    const existing = await this.getById(id, projectId);
    if (!existing) return false;

    await this.db
      .update(cannedResponses)
      .set({ status: "approved" })
      .where(
        and(
          eq(cannedResponses.id, id),
          eq(cannedResponses.projectId, projectId),
        ),
      );
    return true;
  }

  async delete(id: string, projectId: string): Promise<boolean> {
    const existing = await this.getById(id, projectId);
    if (!existing) return false;

    await this.db
      .delete(cannedResponses)
      .where(eq(cannedResponses.id, id));
    return true;
  }

  // ─── Auto-Draft Generation ──────────────────────────────────────────────────

  async createDraft(
    projectId: string,
    trigger: string,
    response: string,
    sourceConversationId: string,
  ): Promise<CannedResponseRow> {
    return this.create({
      projectId,
      trigger,
      response,
      status: "draft",
      sourceConversationId,
    });
  }
}
