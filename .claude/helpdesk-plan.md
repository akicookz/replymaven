# Helpdesk / Knowledge Base — Implementation Plan

Authoritative implementation plan for the ReplyMaven helpdesk feature. Read top-to-bottom before writing any code. All conventions in `/CLAUDE.md` apply unchanged.

---

## 1. Feature Summary

A multi-tenant CMS where the project owner writes help articles (markdown via WYSIWYG editor), organized into categories, served as SEO-friendly public pages at `replymaven.com/help/{projectSlug}/{categorySlug}/{articleSlug}` AND auto-indexed by AI Search so the chatbot can cite them.

Owners may optionally host the help center under their own domain (e.g. `theirdomain.com/docs`) via a customer-managed reverse proxy; URL generation is config-driven so canonical/OG/internal links all point at the custom URL when set.

---

## 2. Schema

### 2.1 Two new tables in `worker/db/schema.ts`

```ts
// ─── Help Categories ───────────────────────────────────────────────────────
export const helpCategories = sqliteTable(
  "help_categories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`).$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    uniqueIndex("idx_help_categories_project_slug").on(table.projectId, table.slug),
    index("idx_help_categories_project_sort").on(table.projectId, table.sortOrder),
  ],
);
export type HelpCategoryRow = typeof helpCategories.$inferSelect;
export type NewHelpCategoryRow = typeof helpCategories.$inferInsert;

