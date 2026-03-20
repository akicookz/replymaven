import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, asc, and } from "drizzle-orm";
import {
  widgetConfig,
  quickActions,
  projectSettings,
  inquiryConfig,
  inquiries,
  type WidgetConfigRow,
  type QuickActionRow,
  type NewQuickActionRow,
  type InquiryConfigRow,
  type InquiryRow,
} from "../db";
import { users } from "../db/auth.schema";

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
        | "headerSubtitle"
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
    type: "prompt" | "link" | "inquiry",
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

  // ─── Inquiry Config ──────────────────────────────────────────────────────

  async getInquiryConfig(
    projectId: string,
  ): Promise<InquiryConfigRow | null> {
    const rows = await this.db
      .select()
      .from(inquiryConfig)
      .where(eq(inquiryConfig.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertInquiryConfig(
    projectId: string,
    updates: {
      enabled?: boolean;
      description?: string | null;
      fields?: Array<{ label: string; type: string; required: boolean }>;
    },
  ): Promise<InquiryConfigRow> {
    const existing = await this.getInquiryConfig(projectId);

    if (existing) {
      const setData: Record<string, unknown> = {};
      if (updates.enabled !== undefined) setData.enabled = updates.enabled;
      if (updates.description !== undefined)
        setData.description = updates.description;
      if (updates.fields !== undefined)
        setData.fields = JSON.stringify(updates.fields);

      await this.db
        .update(inquiryConfig)
        .set(setData)
        .where(eq(inquiryConfig.projectId, projectId));

      return (await this.getInquiryConfig(projectId))!;
    }

    const id = crypto.randomUUID();
    await this.db.insert(inquiryConfig).values({
      id,
      projectId,
      enabled: updates.enabled ?? false,
      description:
        updates.description ?? "We'll get back to you within 1-2 hours.",
      fields: updates.fields ? JSON.stringify(updates.fields) : "[]",
    });
    return (await this.getInquiryConfig(projectId))!;
  }

  // ─── Inquiries ──────────────────────────────────────────────────────────

  async createInquiry(
    projectId: string,
    visitorId: string | undefined,
    data: Record<string, string>,
  ): Promise<InquiryRow> {
    const id = crypto.randomUUID();
    await this.db.insert(inquiries).values({
      id,
      projectId,
      visitorId: visitorId ?? null,
      data: JSON.stringify(data),
    });
    const rows = await this.db
      .select()
      .from(inquiries)
      .where(eq(inquiries.id, id))
      .limit(1);
    return rows[0]!;
  }

  async getInquiries(
    projectId: string,
  ): Promise<InquiryRow[]> {
    return this.db
      .select()
      .from(inquiries)
      .where(eq(inquiries.projectId, projectId))
      .orderBy(asc(inquiries.createdAt));
  }

  async getInquiryById(
    id: string,
    projectId: string,
  ): Promise<InquiryRow | null> {
    const rows = await this.db
      .select()
      .from(inquiries)
      .where(eq(inquiries.id, id))
      .limit(1);
    if (!rows[0] || rows[0].projectId !== projectId) return null;
    return rows[0];
  }

  async updateInquiryStatus(
    id: string,
    projectId: string,
    status: "new" | "replied" | "closed",
  ): Promise<InquiryRow | null> {
    const existing = await this.getInquiryById(id, projectId);
    if (!existing) return null;
    await this.db
      .update(inquiries)
      .set({ status })
      .where(eq(inquiries.id, id));
    return (await this.getInquiryById(id, projectId))!;
  }

  // ─── Full Widget Config for Embed ───────────────────────────────────────────

  async getFullWidgetConfig(projectId: string) {
    const [config, actions, settings, formConfig] =
      await Promise.all([
        this.getWidgetConfig(projectId),
        this.getQuickActions(projectId),
        this.db
          .select()
          .from(projectSettings)
          .where(eq(projectSettings.projectId, projectId))
          .limit(1),
        this.getInquiryConfig(projectId),
      ]);

    // Resolve intro message author
    let introMessageAuthor: {
      name: string;
      avatar: string | null;
      workTitle: string | null;
    } | null = null;

    const authorId = settings[0]?.introMessageAuthorId;
    if (authorId) {
      const authorRows = await this.db
        .select({
          name: users.name,
          image: users.image,
          profilePicture: users.profilePicture,
          workTitle: users.workTitle,
        })
        .from(users)
        .where(eq(users.id, authorId))
        .limit(1);

      if (authorRows[0]) {
        const a = authorRows[0];
        introMessageAuthor = {
          name: a.name,
          avatar: a.profilePicture ?? a.image,
          workTitle: a.workTitle,
        };
      }
    }

    return {
      widget: config,
      quickActions: actions,
      introMessage:
        settings[0]?.introMessage ?? "Hi there! How can I help you today?",
      introMessageAuthor,
      showIntroBubble: settings[0]?.showIntroBubble ?? true,
      botName: settings[0]?.botName ?? null,
      inquiryForm:
        formConfig?.enabled
          ? {
              description: formConfig.description,
              fields: JSON.parse(formConfig.fields || "[]"),
            }
          : null,
    };
  }
}
