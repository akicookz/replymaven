import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import * as authSchema from "./auth.schema";

// ─── Projects ─────────────────────────────────────────────────────────────────

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    domain: text("domain"),
    onboarded: integer("onboarded", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_projects_slug_global").on(table.slug),
    index("idx_projects_user").on(table.userId),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

// ─── Project Settings ─────────────────────────────────────────────────────────

export const projectSettings = sqliteTable(
  "project_settings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    geminiApiKey: text("gemini_api_key"), // deprecated: platform key used instead
    aiSearchInstanceName: text("ai_search_instance_name"),
    telegramBotToken: text("telegram_bot_token"), // encrypted
    telegramChatId: text("telegram_chat_id"),
    companyName: text("company_name"),
    companyUrl: text("company_url"),
    industry: text("industry"),
    companyContext: text("company_context"),
    botName: text("bot_name"), // e.g. "Luna", "Alex" — no spaces, max 16 chars
    agentName: text("agent_name"), // e.g. "a team member", "an engineer" — max 50 chars
    toneOfVoice: text("tone_of_voice", {
      enum: ["professional", "friendly", "casual", "formal", "custom"],
    })
      .notNull()
      .default("professional"),
    customTonePrompt: text("custom_tone_prompt"),
    introMessage: text("intro_message").default(
      "Hi there! How can I help you today?",
    ),
    introMessageAuthorId: text("intro_message_author_id").references(
      () => authSchema.users.id,
      { onDelete: "set null" },
    ),
    showIntroBubble: integer("show_intro_bubble", { mode: "boolean" })
      .notNull()
      .default(true),
    autoCannedDraft: integer("auto_canned_draft", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("idx_project_settings_project").on(table.projectId)],
);

export type ProjectSettingsRow = typeof projectSettings.$inferSelect;
export type NewProjectSettingsRow = typeof projectSettings.$inferInsert;

// ─── Widget Config ────────────────────────────────────────────────────────────

export const widgetConfig = sqliteTable(
  "widget_config",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    primaryColor: text("primary_color").notNull().default("#2563eb"),
    backgroundColor: text("background_color").notNull().default("#ffffff"),
    textColor: text("text_color").notNull().default("#1f2937"),
    headerText: text("header_text").notNull().default("Chat with us"),
    headerSubtitle: text("header_subtitle"),
    avatarUrl: text("avatar_url"),
    position: text("position", {
      enum: ["bottom-right", "bottom-left", "center-inline"],
    })
      .notNull()
      .default("bottom-right"),
    borderRadius: real("border_radius").notNull().default(16),
    fontFamily: text("font_family").notNull().default("system-ui"),
    customCss: text("custom_css"),
    bannerUrl: text("banner_url"),
    homeTitle: text("home_title").notNull().default("How can we help?"),
    homeSubtitle: text("home_subtitle"),
    allowedPages: text("allowed_pages"),
    botMessageBgColor: text("bot_message_bg_color")
      .notNull()
      .default("#ffffff"),
    botMessageTextColor: text("bot_message_text_color")
      .notNull()
      .default("#18181b"),
    visitorMessageBgColor: text("visitor_message_bg_color"),
    visitorMessageTextColor: text("visitor_message_text_color"),
    backgroundStyle: text("background_style", {
      enum: ["solid", "blurred"],
    })
      .notNull()
      .default("solid"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("idx_widget_config_project").on(table.projectId)],
);

export type WidgetConfigRow = typeof widgetConfig.$inferSelect;
export type NewWidgetConfigRow = typeof widgetConfig.$inferInsert;

// ─── Quick Actions ────────────────────────────────────────────────────────────

export const quickActions = sqliteTable(
  "quick_actions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["prompt", "link", "inquiry"],
    })
      .notNull()
      .default("prompt"),
    label: text("label").notNull(),
    action: text("action").notNull().default(""),
    icon: text("icon").notNull().default("link"),
    showOnHome: integer("show_on_home", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [index("idx_quick_actions_project").on(table.projectId)],
);

export type QuickActionRow = typeof quickActions.$inferSelect;
export type NewQuickActionRow = typeof quickActions.$inferInsert;

// ─── Resources ────────────────────────────────────────────────────────────────

