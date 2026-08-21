import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schema } from "./db";
import { registerHelpdeskTools } from "./mcp-helpdesk-tools";
import type { McpRequestContext } from "./mcp-tool-helpers";
import type { McpOAuthScope } from "./services/mcp-oauth-service";
import {
  MAX_HELP_IMAGE_BYTES,
  verifyHelpImageUploadToken,
} from "./security/help-image-upload-token";
import { updateHelpArticleSchema } from "./validation";

type ToolResult = { content: Array<{ type: string; text: string }> };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

interface FakeR2 {
  objects: Map<string, string>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

function createFakeR2(): FakeR2 {
  return {
    objects: new Map(),
    async put(key, value) {
      this.objects.set(key, value);
    },
    async delete(key) {
      this.objects.delete(key);
    },
  };
}

function createTestDb(): { db: DrizzleD1Database<Record<string, unknown>>; sqlite: Database } {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(`CREATE TABLE projects (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    domain text,
    onboarded integer DEFAULT 0 NOT NULL,
    created_at integer DEFAULT (unixepoch()) NOT NULL,
    updated_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE project_settings (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    gemini_api_key text,
    ai_search_instance_name text,
    telegram_bot_token text,
    customer_identity_secret text,
    telegram_chat_id text,
    company_name text,
    company_url text,
    industry text,
    company_context text,
    bot_name text,
    agent_name text,
    tone_of_voice text DEFAULT 'professional' NOT NULL,
    custom_tone_prompt text,
    intro_message text DEFAULT 'Hi there! How can I help you today?',
    intro_message_author_id text,
    intro_message_delay integer DEFAULT 1 NOT NULL,
    intro_message_duration integer DEFAULT 15 NOT NULL,
    auto_canned_draft integer DEFAULT 1 NOT NULL,
    auto_close_minutes integer DEFAULT 30,
    working_hours text,
    avg_response_time text,
    help_custom_url text,
    help_top_nav text,
    help_custom_css text,
    help_analytics text,
    help_home_markdown text,
    help_home_background_url text,
    help_home_background_position text,
    help_home_background_fit text,
    created_at integer DEFAULT (unixepoch()) NOT NULL,
    updated_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE help_categories (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    icon text,
    sort_order integer DEFAULT 0 NOT NULL,
    archived_at integer,
    created_at integer DEFAULT (unixepoch()) NOT NULL,
    updated_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE help_articles (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    category_id text NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    excerpt text,
    og_image_url text,
    content text DEFAULT '' NOT NULL,
    status text DEFAULT 'draft' NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    published_at integer,
    created_at integer DEFAULT (unixepoch()) NOT NULL,
    updated_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE resources (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    description text,
    url text,
    r2_key text,
    content text,
    status text DEFAULT 'pending' NOT NULL,
    last_indexed_at integer,
    source_article_id text,
    created_at integer DEFAULT (unixepoch()) NOT NULL,
    updated_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  sqlite.exec(
    `CREATE UNIQUE INDEX idx_resources_source_article_id_unique
     ON resources (source_article_id) WHERE source_article_id IS NOT NULL`,
  );
  sqlite.exec(
    "INSERT INTO projects (id, user_id, name, slug) VALUES " +
      "('project-1', 'owner-1', 'Acme', 'acme'), " +
      "('project-2', 'other-owner', 'Rival', 'rival')",
  );
  const db = drizzleSqlite(sqlite, { schema }) as unknown as DrizzleD1Database<
    Record<string, unknown>
  >;
  return { db, sqlite };
}

interface Harness {
  tools: Map<string, ToolHandler>;
  r2: FakeR2;
  sqlite: Database;
}

function createHarness(options?: {
  scopes?: McpOAuthScope[];
  activeRole?: "owner" | "admin" | "member";
  activeAccessAllProjects?: boolean;
  activeProjectIds?: string[] | null;
}): Harness {
  const { db, sqlite } = createTestDb();
  const r2 = createFakeR2();
  const context = {
    db,
    conversationStore: {},
    env: {
      UPLOADS: r2,
      ENCRYPTION_KEY: "test-encryption-key",
      BETTER_AUTH_URL: "https://replymaven.com",
    },
    executionCtx: {
      waitUntil(promise: Promise<unknown>) {
        void Promise.resolve(promise).catch(() => {});
      },
      passThroughOnException() {},
      props: {},
    },
    userId: "owner-1",
    userName: "Owner",
    effectiveUserId: "owner-1",
    activeRole: options?.activeRole ?? "owner",
    activeAccessAllProjects: options?.activeAccessAllProjects ?? true,
    activeProjectIds: options?.activeProjectIds ?? null,
    scopes: options?.scopes ?? [
      "projects:read",
      "helpdesk:write",
    ],
  } as unknown as McpRequestContext;

  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _def: unknown, handler: ToolHandler) {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  registerHelpdeskTools(server, context);
  return { tools, r2, sqlite };
}

async function call(
  harness: Harness,
  tool: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const handler = harness.tools.get(tool);
  if (!handler) throw new Error(`Tool not registered: ${tool}`);
  const result = await handler({ confirm: true, ...input });
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

async function seedCategory(harness: Harness): Promise<string> {
  const created = await call(harness, "create_help_category", {
    projectId: "project-1",
    name: "Getting Started",
  });
  return (created.category as { id: string }).id;
}

describe("MCP helpdesk tools", () => {
  test("registers all eleven tools", () => {
    const harness = createHarness();
    expect([...harness.tools.keys()].sort()).toEqual([
      "archive_help_category",
      "create_help_article",
      "create_help_category",
      "create_help_image_upload",
      "delete_help_article",
      "get_help_article",
      "import_help_image",
      "list_help_articles",
      "list_help_categories",
      "update_help_article",
      "update_help_category",
    ]);
  });

  test("rejects mutations without the helpdesk:write scope", async () => {
    const harness = createHarness({ scopes: ["projects:read", "resources:write"] });
    await expect(
      call(harness, "create_help_category", {
        projectId: "project-1",
        name: "Nope",
      }),
    ).rejects.toThrow("missing required scope: helpdesk:write");
  });

  test("rejects access to another user's project", async () => {
    const harness = createHarness();
    await expect(
      call(harness, "list_help_categories", { projectId: "project-2" }),
    ).rejects.toThrow("Project not found");
  });

  test("rejects members without access to the project", async () => {
    const harness = createHarness({
      activeRole: "member",
      activeAccessAllProjects: false,
      activeProjectIds: ["some-other-project"],
    });
    await expect(
      call(harness, "list_help_categories", { projectId: "project-1" }),
    ).rejects.toThrow("Project not found");
  });

  test("creates categories and lists them with article counts", async () => {
    const harness = createHarness();
    const categoryId = await seedCategory(harness);
    await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Hello World",
    });

    const listed = await call(harness, "list_help_categories", {
      projectId: "project-1",
    });
    const categories = listed.categories as Array<Record<string, unknown>>;
    expect(categories).toHaveLength(1);
    expect(categories[0]!.slug).toBe("getting-started");
    expect(categories[0]!.articleCount).toBe(1);
  });

  test("article listings omit content; get returns it", async () => {
    const harness = createHarness();
    const categoryId = await seedCategory(harness);
    const created = await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Install Guide",
      content: "# Install\n\nRun the thing.",
    });
    const articleId = (created.article as { id: string }).id;

    const listed = await call(harness, "list_help_articles", {
      projectId: "project-1",
    });
    const articles = listed.articles as Array<Record<string, unknown>>;
    expect(articles).toHaveLength(1);
    expect(articles[0]!).not.toHaveProperty("content");

    const fetched = await call(harness, "get_help_article", {
      projectId: "project-1",
      articleId,
    });
    const article = fetched.article as Record<string, unknown>;
    expect(article.content).toBe("# Install\n\nRun the thing.");
    expect(article.url).toBeNull();
  });

  test("create fills description and og fields from the body when omitted", async () => {
    const harness = createHarness();
    const categoryId = await seedCategory(harness);
    const created = await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Install Guide",
      content:
        "# Install\n\nRun the installer.\n\n![setup](https://cdn.example/setup.png)\n",
    });
    const article = created.article as Record<string, unknown>;
    expect(article.excerpt).toBe("Run the installer.");
    expect(article.ogImageUrl).toBe("https://cdn.example/setup.png");
  });

  test("publishing sets publishedAt, mirrors to R2, and returns the live URL", async () => {
    const harness = createHarness();
    const categoryId = await seedCategory(harness);
    const created = await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Billing FAQ",
      content: "How billing works.",
    });
    const articleId = (created.article as { id: string }).id;

    const published = await call(harness, "update_help_article", {
      projectId: "project-1",
      articleId,
      status: "published",
    });
    const article = published.article as Record<string, unknown>;
    expect(article.status).toBe("published");
    expect(article.publishedAt).not.toBeNull();
    expect(article.url).toBe(
      "https://replymaven.com/help/acme/getting-started/billing-faq",
    );
    expect(harness.r2.objects.has(`project-1/articles/${articleId}.md`)).toBe(true);

    const unpublished = await call(harness, "update_help_article", {
      projectId: "project-1",
      articleId,
      status: "draft",
    });
    const draft = unpublished.article as Record<string, unknown>;
    expect(draft.status).toBe("draft");
    expect(draft.publishedAt).toBeNull();
    expect(draft.url).toBeNull();
    expect(harness.r2.objects.has(`project-1/articles/${articleId}.md`)).toBe(false);
  });

  test("published URL honors the custom help domain", async () => {
    const harness = createHarness();
    harness.sqlite.exec(
      "INSERT INTO project_settings (id, project_id, help_custom_url) " +
        "VALUES ('settings-1', 'project-1', 'https://docs.acme.com/help')",
    );
    const categoryId = await seedCategory(harness);
    const created = await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Custom Domain",
      status: "published",
    });
    expect((created.article as Record<string, unknown>).url).toBe(
      "https://docs.acme.com/help/getting-started/custom-domain",
    );
  });

  test("slug conflicts on update surface as errors", async () => {
    const harness = createHarness();
    const categoryId = await seedCategory(harness);
    await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "First",
      slug: "taken",
    });
    const second = await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Second",
    });
    await expect(
      call(harness, "update_help_article", {
        projectId: "project-1",
        articleId: (second.article as { id: string }).id,
        slug: "taken",
      }),
    ).rejects.toThrow("already exists");
  });

  test("archiving a category unpublishes its published articles", async () => {
    const harness = createHarness();
    const categoryId = await seedCategory(harness);
    const created = await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Doomed",
      status: "published",
    });
    const articleId = (created.article as { id: string }).id;
    expect(harness.r2.objects.size).toBe(1);

    await call(harness, "archive_help_category", {
      projectId: "project-1",
      categoryId,
    });
    expect(harness.r2.objects.size).toBe(0);

    const listed = await call(harness, "list_help_categories", {
      projectId: "project-1",
    });
    expect(listed.categories).toHaveLength(0);

    // The article row survives the archive.
    const fetched = await call(harness, "get_help_article", {
      projectId: "project-1",
      articleId,
    });
    expect((fetched.article as Record<string, unknown>).id).toBe(articleId);
  });

  test("delete removes the article and its R2 mirror", async () => {
    const harness = createHarness();
    const categoryId = await seedCategory(harness);
    const created = await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Ephemeral",
      status: "published",
    });
    const articleId = (created.article as { id: string }).id;

    await call(harness, "delete_help_article", {
      projectId: "project-1",
      articleId,
    });
    expect(harness.r2.objects.size).toBe(0);
    await expect(
      call(harness, "get_help_article", { projectId: "project-1", articleId }),
    ).rejects.toThrow("Article not found");
  });
});

describe("update_help_article contentPatch", () => {
  const BODY = [
    "# Install",
    "",
    "Run the installer.",
    "",
    "## Pricing",
    "",
    "Plans start at $10.",
    "",
  ].join("\n");

  async function seedArticle(
    harness: Harness,
    content = BODY,
  ): Promise<string> {
    const categoryId = await seedCategory(harness);
    const created = await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Install",
      content,
    });
    return (created.article as { id: string }).id;
  }

  async function readContent(
    harness: Harness,
    articleId: string,
  ): Promise<string> {
    const fetched = await call(harness, "get_help_article", {
      projectId: "project-1",
      articleId,
    });
    return (fetched.article as { content: string }).content;
  }

  test("applies a hunk and leaves the rest byte-identical", async () => {
    const harness = createHarness();
    const articleId = await seedArticle(harness);

    await call(harness, "update_help_article", {
      projectId: "project-1",
      articleId,
      contentPatch: [
        "@@ -3,5 +3,7 @@",
        " Run the installer.",
        " ",
        "+![Plan comparison](/api/uploads/owner-1/plans.png)",
        "+",
        " ## Pricing",
        " ",
        " Plans start at $10.",
        "",
      ].join("\n"),
    });

    expect(await readContent(harness, articleId)).toBe(
      BODY.replace(
        "## Pricing",
        "![Plan comparison](/api/uploads/owner-1/plans.png)\n\n## Pricing",
      ),
    );
  });

  test("a stale hunk line number still applies via context", async () => {
    const harness = createHarness();
    // Same patch as above, but the header claims a line that has drifted.
    const articleId = await seedArticle(harness, `Preamble.\n\n${BODY}`);

    await call(harness, "update_help_article", {
      projectId: "project-1",
      articleId,
      contentPatch: [
        "@@ -3,5 +3,6 @@",
        " Run the installer.",
        " ",
        "+![Plans](/api/uploads/owner-1/plans.png)",
        " ## Pricing",
        " ",
        " Plans start at $10.",
        "",
      ].join("\n"),
    });

    expect(await readContent(harness, articleId)).toContain(
      "![Plans](/api/uploads/owner-1/plans.png)\n## Pricing",
    );
  });

  test("rejects a patch whose context no longer matches", async () => {
    const harness = createHarness();
    const articleId = await seedArticle(harness);

    const result = await call(harness, "update_help_article", {
      projectId: "project-1",
      articleId,
      contentPatch: [
        "@@ -1,3 +1,3 @@",
        " # Install",
        " ",
        "-Text that was never in this article.",
        "+Replacement.",
        "",
      ].join("\n"),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("patch_did_not_apply");
    expect(await readContent(harness, articleId)).toBe(BODY);
  });

  test("rejects a malformed patch without touching the article", async () => {
    const harness = createHarness();
    const articleId = await seedArticle(harness);

    const result = await call(harness, "update_help_article", {
      projectId: "project-1",
      articleId,
      contentPatch: "this is not a diff at all",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("malformed_patch");
    expect(await readContent(harness, articleId)).toBe(BODY);
  });

  test("rejects content and contentPatch together", async () => {
    const harness = createHarness();
    const articleId = await seedArticle(harness);

    await expect(
      call(harness, "update_help_article", {
        projectId: "project-1",
        articleId,
        content: "Whole new body",
        contentPatch: "@@ -1,1 +1,1 @@\n-a\n+b\n",
      }),
    ).rejects.toThrow("not both");
    expect(await readContent(harness, articleId)).toBe(BODY);
  });
});

describe("update_help_article expectedUpdatedAt", () => {
  async function seedArticle(harness: Harness): Promise<string> {
    const categoryId = await seedCategory(harness);
    const created = await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Guarded",
      content: "Original body.",
    });
    return (created.article as { id: string }).id;
  }

  test("applies the write when the article has not moved", async () => {
    const harness = createHarness();
    const articleId = await seedArticle(harness);
    const fetched = await call(harness, "get_help_article", {
      projectId: "project-1",
      articleId,
    });

    const result = await call(harness, "update_help_article", {
      projectId: "project-1",
      articleId,
      content: "Edited body.",
      expectedUpdatedAt: (fetched.article as { updatedAt: string }).updatedAt,
    });

    expect(result.ok).toBe(true);
  });

  test("rejects the write when the article moved since the read", async () => {
    const harness = createHarness();
    const articleId = await seedArticle(harness);
    const stale = new Date(Date.now() - 60_000).toISOString();

    const result = await call(harness, "update_help_article", {
      projectId: "project-1",
      articleId,
      content: "Edited from a stale read.",
      expectedUpdatedAt: stale,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("stale_article");
    expect(result.currentUpdatedAt).toBeString();

    const fetched = await call(harness, "get_help_article", {
      projectId: "project-1",
      articleId,
    });
    expect((fetched.article as { content: string }).content).toBe(
      "Original body.",
    );
  });
});

describe("help image tools", () => {
  test("issues an upload URL whose key stays out of the RAG folder range", async () => {
    const harness = createHarness();
    const result = await call(harness, "create_help_image_upload", {
      projectId: "project-1",
      contentType: "image/png",
    });

    expect(result.ok).toBe(true);
    expect(result.url as string).toMatch(
      /^https:\/\/replymaven\.com\/api\/uploads\/help-images\/project-1\/[a-f0-9-]+\.png$/,
    );
    // Anything under `project-1/` is swept into AI Search retrieval.
    expect(result.url as string).not.toContain("/api/uploads/project-1/");
    expect(result.uploadUrl as string).toStartWith(
      "https://replymaven.com/api/help-images/upload?token=",
    );
    expect(result.contentType).toBe("image/png");
  });

  test("issued tokens verify and pin the key and type", async () => {
    const harness = createHarness();
    const result = await call(harness, "create_help_image_upload", {
      projectId: "project-1",
      contentType: "image/webp",
    });

    const token = new URL(result.uploadUrl as string).searchParams.get("token");
    const payload = await verifyHelpImageUploadToken({
      token: token!,
      secret: "test-encryption-key",
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    expect(payload.projectId).toBe("project-1");
    expect(payload.contentType).toBe("image/webp");
    expect(`https://replymaven.com/api/uploads/${payload.key}`).toBe(result.url);
  });

