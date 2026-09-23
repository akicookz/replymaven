# Help Center Tabs

**Date:** 2026-09-23
**Status:** Built locally, not committed
**Scope:** Rework the help center top bar into real navigation: tabs (for example Docs, Changelog, API, Academy), search, top-nav links, and an Ask button. Each tab has its own categories and its own sidebar.

## Problem

The help center has one level of grouping: categories. Every category shows in one
sidebar (`worker/helpdesk-render/sidebar.tsx`). A project with docs, a changelog, an API
reference, and courses must mix all of them in one long list. There is no way to say
"this is a different section of the site".

The top nav (`project_settings.helpTopNav`, max 3 items) does not solve this. It only
holds external `https://` links, and it cannot point at replymaven.com.

## Current model (traced)

- `help_categories`: project-scoped, `slug` unique per project, global `sortOrder`, soft `archivedAt`.
- `help_articles`: belongs to one category, `slug` unique per category.
- Public URLs: `/help/:projectSlug/:categorySlug/:articleSlug` (`worker/index.ts` ~L1789-2046). `/docs/*` re-dispatches to `/help/replymaven/*`. Custom domains proxy the same paths. Reserved second segments: `search`, `sitemap.xml`, `robots.txt`.
- `loadPublicHelpPage()` loads all categories and all published article nav rows once per request. Every renderer (index, category, article, search, dashboard preview) passes the full list to `HelpSidebar` and `MobileCategoryNav`.
- The canonical URL of each published article is written to `resources.url` for RAG (`HelpdeskService.publishArticleToR2`). MCP returns the same URL (`liveArticleUrl`).
- HTML is edge-cached for 1 hour under tag `help-<projectId>`. Every help mutation calls `scheduleHelpPageCachePurge`.
- Dashboard: `src/pages/HelpCenter.tsx` shows categories in a left column and articles on the right.
- The widget does not read help categories or articles. No widget change is needed: the widget sets `window.ReplyMaven` as soon as its script runs.

## Design

### 1. Tabs group categories. URLs do not change.

A tab is a named group of categories. It has no slug and no URL of its own.

Category slugs are already unique per project. The tab of a page is found from its
category. So every existing URL stays valid. There is nothing to redirect. These stay
the same: `resources.url`, the sitemap, canonical tags, JSON-LD, `.md` links, MCP URLs,
the `/docs` re-dispatch, and custom-domain proxies. Moving a category to a different tab
changes no URL and needs no RAG re-sync.

A nested scheme (`/docs/<tab>/<category>/<article>`) was rejected. It would break every
live URL, need redirects for all of them, and give no extra uniqueness.

### 2. Data model

New table `help_tabs`:

```
help_tabs
  id          text pk
  projectId   text not null, FK projects.id, on delete cascade
  name        text not null (1-24 chars)
  sortOrder   integer not null default 0
  createdAt / updatedAt (standard)
  index (projectId, sortOrder)
```

New column `help_categories.tabId`: text, nullable, FK `help_tabs.id` with no `ON DELETE` action (SQLite `ADD COLUMN` cannot keep one).

Generate the migration with `bun run db:generate`. Check that the SQL adds the table, the
column, and the index. No data backfill in SQL.

Limit: 6 tabs per project. Name: 1-24 characters, so tabs fit in one row next to the brand.

### 3. Rules

- **Zero tabs:** the help center works exactly as it does today.
- **One tab:** no tabs are shown in the top bar. It looks the same as zero tabs.
- **Two or more tabs:** the tabs are shown in the top bar.
- **First tab adopts existing content.** When a project creates its first tab, the service sets `tabId` on every category that has none, in the same request. After that, every active category has a tab.
- **New categories need a tab** when tabs exist. If the caller omits `tabId`, the category goes to the first tab by `sortOrder`. This keeps old MCP clients working.
- **Safety net in the renderer:** a category with `tabId = null` is treated as part of the first tab. Content is never hidden by a missed write.
- **Delete a tab only when it is empty** (no active categories). Otherwise answer `409 tab_not_empty`. Archived categories do not block delete. `deleteTab` sets their `tabId` to null in the same batch.
- `tabId` must belong to the same project. Check this in the service.

### 4. Public help center

**Which tab is active**

- Category page and article page: the category's tab.
- Home (`/docs`) and search: the first visible tab. Home belongs to the first tab.

