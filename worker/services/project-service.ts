import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import {
  projects,
  projectSettings,
  widgetConfig,
  type ProjectRow,
  type NewProjectRow,
  type ProjectSettingsRow,
} from "../db";

export class ProjectService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getProjectsByUserId(userId: string): Promise<ProjectRow[]> {
    return this.db.select().from(projects).where(eq(projects.userId, userId));
  }

  async getProjectById(id: string): Promise<ProjectRow | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getProjectBySlug(
    userId: string,
    slug: string,
  ): Promise<ProjectRow | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.slug, slug)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getProjectBySlugPublic(slug: string): Promise<ProjectRow | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async generateUniqueSlug(userId: string, baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let suffix = 1;
    while (await this.getProjectBySlug(userId, slug)) {
      suffix++;
      slug = `${baseSlug.slice(0, 45)}-${suffix}`;
    }
    return slug;
  }

  async createProject(
    data: Omit<NewProjectRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<ProjectRow> {
    const id = crypto.randomUUID();
    const row: NewProjectRow = { id, ...data };

    try {
      await this.db.insert(projects).values(row);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint")
      ) {
        throw new Error("A project with this name already exists");
      }
      throw err;
    }

    // Create default project settings
    await this.db.insert(projectSettings).values({
      id: crypto.randomUUID(),
      projectId: id,
    });

    // Create default widget config
    await this.db.insert(widgetConfig).values({
      id: crypto.randomUUID(),
      projectId: id,
    });

    return (await this.getProjectById(id))!;
  }

  async updateProject(
    id: string,
    userId: string,
    updates: Partial<Pick<ProjectRow, "name" | "slug" | "domain">>,
  ): Promise<ProjectRow | null> {
    const project = await this.getProjectById(id);
    if (!project || project.userId !== userId) return null;

    await this.db.update(projects).set(updates).where(eq(projects.id, id));

    return (await this.getProjectById(id))!;
  }

  async deleteProject(id: string, userId: string): Promise<boolean> {
    const project = await this.getProjectById(id);
    if (!project || project.userId !== userId) return false;

    await this.db.delete(projects).where(eq(projects.id, id));
    return true;
  }

  async getSettings(projectId: string): Promise<ProjectSettingsRow | null> {
    const rows = await this.db
      .select()
      .from(projectSettings)
      .where(eq(projectSettings.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateSettings(
    projectId: string,
    updates: Partial<
      Pick<
        ProjectSettingsRow,
        | "toneOfVoice"
        | "customTonePrompt"
        | "introMessage"
        | "autoCannedDraft"
        | "telegramBotToken"
        | "telegramChatId"
        | "companyName"
        | "companyUrl"
        | "industry"
        | "companyContext"
      >
    >,
  ): Promise<ProjectSettingsRow | null> {
    await this.db
      .update(projectSettings)
      .set(updates)
      .where(eq(projectSettings.projectId, projectId));

    return this.getSettings(projectId);
  }

  async markOnboarded(projectId: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ onboarded: true })
      .where(eq(projects.id, projectId));
  }
}
