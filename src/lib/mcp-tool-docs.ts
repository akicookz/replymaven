export type McpToolScope =
  | "projects:read"
  | "conversations:reply"
  | "resources:write";

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
];