export const resources = sqliteTable(
  "resources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["webpage", "pdf", "faq"] }).notNull(),
    title: text("title").notNull(),
    url: text("url"),
    r2Key: text("r2_key"),
    content: text("content"),
    status: text("status", {
      enum: ["pending", "crawling", "indexed", "failed"],
    })
      .notNull()
      .default("pending"),
    lastIndexedAt: integer("last_indexed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_resources_project").on(table.projectId),
    index("idx_resources_status").on(table.status),
  ],
);

export type ResourceRow = typeof resources.$inferSelect;
export type NewResourceRow = typeof resources.$inferInsert;

// ─── Crawled Pages ────────────────────────────────────────────────────────────

export const crawledPages = sqliteTable(
  "crawled_pages",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    pageTitle: text("page_title"),
    r2Key: text("r2_key"),
    status: text("status", {
      enum: ["pending", "crawled", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    depth: integer("depth").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_crawled_pages_resource_url").on(
      table.resourceId,
      table.url,
    ),
    index("idx_crawled_pages_resource").on(table.resourceId),
    index("idx_crawled_pages_project").on(table.projectId),
  ],
);

export type CrawledPageRow = typeof crawledPages.$inferSelect;
export type NewCrawledPageRow = typeof crawledPages.$inferInsert;

// ─── Conversations ────────────────────────────────────────────────────────────

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    visitorId: text("visitor_id").notNull(),
    visitorName: text("visitor_name"),
    visitorEmail: text("visitor_email"),
    status: text("status", {
      enum: ["active", "waiting_agent", "agent_replied", "closed"],
    })
      .notNull()
      .default("active"),
    closeReason: text("close_reason", {
      enum: ["resolved", "ended", "spam", "bot_resolved"],
    }),
    telegramThreadId: text("telegram_thread_id"),
    metadata: text("metadata"), // JSON string
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_conversations_project").on(table.projectId),
    index("idx_conversations_visitor").on(table.visitorId),
    index("idx_conversations_status").on(table.status),
  ],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;

// ─── Messages ─────────────────────────────────────────────────────────────────

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["visitor", "bot", "agent"] }).notNull(),
    content: text("content").notNull(),
    imageUrl: text("image_url"),
    sources: text("sources"), // JSON string of RAG source references
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_messages_conversation").on(table.conversationId),
    index("idx_messages_created").on(table.createdAt),
  ],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

// ─── Canned Responses ─────────────────────────────────────────────────────────

export const cannedResponses = sqliteTable(
  "canned_responses",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(),
    response: text("response").notNull(),
    status: text("status", { enum: ["draft", "approved", "rejected"] })
      .notNull()
      .default("draft"),
    sourceConversationId: text("source_conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_canned_responses_project").on(table.projectId),
    index("idx_canned_responses_status").on(table.status),
  ],
);

export type CannedResponseRow = typeof cannedResponses.$inferSelect;
export type NewCannedResponseRow = typeof cannedResponses.$inferInsert;

// ─── Inquiry Config ───────────────────────────────────────────────────────

export const inquiryConfig = sqliteTable(
  "inquiry_config",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    description: text("description").default(
      "We'll get back to you within 1-2 hours.",
    ),
    fields: text("fields").notNull().default("[]"), // JSON array of { label, type, required }
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_inquiry_config_project").on(table.projectId),
  ],
);

export type InquiryConfigRow = typeof inquiryConfig.$inferSelect;
export type NewInquiryConfigRow = typeof inquiryConfig.$inferInsert;

// ─── Inquiries ────────────────────────────────────────────────────────────

export const inquiries = sqliteTable(
  "inquiries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    visitorId: text("visitor_id"),
    data: text("data").notNull(), // JSON object of { fieldLabel: value }
    status: text("status", { enum: ["new", "replied", "closed"] })
      .notNull()
      .default("new"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_inquiries_project").on(table.projectId),
  ],
);

export type InquiryRow =
  typeof inquiries.$inferSelect;
export type NewInquiryRow =
  typeof inquiries.$inferInsert;

// ─── Tools ────────────────────────────────────────────────────────────────────