// ─── Help Articles ─────────────────────────────────────────────────────────
export const helpArticles = sqliteTable(
  "help_articles",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull()
      .references(() => helpCategories.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    excerpt: text("excerpt"),
    content: text("content").notNull().default(""),
    status: text("status", { enum: ["draft", "published"] })
      .notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`).$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    uniqueIndex("idx_help_articles_category_slug").on(table.categoryId, table.slug),
    index("idx_help_articles_project").on(table.projectId),
    index("idx_help_articles_project_status").on(table.projectId, table.status),
    index("idx_help_articles_category_sort").on(table.categoryId, table.sortOrder),
  ],
);
export type HelpArticleRow = typeof helpArticles.$inferSelect;
export type NewHelpArticleRow = typeof helpArticles.$inferInsert;
```

Add `helpCategories` and `helpArticles` to the `schema = { ... }` exports object at the bottom of `schema.ts`.

**No `viewCount` in v1** — D1 write-per-render is wasteful. Add later as KV-backed counter if requested.

### 2.2 One nullable column added to `resources` table

```ts
sourceArticleId: text("source_article_id")
  .references(() => helpArticles.id, { onDelete: "cascade" }),
```

This is the bridge: when an article is published, we write a row to the existing `resources` table with `type: "webpage"`, `r2Key: {projectId}/articles/{articleId}.md`, `url: <canonical replymaven.com URL>`, and `sourceArticleId: <article id>`. The existing source resolution in `resolveSourceReferenceMap` lights up automatically → citations become clickable links. Cascade delete on the FK cleans up the bridge row when an article is deleted.

### 2.3 One nullable column added to `projectSettings`

```ts
helpCustomUrl: text("help_custom_url"),
```

Stores the owner's custom domain + subpath, e.g. `https://acme.com/docs`. Null = use canonical `replymaven.com/help/{projectSlug}` URLs.

### 2.4 Migrations

```bash
bun run db:generate
bun run db:migrate:dev
```

Verify migration is additive only (no destructive operations on existing tables).

### 2.5 Slug uniqueness scope

- **Categories**: unique per project (`uniqueIndex(projectId, slug)`)
- **Articles**: unique per category (`uniqueIndex(categoryId, slug)`)

Reasoning: URLs are `{project}/{category}/{article}`. Collisions only matter within the same category path.

---

## 3. Validation (`worker/validation.ts`)

Add to existing file, with box-drawing dividers per convention:

```ts
// ─── Help Categories ──────────────────────────────────────────────────────
export const createHelpCategorySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export const updateHelpCategorySchema = createHelpCategorySchema.partial();

// ─── Help Articles ────────────────────────────────────────────────────────
export const createHelpArticleSchema = z.object({
  categoryId: z.string().min(1),
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  excerpt: z.string().max(280).nullable().optional(),
  content: z.string().max(100_000).optional().default(""),
  status: z.enum(["draft", "published"]).optional().default("draft"),
  sortOrder: z.number().int().min(0).optional(),
});
export const updateHelpArticleSchema = createHelpArticleSchema.partial().extend({
  categoryId: z.string().min(1).optional(),
});

export const reorderHelpItemsSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    sortOrder: z.number().int().min(0),
  })).min(1).max(200),
});
```

Extend the existing `updateProjectSettingsSchema` with one field:

```ts
helpCustomUrl: z.string()
  .url("Must be a valid URL")
  .max(2048)
  .refine((u) => u.startsWith("https://"), "Must use HTTPS")
  .refine((u) => !u.endsWith("/"), "Must not end with a trailing slash")
  .refine(
    (u) => {
      try {
        const host = new URL(u).hostname.toLowerCase();
        return host !== "replymaven.com" && !host.endsWith(".replymaven.com");
      } catch { return false; }
    },
    "Cannot point at replymaven.com",
  )
  .nullable()
  .optional(),
```

---

## 4. HelpdeskService (`worker/services/helpdesk-service.ts`)

Single service class. Constructor takes `db` and `r2`. Methods:

```ts
export class HelpdeskService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private r2: R2Bucket,
  ) {}

  // ─── Categories ────────────────────────────────────────────────────────
  async listCategories(projectId: string): Promise<HelpCategoryRow[]>;
  async getCategoryById(id: string, projectId: string): Promise<HelpCategoryRow | null>;
  async getCategoryBySlug(projectId: string, slug: string): Promise<HelpCategoryRow | null>;
  async createCategory(data, projectId): Promise<HelpCategoryRow>;
  async updateCategory(id, projectId, updates): Promise<HelpCategoryRow | null>;
  async deleteCategory(id, projectId): Promise<boolean>;
    // 1. SELECT articles WHERE categoryId = id
    // 2. For each: r2.delete(r2Key) if status=published
    // 3. DELETE category (cascades articles + bridge rows via FK)
  async reorderCategories(projectId, items): Promise<void>;

  // ─── Articles ──────────────────────────────────────────────────────────
  async listArticles(projectId, opts?: { categoryId?: string; status?: "draft"|"published" }): Promise<HelpArticleRow[]>;
  async getArticleById(id, projectId): Promise<HelpArticleRow | null>;
  async getArticleBySlug(projectId, categorySlug, articleSlug): Promise<{ article, category } | null>;
    // MUST filter by status='published' when called from public route
  async createArticle(data, projectId): Promise<HelpArticleRow>;
  async updateArticle(id, projectId, updates, baseUrl): Promise<HelpArticleRow | null>;
    // If status transitions draft→published, OR content/title changes while published: publishArticleToR2()
    // If status transitions published→draft: unpublishArticleFromR2()
    // Cross-category move: check destination slug uniqueness, 409 if conflict
  async deleteArticle(id, projectId): Promise<boolean>;
    // r2.delete(r2Key) + DB delete (bridge row cascades via FK)
  async reorderArticles(projectId, categoryId, items): Promise<void>;

  // ─── R2 / RAG Bridge (private) ─────────────────────────────────────────
  private async publishArticleToR2(article, category, projectId, baseUrl): Promise<void>;
    // 1. Build markdown: `# ${title}\n\n${excerpt}\n\n${content}`
    // 2. r2Key = `${projectId}/articles/${article.id}.md`
    // 3. r2.put(r2Key, markdown, { customMetadata: { context: `Help article: ${title}` } })
    // 4. Upsert resources bridge row:
    //    - INSERT or UPDATE with type="webpage", title, url=<canonical replymaven URL>,
    //      r2Key, status="indexed", lastIndexedAt=now, sourceArticleId=article.id
    //    - URL stored is ALWAYS the canonical replymaven.com URL (NOT helpCustomUrl).
    //      Lazy rewrite happens at resolveSourceReferenceMap time. This keeps the
    //      stored URL stable when helpCustomUrl changes.

  private async unpublishArticleFromR2(article, projectId): Promise<void>;
    // 1. r2.delete(r2Key)
    // 2. UPDATE resources SET status='pending' WHERE sourceArticleId = article.id
    //    (Keep bridge row; flip status so it's not returned as indexed.)

  private async generateUniqueSlug(table, scopeField, scopeValue, base): Promise<string>;
    // Mirror ProjectService.generateUniqueSlug pattern (worker/services/project-service.ts:50-58)
}
```

**baseUrl note**: `publishArticleToR2` needs the canonical URL base (`https://replymaven.com`). Read from `env.BETTER_AUTH_URL`. Pass via the calling route handler (don't bake into the service constructor — keeps the service env-agnostic for tests).

**Move existing `slugify`** from `worker/index.ts:230-236` to a new shared file `worker/lib/slugify.ts`; re-import from both `index.ts` and `helpdesk-service.ts`.

---

## 5. URL Builder (`worker/helpdesk-render/build-help-url.ts`)

Single chokepoint for ALL help URL construction. No inline string concatenation anywhere else.

```ts
interface BuildHelpUrlInput {
  projectSlug: string;
  customUrl: string | null | undefined;
  category?: string;
  article?: string;
}

function buildHelpUrl(input: BuildHelpUrlInput): string;
function buildHelpSitemapUrl(input: { projectSlug; customUrl }): string;
function buildHelpRobotsUrl(input: { projectSlug; customUrl }): string;
function normalizeHelpCustomUrl(raw: string): string;  // strip trailing slash, lowercase scheme+host
function rewriteHelpUrlIfNeeded(storedUrl: string, projectSlug: string, customUrl: string | null): string;
  // If storedUrl matches https://replymaven.com/help/{projectSlug}/..., rewrite base
  // using customUrl. Otherwise return unchanged. Pure, idempotent.
```

### Examples

- `{ projectSlug: "acme", customUrl: null }` → `https://replymaven.com/help/acme`
- `{ projectSlug: "acme", customUrl: null, category: "billing", article: "refunds" }` → `https://replymaven.com/help/acme/billing/refunds`
- `{ projectSlug: "acme", customUrl: "https://acme.com/docs", category: "billing", article: "refunds" }` → `https://acme.com/docs/billing/refunds`
- `{ projectSlug: "acme", customUrl: "https://docs.acme.com" }` → `https://docs.acme.com`
- Article without category → throw (invalid input)

### Lazy bridge URL rewrite

Modify `resolveSourceReferenceMap` in `worker/services/resource-service.ts:600-723`:
1. Fetch `projectSettings.helpCustomUrl` once at the top of the function.
2. For every resource row, before adding to the `sourceMap`, pass its `url` through `rewriteHelpUrlIfNeeded(url, projectSlug, helpCustomUrl)`.
3. Non-help URLs pass through unchanged. Help URLs get rewritten on the fly to point at the custom domain when set.

This bypasses any need for bulk-UPDATE migrations when `helpCustomUrl` changes.

---

## 6. Public HTML Rendering (Hono JSX)

**Rendering mechanism**: Hono's built-in JSX (`hono/jsx`). NOT template literals. NOT `react-dom/server`. Already-installed framework, ~3KB overhead, auto-escapes interpolations, composable.

### 6.1 TSConfig changes (`worker/tsconfig.worker.json` or whichever the worker uses)

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  }
}
```

### 6.2 Files under `worker/helpdesk-render/`

- `layout.tsx` — `<Layout>` component: `<html>`, `<head>` with meta tags (title, description, canonical, OG, Twitter, JSON-LD Article, `<meta name="replymaven:help" content={projectSlug}>` marker for the proxy-test endpoint), Google Fonts `<link>`, two `<style>` blocks (static + per-tenant), `<body>` with children + widget script.
- `render-help-index.tsx` — Category grid landing page.
- `render-help-category.tsx` — Article list within a category.
- `render-help-article.tsx` — Article body with breadcrumbs + prev/next nav.
- `render-sitemap.ts` — Returns `Content-Type: application/xml` string.
- `render-robots.ts` — Returns plain text.
- `render-markdown.ts` — `marked` + DOMPurify pipeline; see §6.4.
- `render-project-theme.ts` — Pure function, `widgetConfig` → CSS variable overrides string; see §7.
- `build-font-link.ts` — Font allowlist + Google Fonts URL builder; see §7.
- `help.css` — Tailwind v4 entry; see §7.

All renderers use `class=` (not `className=`) — Hono JSX convention.

### 6.3 JSX convention examples

```tsx
import { html } from "hono/html";

