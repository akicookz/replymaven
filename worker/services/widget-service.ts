import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, asc, and, inArray } from "drizzle-orm";
import {
  widgetConfig,
  quickActions,
  projectSettings,
  greetings,
  type WidgetConfigRow,
  type QuickActionRow,
  type NewQuickActionRow,
  type GreetingRow,
  type NewGreetingRow,
} from "../db";
import { users } from "../db/auth.schema";
import { TicketService } from "./ticket-service";

export interface GreetingPublic {
  id: string;
  enabled: boolean;
  imageUrl: string | null;
  imagePosition: string | null;
  imageAspect: "landscape" | "square" | null;
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
        | "bannerPosition"
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

  // Note: `type` enum stored value `"inquiry"` is kept for back-compat with
  // installed widget bundles that read this string. The UI label is "Ticket form".
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
      imagePosition?: string | null;
      imageAspect?: "landscape" | "square" | null;
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
      imagePosition: data.imagePosition ?? null,
      imageAspect: data.imageAspect ?? null,
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
      imagePosition?: string | null;
      imageAspect?: "landscape" | "square" | null;
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
    if (updates.imagePosition !== undefined)
      setData.imagePosition = updates.imagePosition;
    if (updates.imageAspect !== undefined)
      setData.imageAspect = updates.imageAspect;
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
      imagePosition: row.imagePosition,
      imageAspect: (row.imageAspect as "landscape" | "square" | null) ?? null,
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
    const ticketService = new TicketService(this.db);
    const [config, actions, settings, formConfig, greetingList] =
      await Promise.all([
        this.getWidgetConfig(projectId),
        this.getQuickActions(projectId),
        this.db
          .select()
          .from(projectSettings)
          .where(eq(projectSettings.projectId, projectId))
          .limit(1),
        ticketService.getConfig(projectId),
        this.getEnabledGreetingsWithAuthors(projectId),
      ]);

    // Back-compat shim: keep legacy intro fields populated for cached widget
    // bundles that still read them. New widget reads `greetings` instead.
    const firstGreeting = greetingList[0] ?? null;
    const legacyAuthor = firstGreeting?.author ?? null;

    const formPayload = formConfig?.enabled
      ? {
          description: formConfig.description,
          fields: JSON.parse(formConfig.fields || "[]"),
        }
      : null;

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
      // Legacy key kept so installed widget bundles still find the form config.
      inquiryForm: formPayload,
      // Canonical key for new widget bundles.
      ticketForm: formPayload,
    };
  }
}
