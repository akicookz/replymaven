import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, asc, and, inArray } from "drizzle-orm";
import {
  widgetConfig,
  quickActions,
  projectSettings,
  inquiryConfig,
  inquiries,
  greetings,
  type WidgetConfigRow,
  type QuickActionRow,
  type NewQuickActionRow,
  type InquiryConfigRow,
  type InquiryRow,
  type GreetingRow,
  type NewGreetingRow,
} from "../db";
import { users } from "../db/auth.schema";

export interface GreetingPublic {
  id: string;
  enabled: boolean;
  imageUrl: string | null;
  title: string;
  description: string | null;
  ctaText: string | null;
  ctaLink: string | null;
  author: {
    id: string;
    name: string;
    avatar: string | null;
    workTitle: string | null;
  } | null;
  allowedPages: string[] | null;
  delaySeconds: number;
  durationSeconds: number;
  sortOrder: number;
}

function parseAllowedPages(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const result = parsed
        .map((v) => (typeof v === "string" ? v : null))
        .filter((v): v is string => Boolean(v));
      return result.length ? result : null;
    }
  } catch {
    // ignore
  }
  return null;
}

function serializeAllowedPages(value: string[] | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.map((v) => v.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  return JSON.stringify(cleaned);
}

export function parseInquiryData(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "string") {
        result[key] = value;
      } else if (value != null) {
        result[key] = String(value);
      }
    }
    return result;
  } catch {
    return {};
  }
}

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

  async createInquiry(options: {
    projectId: string;
    conversationId?: string | null;
    visitorId?: string;
    title: string;
    data: Record<string, string>;
    appendMode?: boolean;
  }): Promise<{ inquiry: InquiryRow; created: boolean; appended: boolean }> {
    if (options.conversationId) {
      const existing = await this.getInquiryByConversationId(
        options.projectId,
        options.conversationId,
      );
      if (existing) {
        const mergedData = options.appendMode
          ? { ...parseInquiryData(existing.data), ...options.data }
          : options.data;

        await this.db
          .update(inquiries)
          .set({
            visitorId: options.visitorId ?? existing.visitorId,
            title: options.title,
            data: JSON.stringify(mergedData),
          })
          .where(eq(inquiries.id, existing.id));

        return {
          inquiry: (await this.getInquiryById(existing.id, options.projectId))!,
          created: false,
          appended: Boolean(options.appendMode),
        };
      }
    }

    const id = crypto.randomUUID();
    await this.db.insert(inquiries).values({
      id,
      projectId: options.projectId,
      conversationId: options.conversationId ?? null,
      visitorId: options.visitorId ?? null,
      title: options.title,
      data: JSON.stringify(options.data),
    });

    return {
      inquiry: (await this.getInquiryById(id, options.projectId))!,
      created: true,
      appended: false,
    };
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

  async getInquiryByConversationId(
    projectId: string,
    conversationId: string,
  ): Promise<InquiryRow | null> {
    const rows = await this.db
      .select()
      .from(inquiries)
      .where(
        and(
          eq(inquiries.projectId, projectId),
          eq(inquiries.conversationId, conversationId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
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

  async bulkUpdateInquiryStatus(
    ids: string[],
    projectId: string,
    status: "new" | "replied" | "closed",
  ): Promise<number> {
    await this.db
      .update(inquiries)
      .set({ status })
      .where(
        and(inArray(inquiries.id, ids), eq(inquiries.projectId, projectId)),
      );
    return ids.length;
  }

  // ─── Greetings ──────────────────────────────────────────────────────────────

  async getGreetings(projectId: string): Promise<GreetingRow[]> {
    return this.db
      .select()
      .from(greetings)
      .where(eq(greetings.projectId, projectId))
      .orderBy(asc(greetings.sortOrder), asc(greetings.createdAt));
  }

  async getGreetingById(
    id: string,
    projectId: string,
  ): Promise<GreetingRow | null> {
    const rows = await this.db
      .select()
      .from(greetings)
      .where(eq(greetings.id, id))
      .limit(1);
    if (!rows[0] || rows[0].projectId !== projectId) return null;
    return rows[0];
  }

  async createGreeting(
    projectId: string,
    data: {
      enabled?: boolean;
      imageUrl?: string | null;
      title: string;
      description?: string | null;
      ctaText?: string | null;
      ctaLink?: string | null;
      authorId?: string | null;
      allowedPages?: string[] | null;
      delaySeconds?: number;
      durationSeconds?: number;
      sortOrder?: number;
    },
  ): Promise<GreetingRow> {
    const id = crypto.randomUUID();

    let sortOrder = data.sortOrder;
    if (sortOrder == null) {
      const existing = await this.getGreetings(projectId);
      sortOrder = existing.length;
    }

    const insertValues: NewGreetingRow = {
      id,
      projectId,
      enabled: data.enabled ?? true,
      imageUrl: data.imageUrl ?? null,
      title: data.title,
      description: data.description ?? null,
      ctaText: data.ctaText ?? null,
      ctaLink: data.ctaLink ?? null,
      authorId: data.authorId ?? null,
      allowedPages: serializeAllowedPages(data.allowedPages),
      delaySeconds: data.delaySeconds ?? 3,
      durationSeconds: data.durationSeconds ?? 15,
      sortOrder,
    };

    await this.db.insert(greetings).values(insertValues);
    return (await this.getGreetingById(id, projectId))!;
  }

  async updateGreeting(
    id: string,
    projectId: string,
    updates: {
      enabled?: boolean;
      imageUrl?: string | null;
      title?: string;
      description?: string | null;
      ctaText?: string | null;
      ctaLink?: string | null;
      authorId?: string | null;
      allowedPages?: string[] | null;
      delaySeconds?: number;
      durationSeconds?: number;
      sortOrder?: number;
    },
  ): Promise<GreetingRow | null> {
    const existing = await this.getGreetingById(id, projectId);
    if (!existing) return null;

    const setData: Record<string, unknown> = {};
    if (updates.enabled !== undefined) setData.enabled = updates.enabled;
    if (updates.imageUrl !== undefined) setData.imageUrl = updates.imageUrl;
    if (updates.title !== undefined) setData.title = updates.title;
    if (updates.description !== undefined)
      setData.description = updates.description;
    if (updates.ctaText !== undefined) setData.ctaText = updates.ctaText;
    if (updates.ctaLink !== undefined) setData.ctaLink = updates.ctaLink;
    if (updates.authorId !== undefined) setData.authorId = updates.authorId;
    if (updates.allowedPages !== undefined)
      setData.allowedPages = serializeAllowedPages(updates.allowedPages);
    if (updates.delaySeconds !== undefined)
      setData.delaySeconds = updates.delaySeconds;
    if (updates.durationSeconds !== undefined)
      setData.durationSeconds = updates.durationSeconds;
    if (updates.sortOrder !== undefined) setData.sortOrder = updates.sortOrder;

    await this.db.update(greetings).set(setData).where(eq(greetings.id, id));

    return this.getGreetingById(id, projectId);
  }

  async deleteGreeting(id: string, projectId: string): Promise<boolean> {
    const existing = await this.getGreetingById(id, projectId);
    if (!existing) return false;
    await this.db.delete(greetings).where(eq(greetings.id, id));
    return true;
  }

  async reorderGreetings(projectId: string, ids: string[]): Promise<void> {
    const existing = await this.getGreetings(projectId);
    const validIds = new Set(existing.map((g) => g.id));
    const filtered = ids.filter((id) => validIds.has(id));

    for (let i = 0; i < filtered.length; i++) {
      await this.db
        .update(greetings)
        .set({ sortOrder: i })
        .where(eq(greetings.id, filtered[i]!));
    }
  }

  async getEnabledGreetingsWithAuthors(
    projectId: string,
  ): Promise<GreetingPublic[]> {
    const rows = await this.db
      .select()
      .from(greetings)
      .where(
        and(eq(greetings.projectId, projectId), eq(greetings.enabled, true)),
      )
      .orderBy(asc(greetings.sortOrder), asc(greetings.createdAt));

    if (rows.length === 0) return [];

    const authorIds = Array.from(
      new Set(
        rows
          .map((r) => r.authorId)
          .filter((v): v is string => Boolean(v)),
      ),
    );

    const authorMap = new Map<
      string,
      { id: string; name: string; avatar: string | null; workTitle: string | null }
    >();

    if (authorIds.length > 0) {
      const authorRows = await this.db
        .select({
          id: users.id,
          name: users.name,
          image: users.image,
          profilePicture: users.profilePicture,
          workTitle: users.workTitle,
        })
        .from(users)
        .where(inArray(users.id, authorIds));

      for (const a of authorRows) {
        authorMap.set(a.id, {
          id: a.id,
          name: a.name,
          avatar: a.profilePicture ?? a.image,
          workTitle: a.workTitle,
        });
      }
    }

    return rows.map((row) => ({
      id: row.id,
      enabled: row.enabled,
      imageUrl: row.imageUrl,
      title: row.title,
      description: row.description,
      ctaText: row.ctaText,
      ctaLink: row.ctaLink,
      author: row.authorId ? authorMap.get(row.authorId) ?? null : null,
      allowedPages: parseAllowedPages(row.allowedPages),
      delaySeconds: row.delaySeconds,
      durationSeconds: row.durationSeconds,
      sortOrder: row.sortOrder,
    }));
  }

  // ─── Full Widget Config for Embed ───────────────────────────────────────────

  async getFullWidgetConfig(projectId: string) {
    const [config, actions, settings, formConfig, greetingList] =
      await Promise.all([
        this.getWidgetConfig(projectId),
        this.getQuickActions(projectId),
        this.db
          .select()
          .from(projectSettings)
          .where(eq(projectSettings.projectId, projectId))
          .limit(1),
        this.getInquiryConfig(projectId),
        this.getEnabledGreetingsWithAuthors(projectId),
      ]);

    // Back-compat shim: keep legacy intro fields populated for cached widget
    // bundles that still read them. New widget reads `greetings` instead.
    const firstGreeting = greetingList[0] ?? null;
    const legacyAuthor = firstGreeting?.author ?? null;

    return {
      widget: config,
      quickActions: actions,
      greetings: greetingList,
      // Legacy intro fields — derived from first greeting if present, else project_settings
      introMessage:
        firstGreeting?.title ??
        settings[0]?.introMessage ??
        "Hi there! How can I help you today?",
      introMessageAuthor: legacyAuthor
        ? {
            name: legacyAuthor.name,
            avatar: legacyAuthor.avatar,
            workTitle: legacyAuthor.workTitle,
          }
        : null,
      introMessageDelay:
        firstGreeting?.delaySeconds ?? settings[0]?.introMessageDelay ?? 1,
      introMessageDuration:
        firstGreeting?.durationSeconds ??
        settings[0]?.introMessageDuration ??
        15,
      botName: settings[0]?.botName ?? null,
      agentName: settings[0]?.agentName ?? null,
      companyName: settings[0]?.companyName ?? null,
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

export function buildInquiryTitle(options: {
  visitorName?: string | null;
  visitorEmail?: string | null;
  visitorId?: string | null;
}): string {
  const visitorName = options.visitorName?.trim() ?? "";
  const visitorEmail = options.visitorEmail?.trim() ?? "";
  const visitorId = options.visitorId?.trim() ?? "";

  if (visitorName && visitorEmail) {
    return `${visitorName} <${visitorEmail}>`;
  }

  if (visitorName) {
    return visitorName;
  }

  if (visitorEmail) {
    return visitorEmail;
  }

  if (visitorId) {
    return `Visitor ${visitorId}`;
  }

  return "Inquiry";
}