function HelpArticlePage({ project, category, article, widgetConfig, bodyHtml, helpCustomUrl }) {
  const canonical = buildHelpUrl({
    projectSlug: project.slug, customUrl: helpCustomUrl,
    category: category.slug, article: article.slug,
  });

  return (
    <Layout
      title={`${article.title} — ${project.name} Help`}
      description={article.excerpt ?? ""}
      canonicalUrl={canonical}
      projectSlug={project.slug}
      widgetConfig={widgetConfig}
    >
      <div class="min-h-screen bg-background text-foreground">
        <header class="max-w-3xl mx-auto px-6 pt-16 pb-8">
          <nav class="text-sm text-muted-foreground mb-6">
            <a href={buildHelpUrl({ projectSlug: project.slug, customUrl: helpCustomUrl })}
               class="hover:text-foreground">{project.name}</a>
            <span class="mx-2">/</span>
            <a href={buildHelpUrl({ projectSlug: project.slug, customUrl: helpCustomUrl, category: category.slug })}
               class="hover:text-foreground">{category.name}</a>
          </nav>
          <h1 class="font-heading text-4xl tracking-tight">{article.title}</h1>
          {article.excerpt && <p class="mt-3 text-muted-foreground">{article.excerpt}</p>}
        </header>
        <main class="max-w-3xl mx-auto px-6 pb-24">
          <div class="prose" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        </main>
      </div>
    </Layout>
  );
}
```

Static text in JSX (titles, names, breadcrumbs) is auto-escaped. The ONLY place we trust HTML is `dangerouslySetInnerHTML` for the sanitized markdown body and the inlined CSS strings.

### 6.4 Markdown rendering pipeline (`render-markdown.ts`)

- `marked` for parsing (~30KB)
- `isomorphic-dompurify` for sanitization
- **Critical**: verify Workers compatibility on day 1. If DOMPurify chokes, fallback to `marked`'s `walkTokens` hook with a hand-rolled allow-list. Document the choice in a comment.
- Allowlist excludes: `<script>`, `<iframe>`, `<form>`, `<input>`, `<style>`, event handlers (`on*`), `javascript:` URLs, `data:` URLs except `data:image/*`.
- Post-process step walks `<a>` and `<img>` tags:
  - Root-relative URLs are rewritten through `buildHelpUrl(...)` when they match the help URL pattern; otherwise warned (rendered with `data-warning` attr) and converted to absolute against the canonical origin.
  - External links get `rel="noopener noreferrer"` and `target="_blank"`.
  - **Internal article links stay in the same tab** (no `target="_blank"`). Detect via hostname comparison or by checking the resolved URL.

### 6.5 Sitemap + robots

- `sitemap.xml` lists every published article + every category + the help index. Every `<loc>` uses `buildHelpUrl(...)`.
- `robots.txt`:
  ```
  User-agent: *
  Allow: /
  Sitemap: {buildHelpSitemapUrl(...)}
  ```
- Both routes set `Cache-Control: public, max-age=300`.

### 6.6 Caching

Help pages: `Cache-Control: public, max-age=120, s-maxage=120`. Short enough that `helpCustomUrl` or `widgetConfig` changes propagate within 2 minutes. URL alone is the cache key (no `Vary` needed — content varies by URL which already varies by project).

---

## 7. Styling (multi-tenant)

Tailwind v4 utility CSS built once + per-request token overrides from `widget_config`.

### 7.1 Refactor: extract theme tokens

Move the `@theme inline { ... }` block and the `:root { --background: ...; ... }` block from `src/index.css` into a new file `src/theme.css`. The original `src/index.css` re-imports it. The new helpdesk CSS also imports it. **Tokens defined once, no drift.**

### 7.2 New static CSS entry: `worker/helpdesk-render/help.css`

```css
@import "tailwindcss";
@import "../../src/theme.css";
@source "./*.tsx";

/* Prose styles for article body (output of marked.js) */
.prose { font-family: var(--font-sans); line-height: 1.7; max-width: 70ch; }
.prose h1, .prose h2, .prose h3 { font-family: var(--font-heading); }
.prose code { font-family: ui-monospace, monospace; background: var(--code); padding: 0.125em 0.375em; border-radius: 0.25rem; }
.prose pre { background: var(--card); padding: 1rem; border-radius: var(--radius); overflow-x: auto; }
.prose a { color: var(--brand); text-underline-offset: 2px; }
.prose ul, .prose ol { padding-left: 1.5rem; }
.prose blockquote { border-left: 3px solid var(--brand); padding-left: 1rem; color: var(--muted-foreground); }
/* ~40 lines total */
```

### 7.3 Inline at build time via Vite `?inline`

```tsx
// worker/helpdesk-render/layout.tsx
import helpCss from "./help.css?inline";

