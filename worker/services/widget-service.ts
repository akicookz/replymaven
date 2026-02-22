import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, asc } from "drizzle-orm";
import {
  widgetConfig,
  quickActions,
  quickTopics,
  projectSettings,
  type WidgetConfigRow,
  type QuickActionRow,
  type NewQuickActionRow,
  type QuickTopicRow,
  type NewQuickTopicRow,
} from "../db";

export class WidgetService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  // ─── Widget Config ──────────────────────────────────────────────────────────

  async getWidgetConfig(projectId: string): Promise<WidgetConfigRow | null> {
    const rows = await this.db
      .select()
      .from(widgetConfig)
      .where(eq(widgetConfig.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateWidgetConfig(
    projectId: string,
    updates: Partial<
      Pick<
        WidgetConfigRow,
        | "primaryColor"
        | "backgroundColor"
        | "textColor"
        | "headerText"
        | "avatarUrl"
        | "position"
        | "borderRadius"
        | "fontFamily"
        | "customCss"
      >
    >,
  ): Promise<WidgetConfigRow | null> {
    await this.db
      .update(widgetConfig)
      .set(updates)
      .where(eq(widgetConfig.projectId, projectId));

    return this.getWidgetConfig(projectId);
  }

  // ─── Quick Actions ──────────────────────────────────────────────────────────

  async getQuickActions(projectId: string): Promise<QuickActionRow[]> {
    return this.db
      .select()
      .from(quickActions)
      .where(eq(quickActions.projectId, projectId))
      .orderBy(asc(quickActions.sortOrder));
  }

  async createQuickAction(
    data: Omit<NewQuickActionRow, "id" | "createdAt">,
  ): Promise<QuickActionRow> {
    const id = crypto.randomUUID();
    await this.db.insert(quickActions).values({ id, ...data });
    const rows = await this.db
      .select()
      .from(quickActions)
      .where(eq(quickActions.id, id))
      .limit(1);
    return rows[0]!;
  }

  async deleteQuickAction(
    id: string,
    projectId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(quickActions)
      .where(eq(quickActions.id, id))
      .limit(1);
    if (!rows[0] || rows[0].projectId !== projectId) return false;

    await this.db.delete(quickActions).where(eq(quickActions.id, id));
    return true;
  }

  // ─── Quick Topics ───────────────────────────────────────────────────────────

  async getQuickTopics(projectId: string): Promise<QuickTopicRow[]> {
    return this.db
      .select()
      .from(quickTopics)
      .where(eq(quickTopics.projectId, projectId))
      .orderBy(asc(quickTopics.sortOrder));
  }

  async createQuickTopic(
    data: Omit<NewQuickTopicRow, "id" | "createdAt">,
  ): Promise<QuickTopicRow> {
    const id = crypto.randomUUID();
    await this.db.insert(quickTopics).values({ id, ...data });
    const rows = await this.db
      .select()
      .from(quickTopics)
      .where(eq(quickTopics.id, id))
      .limit(1);
    return rows[0]!;
  }

  async deleteQuickTopic(
    id: string,
    projectId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(quickTopics)
      .where(eq(quickTopics.id, id))
      .limit(1);
    if (!rows[0] || rows[0].projectId !== projectId) return false;

    await this.db.delete(quickTopics).where(eq(quickTopics.id, id));
    return true;
  }

  // ─── Full Widget Config for Embed ───────────────────────────────────────────

  async getFullWidgetConfig(projectId: string) {
    const [config, actions, topics, settings] = await Promise.all([
      this.getWidgetConfig(projectId),
      this.getQuickActions(projectId),
      this.getQuickTopics(projectId),
      this.db
        .select()
        .from(projectSettings)
        .where(eq(projectSettings.projectId, projectId))
        .limit(1),
    ]);

    return {
      widget: config,
      quickActions: actions,
      quickTopics: topics,
      introMessage: settings[0]?.introMessage ?? "Hi there! How can I help you today?",
    };
  }
}
