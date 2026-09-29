# Available MCP tools

ReplyMaven exposes 34 MCP tools. Tool access depends on the OAuth scope granted to the client. Every write tool requires a `confirm: true` input. The server checks this value; your MCP client should ask you before sending it.

All tools that take a `projectId` also check that the authenticated user can access that project. Unless stated otherwise, text fields have the limits shown by the tool's schema.

## Projects and resources

| Tool | Scope | Inputs | What it does |
| --- | --- | --- | --- |
| `list_projects` | `projects:read` | `includeSettings` (optional boolean, default `false`) | Lists projects visible to you. With `includeSettings: true`, includes non-secret project settings. |
| `get_project_overview` | `projects:read` | `projectId` | Returns project details, sanitized settings, widget configuration, quick actions, dashboard statistics, and recent conversations. |
| `list_resources` | `projects:read` | `projectId` | Lists knowledge resources and crawl counts. |
| `get_resource_content` | `projects:read` | `projectId`, `resourceId`, `maxChars` (optional integer, 500–30,000; default 8,000) | Returns extracted resource content, FAQ pairs when present, and whether the text was truncated. |
| `create_faq_resource` | `resources:write` | `projectId`, `title`, `pairs`; `description` optional; `confirm: true` | Creates an FAQ resource and queues indexing. The title is at most 200 characters. |
| `update_faq_resource` | `resources:write` | `projectId`, `resourceId`; `title`, `description`, and `pairs` follow the update schema; `confirm: true` | Replaces an FAQ resource's title, description, and pairs, then queues index sync. |
| `create_webpage_resource` | `resources:write` | `projectId`, `title` (up to 200 characters), `url` (valid URL, up to 2,048 characters), `confirm: true` | Creates a webpage resource, then queues a crawl and index sync. It does not upload PDFs. |
| `reindex_resource` | `resources:write` | `projectId`, `resourceId`, `confirm: true` | Queues a webpage or FAQ for reindexing. PDF reindexing through MCP is unsupported. |

`create_faq_resource` and `update_faq_resource` take `pairs` as structured question-and-answer entries. An FAQ has 1–50 pairs; each question can have up to 500 characters, each answer up to 5,000 characters, and each pair is limited to 2,000 combined characters. The full set is limited to 10,000 characters. Use the dashboard when you need to upload a PDF or inspect crawl details.

## Conversations and Maven's private thread

| Tool | Scope | Inputs | What it does |
| --- | --- | --- | --- |
| `list_conversations` | `projects:read` | `projectId`; `status` (optional: `open`, `closed`, `all`, default `open`); `searchQuery` (optional, up to 100 characters); `limit` (optional integer, 1–50, default 20) | Lists recent conversations. Search matches visitor name or email. |
| `get_conversation` | `projects:read` | `projectId`, `conversationId`; `maxMessages` (optional integer, 1–100, default 50) | Returns conversation details and the latest messages up to the selected limit. |
| `send_agent_reply` | `conversations:reply` | `projectId`, `conversationId`, `content` (1–5,000 characters), `confirm: true` | Adds a teammate reply to the visitor's conversation. A leading `@BotName` line is treated as a command for Maven, not as visitor-visible text. |
| `ask_maven` | `conversations:reply` | `projectId`, `conversationId`, `text` (1–5,000 characters), `confirm: true` | Sends a message to Maven in the private team thread for that conversation. Maven may research, reply to the visitor, assign, close, or block, and then answers in the private thread. |
| `get_sidechat_status` | `conversations:reply` | `projectId`, `conversationId` | Reports whether Maven is idle or working, and whether an approval or reply draft is present. It does not return the draft or private transcript. |

`get_sidechat_status` is read-only but needs `conversations:reply`. It is an exception to the usual read scope. `send_agent_reply` may route an `@BotName` command to Maven; the response reports whether a command was handled.

## Help-center tabs, categories, and articles

