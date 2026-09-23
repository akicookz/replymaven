import { type DrizzleD1Database } from "drizzle-orm/d1";
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { type SQLiteColumn } from "drizzle-orm/sqlite-core";
import { applyPatch, parsePatch } from "diff";
import {
  helpArticles,
  helpCategories,
  helpTabs,
  resources,
  type HelpArticleRow,
  type HelpCategoryRow,
  type HelpTabRow,
  type NewHelpArticleRow,
  type NewHelpCategoryRow,
  type NewHelpTabRow,
  type NewResourceRow,
} from "../db";
import { slugify } from "../lib/slugify";
import { buildHelpUrl } from "../helpdesk-render/build-help-url";
import { buildFrontmatterMarkdown } from "../helpdesk-render/build-frontmatter-md";
import { applyHelpArticleSeoDefaults } from "../helpdesk-render/apply-help-article-seo-defaults";
import { helpArticleR2RefreshAction } from "../helpdesk-render/help-article-r2-refresh";

export const MAX_HELP_TABS = 6;

interface CreateTabInput {
  name: string;
}

interface UpdateTabInput {
  name?: string;
  sortOrder?: number;
}

export interface HelpTabWithCount extends HelpTabRow {
  categoryCount: number;
}

/** Thrown when a tab write is refused. `code` is surfaced to callers. */
export class HelpTabWriteError extends Error {
  constructor(
    message: string,
    readonly code: "tab_limit" | "tab_not_empty" | "tab_not_found",
  ) {
    super(message);
    this.name = "HelpTabWriteError";
  }
}

interface CreateCategoryInput {
  tabId?: string;
  name: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
  sortOrder?: number;
}

interface UpdateCategoryInput {
  tabId?: string;
  name?: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
  sortOrder?: number;
}

interface CreateArticleInput {
  categoryId: string;
  title: string;
  slug?: string;
  excerpt?: string | null;
  ogImageUrl?: string | null;
  content?: string;
  status?: "draft" | "published";
  sortOrder?: number;
}

interface UpdateArticleInput {
  categoryId?: string;
  title?: string;
  slug?: string;
  excerpt?: string | null;
  ogImageUrl?: string | null;
  content?: string;
  /** Unified diff applied to the current body. Mutually exclusive with content. */
  contentPatch?: string;
  /** Optimistic concurrency guard: the updatedAt the caller last read. */
  expectedUpdatedAt?: Date;
  status?: "draft" | "published";
  sortOrder?: number;
}

/** Thrown when a write is rejected rather than applied. `code` is surfaced to callers. */
export class HelpArticleWriteError extends Error {
  constructor(
    message: string,
    readonly code:
      | "patch_did_not_apply"
      | "malformed_patch"
      | "patch_result_too_large"
      | "stale_article",
    readonly currentUpdatedAt?: Date,
  ) {
    super(message);
    this.name = "HelpArticleWriteError";
  }
}

interface ReorderItem {
  id: string;
  sortOrder: number;
}

interface ListArticlesOptions {
  categoryId?: string;
  status?: "draft" | "published";
}

export type HelpArticleNav = Omit<HelpArticleRow, "content">;

const helpArticleNavColumns = {
  id: helpArticles.id,
  projectId: helpArticles.projectId,
  categoryId: helpArticles.categoryId,
  title: helpArticles.title,
  slug: helpArticles.slug,
  excerpt: helpArticles.excerpt,
  ogImageUrl: helpArticles.ogImageUrl,
  status: helpArticles.status,
  sortOrder: helpArticles.sortOrder,
  publishedAt: helpArticles.publishedAt,
  createdAt: helpArticles.createdAt,
  updatedAt: helpArticles.updatedAt,
} as const;

