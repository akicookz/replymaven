import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, asc, and } from "drizzle-orm";
import {
  widgetConfig,
  quickActions,
  projectSettings,
  contactFormConfig,
  contactFormSubmissions,
  bookingConfig,
  type WidgetConfigRow,
  type QuickActionRow,
  type NewQuickActionRow,
  type ContactFormConfigRow,
  type ContactFormSubmissionRow,
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
        | "bannerUrl"
        | "homeTitle"
        | "homeSubtitle"
        | "allowedPages"
        | "botMessageBgColor"
        | "botMessageTextColor"
        | "visitorMessageBgColor"
        | "visitorMessageTextColor"
        | "backgroundStyle"
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

  async updateQuickAction(
    id: string,
    projectId: string,
    updates: Partial<Pick<QuickActionRow, "label" | "action" | "icon" | "showOnHome" | "sortOrder">>,
  ): Promise<QuickActionRow | null> {
    const rows = await this.db
      .select()
      .from(quickActions)
      .where(eq(quickActions.id, id))
      .limit(1);
    if (!rows[0] || rows[0].projectId !== projectId) return null;

    await this.db
      .update(quickActions)
      .set(updates)
      .where(eq(quickActions.id, id));

    const updated = await this.db
      .select()
      .from(quickActions)
      .where(eq(quickActions.id, id))
      .limit(1);
    return updated[0] ?? null;
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

  async getQuickActionsByType(
    projectId: string,
    type: "prompt" | "link" | "contact_form" | "booking",
  ): Promise<QuickActionRow[]> {
    return this.db
      .select()
      .from(quickActions)
      .where(
        and(
          eq(quickActions.projectId, projectId),
          eq(quickActions.type, type),
        ),
      );
  }

  // ─── Contact Form Config ─────────────────────────────────────────────────

  async getContactFormConfig(
    projectId: string,
  ): Promise<ContactFormConfigRow | null> {
    const rows = await this.db
      .select()
      .from(contactFormConfig)
      .where(eq(contactFormConfig.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertContactFormConfig(
    projectId: string,
    updates: {
      enabled?: boolean;
      description?: string | null;
      fields?: Array<{ label: string; type: string; required: boolean }>;
    },
  ): Promise<ContactFormConfigRow> {
    const existing = await this.getContactFormConfig(projectId);

    if (existing) {
      const setData: Record<string, unknown> = {};
      if (updates.enabled !== undefined) setData.enabled = updates.enabled;
      if (updates.description !== undefined)
        setData.description = updates.description;
      if (updates.fields !== undefined)
        setData.fields = JSON.stringify(updates.fields);

      await this.db
        .update(contactFormConfig)
        .set(setData)
        .where(eq(contactFormConfig.projectId, projectId));

      return (await this.getContactFormConfig(projectId))!;
    }

    const id = crypto.randomUUID();
    await this.db.insert(contactFormConfig).values({
      id,
      projectId,
      enabled: updates.enabled ?? false,
      description:
        updates.description ?? "We'll get back to you within 1-2 hours.",
      fields: updates.fields ? JSON.stringify(updates.fields) : "[]",
    });
    return (await this.getContactFormConfig(projectId))!;
  }

  // ─── Contact Form Submissions ───────────────────────────────────────────

  async createContactFormSubmission(
    projectId: string,
    visitorId: string | undefined,
    data: Record<string, string>,
  ): Promise<ContactFormSubmissionRow> {
    const id = crypto.randomUUID();
    await this.db.insert(contactFormSubmissions).values({
      id,
      projectId,
      visitorId: visitorId ?? null,
      data: JSON.stringify(data),
    });
    const rows = await this.db
      .select()
      .from(contactFormSubmissions)
      .where(eq(contactFormSubmissions.id, id))
      .limit(1);
    return rows[0]!;
  }

  async getContactFormSubmissions(
    projectId: string,
  ): Promise<ContactFormSubmissionRow[]> {
    return this.db
      .select()
      .from(contactFormSubmissions)
      .where(eq(contactFormSubmissions.projectId, projectId))
      .orderBy(asc(contactFormSubmissions.createdAt));
  }

  // ─── Full Widget Config for Embed ───────────────────────────────────────────

  async getFullWidgetConfig(projectId: string) {
    const [config, actions, settings, formConfig, booking] =
      await Promise.all([
        this.getWidgetConfig(projectId),
        this.getQuickActions(projectId),
        this.db
          .select()
          .from(projectSettings)
          .where(eq(projectSettings.projectId, projectId))
          .limit(1),
        this.getContactFormConfig(projectId),
        this.db
          .select()
          .from(bookingConfig)
          .where(eq(bookingConfig.projectId, projectId))
          .limit(1),
      ]);

    return {
      widget: config,
      quickActions: actions,
      introMessage:
        settings[0]?.introMessage ?? "Hi there! How can I help you today?",
      contactForm:
        formConfig?.enabled
          ? {
              description: formConfig.description,
              fields: JSON.parse(formConfig.fields || "[]"),
            }
          : null,
      bookingEnabled: booking[0]?.enabled ?? false,
    };
  }
}