**Visible tabs.** A tab shows on the public site only if at least one of its categories
has a published article. Draft-only tabs stay hidden while the owner writes them. If
fewer than two tabs are visible, no tabs are shown.

**Reader navigation opens articles, not category pages**

- First visible tab: the help home.
- Other tabs, sidebar category names, home category cards, and the mobile category select: the category's first published article (by `sortOrder`). These are plain server-rendered `href`s, with no redirect and no script.
- Category pages still render at their URL for search engines. The article breadcrumb keeps its category link so they are not orphans, and category and article pages carry `BreadcrumbList` JSON-LD.
- Categories with no published article are left out of navigation and the sitemap. Their page still works by direct URL.

**What each tab scopes**

| Surface | Behavior |
|---|---|
| Sidebar | Only the active tab's categories |
| Mobile category select (`MobileCategoryNav`) | Only the active tab's categories |
| Home `::help-categories` block | The first tab's categories |
| Home `::help-popular` block | Unchanged (explicit article IDs) |
| Search | All tabs. When tabs are shown, the result breadcrumb reads `Tab · Category` |
| Prev / next on article | Unchanged (same category) |
| Sitemap, robots, `.md`, canonical, JSON-LD | Unchanged |

### 5. Top bar rework

Today the top bar is a full-width 3.5rem row with the brand on the left and one theme
toggle on the right. The replymaven project sets no top-nav links, so the bar is empty
from edge to edge. Search exists only as a block inside the home page body.

The top bar becomes the main navigation. It stays one row and 3.5rem high, so the
sticky offsets for the sidebar, TOC, overlay, and anchors (all `3.5rem` in `help.css`
and `shared/help-prose.css`) do not change.

**Desktop (1280px and up)**

```
[logo] Acme   Docs  Changelog  API  Academy  ······  [⌕ Search…  ⌘K]  Status  Blog  [Ask Luna]  ◐
└ brand ┘     └──────── tabs ────────┘               └─ search ──┘    └ top nav ┘  └ ask ┘    theme
```

- **Brand:** as today. Links to the help home.
- **Tabs:** directly after the brand. Shown only when two or more tabs are visible (rules in section 4).
- **Search:** a button that looks like a field: search icon, "Search…", and a `⌘K` hint (`Ctrl K` on other platforms). It opens the search dialog.
- **Top-nav links:** the existing `helpTopNav` items (max 3 external links), same place as today.
- **Ask button:** a primary `sm` button, `Ask {botName}` (fallback "Contact us"). It calls `window.ReplyMaven.open("chat")`. The server renders it, so it causes no layout shift. The async widget script runs before `window` load, so the page hides the button at load only if `window.ReplyMaven` is missing (the widget failed to load). A click before load waits for load.
- **Theme toggle:** as today, last.

**1024px to 1279px.** The search field shrinks to an icon button. Everything else stays.
The tab group has `min-width: 0` and scrolls sideways when it does not fit, with a
fade at the cut edge (the same mask technique the sidebar uses). The active tab
scrolls into view on load.

**Below 1024px**

```
☰  [logo] Acme                    ⌕   ◐
```

- The menu button, brand, search icon, and theme toggle stay in the bar.
- The drawer opens with the tabs first (vertical list, active one marked), then the top-nav links (as today), then the active tab's categories.
- The Ask button is not in the bar. The widget launcher already sits bottom-right.

**Search dialog.** One native `<dialog>`, the same way the image zoom already works. It
holds the existing `HelpSearchForm` (GET to `…/search`). Open it with the bar button,
`⌘K`/`Ctrl K`, or `/` when the focus is not in a text field. `Esc` closes it. It works
with no API and no JS state, so edge-cached pages stay fully static. The home page
`::help-search` block stays as it is.

**Tab markup and style**

```html
<nav class="help-tabs" aria-label="Sections">
  <a class="help-tab active" href="..." aria-current="page">Docs</a>
  <a class="help-tab" href="...">Changelog</a>
</nav>
```