export class HelpdeskService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private r2: R2Bucket,
  ) {}

  // ─── Tabs ──────────────────────────────────────────────────────────────────

  async listTabs(projectId: string): Promise<HelpTabRow[]> {
    return this.db
      .select()
      .from(helpTabs)
      .where(eq(helpTabs.projectId, projectId))
      .orderBy(asc(helpTabs.sortOrder), asc(helpTabs.createdAt));
  }

  async getTabById(id: string, projectId: string): Promise<HelpTabRow | null> {
    const rows = await this.db
      .select()
      .from(helpTabs)
      .where(and(eq(helpTabs.id, id), eq(helpTabs.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Active categories per tab. Categories with no tab count toward the first tab. */
  async listTabsWithCategoryCounts(
    projectId: string,
  ): Promise<HelpTabWithCount[]> {
    const [tabs, rows] = await Promise.all([
      this.listTabs(projectId),
      this.db
        .select({
          tabId: helpCategories.tabId,
          count: sql<number>`count(*)`,
        })
        .from(helpCategories)
        .where(
          and(
            eq(helpCategories.projectId, projectId),
            isNull(helpCategories.archivedAt),
          ),
        )
        .groupBy(helpCategories.tabId),
    ]);
    const firstTabId = tabs[0]?.id ?? null;
    const counts = new Map<string, number>();
    for (const row of rows) {
      const tabId = row.tabId ?? firstTabId;
      if (!tabId) continue;
      counts.set(tabId, (counts.get(tabId) ?? 0) + Number(row.count));
    }
    return tabs.map((tab) => ({
      ...tab,
      categoryCount: counts.get(tab.id) ?? 0,
    }));
  }

  /**
   * The first tab of a project adopts every category that has no tab, so
   * once tabs exist each category belongs to one.
   */
  async createTab(
    data: CreateTabInput,
    projectId: string,
  ): Promise<HelpTabRow> {
    const existing = await this.listTabs(projectId);
    if (existing.length >= MAX_HELP_TABS) {
      throw new HelpTabWriteError(
        `A help center can have at most ${MAX_HELP_TABS} tabs.`,
        "tab_limit",
      );
    }
    const last = existing[existing.length - 1];
    const id = crypto.randomUUID();
    const row: NewHelpTabRow = {
      id,
      projectId,
      name: data.name,
      sortOrder: last ? last.sortOrder + 1 : 0,
    };
    if (existing.length === 0) {
      await this.db.batch([
        this.db.insert(helpTabs).values(row),
        this.db
          .update(helpCategories)
          .set({ tabId: id })
          .where(
            and(
              eq(helpCategories.projectId, projectId),
              isNull(helpCategories.tabId),
            ),
          ),
      ]);
    } else {
      await this.db.insert(helpTabs).values(row);
    }
    return (await this.getTabById(id, projectId))!;
  }

  async updateTab(
    id: string,
    projectId: string,
    updates: UpdateTabInput,
  ): Promise<HelpTabRow | null> {
    const existing = await this.getTabById(id, projectId);
    if (!existing) return null;
    const patch: Partial<NewHelpTabRow> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.sortOrder !== undefined) patch.sortOrder = updates.sortOrder;
    if (Object.keys(patch).length > 0) {
      await this.db
        .update(helpTabs)
        .set(patch)
        .where(and(eq(helpTabs.id, id), eq(helpTabs.projectId, projectId)));
    }
    return this.getTabById(id, projectId);
  }

  async reorderTabs(projectId: string, items: ReorderItem[]): Promise<void> {
    const existing = await this.listTabs(projectId);
    const valid = new Set(existing.map((t) => t.id));
    for (const item of items) {
      if (!valid.has(item.id)) continue;
      await this.db
        .update(helpTabs)
        .set({ sortOrder: item.sortOrder })
        .where(
          and(eq(helpTabs.id, item.id), eq(helpTabs.projectId, projectId)),
        );
    }
  }

  /** Only an empty tab can be deleted. Archived categories keep no tab. */
  async deleteTab(id: string, projectId: string): Promise<boolean> {
    const tabs = await this.listTabsWithCategoryCounts(projectId);
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return false;
    if (tab.categoryCount > 0) {
      throw new HelpTabWriteError(
        "Move or archive this tab's categories first.",
        "tab_not_empty",
      );
    }
    await this.db.batch([
      this.db
        .update(helpCategories)
        .set({ tabId: null })
        .where(
          and(
            eq(helpCategories.projectId, projectId),
            eq(helpCategories.tabId, id),
          ),
        ),
      this.db
        .delete(helpTabs)
        .where(and(eq(helpTabs.id, id), eq(helpTabs.projectId, projectId))),
    ]);
    return true;
  }

  /** An explicit tab must exist; without one a category joins the first tab, if any. */
  private async resolveCategoryTabId(
    projectId: string,
    tabId: string | undefined,
  ): Promise<string | null> {
    if (tabId) {
      const tab = await this.getTabById(tabId, projectId);
      if (!tab) {
        throw new HelpTabWriteError("Tab not found", "tab_not_found");
      }
      return tab.id;
    }
    const tabs = await this.listTabs(projectId);
    return tabs[0]?.id ?? null;
  }

  // ─── Categories ────────────────────────────────────────────────────────────

  async listCategories(projectId: string): Promise<HelpCategoryRow[]> {
    return this.db
      .select()
      .from(helpCategories)
      .where(
        and(
          eq(helpCategories.projectId, projectId),
          isNull(helpCategories.archivedAt),
        ),
      )
      .orderBy(asc(helpCategories.sortOrder), asc(helpCategories.createdAt));
  }

  async getCategoryById(
    id: string,
    projectId: string,
  ): Promise<HelpCategoryRow | null> {
    const rows = await this.db
      .select()
      .from(helpCategories)
      .where(
        and(
          eq(helpCategories.id, id),
          eq(helpCategories.projectId, projectId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getCategoryBySlug(
    projectId: string,
    slug: string,
  ): Promise<HelpCategoryRow | null> {
    const rows = await this.db
      .select()
      .from(helpCategories)
      .where(
        and(
          eq(helpCategories.projectId, projectId),
          eq(helpCategories.slug, slug),
          isNull(helpCategories.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getArticleCountsByCategory(
    projectId: string,
  ): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        categoryId: helpArticles.categoryId,
        count: sql<number>`count(*)`,
      })
      .from(helpArticles)
      .where(eq(helpArticles.projectId, projectId))
      .groupBy(helpArticles.categoryId);
    return new Map(rows.map((r) => [r.categoryId, Number(r.count)]));
  }

  async createCategory(
    data: CreateCategoryInput,
    projectId: string,
  ): Promise<HelpCategoryRow> {
    const baseSlug = data.slug ?? slugify(data.name);
    if (!baseSlug) {
      throw new Error("Could not derive a slug from the provided name");
    }
    const slug = await this.generateUniqueSlug(
      helpCategories,
      helpCategories.projectId,
      projectId,
      baseSlug,
      helpCategories.slug,
    );

    const sortOrder = data.sortOrder ?? (await this.nextCategorySortOrder(projectId));
    const tabId = await this.resolveCategoryTabId(projectId, data.tabId);
    const id = crypto.randomUUID();
    const row: NewHelpCategoryRow = {
      id,
      projectId,
      tabId,
      name: data.name,
      slug,
      description: data.description ?? null,
      icon: data.icon ?? null,
      sortOrder,
    };
    await this.db.insert(helpCategories).values(row);
    return (await this.getCategoryById(id, projectId))!;
  }

  async updateCategory(
    id: string,
    projectId: string,
    updates: UpdateCategoryInput,
  ): Promise<HelpCategoryRow | null> {
    const existing = await this.getCategoryById(id, projectId);
    if (!existing) return null;

    const patch: Partial<NewHelpCategoryRow> = {};

    if (updates.tabId !== undefined && updates.tabId !== existing.tabId) {
      patch.tabId = await this.resolveCategoryTabId(projectId, updates.tabId);
    }
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.icon !== undefined) patch.icon = updates.icon;
    if (updates.sortOrder !== undefined) patch.sortOrder = updates.sortOrder;

    if (updates.slug !== undefined && updates.slug !== existing.slug) {
      const collision = await this.getCategoryBySlug(projectId, updates.slug);
      if (collision && collision.id !== id) {
        throw new Error("That category slug is already in use");
      }
      patch.slug = updates.slug;
    }

    if (Object.keys(patch).length > 0) {
      await this.db
        .update(helpCategories)
        .set(patch)
        .where(
          and(
            eq(helpCategories.id, id),
            eq(helpCategories.projectId, projectId),
          ),
        );
    }

    return this.getCategoryById(id, projectId);
  }

  /**
   * Soft-archive a category. The row and its articles are retained in the DB,
   * but the category disappears from every listing (`listCategories` /
   * `getCategoryBySlug` filter out archived rows) and its published articles
   * are pulled from R2 so they no longer surface in the public help center,
   * search, or RAG. There is intentionally no hard delete for content groups.
   */
  async archiveCategory(id: string, projectId: string): Promise<boolean> {
    const existing = await this.getCategoryById(id, projectId);
    if (!existing || existing.archivedAt) return false;

    const articles = await this.db
      .select()
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.categoryId, id),
          eq(helpArticles.projectId, projectId),
        ),
      );

    for (const article of articles) {
      if (article.status === "published") {
        await this.unpublishArticleFromR2(article, projectId);
      }
    }

    await this.db
      .update(helpCategories)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(helpCategories.id, id),
          eq(helpCategories.projectId, projectId),
        ),
      );

    return true;
  }

  async reorderCategories(
    projectId: string,
    items: ReorderItem[],
  ): Promise<void> {
    const existing = await this.listCategories(projectId);
    const valid = new Set(existing.map((c) => c.id));
    for (const item of items) {
      if (!valid.has(item.id)) continue;
      await this.db
        .update(helpCategories)
        .set({ sortOrder: item.sortOrder })
        .where(
          and(
            eq(helpCategories.id, item.id),
            eq(helpCategories.projectId, projectId),
          ),
        );
    }
  }

  // ─── Articles ──────────────────────────────────────────────────────────────

  async listArticles(
    projectId: string,
    opts: ListArticlesOptions = {},
  ): Promise<HelpArticleRow[]> {
    const conditions: SQL[] = [eq(helpArticles.projectId, projectId)];
    if (opts.categoryId) {
      conditions.push(eq(helpArticles.categoryId, opts.categoryId));
    }
    if (opts.status) {
      conditions.push(eq(helpArticles.status, opts.status));
    }
    return this.db
      .select()
      .from(helpArticles)
      .where(and(...conditions))
      .orderBy(asc(helpArticles.sortOrder), asc(helpArticles.createdAt));
  }

  async listPublishedArticleNav(
    projectId: string,
  ): Promise<HelpArticleNav[]> {
    return this.db
      .select(helpArticleNavColumns)
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.projectId, projectId),
          eq(helpArticles.status, "published"),
        ),
      )
      .orderBy(
        asc(helpArticles.categoryId),
        asc(helpArticles.sortOrder),
        asc(helpArticles.createdAt),
      );
  }

  async getArticleById(
    id: string,
    projectId: string,
  ): Promise<HelpArticleRow | null> {
    const rows = await this.db
      .select()
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.id, id),
          eq(helpArticles.projectId, projectId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getArticleBySlug(
    projectId: string,
    categorySlug: string,
    articleSlug: string,
  ): Promise<{ article: HelpArticleRow; category: HelpCategoryRow } | null> {
    const category = await this.getCategoryBySlug(projectId, categorySlug);
    if (!category) return null;

    const rows = await this.db
      .select()
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.projectId, projectId),
          eq(helpArticles.categoryId, category.id),
          eq(helpArticles.slug, articleSlug),
        ),
      )
      .limit(1);
    const article = rows[0];
    if (!article) return null;
    return { article, category };
  }

  async createArticle(
    data: CreateArticleInput,
    projectId: string,
    projectSlug?: string,
  ): Promise<HelpArticleRow> {
    const category = await this.getCategoryById(data.categoryId, projectId);
    if (!category) {
      throw new Error("Category not found");
    }

    const baseSlug = data.slug ?? slugify(data.title);
    if (!baseSlug) {
      throw new Error("Could not derive a slug from the provided title");
    }
    const slug = await this.generateUniqueSlug(
      helpArticles,
      helpArticles.categoryId,
      data.categoryId,
      baseSlug,
      helpArticles.slug,
    );

    const status = data.status ?? "draft";
    const sortOrder =
      data.sortOrder ?? (await this.nextArticleSortOrder(data.categoryId));
    const id = crypto.randomUUID();
    const publishedAt = status === "published" ? new Date() : null;
    const content = data.content ?? "";
    const seo = applyHelpArticleSeoDefaults({
      excerpt: data.excerpt,
      ogImageUrl: data.ogImageUrl,
      content,
    });

    const row: NewHelpArticleRow = {
      id,
      projectId,
      categoryId: data.categoryId,
      title: data.title,
      slug,
      excerpt: seo.excerpt,
      ogImageUrl: seo.ogImageUrl,
      content,
      status,
      sortOrder,
      publishedAt,
    };
    await this.db.insert(helpArticles).values(row);

    const created = (await this.getArticleById(id, projectId))!;
    if (status === "published" && projectSlug) {
      await this.publishArticleToR2(created, category, projectId, projectSlug);
    }

    return created;
  }

  async updateArticle(
    id: string,
    projectId: string,
    updates: UpdateArticleInput,
    projectSlug?: string,
  ): Promise<HelpArticleRow | null> {
    const existing = await this.getArticleById(id, projectId);
    if (!existing) return null;

    // Reject a stale write before doing any work. The same check is repeated in
    // the UPDATE's WHERE clause so a write landing in between also fails.
    if (
      updates.expectedUpdatedAt !== undefined &&
      existing.updatedAt.getTime() !== updates.expectedUpdatedAt.getTime()
    ) {
      throw new HelpArticleWriteError(
        "The article changed since you read it. Re-read it and retry.",
        "stale_article",
        existing.updatedAt,
      );
    }

    const patch: Partial<NewHelpArticleRow> = {};

    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.excerpt !== undefined) patch.excerpt = updates.excerpt;
    if (updates.ogImageUrl !== undefined) patch.ogImageUrl = updates.ogImageUrl;
    if (updates.content !== undefined) patch.content = updates.content;
    if (updates.contentPatch !== undefined) {
      patch.content = applyContentPatch(existing.content, updates.contentPatch);
    }
    if (updates.sortOrder !== undefined) patch.sortOrder = updates.sortOrder;

    const targetCategoryId = updates.categoryId ?? existing.categoryId;
    if (updates.categoryId && updates.categoryId !== existing.categoryId) {
      const targetCategory = await this.getCategoryById(
        updates.categoryId,
        projectId,
      );
      if (!targetCategory) {
        throw new Error("Destination category not found");
      }
      patch.categoryId = updates.categoryId;
      if (updates.sortOrder === undefined) {
        patch.sortOrder = await this.nextArticleSortOrder(updates.categoryId);
      }
    }

    const targetSlug = updates.slug ?? existing.slug;
    const slugChanged =
      updates.slug !== undefined && updates.slug !== existing.slug;
    const categoryChanged =
      updates.categoryId !== undefined &&
      updates.categoryId !== existing.categoryId;

    if (slugChanged || categoryChanged) {
      const collision = await this.db
        .select()
        .from(helpArticles)
        .where(
          and(
            eq(helpArticles.categoryId, targetCategoryId),
            eq(helpArticles.slug, targetSlug),
          ),
        )
        .limit(1);
      if (collision[0] && collision[0].id !== id) {
        const err = new Error(
          "An article with that slug already exists in the destination category",
        );
        (err as Error & { code?: string }).code = "slug_conflict";
        throw err;
      }
      if (slugChanged) patch.slug = targetSlug;
    }

    let nextStatus: "draft" | "published" = existing.status;
    if (updates.status !== undefined) {
      nextStatus = updates.status;
      patch.status = updates.status;
      if (updates.status === "published" && existing.status !== "published") {
        patch.publishedAt = new Date();
      } else if (
        updates.status === "draft" &&
        existing.status === "published"
      ) {
        patch.publishedAt = null;
      }
    }

    const mergedContent = patch.content ?? existing.content;
    const seo = applyHelpArticleSeoDefaults({
      excerpt:
        patch.excerpt !== undefined ? patch.excerpt : existing.excerpt,
      ogImageUrl:
        patch.ogImageUrl !== undefined
          ? patch.ogImageUrl
          : existing.ogImageUrl,
      content: mergedContent,
    });
    if (seo.excerpt !== existing.excerpt) patch.excerpt = seo.excerpt;
    if (seo.ogImageUrl !== existing.ogImageUrl) {
      patch.ogImageUrl = seo.ogImageUrl;
    }

    if (Object.keys(patch).length > 0) {
      const scope = and(
        eq(helpArticles.id, id),
        eq(helpArticles.projectId, projectId),
      );

      if (updates.expectedUpdatedAt === undefined) {
        await this.db.update(helpArticles).set(patch).where(scope);
      } else {
        // RETURNING tells us the guard matched. Without it a losing write is
        // indistinguishable from a successful one and would report success.
        const applied = await this.db
          .update(helpArticles)
          .set(patch)
          .where(and(scope, eq(helpArticles.updatedAt, updates.expectedUpdatedAt)))
          .returning({ id: helpArticles.id });
        if (applied.length === 0) {
          const current = await this.getArticleById(id, projectId);
          throw new HelpArticleWriteError(
            "The article changed since you read it. Re-read it and retry.",
            "stale_article",
            current?.updatedAt,
          );
        }
      }
    }

    const updated = await this.getArticleById(id, projectId);

    if (updated && projectSlug) {
      const beforeCategory = await this.getCategoryById(
        existing.categoryId,
        projectId,
      );
      const afterCategory =
        updated.categoryId === existing.categoryId
          ? beforeCategory
          : await this.getCategoryById(updated.categoryId, projectId);
      const refresh = helpArticleR2RefreshAction({
        existingStatus: existing.status,
        nextStatus,
        before: beforeCategory
          ? { article: existing, category: beforeCategory }
          : null,
        after: afterCategory
          ? { article: updated, category: afterCategory }
          : null,
      });

      if (refresh === "publish" && afterCategory) {
        await this.publishArticleToR2(
          updated,
          afterCategory,
          projectId,
          projectSlug,
        );
      } else if (refresh === "unpublish") {
        await this.unpublishArticleFromR2(updated, projectId);
      }
    }

    return updated;
  }

  async deleteArticle(
    id: string,
    projectId: string,
  ): Promise<HelpArticleRow | null> {
    const existing = await this.getArticleById(id, projectId);
    if (!existing) return null;

    if (existing.status === "published") {
      await this.r2.delete(`${projectId}/articles/${existing.id}.md`);
    }

    await this.db
      .delete(helpArticles)
      .where(
        and(
          eq(helpArticles.id, id),
          eq(helpArticles.projectId, projectId),
        ),
      );
    return existing;
  }

  async reorderArticles(
    projectId: string,
    categoryId: string,
    items: ReorderItem[],
  ): Promise<void> {
    const existing = await this.listArticles(projectId, { categoryId });
    const valid = new Set(existing.map((a) => a.id));
    for (const item of items) {
      if (!valid.has(item.id)) continue;
      await this.db
        .update(helpArticles)
        .set({ sortOrder: item.sortOrder })
        .where(
          and(
            eq(helpArticles.id, item.id),
            eq(helpArticles.projectId, projectId),
            eq(helpArticles.categoryId, categoryId),
          ),
        );
    }
  }

  // ─── R2 / RAG Bridge ───────────────────────────────────────────────────────

  private async publishArticleToR2(
    article: HelpArticleRow,
    category: HelpCategoryRow,
    projectId: string,
    projectSlug: string,
  ): Promise<void> {
    const r2Key = `${projectId}/articles/${article.id}.md`;
    const markdown = buildFrontmatterMarkdown(article, category);
    await this.r2.put(r2Key, markdown, {
      customMetadata: {
        context: `Help article: ${article.title}`,
      },
    });

    const canonicalUrl = buildHelpUrl({
      projectSlug,
      customUrl: null,
      category: category.slug,
      article: article.slug,
    });

    const now = new Date();
    const row: NewResourceRow = {
      id: crypto.randomUUID(),
      projectId,
      type: "webpage",
      title: article.title,
      url: canonicalUrl,
      r2Key,
      status: "indexed",
      lastIndexedAt: now,
      sourceArticleId: article.id,
    };

    await this.db
      .insert(resources)
      .values(row)
      .onConflictDoUpdate({
        target: resources.sourceArticleId,
        targetWhere: sql`${resources.sourceArticleId} IS NOT NULL`,
        set: {
          type: "webpage",
          title: article.title,
          url: canonicalUrl,
          r2Key,
          status: "indexed",
          lastIndexedAt: now,
        },
      });
  }

  private async unpublishArticleFromR2(
    article: HelpArticleRow,
    projectId: string,
  ): Promise<void> {
    const r2Key = `${projectId}/articles/${article.id}.md`;
    await this.r2.delete(r2Key);
    await this.db
      .update(resources)
      .set({ status: "pending", lastIndexedAt: null, r2Key: null })
      .where(eq(resources.sourceArticleId, article.id));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async nextCategorySortOrder(projectId: string): Promise<number> {
    const rows = await this.db
      .select({ max: sql<number>`max(${helpCategories.sortOrder})` })
      .from(helpCategories)
      .where(eq(helpCategories.projectId, projectId));
    const max = rows[0]?.max;
    return typeof max === "number" ? max + 1 : 0;
  }

  private async nextArticleSortOrder(categoryId: string): Promise<number> {
    const rows = await this.db
      .select({ max: sql<number>`max(${helpArticles.sortOrder})` })
      .from(helpArticles)
      .where(eq(helpArticles.categoryId, categoryId));
    const max = rows[0]?.max;
    return typeof max === "number" ? max + 1 : 0;
  }

  private async generateUniqueSlug(
    table: typeof helpCategories | typeof helpArticles,
    scopeField: SQLiteColumn,
    scopeValue: string,
    base: string,
    slugField: SQLiteColumn,
  ): Promise<string> {
    let slug = base;
    let suffix = 1;
    while (true) {
      const rows = await this.db
        .select()
        .from(table)
        .where(and(eq(scopeField, scopeValue), eq(slugField, slug)))
        .limit(1);
      if (rows.length === 0) return slug;
      suffix++;
      slug = `${base.slice(0, 70)}-${suffix}`;
    }
  }
}

