---
title: Available MCP tools
slug: available-mcp-tools
excerpt: Every tool the ReplyMaven MCP server exposes, grouped by permission.
---

ReplyMaven exposes 20 tools over MCP. Read tools need `projects:read`; write tools need their own permission and an explicit `confirm: true` argument.

## Projects and resources (`projects:read`)

| Tool | Description |
| --- | --- |
| `list_projects` | List projects visible to the authenticated user. |
| `get_project_overview` | Project details, settings, widget configuration, stats, and recent activity. |
| `list_resources` | List knowledge resources configured for a project. |
| `get_resource_content` | Read the extracted content of a knowledge resource. |

## Conversations

| Tool | Permission | Description |
| --- | --- | --- |
| `list_conversations` | `projects:read` | List recent conversations, filterable by status or visitor search. |
| `get_conversation` | `projects:read` | Read a conversation and its recent message history. |
| `send_agent_reply` | `conversations:reply` | Send an agent reply and notify the live widget. |

## Knowledge resources (`resources:write`)

| Tool | Description |
| --- | --- |
| `create_faq_resource` | Create a structured FAQ resource and queue indexing. |
| `update_faq_resource` | Replace an FAQ resource's title, description, and pairs. |
| `create_webpage_resource` | Add a webpage resource and queue crawling plus indexing. |
| `reindex_resource` | Reindex a webpage or FAQ resource. |

## Help center

| Tool | Permission | Description |
| --- | --- | --- |
| `list_help_categories` | `projects:read` | List help center categories with article counts. |
| `list_help_articles` | `projects:read` | List article summaries, filterable by category or status. |
| `get_help_article` | `projects:read` | Read an article's full markdown and live URL. |
| `create_help_category` | `helpdesk:write` | Create a category. |
| `update_help_category` | `helpdesk:write` | Update a category's name, slug, description, or position. |
| `archive_help_category` | `helpdesk:write` | Archive a category and unpublish its articles. |
| `create_help_article` | `helpdesk:write` | Create an article (markdown, draft or published). |
| `update_help_article` | `helpdesk:write` | Update, publish, or unpublish an article. |
| `delete_help_article` | `helpdesk:write` | Permanently delete an article. |

> [!INFO]
> This help center is itself maintained through these tools.
