import { type DrizzleD1Database } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import {
  projects,
  projectSettings,
  widgetConfig,
  users,
  type ProjectRow,
  type NewProjectRow,
  type ProjectSettingsRow,
  type WidgetConfigRow,
} from "../db";
import { RESERVED_INBOUND_LOCAL_PARTS } from "./email-service";
import { encrypt } from "./encryption-service";

export interface HelpPresentationSettings {
  helpCustomUrl: string | null;
  helpTopNav: string | null;
  helpCustomCss: string | null;
  helpHomeMarkdown: string | null;
  helpHomeBackgroundUrl: string | null;
  helpHomeBackgroundPosition: string | null;
  helpHomeBackgroundFit: string | null;
  helpThemeDefault: string;
}

export interface PublicHelpProject {
  project: ProjectRow;
  settings: HelpPresentationSettings | null;
  widgetConfig: WidgetConfigRow | null;
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

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

  async getPublicHelpProject(slug: string): Promise<PublicHelpProject | null> {
    const rows = await this.db
      .select({
        project: projects,
        settingsProjectId: projectSettings.projectId,
        helpCustomUrl: projectSettings.helpCustomUrl,
        helpTopNav: projectSettings.helpTopNav,
        helpCustomCss: projectSettings.helpCustomCss,
        helpHomeMarkdown: projectSettings.helpHomeMarkdown,
        helpHomeBackgroundUrl: projectSettings.helpHomeBackgroundUrl,
        helpHomeBackgroundPosition: projectSettings.helpHomeBackgroundPosition,
        helpHomeBackgroundFit: projectSettings.helpHomeBackgroundFit,
        helpThemeDefault: projectSettings.helpThemeDefault,
        widgetConfig,
      })
      .from(projects)
      .leftJoin(projectSettings, eq(projectSettings.projectId, projects.id))
      .leftJoin(widgetConfig, eq(widgetConfig.projectId, projects.id))
      .where(eq(projects.slug, slug))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      project: row.project,
      settings: row.settingsProjectId
        ? {
            helpCustomUrl: row.helpCustomUrl,
            helpTopNav: row.helpTopNav,
            helpCustomCss: row.helpCustomCss,
            helpHomeMarkdown: row.helpHomeMarkdown,
            helpHomeBackgroundUrl: row.helpHomeBackgroundUrl,
            helpHomeBackgroundPosition: row.helpHomeBackgroundPosition,
            helpHomeBackgroundFit: row.helpHomeBackgroundFit,
            helpThemeDefault: row.helpThemeDefault ?? "system",
          }
        : null,
      widgetConfig: row.widgetConfig,
    };
  }

  async generateUniqueSlug(_userId: string, baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let suffix = 1;
    // The slug doubles as the local part of the project's inbound email
    // address ({slug}@updates.replymaven.com), so platform sender aliases are
    // off-limits — the inbound webhook drops mail addressed to them.
    while (
      RESERVED_INBOUND_LOCAL_PARTS.has(slug) ||
      (await this.getProjectBySlugPublic(slug))
    ) {
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
        throw new Error("This slug is already taken. Please choose a different project name.");
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
        | "workingHours"
        | "avgResponseTime"
        | "telegramBotToken"
        | "telegramChatId"
        | "companyName"
        | "companyUrl"
        | "industry"
        | "companyContext"
        | "botName"
        | "agentName"
        | "introMessageAuthorId"
        | "introMessageDelay"
        | "introMessageDuration"
        | "helpCustomUrl"
        | "helpTopNav"
        | "helpCustomCss"
        | "helpHomeMarkdown"
        | "helpHomeBackgroundUrl"
        | "helpHomeBackgroundPosition"
        | "helpHomeBackgroundFit"
        | "helpThemeDefault"
      >
    >,
  ): Promise<ProjectSettingsRow | null> {
    await this.db
      .update(projectSettings)
      .set(updates)
      .where(eq(projectSettings.projectId, projectId));

    return this.getSettings(projectId);
  }

  async rotateCustomerIdentitySecret(
    projectId: string,
    encryptionKey: string,
  ): Promise<{ configured: true; secret: string }> {
    const secret = encodeBase64Url(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const encryptedSecret = await encrypt(secret, encryptionKey);
    await this.db
      .update(projectSettings)
      .set({ customerIdentitySecret: encryptedSecret })
      .where(eq(projectSettings.projectId, projectId));
    return { configured: true, secret };
  }

  async markOnboarded(projectId: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ onboarded: true })
      .where(eq(projects.id, projectId));
  }

  async getOwnerEmail(projectId: string): Promise<string | null> {
    const rows = await this.db
      .select({ email: users.email })
      .from(projects)
      .innerJoin(users, eq(projects.userId, users.id))
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0]?.email ?? null;
  }
}