- These are links to other pages, not an ARIA tablist. Do not use `role="tablist"`.
- Each tab is 32px high. Tabs use `text-muted-foreground`, weight 500, with `text-foreground` on hover. The active tab is text only: `text-foreground`, weight 600. No background, no indicator. This keeps it apart from the active sidebar article, which uses the `bg-muted` pill, and matches the active TOC link.
- Reserve the bold width so tabs do not shift when the active one changes: stack a hidden weight-600 copy of the label in the same grid cell (`display: inline-grid`, both children `grid-area: 1 / 1`, the copy `visibility: hidden`).
- The drawer tab list uses the same rule: active is `text-foreground` weight 600, others muted.
- The top-nav links use the same height and radius, so every item in the bar lines up.
- `.help-tabs`, `.help-tab`, `.help-tab.active`, `.help-topbar-search`, and `.help-topbar-ask` are stable class names for custom CSS.
- No line under the bar and no lines between groups. Spacing separates them, and the bar's solid background covers content scrolling under it.

### 6. Code changes (worker)

- `worker/db/schema.ts`: `helpTabs` table, `HelpTabRow`/`NewHelpTabRow`, `helpCategories.tabId`.
- `worker/validation.ts`: `createHelpTabSchema` (`name`), `updateHelpTabSchema` (`name`, `sortOrder`). Add `tabId: z.string().min(1).optional()` to `createHelpCategorySchema`. `updateHelpCategorySchema` gets it through `.partial()`.
- `worker/services/helpdesk-service.ts`: `listTabs`, `getTabCategoryCounts`, `createTab` (adopt rule, 6-tab limit), `updateTab`, `reorderTabs`, `deleteTab` (empty rule). `createCategory` and `updateCategory` resolve and check `tabId`.
- New `worker/helpdesk-render/help-tabs.ts`: one pure function. Input: tabs, categories, `articlesByCategory`, project slug, custom URL. Output: visible tab links with hrefs, `tabIdForCategory(id)`, `categoriesForTab(id)`, and the first visible tab. All renderers use this; none re-derive it.
- `load-public-help-page.ts`: load tabs next to categories (one more D1 query; the page is edge-cached) and return the resolved tab context.
- `top-bar.tsx`: rework into brand, tabs, search button, top-nav links, Ask button, theme toggle. It takes `tabs`, `activeTabId`, and `searchAction`.
- `sidebar.tsx`: tab list at the top of the drawer (hidden at 1024px and up, like `.help-sidebar-topnav`).
- `layout.tsx`: the search `<dialog>` and one small inline script for the dialog, the shortcuts, the active-tab scroll and edge fades, and the Ask button. Put it next to the existing nav scripts.
- `help.css`: new top bar groups, tabs, search button, and the 1024px and 1280px breakpoints.
- `render-help-index.tsx`, `render-help-category.tsx`, `render-help-article.tsx`, `render-help-search.tsx`: pass the active tab and the filtered categories to `HelpTopBar`, `HelpSidebar`, and `MobileCategoryNav`.
- Ask button: `ProjectService.getPublicHelpProject` also selects `botName`.
- Schema note: SQLite `ADD COLUMN` drops `ON DELETE`, so `help_categories.tab_id` is a plain FK. `deleteTab` clears `tabId` on archived categories in the same batch before it deletes the tab.
- `worker/index.ts` home route: pass only the first tab's categories to `expandHelpHomeBlocks`.
- `worker/index.ts` preview route (`/help/articles/preview`): load tabs and scope the sidebar the same way, so the preview matches the live page.

### 7. Dashboard API

All routes use the same owner check as the category routes. Every mutation calls
`scheduleHelpPageCachePurge`. None triggers AutoRAG sync, because R2 content and URLs do
not change.

| Method | Route | Notes |
|---|---|---|
| GET | `/api/projects/:id/help/tabs` | `[{ id, name, sortOrder, categoryCount, createdAt, updatedAt }]` |
| POST | `/api/projects/:id/help/tabs` | `{ name }`. `409 tab_limit` at 6 |
| POST | `/api/projects/:id/help/tabs/reorder` | `{ items: [{ id, sortOrder }] }` |
| PATCH | `/api/projects/:id/help/tabs/:tabId` | `{ name?, sortOrder? }` |
| DELETE | `/api/projects/:id/help/tabs/:tabId` | `409 tab_not_empty` if it has active categories |

`GET /help/categories` already returns full rows, so `tabId` comes back with no route change.

### 8. Dashboard UI (`src/pages/HelpCenter.tsx`)