  test("refuses to issue an upload for another user's project", async () => {
    const harness = createHarness();
    await expect(
      call(harness, "create_help_image_upload", {
        projectId: "project-2",
        contentType: "image/png",
      }),
    ).rejects.toThrow("Project not found");
  });

  test("imports an image from an https URL", async () => {
    const harness = createHarness();
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "content-type": "image/png" },
      })) as typeof fetch;
    try {
      const result = await call(harness, "import_help_image", {
        projectId: "project-1",
        sourceUrl: "https://example.com/shot.png",
      });
      expect(result.ok).toBe(true);
      expect(result.bytes).toBe(4);
      expect(result.url as string).toStartWith(
        "https://replymaven.com/api/uploads/help-images/project-1/",
      );
      expect(harness.r2.objects.size).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("rejects a non-https source without fetching it", async () => {
    const harness = createHarness();
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("", { headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    try {
      await expect(
        call(harness, "import_help_image", {
          projectId: "project-1",
          sourceUrl: "http://example.com/shot.png",
        }),
      ).rejects.toThrow("https");
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("rejects a source that is not an allowed image type", async () => {
    const harness = createHarness();
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("<html></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as typeof fetch;
    try {
      await expect(
        call(harness, "import_help_image", {
          projectId: "project-1",
          sourceUrl: "https://example.com/not-an-image",
        }),
      ).rejects.toThrow("Unsupported image type");
      expect(harness.r2.objects.size).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("rejects a source larger than the cap", async () => {
    const harness = createHarness();
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(MAX_HELP_IMAGE_BYTES + 1), {
        headers: { "content-type": "image/png" },
      })) as typeof fetch;
    try {
      await expect(
        call(harness, "import_help_image", {
          projectId: "project-1",
          sourceUrl: "https://example.com/huge.png",
        }),
      ).rejects.toThrow("over the");
      expect(harness.r2.objects.size).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("updateHelpArticleSchema", () => {
  // `.partial()` keeps the `.default()` a field carries in the create schema.
  // Before this was pinned down, a partial PATCH blanked the body
  // and unpublished the article.
  test("a partial update injects no defaults", () => {
    const parsed = updateHelpArticleSchema.parse({ excerpt: "Just the excerpt" });
    expect(parsed).toEqual({ excerpt: "Just the excerpt" });
    expect(parsed).not.toHaveProperty("content");
    expect(parsed).not.toHaveProperty("status");
  });

  test("an empty update stays empty", () => {
    expect(updateHelpArticleSchema.parse({})).toEqual({});
  });

  test("explicit values still come through", () => {
    expect(
      updateHelpArticleSchema.parse({ content: "Body", status: "published" }),
    ).toEqual({ content: "Body", status: "published" });
  });

  test("content and contentPatch together are rejected", () => {
    expect(
      updateHelpArticleSchema.safeParse({
        content: "Body",
        contentPatch: "@@ -1,1 +1,1 @@\n-a\n+b\n",
      }).success,
    ).toBe(false);
  });
});

describe("contentPatch size cap", () => {
  test("rejects a patch whose result exceeds the content cap", async () => {
    const harness = createHarness();
    const categoryId = await seedCategory(harness);
    const created = await call(harness, "create_help_article", {
      projectId: "project-1",
      categoryId,
      title: "Growing",
      content: "start\n",
    });
    const articleId = (created.article as { id: string }).id;

    // One added line, just over the 100,000-character ceiling.
    const huge = "x".repeat(100_001);
    const result = await call(harness, "update_help_article", {
      projectId: "project-1",
      articleId,
      contentPatch: ["@@ -1,1 +1,2 @@", " start", `+${huge}`, ""].join("\n"),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("patch_result_too_large");

    const fetched = await call(harness, "get_help_article", {
      projectId: "project-1",
      articleId,
    });
    expect((fetched.article as { content: string }).content).toBe("start\n");
  });
});
