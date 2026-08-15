# MCP Helpdesk Tools

**Date:** 2026-08-16
**Status:** Implemented (worker/mcp-helpdesk-tools.ts, 2026-08-16)
**Scope:** Let MCP clients manage the help center (articles + categories) on behalf of a tenant.

## Problem

The MCP server (`worker/mcp-server.ts`) exposes 11 tools, none of which touch the help
center. Articles live in `help_articles` / `help_categories`, edited only through the
dashboard routes in `worker/index.ts`. Tenants who drive ReplyMaven from Claude (or any
MCP client) cannot draft, publish, or restructure help content.

## Non-goals

- Image/asset upload through MCP. Article content references already-hosted URLs.
- `helpCustomUrl` changes (reverse-proxy config; a bad value takes the help center down).
- Hard-deleting categories (the dashboard only soft-archives; MCP matches).
- Reorder tools. `sortOrder` is settable on create/update; a dedicated reorder tool can
  come later if agents actually need bulk reordering.

## Design

### New OAuth scope: `helpdesk:write`

Add to `MCP_OAUTH_SCOPES` in `worker/services/mcp-oauth-service.ts`:

```ts
export const MCP_OAUTH_SCOPES = [
  "projects:read",
  "conversations:reply",
  "resources:write",
  "helpdesk:write",
] as const;
```

Rationale: `resources:write` currently means "edit the bot's knowledgebase". Publishing
an article changes a public website; that is a different blast radius and deserves its
own consent line. Existing tokens lack the scope, so no already-connected client gains
helpdesk access silently — re-consent is required. Read tools ride on `projects:read`
like every other read.

Consent/metadata surfaces (`worker/mcp-oauth.ts`) enumerate `MCP_OAUTH_SCOPES`, so the
new scope appears automatically; add a human-readable label wherever scope labels are
mapped for the consent page.

### Tools

All tools follow the existing conventions in `mcp-server.ts`: `requireScope` first,
`getAccessibleProject` second (owner check + member `activeProjectIds` scoping), zod
`inputSchema` reusing shapes from `worker/validation.ts`, `confirm: confirmedMutationSchema`
on every mutation, results via `textResult`.

**Read (scope `projects:read`)**

| Tool | Input | Returns |
|---|---|---|
| `list_help_categories` | `projectId` | Categories (id, name, slug, sortOrder, archived) + per-category article counts via `getArticleCountsByCategory` |
| `list_help_articles` | `projectId`, `categoryId?`, `status?` | Article summaries only — id, categoryId, title, slug, excerpt, status, sortOrder, publishedAt, updatedAt. No `content` (100k max per article; listing must stay small) |
| `get_help_article` | `projectId`, `articleId` | Full row including markdown `content`, plus the live URL when published (`buildHelpUrl` from project slug / custom URL) |

**Write (scope `helpdesk:write`)**

| Tool | Input | Behavior |
|---|---|---|
| `create_help_category` | `projectId`, name/slug per `createHelpCategorySchema` | `HelpdeskService.createCategory` |
| `update_help_category` | `projectId`, `categoryId`, patch per `updateHelpCategorySchema` | `HelpdeskService.updateCategory` |
| `archive_help_category` | `projectId`, `categoryId` | `HelpdeskService.archiveCategory` (soft), then `waitUntil(triggerAutoRagSync("mcp.helpdesk.category.archive"))` — mirrors the dashboard DELETE route. `destructiveHint: true` |
| `create_help_article` | `projectId` + `createHelpArticleSchema` shape (categoryId, title, slug?, excerpt?, content?, status?, sortOrder?) | `HelpdeskService.createArticle(data, projectId, projectSlug)`. Service auto-generates a unique slug and, when `status: "published"`, writes the R2 mirror. Default status stays `draft` |
| `update_help_article` | `projectId`, `articleId` + `updateHelpArticleSchema` patch | `HelpdeskService.updateArticle`. Publish/unpublish happen through `status` — the service already stamps `publishedAt`, writes/removes the R2 mirror, and handles slug-conflict errors (`code: "slug_conflict"` → surfaced verbatim) |
| `delete_help_article` | `projectId`, `articleId` | `HelpdeskService.deleteArticle`. `destructiveHint: true`. Tool description steers agents to unpublish (`status: "draft"`) unless the user explicitly asked for deletion |

Rejected alternative: separate `publish_help_article` / `unpublish_help_article` tools.
The service models publish as a status transition inside `updateArticle` (R2 mirror,
`publishedAt`, AutoRAG bridge all keyed off it); a separate tool would duplicate that
path for no gain. The `update_help_article` description documents
`status: "published"` as the publish action so agents can find it.

Sync triggers: whatever `triggerAutoRagSync` reasons the dashboard article routes fire
on create/update/delete, the MCP tools fire the same ones with an `mcp.` prefix, wrapped
in `context.executionCtx.waitUntil` (same pattern as `reindex_resource`).

### Annotations

- Reads: `readOnlyHint: true`.
- Creates/updates: `readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true` (matches the FAQ tools).
- `archive_help_category`, `delete_help_article`: `destructiveHint: true`.

### Content contract

Tool descriptions state: `content` is markdown rendered by the help center
(`render-markdown.ts`), max 100,000 chars; `title` max 200; `excerpt` max 280; `slug`
lowercase `[a-z0-9-]`, max 80, unique per category, auto-derived from title when
omitted. These limits come from `createHelpArticleSchema` / `updateHelpArticleSchema`
and are enforced by reusing those shapes, not re-declared.

### Optional v1.1: `update_help_top_nav`

`projectId`, `items: [{label, href, classes?}]` (max 3), validated with the same rules
as the settings PUT route (HTTPS, not replymaven.com, classes charset/length). Scope
`helpdesk:write`. Deliberately excludes `helpCustomUrl`. Deferred unless asked for:
nav edits are rare and the validation lives client-side today, so this needs the
validation lifted into `worker/validation.ts` first.

## Implementation notes

- New file `worker/mcp-helpdesk-tools.ts` exporting `registerHelpdeskTools(server, context)`,
  called from the existing registration site in `mcp-server.ts` — keeps the 1,100-line
  file from growing another ~600 lines.
- `getAccessibleProject` returns the `ProjectRow`; pass `project.slug` as `projectSlug`
  so the service's R2 publish path works.
- No D1 migration. Deploy is a normal push to main.

## Tests (`worker/mcp-server.test.ts` or new `mcp-helpdesk-tools.test.ts`)

- Scope enforcement: `helpdesk:write` mutation rejected on a `resources:write`-only token.
- Cross-tenant: article/category in another user's project → "Project not found".
- Member scoping: member token without the project in `activeProjectIds` → not found.
- Publish transition: `update_help_article {status: "published"}` sets `publishedAt` and
  writes the R2 mirror; back to `draft` clears both.
- Slug conflict on update surfaces the `slug_conflict` error message.
- `list_help_articles` omits `content`.