export const tools = sqliteTable(
  "tools",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // Machine-friendly: check_order_status
    displayName: text("display_name").notNull(), // Human-friendly: Check Order Status
    description: text("description").notNull(), // Used by Gemini to decide when to call
    endpoint: text("endpoint").notNull(), // HTTP URL
    method: text("method", { enum: ["GET", "POST"] })
      .notNull()
      .default("POST"),
    headers: text("headers"), // JSON string, encrypted sensitive values
    parameters: text("parameters").notNull().default("[]"), // JSON array of param definitions
    responseMapping: text("response_mapping"), // JSON: { resultPath, summaryTemplate }
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    timeout: integer("timeout").notNull().default(10000), // ms, max 30000
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_tools_project").on(table.projectId),
    uniqueIndex("idx_tools_project_name").on(table.projectId, table.name),
  ],
);

export type ToolRow = typeof tools.$inferSelect;
export type NewToolRow = typeof tools.$inferInsert;

// ─── Tool Executions ──────────────────────────────────────────────────────────

export const toolExecutions = sqliteTable(
  "tool_executions",
  {
    id: text("id").primaryKey(),
    toolId: text("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    messageId: text("message_id"), // The bot message that triggered this
    input: text("input"), // JSON: parameters sent to endpoint
    output: text("output"), // JSON: response from endpoint (truncated)
    status: text("status", { enum: ["success", "error", "timeout"] }).notNull(),
    httpStatus: integer("http_status"),
    duration: integer("duration"), // ms
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_tool_executions_tool").on(table.toolId),
    index("idx_tool_executions_conversation").on(table.conversationId),
    index("idx_tool_executions_created").on(table.createdAt),
  ],
);

export type ToolExecutionRow = typeof toolExecutions.$inferSelect;
export type NewToolExecutionRow = typeof toolExecutions.$inferInsert;

// ─── Subscriptions ────────────────────────────────────────────────────────────

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    plan: text("plan", { enum: ["starter", "standard", "business"] }).notNull(),
    interval: text("interval", { enum: ["monthly", "annual"] }).notNull(),
    status: text("status", {
      enum: [
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "incomplete",
      ],
    }).notNull(),
    trialEndsAt: integer("trial_ends_at", { mode: "timestamp" }),
    currentPeriodStart: integer("current_period_start", { mode: "timestamp" }),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_subscriptions_user").on(table.userId),
    index("idx_subscriptions_stripe_customer").on(table.stripeCustomerId),
    index("idx_subscriptions_stripe_sub").on(table.stripeSubscriptionId),
  ],
);

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;

// ─── Team Members ─────────────────────────────────────────────────────────────

export const teamMembers = sqliteTable(
  "team_members",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => authSchema.users.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    status: text("status", { enum: ["pending", "accepted", "revoked"] })
      .notNull()
      .default("pending"),
    invitedAt: integer("invited_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("idx_team_members_owner_email").on(table.ownerId, table.email),
    index("idx_team_members_user").on(table.userId),
    index("idx_team_members_email").on(table.email),
  ],
);

export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type NewTeamMemberRow = typeof teamMembers.$inferInsert;

// ─── Usage ────────────────────────────────────────────────────────────────────

export const usage = sqliteTable(
  "usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
    periodStart: integer("period_start", { mode: "timestamp" }).notNull(),
    messagesUsed: integer("messages_used").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_usage_user_period").on(table.userId, table.periodStart),
  ],
);

export type UsageRow = typeof usage.$inferSelect;
export type NewUsageRow = typeof usage.$inferInsert;

// ─── API Keys ─────────────────────────────────────────────────────────────────

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(), // SHA-256 hash
    prefix: text("prefix").notNull(), // e.g. "sb_abc" for display
    label: text("label").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [index("idx_api_keys_project").on(table.projectId)],
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;

// ─── Guidelines (SOPs) ────────────────────────────────────────────────────────

export const guidelines = sqliteTable(
  "guidelines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    condition: text("condition").notNull(),
    instruction: text("instruction").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("idx_guidelines_project").on(table.projectId)],
);

export type GuidelineRow = typeof guidelines.$inferSelect;
export type NewGuidelineRow = typeof guidelines.$inferInsert;

// ─── Unified Schema Object ────────────────────────────────────────────────────

export const schema = {
  ...authSchema,
  projects,
  projectSettings,
  widgetConfig,
  quickActions,
  resources,
  crawledPages,
  conversations,
  messages,
  cannedResponses,
  inquiryConfig,
  inquiries,
  subscriptions,
  teamMembers,
  usage,
  apiKeys,
  tools,
  toolExecutions,
  guidelines,
} as const;
