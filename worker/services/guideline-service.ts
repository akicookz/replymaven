import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import {
  guidelines,
  type GuidelineRow,
  type NewGuidelineRow,
} from "../db";

export class GuidelineService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getByProject(projectId: string): Promise<GuidelineRow[]> {
    return this.db
      .select()
      .from(guidelines)
      .where(eq(guidelines.projectId, projectId))
      .orderBy(guidelines.sortOrder);
  }

  async getEnabledByProject(projectId: string): Promise<GuidelineRow[]> {
    return this.db
      .select()
      .from(guidelines)
      .where(
        and(
          eq(guidelines.projectId, projectId),
          eq(guidelines.enabled, true),
        ),
      )
      .orderBy(guidelines.sortOrder);
  }

  async getById(
    id: string,
    projectId: string,
  ): Promise<GuidelineRow | null> {
    const rows = await this.db
      .select()
      .from(guidelines)
      .where(
        and(eq(guidelines.id, id), eq(guidelines.projectId, projectId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async countByProject(projectId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(guidelines)
      .where(eq(guidelines.projectId, projectId));
    return rows.length;
  }

  async create(
    data: Omit<NewGuidelineRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<GuidelineRow> {
    const id = crypto.randomUUID();
    await this.db.insert(guidelines).values({ id, ...data });
    return (await this.getById(id, data.projectId))!;
  }

  async update(
    id: string,
    projectId: string,
    updates: Partial<
      Pick<GuidelineRow, "condition" | "instruction" | "enabled" | "sortOrder">
    >,
  ): Promise<GuidelineRow | null> {
    const existing = await this.getById(id, projectId);
    if (!existing) return null;

    await this.db
      .update(guidelines)
      .set(updates)
      .where(
        and(eq(guidelines.id, id), eq(guidelines.projectId, projectId)),
      );

    return (await this.getById(id, projectId))!;
  }

  async delete(id: string, projectId: string): Promise<boolean> {
    const existing = await this.getById(id, projectId);
    if (!existing) return false;

    await this.db.delete(guidelines).where(eq(guidelines.id, id));
    return true;
  }
}