- **No tabs yet:** one outline button, `Add tab`, next to `New Category`. It opens a dialog with two name fields: the current content (default "Docs") and the new tab (placeholder "Changelog"). Submit creates both in order, so the first one adopts all categories and the tabs appear at once.
- **Tabs exist:** a `Tabs`/`TabsList`/`TabsTrigger` row (existing primitive) above the category column. The selected tab filters the category list and the mobile chip row. The selection is kept in the `?tab=` query param so a reload keeps it.
- **Manage tabs:** a `Manage tabs ›` text button opens a dialog. It has a sortable list (same dnd-kit pattern as `help-category-list.tsx`), inline rename, add, and delete. Delete is disabled for a non-empty tab, with the short reason "Move or archive its categories first."
- **Category dialog:** add a `Tab` select when tabs exist. It defaults to the selected tab. Moving a category means changing this field.
- **Article editor** (`HelpArticleEditor.tsx`): group the category select by tab (`SelectGroup` + `SelectLabel`) when tabs exist.
- **Home editor preview** (`help-home-previews.tsx`): the categories preview shows the first tab's categories, to match the live page.
- **Feedback:** new tab appears selected. Rename re-renders in place. Delete removes the item from the list. Reorder shows the new order at once (optimistic, like categories). Errors use a toast.

### 9. MCP (`worker/mcp-helpdesk-tools.ts`)

- `list_help_tabs` (`projects:read`): tabs with category counts.
- `create_help_tab`, `update_help_tab` (name, sortOrder), `delete_help_tab` (`helpdesk:write`). All three take `confirm: confirmedMutationSchema`, like the other help write tools.
- `summarizeHelpCategory` includes `tabId`. `create_help_category` and `update_help_category` accept an optional `tabId`.
- No new OAuth scope.

### 10. Docs

Update `AGENTS.md`: `help_tabs` and `help_categories.tabId` in the schema section, the new
routes, and the new MCP tools.

## Non-goals (v1)

- Tab URLs or slugs (`/docs/api/...`).
- A separate home page per tab.
- External-link tabs. The top nav already covers external links.
- Tab icons.
- Changelog features: sort by publish date, RSS, a "new" badge. Order stays manual (drag).
- Instant search results in the dialog. v1 submits to the search page. A later version can add a small JSON endpoint on top of `matchHelpArticlesFromQuery` and list results in the same dialog.
- OpenAPI import for the API tab. The existing API blocks in the editor stay the way to write endpoints.
- A `tab` field in the RAG frontmatter. It could help Maven tell a changelog entry from a guide, but a tab rename would then need every article in the tab re-published to R2. Do it as a follow-up if answers need it.

## Edge cases

- **Tab with no published articles:** hidden on the public site, shown in the dashboard.
- **Only one visible tab** (others are drafts): no tabs in the top bar. The sidebar shows only that tab's categories. This hides draft tabs' categories, which is correct because they have no published articles.
- **Category created at the same moment as the first tab:** it may keep `tabId = null`. The renderer treats it as the first tab, so it still shows.
- **Deleted tab with archived categories:** the FK sets their `tabId` to null. They are archived, so nothing renders.
- **Project delete:** tabs cascade with the project.
- **A deep link to a category in a hidden tab:** the page renders as today. No tab is marked active.
- **Widget page targeting excludes help pages:** the launcher stays hidden, but the Ask button still opens the chat. `open()` skips page targeting on purpose.
- **Custom CSS that targets `.help-topbar-nav`:** the class stays on the top-nav link group.

## Verification

1. `bun run lint` and `bunx tsc -b --force`, then `bun run build`.
2. Check the generated migration SQL has the table, column, FK, and index.
3. Local D1 with a production dump. Screenshot `/docs`, a category page, an article page, and search with `bun ~/.preview-tools/shot.mjs` at 1440px, 1100px, and 390px, in these states: 0 tabs, 1 tab, 2+ tabs, 6 long tab names with 3 top-nav links (overflow), and a draft-only tab.
4. Open search with the button, `⌘K`, and `/`. Check that `/` does nothing while typing in an input. Check the drawer order on mobile. Check the Ask button opens the chat, and hides when the widget script is blocked.
5. In the dashboard: create the first tab pair, move a category, reorder, rename, try to delete a non-empty tab, then delete an empty one. Check that the live page changes after each step (cache purge).
6. Over MCP: create a category without `tabId` and confirm it lands in the first tab.

## Decisions taken

1. Flat URLs. Tabs have no URL of their own.
2. Home belongs to the first visible tab.
3. On mobile, tabs go in the drawer. The bar stays one row.
4. Search covers all tabs.
5. The Ask button is in the top bar at 1024px and up.
6. Active tab is text only (foreground, weight 600).
