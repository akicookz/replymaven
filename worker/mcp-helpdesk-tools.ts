import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type HelpArticleRow, type HelpCategoryRow } from "./db";
import { HelpdeskService } from "./services/helpdesk-service";
import { ProjectService } from "./services/project-service";
import { triggerAutoRagSync } from "./services/autorag-sync";
import { buildHelpUrl } from "./helpdesk-render/build-help-url";
import {
  createHelpArticleSchema,
  createHelpCategorySchema,
  updateHelpArticleSchema,
  updateHelpCategorySchema,
} from "./validation";
import {
  confirmedMutationSchema,
  getAccessibleProject,
  requireScope,
  serializeDate,
  textResult,
  type McpRequestContext,
} from "./mcp-tool-helpers";

export function registerHelpdeskTools(
  server: McpServer,
  context: McpRequestContext,
): void {
  registerListHelpCategoriesTool(server, context);
  registerListHelpArticlesTool(server, context);
  registerGetHelpArticleTool(server, context);
  registerCreateHelpCategoryTool(server, context);
  registerUpdateHelpCategoryTool(server, context);
  registerArchiveHelpCategoryTool(server, context);
  registerCreateHelpArticleTool(server, context);
  registerUpdateHelpArticleTool(server, context);
  registerDeleteHelpArticleTool(server, context);
}

function helpdeskService(context: McpRequestContext): HelpdeskService {
  return new HelpdeskService(context.db, context.env.UPLOADS);
}

// ─── Read Tools ───────────────────────────────────────────────────────────────

function registerListHelpCategoriesTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "list_help_categories",
    {
      title: "List help categories",
      description:
        "List the help center's categories with per-category article counts (drafts included).",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      requireScope(context, "projects:read");

      const project = await getAccessibleProject(context, projectId);
      const service = helpdeskService(context);
      const [categories, counts] = await Promise.all([
        service.listCategories(project.id),
        service.getArticleCountsByCategory(project.id),
      ]);

      return textResult({
        categories: categories.map((category) =>
          summarizeHelpCategory(category, counts.get(category.id) ?? 0),
        ),
      });
    },
  );
}

function registerListHelpArticlesTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "list_help_articles",
    {
      title: "List help articles",
      description:
        "List help center articles as summaries without body content. Use get_help_article to read one.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        categoryId: z
          .string()
          .min(1)
          .optional()
          .describe("Only list articles in this category."),
        status: z
          .enum(["draft", "published"])
          .optional()
          .describe("Only list articles with this status."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, categoryId, status }) => {
      requireScope(context, "projects:read");

      const project = await getAccessibleProject(context, projectId);
      const articles = await helpdeskService(context).listArticles(project.id, {
        categoryId,
        status,
      });

      return textResult({ articles: articles.map(summarizeHelpArticle) });
    },
  );
}

function registerGetHelpArticleTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "get_help_article",
    {
      title: "Get help article",
      description:
        "Read a help center article including its full markdown content and, when published, its live URL.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        articleId: z.string().min(1).describe("Help article ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, articleId }) => {
      requireScope(context, "projects:read");

      const project = await getAccessibleProject(context, projectId);
      const service = helpdeskService(context);
      const article = await service.getArticleById(articleId, project.id);
      if (!article) throw new Error("Article not found");

      const category = await service.getCategoryById(
        article.categoryId,
        project.id,
      );

      return textResult({
        article: {
          ...summarizeHelpArticle(article),
          content: article.content,
          url: await liveArticleUrl(context, project, article, category),
        },
      });
    },
  );
}

// ─── Category Write Tools ─────────────────────────────────────────────────────

function registerCreateHelpCategoryTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "create_help_category",
    {
      title: "Create help category",
      description:
        "Create a help center category. The slug is derived from the name when omitted and de-duplicated automatically.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        name: createHelpCategorySchema.shape.name.describe(
          "Category name, max 100 characters.",
        ),
        slug: createHelpCategorySchema.shape.slug.describe(
          "Optional URL slug: lowercase letters, numbers, and hyphens, max 60 characters.",
        ),
        description: createHelpCategorySchema.shape.description.describe(
          "Optional category description, max 500 characters.",
        ),
        sortOrder: createHelpCategorySchema.shape.sortOrder.describe(
          "Optional position in the category list. Appended last when omitted.",
        ),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, name, slug, description, sortOrder }) => {
      requireScope(context, "helpdesk:write");

      const project = await getAccessibleProject(context, projectId);
      const created = await helpdeskService(context).createCategory(
        { name: name.trim(), slug, description: description ?? null, sortOrder },
        project.id,
      );

      return textResult({ ok: true, category: summarizeHelpCategory(created) });
    },
  );
}

function registerUpdateHelpCategoryTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "update_help_category",
    {
      title: "Update help category",
      description:
        "Update a help center category's name, slug, description, or position. Omitted fields keep their current value.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        categoryId: z.string().min(1).describe("Help category ID."),
        name: updateHelpCategorySchema.shape.name.describe(
          "Replacement name, max 100 characters.",
        ),
        slug: updateHelpCategorySchema.shape.slug.describe(
          "Replacement URL slug: lowercase letters, numbers, and hyphens, max 60 characters. Changing it breaks existing links.",
        ),
        description: updateHelpCategorySchema.shape.description.describe(
          "Replacement description, max 500 characters. Pass null to clear.",
        ),
        sortOrder: updateHelpCategorySchema.shape.sortOrder.describe(
          "Replacement position in the category list.",
        ),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, categoryId, name, slug, description, sortOrder }) => {
      requireScope(context, "helpdesk:write");

      const project = await getAccessibleProject(context, projectId);
      const updated = await helpdeskService(context).updateCategory(
        categoryId,
        project.id,
        { name, slug, description, sortOrder },
      );
      if (!updated) throw new Error("Category not found");

      return textResult({ ok: true, category: summarizeHelpCategory(updated) });
    },
  );
}

function registerArchiveHelpCategoryTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "archive_help_category",
    {
      title: "Archive help category",
      description:
        "Archive a help center category. Its published articles are unpublished and the category disappears from the help center. Articles are retained but there is no unarchive through MCP.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        categoryId: z.string().min(1).describe("Help category ID."),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, categoryId }) => {
      requireScope(context, "helpdesk:write");

      const project = await getAccessibleProject(context, projectId);
      const archived = await helpdeskService(context).archiveCategory(
        categoryId,
        project.id,
      );
      if (!archived) throw new Error("Category not found");

      context.executionCtx.waitUntil(
        triggerAutoRagSync(context.env, "mcp.helpdesk.category.archive"),
      );

      return textResult({
        ok: true,
        message: "Category archived and its published articles unpublished.",
      });
    },
  );
}

// ─── Article Write Tools ──────────────────────────────────────────────────────

function registerCreateHelpArticleTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "create_help_article",
    {
      title: "Create help article",
      description:
        "Create a help center article. Content is markdown. Articles default to draft; pass status \"published\" to make the article live immediately.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        categoryId: createHelpArticleSchema.shape.categoryId.describe(
          "Help category ID the article belongs to.",
        ),
        title: createHelpArticleSchema.shape.title.describe(
          "Article title, max 200 characters.",
        ),
        slug: createHelpArticleSchema.shape.slug.describe(
          "Optional URL slug: lowercase letters, numbers, and hyphens, max 80 characters. Derived from the title and de-duplicated when omitted.",
        ),
        excerpt: createHelpArticleSchema.shape.excerpt.describe(
          "Optional summary shown in listings and search, max 280 characters.",
        ),
        content: createHelpArticleSchema.shape.content.describe(
          "Markdown body, max 100,000 characters. Images must be already-hosted URLs.",
        ),
        status: createHelpArticleSchema.shape.status.describe(
          'Initial status. Defaults to "draft".',
        ),
        sortOrder: createHelpArticleSchema.shape.sortOrder.describe(
          "Optional position within the category. Appended last when omitted.",
        ),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      projectId,
      categoryId,
      title,
      slug,
      excerpt,
      content,
      status,
      sortOrder,
    }) => {
      requireScope(context, "helpdesk:write");

      const project = await getAccessibleProject(context, projectId);
      const service = helpdeskService(context);
      const created = await service.createArticle(
        {
          categoryId,
          title: title.trim(),
          slug,
          excerpt: excerpt ?? null,
          content,
          status,
          sortOrder,
        },
        project.id,
        project.slug,
      );

      if (created.status === "published") {
        context.executionCtx.waitUntil(
          triggerAutoRagSync(context.env, "mcp.helpdesk.article.create"),
        );
      }

      const category = await service.getCategoryById(
        created.categoryId,
        project.id,
      );

      return textResult({
        ok: true,
        article: {
          ...summarizeHelpArticle(created),
          url: await liveArticleUrl(context, project, created, category),
        },
      });
    },
  );
}

function registerUpdateHelpArticleTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "update_help_article",
    {
      title: "Update help article",
      description:
        'Update a help center article. Omitted fields keep their current value. Publishing and unpublishing happen here: status "published" puts the article live and indexes it for the AI, status "draft" takes it down.',
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        articleId: z.string().min(1).describe("Help article ID."),
        categoryId: updateHelpArticleSchema.shape.categoryId.describe(
          "Move the article to this category.",
        ),
        title: updateHelpArticleSchema.shape.title.describe(
          "Replacement title, max 200 characters.",
        ),
        slug: updateHelpArticleSchema.shape.slug.describe(
          "Replacement URL slug: lowercase letters, numbers, and hyphens, max 80 characters. Changing it breaks existing links.",
        ),
        excerpt: updateHelpArticleSchema.shape.excerpt.describe(
          "Replacement summary, max 280 characters. Pass null to clear.",
        ),
        content: updateHelpArticleSchema.shape.content.describe(
          "Replacement markdown body, max 100,000 characters. Replaces the whole body.",
        ),
        status: updateHelpArticleSchema.shape.status.describe(
          '"published" makes the article live; "draft" unpublishes it.',
        ),
        sortOrder: updateHelpArticleSchema.shape.sortOrder.describe(
          "Replacement position within the category.",
        ),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      projectId,
      articleId,
      categoryId,
      title,
      slug,
      excerpt,
      content,
      status,
      sortOrder,
    }) => {
      requireScope(context, "helpdesk:write");

      const project = await getAccessibleProject(context, projectId);
      const service = helpdeskService(context);
      const updated = await service.updateArticle(
        articleId,
        project.id,
        { categoryId, title, slug, excerpt, content, status, sortOrder },
        project.slug,
      );
      if (!updated) throw new Error("Article not found");

      context.executionCtx.waitUntil(
        triggerAutoRagSync(context.env, "mcp.helpdesk.article.update"),
      );

      const category = await service.getCategoryById(
        updated.categoryId,
        project.id,
      );

      return textResult({
        ok: true,
        article: {
          ...summarizeHelpArticle(updated),
          url: await liveArticleUrl(context, project, updated, category),
        },
      });
    },
  );
}

function registerDeleteHelpArticleTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "delete_help_article",
    {
      title: "Delete help article",
      description:
        'Permanently delete a help center article. This cannot be undone — prefer unpublishing (update_help_article with status "draft") unless the user explicitly asked for deletion.',
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        articleId: z.string().min(1).describe("Help article ID."),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, articleId }) => {
      requireScope(context, "helpdesk:write");

      const project = await getAccessibleProject(context, projectId);
      const deleted = await helpdeskService(context).deleteArticle(
        articleId,
        project.id,
      );
      if (!deleted) throw new Error("Article not found");

      context.executionCtx.waitUntil(
        triggerAutoRagSync(context.env, "mcp.helpdesk.article.delete"),
      );

      return textResult({ ok: true });
    },
  );
}

// ─── Serialization ────────────────────────────────────────────────────────────

function summarizeHelpCategory(
  category: HelpCategoryRow,
  articleCount?: number,
): Record<string, unknown> {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    sortOrder: category.sortOrder,
    ...(articleCount === undefined ? {} : { articleCount }),
    createdAt: serializeDate(category.createdAt),
    updatedAt: serializeDate(category.updatedAt),
  };
}

function summarizeHelpArticle(article: HelpArticleRow): Record<string, unknown> {
  return {
    id: article.id,
    categoryId: article.categoryId,
    title: article.title,
    slug: article.slug,
    excerpt: article.excerpt,
    status: article.status,
    sortOrder: article.sortOrder,
    publishedAt: serializeDate(article.publishedAt),
    createdAt: serializeDate(article.createdAt),
    updatedAt: serializeDate(article.updatedAt),
  };
}

async function liveArticleUrl(
  context: McpRequestContext,
  project: { id: string; slug: string },
  article: HelpArticleRow,
  category: HelpCategoryRow | null,
): Promise<string | null> {
  if (article.status !== "published" || !category) return null;
  const settings = await new ProjectService(context.db).getSettings(project.id);
  return buildHelpUrl({
    projectSlug: project.slug,
    customUrl: settings?.helpCustomUrl ?? null,
    category: category.slug,
    article: article.slug,
  });
}