export function Layout({ title, description, canonicalUrl, projectSlug, widgetConfig, children }) {
  const themeOverrides = renderProjectTheme(widgetConfig);
  const fontHref = buildFontLink(widgetConfig?.fontFamily ?? null);

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta name="replymaven:help" content={projectSlug} />
        {/* OG, Twitter, JSON-LD ... */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        {fontHref && <link href={fontHref} rel="stylesheet" />}
        <style dangerouslySetInnerHTML={{ __html: helpCss }} />
        <style dangerouslySetInnerHTML={{ __html: themeOverrides }} />
      </head>
      <body>
        {children}
        <script src="https://widget.replymaven.com/widget-embed.js" data-project={projectSlug} async></script>
      </body>
    </html>
  );
}
```

### 7.4 Day-1 verification

The `?inline` import must trigger `@tailwindcss/vite` processing when imported from worker code. `vite.config.ts` already has `tailwindcss()` and `cloudflare()` in the plugin chain, so they share the same build. **Run `bun run build` immediately after creating `help.css` and verify the worker output contains real utility CSS (not raw `@import` directives).** If broken, fallbacks in order:

1. Run Tailwind CLI as a pre-build script → output to `help.css.generated.ts` → import that .ts file
2. Hand-write the CSS using `var(--...)` token references only, no Tailwind utilities

### 7.5 Per-tenant token overrides (`render-project-theme.ts`)

```ts
function renderProjectTheme(widgetConfig: WidgetConfigRow | null): string {
  const primary = sanitizeColor(widgetConfig?.primaryColor) ?? "#2563eb"; // default blue
  const bg = sanitizeColor(widgetConfig?.backgroundColor) ?? "#ffffff";
  const fg = sanitizeColor(widgetConfig?.textColor) ?? "#0a0a0a";
  const radius = sanitizeRadius(widgetConfig?.borderRadius) ?? "0.75rem";
  const fontSans = sanitizeFontName(widgetConfig?.fontFamily) ?? "Inter";

  return `:root {
    --brand: ${primary};
    --brand-dark: color-mix(in oklch, ${primary}, black 12%);
    --brand-soft: color-mix(in oklch, ${primary}, white 25%);
    --background: ${bg};
    --foreground: ${fg};
    --card: color-mix(in oklch, ${bg}, ${fg} 3%);
    --card-foreground: ${fg};
    --muted: color-mix(in oklch, ${bg}, ${fg} 5%);
    --muted-foreground: color-mix(in oklch, ${fg}, transparent 35%);
    --border: color-mix(in oklch, ${fg}, transparent 88%);
    --code: color-mix(in oklch, ${bg}, ${fg} 5%);
    --radius: ${radius};
    --font-sans: "${fontSans}", system-ui, sans-serif;
    --font-heading: "Playfair", Georgia, serif;
  }`;
}

function sanitizeColor(input: string | null | undefined): string | null {
  if (!input) return null;
  // Allow #RGB, #RRGGBB, #RRGGBBAA, oklch(...), rgb(...), rgba(...). Reject anything else.
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^(oklch|rgb|rgba|hsl|hsla)\([^)]+\)$/i.test(trimmed)) return trimmed;
  return null;
}

function sanitizeRadius(input: string | null | undefined): string | null {
  if (!input) return null;
  // Allow only valid CSS length values
  return /^\d+(\.\d+)?(px|rem|em|%)$/.test(input.trim()) ? input.trim() : null;
}

function sanitizeFontName(input: string | null | undefined): string | null {
  if (!input) return null;
  // Only allow names in FONT_ALLOWLIST
  return input in FONT_ALLOWLIST ? input : null;
}
```

**Default theme** (when no widget_config or fields null): light mode, neutral palette, blue brand. NOT the dashboard's dark-first theme. Help centers are almost universally light by convention.

### 7.6 Font allowlist (`build-font-link.ts`)

```ts
const FONT_ALLOWLIST: Record<string, string> = {
  "Inter": "Inter:wght@400;500;600;700",
  "Manrope": "Manrope:wght@400;500;600;700",
  "Plus Jakarta Sans": "Plus+Jakarta+Sans:wght@400;500;600;700",
  "DM Sans": "DM+Sans:wght@400;500;600;700",
  "Geist": "Geist:wght@400;500;600;700",
  "Satoshi": "Satoshi:wght@400;500;600;700",
  // 10-15 fonts total
};