| Tool | Scope | Inputs | What it does |
| --- | --- | --- | --- |
| `list_help_tabs` | `projects:read` | `projectId` | Lists tabs in order and their active category counts. |
| `create_help_tab` | `helpdesk:write` | `projectId`, `name` (1–24 characters), `confirm: true` | Adds a tab at the end. A project can have at most six. Its first tab adopts categories that have no tab. |
| `update_help_tab` | `helpdesk:write` | `projectId`, `tabId`; optional `name` (1–24 characters) and `sortOrder`; `confirm: true` | Renames or reorders a tab. Omitted fields stay as they are. The first tab owns the help-center home page. |
| `delete_help_tab` | `helpdesk:write` | `projectId`, `tabId`, `confirm: true` | Deletes an empty tab. Move or archive its categories first. |
| `list_help_categories` | `projects:read` | `projectId` | Lists categories, their tab IDs, and article counts. Counts include drafts. |
| `list_help_articles` | `projects:read` | `projectId`; optional `categoryId`, `status` (`draft` or `published`) | Lists article summaries without body content. |
| `search_help_articles` | `projects:read` | `projectId`, `query` (1–200 characters); optional `categoryId`, `status` (`draft` or `published`), `limit` (1–50, default 20) | Searches titles, excerpts, and bodies. Returns ranked summaries and snippets, not full article bodies. Without `status`, drafts are included. |
| `get_help_article` | `projects:read` | `projectId`, `articleId` | Returns an article's full Markdown body and its live URL when published. |
| `create_help_category` | `helpdesk:write` | `projectId`, `name` (up to 100 characters); optional `tabId`, `slug` (up to 60 characters), `description` (up to 500), `icon`, `sortOrder`; `confirm: true` | Creates a category. The slug is derived from the name when omitted. |
| `update_help_category` | `helpdesk:write` | `projectId`, `categoryId`; optional `tabId`, `name`, `slug`, `description`, `icon`, `sortOrder`; `confirm: true` | Updates or moves a category. Omitted values stay as they are. Changing the slug changes the category URL. |
| `archive_help_category` | `helpdesk:write` | `projectId`, `categoryId`, `confirm: true` | Hides the category and unpublishes its published articles. The records remain, but MCP has no unarchive tool. |
| `create_help_article` | `helpdesk:write` | `projectId`, `categoryId`, `title` (up to 200 characters); optional `slug` (up to 80), `excerpt` (up to 280), `ogImageUrl`, `content` (up to 100,000), `status` (`draft` or `published`, default `draft`), `sortOrder`; `confirm: true` | Creates an article. An omitted slug is derived from the title. An omitted excerpt is filled from the first body text line; an omitted Open Graph image uses the first body image. |
| `update_help_article` | `helpdesk:write` | `projectId`, `articleId`; optional `categoryId`, `title`, `slug`, `excerpt`, `ogImageUrl`, `content`, `contentPatch`, `expectedUpdatedAt`, `status`, `sortOrder`; `confirm: true` | Updates, moves, publishes, or unpublishes an article. See the safe-edit notes below. |
| `delete_help_article` | `helpdesk:write` | `projectId`, `articleId`, `confirm: true` | Permanently deletes an article. Unpublish it with `update_help_article` when you want to keep its content. |
| `create_help_image_upload` | `helpdesk:write` | `projectId`, `contentType` (`image/jpeg`, `image/png`, `image/webp`, or `image/svg+xml`), `confirm: true` | Returns a short-lived upload URL and a hosted image URL for an article. Send raw image bytes in an HTTP `PUT` to `uploadUrl`, then use the returned `url` in Markdown. The result includes the size limit and expiry time. |
| `import_help_image` | `helpdesk:write` | `projectId`, `sourceUrl` (public HTTPS URL), `confirm: true` | Fetches a JPEG, PNG, WebP, or SVG image, stores it for the project, and returns its hosted URL. |

Help tabs are shown on the public site only when at least two tabs have published content. Each category belongs to one tab. The first tab keeps the help home and existing flat article URLs.

For a partial article edit, first call `get_help_article`. Send either `contentPatch` or `content`, never both. `contentPatch` is a unified diff, up to 100,000 characters, based on the exact body you just read. Put all changes for that article in one patch. Context text must still match; stale line numbers alone do not block a patch. Pass the returned `updatedAt` as `expectedUpdatedAt` to reject the write if someone changed the article after your read. This guard is recommended whenever you send content. A conflict returns `ok: false`, an error code, and the current update time.

Changing a published article requests an AI Search index sync in the background. The tool response does not mean indexing has finished. Check the article list in the dashboard for indexing status.

## Widget greeting cards

| Tool | Scope | Inputs | What it does |
| --- | --- | --- | --- |
| `list_greetings` | `projects:read` or `widget:write` | `projectId` | Lists enabled and disabled greeting cards in display order. This read tool accepts either scope. |
| `create_greeting` | `widget:write` | `projectId`, `title` (1–120 characters); optional `enabled`, `imageUrl`, `imagePosition`, `imageAspect`, `description` (up to 500), `ctaText` (up to 40), `ctaLink`, `allowedPages`, `delaySeconds` (0–60, default 3), `durationSeconds` (0–120, default 15), `sortOrder`; `confirm: true` | Creates a greeting card. `imageUrl` must be a public image URL. A label only shows when `ctaLink` is set. A duration of 0 keeps the card visible. |
| `update_greeting` | `widget:write` | `projectId`, `greetingId`; same optional greeting fields as create, `confirm: true` | Changes one card. Omitted fields stay as they are. |
| `delete_greeting` | `widget:write` | `projectId`, `greetingId`, `confirm: true` | Permanently removes a greeting card. |
| `reorder_greetings` | `widget:write` | `projectId`, `ids` (1–50 greeting IDs in order), `confirm: true` | Sets the card order. IDs not listed keep trailing positions. |

The MCP greeting tools cover text, CTA details, public image URLs, page patterns, delay, duration, enabled state, and order. They cannot upload artwork or video. Use the dashboard for uploaded images or video greetings.

## Scope exceptions and background work

Most read tools need `projects:read`, but `get_sidechat_status` needs `conversations:reply`, and `list_greetings` accepts `projects:read` or `widget:write`. Tool-specific scope labels above reflect the server checks.

Web-page crawls and resource indexing run after the MCP call returns. The tools report that work has started. Use the dashboard to check resource status and errors.

See [MCP permissions](https://replymaven.com/docs/mcp/mcp-permissions) for what each scope grants and [Connect an MCP client](https://replymaven.com/docs/mcp/connect-an-mcp-client) for client setup.
