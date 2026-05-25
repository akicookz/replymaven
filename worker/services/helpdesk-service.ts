import { type DrizzleD1Database } from "drizzle-orm/d1";
import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { type SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  helpArticles,
  helpCategories,
  resources,
  type HelpArticleRow,
  type HelpCategoryRow,
  type NewHelpArticleRow,
  type NewHelpCategoryRow,
  type NewResourceRow,
} from "../db";
import { slugify } from "../lib/slugify";
import { buildHelpUrl } from "../helpdesk-render/build-help-url";
import { buildFrontmatterMarkdown } from "../helpdesk-render/build-frontmatter-md";

interface CreateCategoryInput {
  name: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
  sortOrder?: number;
}

interface UpdateCategoryInput {
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
  content?: string;
  status?: "draft" | "published";
  sortOrder?: number;
}

interface UpdateArticleInput {
  categoryId?: string;
  title?: string;
  slug?: string;
  excerpt?: string | null;
  content?: string;
  status?: "draft" | "published";
  sortOrder?: number;
}

interface ReorderItem {
  id: string;
  sortOrder: number;
}

interface ListArticlesOptions {
  categoryId?: string;
  status?: "draft" | "published";
}

export class HelpdeskService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private r2: R2Bucket,
  ) {}

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
    const id = crypto.randomUUID();
    const row: NewHelpCategoryRow = {
      id,
      projectId,
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

  async listAllPublishedArticles(
    projectId: string,
  ): Promise<HelpArticleRow[]> {
    return this.db
      .select()
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

  async listRecentlyPublishedArticles(
    projectId: string,
    limit = 6,
  ): Promise<HelpArticleRow[]> {
    return this.db
      .select()
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.projectId, projectId),
          eq(helpArticles.status, "published"),
        ),
      )
      .orderBy(desc(helpArticles.publishedAt))
      .limit(limit);
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

    const row: NewHelpArticleRow = {
      id,
      projectId,
      categoryId: data.categoryId,
      title: data.title,
      slug,
      excerpt: data.excerpt ?? null,
      content: data.content ?? "",
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

    const patch: Partial<NewHelpArticleRow> = {};

    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.excerpt !== undefined) patch.excerpt = updates.excerpt;
    if (updates.content !== undefined) patch.content = updates.content;
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

    if (Object.keys(patch).length > 0) {
      await this.db
        .update(helpArticles)
        .set(patch)
        .where(
          and(
            eq(helpArticles.id, id),
            eq(helpArticles.projectId, projectId),
          ),
        );
    }

    const updated = await this.getArticleById(id, projectId);

    if (updated && projectSlug) {
      const transitionedToPublished =
        existing.status !== "published" && nextStatus === "published";
      const transitionedToDraft =
        existing.status === "published" && nextStatus === "draft";

      const stayedPublished =
        existing.status === "published" && nextStatus === "published";
      const contentLikeChanged =
        updates.title !== undefined ||
        updates.content !== undefined ||
        updates.excerpt !== undefined ||
        updates.slug !== undefined ||
        updates.categoryId !== undefined;

      if (transitionedToPublished || (stayedPublished && contentLikeChanged)) {
        const category =
          (await this.getCategoryById(updated.categoryId, projectId)) ?? null;
        if (category) {
          await this.publishArticleToR2(
            updated,
            category,
            projectId,
            projectSlug,
          );
        }
      } else if (transitionedToDraft) {
        await this.unpublishArticleFromR2(updated, projectId);
      }
    }

    return updated;
  }

  async deleteArticle(id: string, projectId: string): Promise<boolean> {
    const existing = await this.getArticleById(id, projectId);
    if (!existing) return false;

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
    return true;
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