function buildFontLink(family: string | null | undefined): string | null {
  if (!family || !(family in FONT_ALLOWLIST)) return null;
  return `https://fonts.googleapis.com/css2?family=${FONT_ALLOWLIST[family]}&display=swap`;
}
```

Allowlist defends against arbitrary URL injection via `widgetConfig.fontFamily`.

### 7.7 `customCss` from widget_config: DEFERRED

Do NOT inject `widgetConfig.customCss` on help pages in v1. Token overrides cover ~95% of branding. Skipping customCss sidesteps the CSS-injection sanitization rabbit hole (`@import url(...)`, `url(...)` exfiltration, etc.). Add later with a proper CSS-aware sanitizer if requested.

---

## 8. Image Uploads (Tiptap)

**Reuse the existing `POST /api/upload` endpoint at `worker/index.ts:5993` verbatim.** It stores at `{userId}/{uuid}.{ext}` — completely OUTSIDE any `{projectId}/` folder, so AI Search never sees those images.

- DO NOT mirror the widget chat-images path `{projectId}/chat-images/...` (line 645). That path is inside the RAG folder.
- DO NOT create a new endpoint or new R2 prefix for help images.

Tiptap `Image` extension's upload handler:
1. POST `FormData` with `file` field to `/api/upload`
2. Read `response.url` (returns `/api/uploads/{userId}/{uuid}.{ext}`)
3. Insert into editor as image node

No backend changes needed for image support. The existing endpoint already validates MIME types (`image/jpeg`, `image/png`, `image/webp`, `image/svg+xml`) and enforces 10MB max.

---

## 9. Backend Routes (`worker/index.ts`)

### 9.1 Public routes — register BEFORE the SPA fallback at lines 390-394

Move the existing `.use("*", except(["/api/*"], ...))` SPA fallback to AFTER the new `/help/*` registrations. Order matters.

| Method | Route | Returns |
|---|---|---|
| GET | `/help/:projectSlug` | HTML — categories index |
| GET | `/help/:projectSlug/:categorySlug` | HTML — category page |
| GET | `/help/:projectSlug/:categorySlug/:articleSlug` | HTML — full article (404 if status=draft) |
| GET | `/help/:projectSlug/sitemap.xml` | XML sitemap |
| GET | `/help/:projectSlug/robots.txt` | robots.txt |

Each public route:
1. Looks up project by slug (404 if not found)
2. Looks up content (404 if not found OR if article status=draft)
3. Looks up `widgetConfig` and `projectSettings.helpCustomUrl`
4. Renders JSX via Hono's JSX runtime
5. Returns `c.html(...)` with `Cache-Control: public, max-age=120`
6. Rate limit: **200 req/min per IP** (using existing `checkRateLimit` helper)

### 9.2 Dashboard routes — protected, session-authenticated

Add after existing resources routes (`worker/index.ts:3925` block, look for `// ─── Resources ─────────`):

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/projects/:id/help/categories` | List with article counts |
| POST | `/api/projects/:id/help/categories` | Create |
| PATCH | `/api/projects/:id/help/categories/:catId` | Update |
| DELETE | `/api/projects/:id/help/categories/:catId` | Delete (cascades) |
| POST | `/api/projects/:id/help/categories/reorder` | Bulk sort |
| GET | `/api/projects/:id/help/articles` | List (`?categoryId=`, `?status=`) |
| GET | `/api/projects/:id/help/articles/:artId` | Get with content |
| POST | `/api/projects/:id/help/articles` | Create (default status draft) |
| PATCH | `/api/projects/:id/help/articles/:artId` | Update (handles publish/unpublish R2 flow) |
| DELETE | `/api/projects/:id/help/articles/:artId` | Delete |
| POST | `/api/projects/:id/help/articles/:artId/publish` | Convenience: status=published |
| POST | `/api/projects/:id/help/articles/:artId/unpublish` | Convenience: status=draft |
| POST | `/api/projects/:id/help/articles/reorder` | Bulk sort within category |
| POST | `/api/projects/:id/help/test-proxy` | Verify customer's reverse proxy |

Every route:
1. Check `c.get("user")` (401 if missing)
2. Verify project ownership via `projectService.getProjectById()` and compare `project.userId` to `c.get("effectiveUserId") ?? user.id`
3. Validate body via `validate(schema, body)`
4. Call `HelpdeskService` method
5. After publish/unpublish/delete: `c.executionCtx.waitUntil(triggerAutoRagSync(c.env, "helpdesk.<action>"))` — note: AutoRAG sync is already non-blocking and idempotent server-side (see `worker/services/autorag-sync.ts:11-19`). No debouncing needed.

### 9.3 Proxy test endpoint (`POST /api/projects/:id/help/test-proxy`)

Body: `{ customUrl: string }`

1. Validate URL via the same Zod schema used for `helpCustomUrl`
2. Server-side `fetch(customUrl)` (worker → user's domain)
3. Parse response, look for `<meta name="replymaven:help" content="{projectSlug}">` in body
4. Return `{ ok: true, status: 200 }` on success or `{ ok: false, status, snippet }` on failure
5. Used by the dashboard "Test connection" button

### 9.4 Enrich resources list response

In the existing `GET /api/projects/:id/resources` handler, JOIN with `helpArticles` ON `resources.sourceArticleId = helpArticles.id`. When the bridge row is set, include in the response:

```ts
sourceArticle?: {
  id: string;
  title: string;
  categorySlug: string;
  articleSlug: string;
}
```

Frontend renders these with a "Help article" badge linking back to the article editor instead of inline edit controls. Full transparency on what's indexed.

---

## 10. Dashboard UI

### 10.1 Sidebar entry

`src/components/Layout.tsx:125-149` — add to `mainNav`:

```tsx
{
  label: "Help Center",
  href: `/app/projects/${currentProject.id}/help`,
  icon: BookOpen,  // from lucide-react
}
```

### 10.2 Routes (`src/App.tsx`)

Add under the `/app` block:

```tsx
<Route path="projects/:projectId/help" element={<HelpCenter />} />
<Route path="projects/:projectId/help/settings" element={<HelpCenterSettings />} />
<Route path="projects/:projectId/help/articles/new" element={<HelpArticleEditor />} />
<Route path="projects/:projectId/help/articles/:articleId" element={<HelpArticleEditor />} />
```

### 10.3 Page components

- `src/pages/HelpCenter.tsx` — main listing. Two-column: left = categories sidebar (drag-to-reorder via existing `@dnd-kit/sortable`, mirror `src/components/GreetingsList.tsx`), right = articles in selected category. Top right: "New Article", "New Category", "Settings" buttons. Empty state prompts creation of first category.
- `src/pages/HelpCenterSettings.tsx` — settings page with the "Custom Domain" section (see §10.5).
- `src/pages/HelpArticleEditor.tsx` — full editor screen. Top bar: title input, slug input (auto-derived, editable), category selector, status pill, publish/unpublish button, "View public" link. Main area: Tiptap editor with toolbar + preview tab toggle. Right rail: excerpt textarea (280 char counter).

### 10.4 Editor components

- `src/components/help-article-editor.tsx` — Tiptap wrapper. Extensions:
  - `StarterKit` (paragraph, heading, bold, italic, lists, blockquote, code, hr)
  - `Link` (`@tiptap/extension-link`) — config: external links get `target="_blank" rel="noopener noreferrer"`, internal article links stay in same tab. Detect via URL hostname match against `window.location.hostname` OR a configured help base URL.
  - `Image` (`@tiptap/extension-image`) with upload handler hitting `POST /api/upload` (see §8)
  - `Placeholder` (`@tiptap/extension-placeholder`)
  - `Markdown` (`tiptap-markdown`) — serializes ↔ markdown
  - (optional) `CodeBlockLowlight` if bundle size allows
- `src/components/help-category-list.tsx` — DnD list with edit/delete actions
- `src/components/help-article-list.tsx` — DnD list within category with status badge

**Lazy load the editor** to avoid bloating the dashboard bundle. Tiptap is ~150KB gzipped with StarterKit. Use `React.lazy(() => import("@/components/help-article-editor"))`. Add `tiptap-vendor` chunk to `vite.config.ts:40-44` `manualChunks`.

### 10.5 Custom Domain section (in `HelpCenterSettings.tsx`)

Card with:

1. **Text input** for `helpCustomUrl`:
   - Placeholder: `https://yourdomain.com/docs`
   - Bound to `projectSettings.helpCustomUrl`. Empty input is sent as `null` to clear.
   - Client-side validation mirrors the Zod schema
   - Helper text: "Host your help center under your own domain. Configure a reverse proxy on your side to forward requests here. Leave empty to use replymaven.com/help/{slug}."

2. **"Test connection" button**:
   - POSTs to `/api/projects/:id/help/test-proxy` with the candidate URL
   - Shows success or surfaces `status` + `snippet` on failure

3. **Collapsible setup instructions** (`src/components/ProxySetupGuide.tsx`):
   - Tabs: Cloudflare Rules, Vercel rewrites, Netlify `_redirects`, Nginx `proxy_pass`
   - Each tab shows a copy-to-clipboard code snippet with the user's project slug auto-injected. Example for Vercel:
     ```json
     { "rewrites": [{ "source": "/docs/:path*", "destination": "https://replymaven.com/help/{projectSlug}/:path*" }] }
     ```
   - Notes: "Make sure your proxy also forwards `/docs/sitemap.xml` and `/docs/robots.txt`."

### 10.6 Tiptap dependencies to add

```
@tiptap/react
@tiptap/starter-kit
@tiptap/extension-link
@tiptap/extension-image
@tiptap/extension-placeholder
tiptap-markdown
marked
isomorphic-dompurify
```

Install with `bun add ...`.

### 10.7 Day-1 spike: tiptap-markdown round-trip fidelity

**Before committing to markdown as source of truth**, run a 10-minute test:

1. Type a complex document in the editor: nested lists, tables, code blocks, blockquotes within lists, mixed inline marks
2. Paste from Google Docs and Notion
3. Save → reload → re-save → reload
4. Diff the markdown output

If significant loss occurs, switch to: store Tiptap's JSON as the source of truth in `content`, serialize to markdown only when uploading to R2 for AI Search. Schema change: rename `content` → `contentJson` or add a sibling column. Decide before locking in.

---

## 11. RAG Citation Integration

This works automatically once the bridge row pattern is implemented. No widget changes needed.

1. AI Search returns a chunk with filename `{projectId}/articles/{articleId}.md`
2. `resolveSourceReferenceMap` in `worker/services/resource-service.ts:600-723` matches the `r2Key`, finds the bridge row
3. Bridge row has `type: "webpage"`, `url: <canonical replymaven URL>`, `title: <article title>`
4. `rewriteHelpUrlIfNeeded` swaps the canonical URL for the custom one if `helpCustomUrl` is set
5. The widget renders webpage-type sources as clickable links automatically

Verify during testing: ask a question that should hit a published article, confirm the citation appears with a correct URL.

---

## 12. File-by-File Change List (dependency order)

### Backend (worker/)

1. `worker/db/schema.ts` — add `helpCategories`, `helpArticles` tables; add `sourceArticleId` to `resources`; add `helpCustomUrl` to `projectSettings`; export new tables in `schema` object.
2. `worker/db/drizzle/<new-migration>.sql` — generated via `bun run db:generate`.
3. `worker/lib/slugify.ts` — NEW — extract from `worker/index.ts:230-236`.
4. `worker/validation.ts` — add help schemas; extend `updateProjectSettingsSchema` with `helpCustomUrl`.
5. `worker/services/helpdesk-service.ts` — NEW.
6. `worker/services/resource-service.ts` — modify `resolveSourceReferenceMap` to apply `rewriteHelpUrlIfNeeded`.
7. `worker/services/project-service.ts` — (if needed) call `normalizeHelpCustomUrl` on write.
8. `worker/helpdesk-render/build-help-url.ts` — NEW.
9. `worker/helpdesk-render/render-markdown.ts` — NEW.
10. `worker/helpdesk-render/render-project-theme.ts` — NEW.
11. `worker/helpdesk-render/build-font-link.ts` — NEW.
12. `worker/helpdesk-render/help.css` — NEW.
13. `worker/helpdesk-render/layout.tsx` — NEW (Hono JSX).
14. `worker/helpdesk-render/render-help-index.tsx` — NEW.
15. `worker/helpdesk-render/render-help-category.tsx` — NEW.
16. `worker/helpdesk-render/render-help-article.tsx` — NEW.
17. `worker/helpdesk-render/render-sitemap.ts` — NEW.
18. `worker/helpdesk-render/render-robots.ts` — NEW.
19. `worker/index.ts` — (a) replace local `slugify` with import, (b) move SPA fallback to AFTER help routes, (c) register `/help/*` public routes, (d) register `/api/projects/:id/help/...` dashboard routes, (e) register test-proxy endpoint, (f) enrich resources list response.
20. `worker/tsconfig.worker.json` — add `"jsx": "react-jsx"`, `"jsxImportSource": "hono/jsx"`.

### Frontend (src/)

21. `src/theme.css` — NEW — extract `@theme` + `:root` blocks from `src/index.css`.
22. `src/index.css` — `@import "./theme.css"`.
23. `src/App.tsx` — add 4 routes under `/app/projects/:projectId/help/*`.
24. `src/components/Layout.tsx` — add "Help Center" nav entry.
25. `src/pages/HelpCenter.tsx` — NEW.
26. `src/pages/HelpCenterSettings.tsx` — NEW.
27. `src/pages/HelpArticleEditor.tsx` — NEW.
28. `src/components/help-article-editor.tsx` — NEW.
29. `src/components/help-category-list.tsx` — NEW.
30. `src/components/help-article-list.tsx` — NEW.
31. `src/components/ProxySetupGuide.tsx` — NEW.
32. `vite.config.ts` — add `tiptap-vendor` to `manualChunks`.
33. `package.json` — add deps via `bun add` (see §10.6).

### Docs

34. `CLAUDE.md` — append "Helpdesk / Knowledge Base" section under "Key Feature Implementation Details".

---

## 13. Testing Strategy

### Unit (Bun test)

- `buildHelpUrl` table-driven: all combinations of `(customUrl null/set, category, article)` → exact expected string.
- `normalizeHelpCustomUrl`: trailing-slash strip, scheme/host casing, idempotency.
- `rewriteHelpUrlIfNeeded`: canonical with customUrl set → rewritten; customUrl null → unchanged; non-help URL → unchanged.
- `renderProjectTheme`: valid/invalid colors clamped; defaults applied; safe output (no injection).
- `sanitizeColor`, `sanitizeRadius`, `sanitizeFontName`: reject malicious inputs.
- `render-markdown`: XSS payloads (`<script>`, `javascript:`, `onclick=`) stripped; `[text](url)` renders correctly; internal vs external link target handling.
- Zod schemas: reject http, trailing slash, replymaven.com host, malformed.
- `HelpdeskService` (mock D1 + R2):
  - `createCategory` generates slug from name when missing
  - `generateUniqueSlug` collisions append `-2`, `-3`
  - `updateArticle` draft→published triggers `publishArticleToR2`
  - Flipping published→draft removes R2 object
  - `deleteArticle` removes both DB row and R2 object
  - Article publish creates exactly one bridge row; re-publish updates not duplicates

### Integration

- Publish article → verify bridge row exists in `resources` with correct fields
- Render article page with `helpCustomUrl=null` → assert canonical, OG, JSON-LD, internal links all use `https://replymaven.com/help/{slug}/...`
- Render with `helpCustomUrl` set → assert all of the above use `https://acme.com/docs/...`
- Render sitemap with `helpCustomUrl` set → every `<loc>` uses custom base
- Citation resolution: publish article, simulate AI Search returning its filename, assert resolved URL matches current `helpCustomUrl` (toggle settings between calls)
- Hit `/help/{slug}/{cat}/{draft-article-slug}` → 404 (NOT content)

### Manual / E2E

- Create category → create article → type markdown → preview tab → publish → click "View public" → public page loads with project's brand colors applied
- Drag-to-reorder articles → reload → order persists
- Tiptap image paste → uploads via `/api/upload` → URL inserted
- Set `helpCustomUrl`, configure Vercel rewrite to staging, click "Test connection" → success
- Tiptap round-trip spike (§10.7) before committing markdown-as-source

### SEO smoke

- `curl -i https://replymaven.com/help/<slug>/<cat>/<art>` returns `Content-Type: text/html`, valid `<title>`, `<meta description>`, `<link canonical>`, OG tags, JSON-LD Article schema
- `view-source:` shows article body rendered server-side
- Lighthouse SEO ≥ 95

---

## 14. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| `isomorphic-dompurify` fails on Workers runtime | Medium | Day-1 verification. Fallback: `marked` walkTokens-based allow-list sanitizer. |
| `?inline` CSS import doesn't trigger Tailwind processing in worker context | Medium | Day-1 verification with `bun run build`. Fallback: Tailwind CLI pre-build step. |
| `tiptap-markdown` round-trip is lossy | High | Day-1 spike (§10.7). Fallback: store Tiptap JSON as source of truth. |
| Tiptap bundle size bloats dashboard | High | Lazy-load editor route; `tiptap-vendor` chunk. |
| AI Search sync lag (5-30 min after publish) | Medium | `triggerAutoRagSync` already non-blocking + idempotent. Inform user in UI: "AI may take a few minutes to learn from new articles." |
| Slug collision on cross-category article move | Low | `updateArticle` checks destination slug uniqueness, returns 409. |
| Public page exposing draft content | Medium | Public route MUST filter `WHERE status='published'`. Explicit test: hit draft URL returns 404. |
| XSS via Tiptap-allowed HTML that sanitizer misses | Medium | Sanitize on render. CSP `style-src 'unsafe-inline' 'self'`; no `script-src` extensions. |
| User CSS injection via per-tenant theme overrides | Medium | `sanitizeColor`, `sanitizeRadius`, `sanitizeFontName` reject anything not matching strict regex. Font allowlist. customCss DEFERRED. |
| Misconfigured proxy creates redirect loop | Medium | Validation rejects `helpCustomUrl` pointing at replymaven.com. Worker doesn't redirect on help routes. Test button surfaces broken proxies. |
| Stale edge cache after `helpCustomUrl` or `widgetConfig` change | Low | `max-age=120` keeps window ≤ 2 minutes. Document. |
| FK on `resources.source_article_id` breaks existing queries | Low | Column is nullable, added via additive ALTER. No existing queries reference it. |
| Markdown contains iframes (YouTube/Loom) — sanitizer strips them | Medium | v1: strip iframes. v2: allowlist for known embed domains via custom Tiptap node. |
| URL changes break inbound links on slug rename | Medium | v1: accept, document. v2: `help_article_redirects` table mapping old paths → article id, served as 301. |
| Public help routes accidentally swallow a legitimate SPA path | Low | `/help/*` is reserved by this feature. Document in CLAUDE.md. |

---

## 15. Deferred to v2

Explicitly NOT in v1 scope, listed so they don't get scope-crept in:

- `viewCount` (move to KV-backed counter later)
- Slug history / 301 redirects on rename
- `customCss` injection on help pages
- Iframe/embed allowlist for YouTube/Loom/Vimeo
- Article revisions / version history
- Per-category visibility / gated docs
- Custom font URLs (only allowlisted Google Fonts in v1)
- Dark mode toggle on help pages (always light unless `widgetConfig.backgroundColor` is dark)
- Cache purge button (just live with 2-min TTL)
- Sitemap auto-submission to Google Search Console
- Multi-language / i18n on slugs (ASCII only in v1)
- "Was this helpful?" feedback widget on articles
- Search box on help pages
- Auth-gated draft preview links

---

## 16. Process

1. Read this whole document AND `/CLAUDE.md` before writing code.
2. Implement Phase A first (schema + migration + service + dashboard CRUD UI — no public pages yet). Get it reviewed.
3. Then Phase B (public pages, buildHelpUrl, custom-domain setting, bridge row, AutoRAG wiring, sitemap/robots, theming).
4. Run the day-1 verifications (§6.4 DOMPurify, §7.4 Tailwind `?inline`, §10.7 tiptap-markdown round-trip) BEFORE locking in their respective patterns.
5. After implementation, request code review per CLAUDE.md (`@agent-code-reviewer`).
6. Do NOT deploy. Ask the user before deploying anything.

---

## 17. Conventions reminder (full list in `/CLAUDE.md`)

- Bun only — never npm/yarn
- Function declarations for named functions and React components; arrows only for inline callbacks
- `@/` alias for src imports
- `import type` for type-only imports
- PascalCase for components/types/services; camelCase for variables; kebab-case for UI component files and service files; PascalCase for page component files
- Tailwind v4 with semantic tokens (`bg-background`, `text-muted-foreground`, etc.); oklch color space
- No `border-t`, `border-b`, `<hr>`, or row-separator borders — use spacing and `bg-muted/50` cards instead
- Box-drawing dividers in backend section comments: `// ─── Section Name ─────────`
- Default to writing NO comments. Comments only when WHY is non-obvious.
- Never write files without reading start-to-end first
- Strict TypeScript; avoid `any`
- All API calls via `fetch("/api/...")` inside `useQuery`/`useMutation`
