export type McpToolScope =
  | "projects:read"
  | "conversations:reply"
  | "resources:write"
  | "helpdesk:write";

export interface McpToolInputDoc {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface McpToolDoc {
  name: string;
  title: string;
  description: string;
  scope: McpToolScope;
  readOnly: boolean;
  inputs: McpToolInputDoc[];
}

export const MCP_TOOL_DOCS: McpToolDoc[] = [
  {
    name: "list_projects",
    title: "List projects",
    description: "List ReplyMaven projects visible to the authenticated user.",
    scope: "projects:read",
    readOnly: true,
    inputs: [
      {
        name: "includeSettings",
        type: "boolean",
        required: false,
        description: "Include non-secret project settings for each project.",
      },
    ],
  },
  {
    name: "get_project_overview",
    title: "Get project overview",
    description:
      "Get project details, settings, widget configuration, dashboard stats, and recent activity.",
    scope: "projects:read",
    readOnly: true,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
    ],
  },
  {
    name: "list_resources",
    title: "List resources",
    description: "List knowledge resources configured for a ReplyMaven project.",
    scope: "projects:read",
    readOnly: true,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
    ],
  },
  {
    name: "get_resource_content",
    title: "Get resource content",
    description:
      "Read the extracted content for a knowledge resource. Content is truncated by default.",
    scope: "projects:read",
    readOnly: true,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "resourceId",
        type: "string",
        required: true,
        description: "ReplyMaven resource ID.",
      },
      {
        name: "maxChars",
        type: "integer (500–30,000)",
        required: false,
        description: "Maximum content characters to return. Defaults to 8,000.",
      },
    ],
  },
  {
    name: "list_conversations",
    title: "List conversations",
    description:
      "List recent conversations for a project, optionally filtered by status or visitor search.",
    scope: "projects:read",
    readOnly: true,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "status",
        type: '"open" | "closed" | "all"',
        required: false,
        description: "Conversation status filter. Defaults to open.",
      },
      {
        name: "searchQuery",
        type: "string",
        required: false,
        description: "Visitor name or email search.",
      },
      {
        name: "limit",
        type: "integer (1–50)",
        required: false,
        description: "Maximum conversations to return. Defaults to 20.",
      },
    ],
  },
  {
    name: "get_conversation",
    title: "Get conversation",
    description: "Read a conversation and its recent message history.",
    scope: "projects:read",
    readOnly: true,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "conversationId",
        type: "string",
        required: true,
        description: "ReplyMaven conversation ID.",
      },
      {
        name: "maxMessages",
        type: "integer (1–100)",
        required: false,
        description: "Maximum latest messages to return. Defaults to 50.",
      },
    ],
  },
  {
    name: "send_agent_reply",
    title: "Send agent reply",
    description: "Send an agent reply to a conversation and notify the live widget.",
    scope: "conversations:reply",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "conversationId",
        type: "string",
        required: true,
        description: "ReplyMaven conversation ID.",
      },
      {
        name: "content",
        type: "string",
        required: true,
        description: "Reply content, up to 5,000 characters.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
  {
    name: "create_faq_resource",
    title: "Create FAQ resource",
    description: "Create a structured FAQ resource and queue AI Search indexing.",
    scope: "resources:write",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "title",
        type: "string",
        required: true,
        description: "FAQ resource title.",
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "FAQ resource description.",
      },
      {
        name: "pairs",
        type: "Array<{ question, answer }>",
        required: true,
        description: "FAQ question and answer pairs.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
  {
    name: "update_faq_resource",
    title: "Update FAQ resource",
    description:
      "Replace an FAQ resource's title, description, and pairs, then queue AI Search sync.",
    scope: "resources:write",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "resourceId",
        type: "string",
        required: true,
        description: "FAQ resource ID.",
      },
      {
        name: "title",
        type: "string",
        required: false,
        description: "Replacement title. Defaults to the current title.",
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Replacement FAQ resource description.",
      },
      {
        name: "pairs",
        type: "Array<{ question, answer }>",
        required: true,
        description: "Replacement FAQ question and answer pairs.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
  {
    name: "create_webpage_resource",
    title: "Create webpage resource",
    description:
      "Create a webpage resource and queue crawling plus AI Search indexing.",
    scope: "resources:write",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "title",
        type: "string",
        required: true,
        description: "Webpage resource title.",
      },
      {
        name: "url",
        type: "URL string",
        required: true,
        description: "Webpage URL to crawl.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
  {
    name: "reindex_resource",
    title: "Reindex resource",
    description:
      "Reindex a webpage or FAQ resource. PDF reindexing is not available through MCP.",
    scope: "resources:write",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "resourceId",
        type: "string",
        required: true,
        description: "Resource ID to reindex.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
  {
    name: "list_help_categories",
    title: "List help categories",
    description:
      "List help center categories with per-category article counts.",
    scope: "projects:read",
    readOnly: true,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
    ],
  },
  {
    name: "list_help_articles",
    title: "List help articles",
    description:
      "List help center articles as summaries, optionally filtered by category or status.",
    scope: "projects:read",
    readOnly: true,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "categoryId",
        type: "string",
        required: false,
        description: "Only list articles in this category.",
      },
      {
        name: "status",
        type: '"draft" | "published"',
        required: false,
        description: "Only list articles with this status.",
      },
    ],
  },
  {
    name: "get_help_article",
    title: "Get help article",
    description:
      "Read an article's full markdown content and, when published, its live URL.",
    scope: "projects:read",
    readOnly: true,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "articleId",
        type: "string",
        required: true,
        description: "Help article ID.",
      },
    ],
  },
  {
    name: "create_help_category",
    title: "Create help category",
    description:
      "Create a help center category. The slug is derived from the name when omitted.",
    scope: "helpdesk:write",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "name",
        type: "string",
        required: true,
        description: "Category name, max 100 characters.",
      },
      {
        name: "slug",
        type: "string",
        required: false,
        description: "URL slug: lowercase letters, numbers, and hyphens.",
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Category description, max 500 characters.",
      },
      {
        name: "sortOrder",
        type: "integer",
        required: false,
        description: "Position in the category list.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
  {
    name: "update_help_category",
    title: "Update help category",
    description:
      "Update a category's name, slug, description, or position. Omitted fields are kept.",
    scope: "helpdesk:write",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "categoryId",
        type: "string",
        required: true,
        description: "Help category ID.",
      },
      {
        name: "name",
        type: "string",
        required: false,
        description: "Replacement name.",
      },
      {
        name: "slug",
        type: "string",
        required: false,
        description: "Replacement URL slug. Changing it breaks existing links.",
      },
      {
        name: "description",
        type: "string | null",
        required: false,
        description: "Replacement description. Null clears it.",
      },
      {
        name: "sortOrder",
        type: "integer",
        required: false,
        description: "Replacement position in the category list.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
  {
    name: "archive_help_category",
    title: "Archive help category",
    description:
      "Archive a category and unpublish its published articles. Articles are retained.",
    scope: "helpdesk:write",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "categoryId",
        type: "string",
        required: true,
        description: "Help category ID.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
  {
    name: "create_help_article",
    title: "Create help article",
    description:
      "Create a help center article with markdown content. Defaults to draft.",
    scope: "helpdesk:write",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "categoryId",
        type: "string",
        required: true,
        description: "Help category ID the article belongs to.",
      },
      {
        name: "title",
        type: "string",
        required: true,
        description: "Article title, max 200 characters.",
      },
      {
        name: "slug",
        type: "string",
        required: false,
        description: "URL slug. Derived from the title when omitted.",
      },
      {
        name: "excerpt",
        type: "string",
        required: false,
        description: "Summary shown in listings and search, max 280 characters.",
      },
      {
        name: "content",
        type: "string (markdown)",
        required: false,
        description: "Markdown body, max 100,000 characters.",
      },
      {
        name: "status",
        type: '"draft" | "published"',
        required: false,
        description: 'Initial status. Defaults to "draft".',
      },
      {
        name: "sortOrder",
        type: "integer",
        required: false,
        description: "Position within the category.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
  {
    name: "update_help_article",
    title: "Update help article",
    description:
      'Update an article. Status "published" puts it live; "draft" takes it down.',
    scope: "helpdesk:write",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "articleId",
        type: "string",
        required: true,
        description: "Help article ID.",
      },
      {
        name: "categoryId",
        type: "string",
        required: false,
        description: "Move the article to this category.",
      },
      {
        name: "title",
        type: "string",
        required: false,
        description: "Replacement title.",
      },
      {
        name: "slug",
        type: "string",
        required: false,
        description: "Replacement URL slug. Changing it breaks existing links.",
      },
      {
        name: "excerpt",
        type: "string | null",
        required: false,
        description: "Replacement summary. Null clears it.",
      },
      {
        name: "content",
        type: "string (markdown)",
        required: false,
        description: "Replacement markdown body. Replaces the whole body.",
      },
      {
        name: "status",
        type: '"draft" | "published"',
        required: false,
        description: '"published" makes the article live; "draft" unpublishes.',
      },
      {
        name: "sortOrder",
        type: "integer",
        required: false,
        description: "Replacement position within the category.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
  {
    name: "delete_help_article",
    title: "Delete help article",
    description:
      "Permanently delete an article. Prefer unpublishing unless deletion was explicitly requested.",
    scope: "helpdesk:write",
    readOnly: false,
    inputs: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "ReplyMaven project ID.",
      },
      {
        name: "articleId",
        type: "string",
        required: true,
        description: "Help article ID.",
      },
      {
        name: "confirm",
        type: "true",
        required: true,
        description: "Must be true after the user explicitly confirms the action.",
      },
    ],
  },
];
