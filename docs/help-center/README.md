# Help center content source

Source of truth for the ReplyMaven help center at `https://replymaven.com/help/replymaven` (project slug `replymaven`).

- `categories.json` defines the categories, descriptions, and order.
- Each subdirectory is one category. Each `NN-slug.md` file is one article; the numeric prefix is the article `sortOrder` within its category.
- Article frontmatter carries `title`, `slug`, and `excerpt`. The body below the frontmatter is the published markdown (no leading H1; the title renders from the article record).
- Internal links use `/help/replymaven/<category>/<article>` paths. The renderer rewrites them for custom domains.
- Supported markdown extras: GFM tables, fenced code (js/ts/json/html/css/bash/python/sql), `> [!INFO|TIP|WARNING|DANGER]` callouts, and `:::steps` / `::step Title` blocks.

Publishing happens through the ReplyMaven MCP tools (`create_help_category`, `create_help_article`, `update_help_article`) or the dashboard. Published articles are auto-indexed as AI knowledge. Edit here first, then push the change to the live article so this directory stays the source of truth.