// ─── Content Patching ─────────────────────────────────────────────────────────

/** Mirrors the `content` cap in worker/validation.ts. */
const MAX_ARTICLE_CONTENT_CHARS = 100_000;

/**
 * Apply a unified diff to an article body with `patch(1)` semantics: the hunk
 * header's line number is a hint, the context lines are the truth, and a hunk
 * that fits nowhere fails the whole patch rather than landing approximately.
 *
 * fuzzFactor stays 0 — the caller just read the exact body, so a fuzzy match
 * that lands slightly off is the silent wrong-place write we are avoiding.
 */
function applyContentPatch(current: string, unifiedDiff: string): string {
  let parsed: ReturnType<typeof parsePatch>;
  try {
    parsed = parsePatch(unifiedDiff);
  } catch (err) {
    throw new HelpArticleWriteError(
      `The patch could not be parsed as a unified diff: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "malformed_patch",
    );
  }

  // Text that parses to zero hunks applies cleanly as a no-op, which would
  // report success for a patch that changed nothing. Reject it instead.
  const hunks = parsed.reduce((total, file) => total + file.hunks.length, 0);
  if (parsed.length !== 1 || hunks === 0) {
    throw new HelpArticleWriteError(
      "The patch is not a single-file unified diff with at least one hunk.",
      "malformed_patch",
    );
  }

  const next = applyPatch(current, parsed[0]!, { fuzzFactor: 0 });
  if (next !== false && next.length > MAX_ARTICLE_CONTENT_CHARS) {
    // `content` is capped in Zod; without this a patch could append past the
    // ceiling the REST and MCP write paths both guarantee.
    throw new HelpArticleWriteError(
      `The patched body would be ${next.length} characters, over the ${MAX_ARTICLE_CONTENT_CHARS} character limit.`,
      "patch_result_too_large",
    );
  }
  if (next === false) {
    throw new HelpArticleWriteError(
      "No hunk in the patch matched the current article body. Re-read the article and rebuild the diff against it.",
      "patch_did_not_apply",
    );
  }
  return next;
}

