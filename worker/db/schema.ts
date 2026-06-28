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
    introMessageDelay: integer("intro_message_delay").notNull().default(1),
    introMessageDuration: integer("intro_message_duration")
      .notNull()
      .default(15),
    autoCannedDraft: integer("auto_canned_draft", { mode: "boolean" })
      .notNull()
      .default(true),
    autoRefinement: integer("auto_refinement", { mode: "boolean" })
      .notNull()
      .default(true),
    autoCloseMinutes: integer("auto_close_minutes").default(30), // null = disabled
    helpCustomUrl: text("help_custom_url"),
    helpTopNav: text("help_top_nav"),
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
    // Focal point for the banner image as "X% Y%"; null = centered.
    bannerPosition: text("banner_position"),
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

// ─── Help Categories ──────────────────────────────────────────────────────────

export const helpCategories = sqliteTable(
  "help_categories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_help_categories_project_slug").on(
      table.projectId,
      table.slug,
    ),
    index("idx_help_categories_project_sort").on(
      table.projectId,
      table.sortOrder,
    ),
  ],
);

export type HelpCategoryRow = typeof helpCategories.$inferSelect;
export type NewHelpCategoryRow = typeof helpCategories.$inferInsert;

// ─── Help Articles ────────────────────────────────────────────────────────────

export const helpArticles = sqliteTable(
  "help_articles",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => helpCategories.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    excerpt: text("excerpt"),
    content: text("content").notNull().default(""),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_help_articles_category_slug").on(
      table.categoryId,
      table.slug,
    ),
    index("idx_help_articles_project").on(table.projectId),
    index("idx_help_articles_project_status").on(
      table.projectId,
      table.status,
    ),
    index("idx_help_articles_category_sort").on(
      table.categoryId,
      table.sortOrder,
    ),
  ],
);

export type HelpArticleRow = typeof helpArticles.$inferSelect;
export type NewHelpArticleRow = typeof helpArticles.$inferInsert;

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
    description: text("description"),
    url: text("url"),
    r2Key: text("r2_key"),
    content: text("content"),
    status: text("status", {
      enum: ["pending", "crawling", "indexed", "failed"],
    })
      .notNull()
      .default("pending"),
    lastIndexedAt: integer("last_indexed_at", { mode: "timestamp" }),
    sourceArticleId: text("source_article_id").references(
      () => helpArticles.id,
      { onDelete: "cascade" },
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
    index("idx_resources_project").on(table.projectId),
    index("idx_resources_status").on(table.status),
    uniqueIndex("idx_resources_source_article_id_unique")
      .on(table.sourceArticleId)
      .where(sql`${table.sourceArticleId} IS NOT NULL`),
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
    // Last status transition — used to detect crawls that have gone quiet.
    // Nullable (SQLite can't add a column with a non-constant default);
    // null means "no transition yet", fall back to createdAt.
    updatedAt: integer("updated_at", { mode: "timestamp" }),
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
    chatState: text("chat_state"), // JSON string – AI runtime state (separate from metadata)
    lastActivityAt: integer("last_activity_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    visitorLastSeenAt: integer("visitor_last_seen_at", { mode: "timestamp" }),
    visitorPresence: text("visitor_presence", { enum: ["active", "background"] }).default("active"),
    visitorLastOnlineAt: integer("visitor_last_online_at", { mode: "timestamp" }),
    snoozedUntil: integer("snoozed_until", { mode: "timestamp" }),
    priority: text("priority", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
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
    index("idx_conversations_visitor_name_lower").on(
      table.projectId,
      sql`LOWER(${table.visitorName})`,
    ),
    index("idx_conversations_visitor_email_lower").on(
      table.projectId,
      sql`LOWER(${table.visitorEmail})`,
    ),
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
    role: text("role", { enum: ["visitor", "bot", "agent", "system"] }).notNull(),
    content: text("content").notNull(),
    imageUrl: text("image_url"),
    sources: text("sources"), // JSON string of RAG source references
    senderName: text("sender_name"),
    senderAvatar: text("sender_avatar"),
    userId: text("user_id").references(() => authSchema.users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    emailedAt: integer("emailed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("idx_messages_conversation").on(table.conversationId),
    index("idx_messages_created").on(table.createdAt),
  ],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

// ─── Copilot Messages ─────────────────────────────────────────────────────────
// Agent-facing Copilot thread, scoped per visitor conversation. Visitors never
// see these. Distinct from `messages` so visitor-flow queries stay clean.

export const copilotMessages = sqliteTable(
  "copilot_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["agent", "copilot"] }).notNull(),
    content: text("content").notNull(),
    sources: text("sources"), // JSON string of RAG source references (same shape as messages.sources)
    agentUserId: text("agent_user_id").references(() => authSchema.users.id, {
      onDelete: "set null",
    }), // who asked; null for copilot rows and auto-suggest triggers
    autoSuggest: integer("auto_suggest", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_copilot_messages_conversation").on(table.conversationId),
    index("idx_copilot_messages_conversation_created").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export type CopilotMessageRow = typeof copilotMessages.$inferSelect;
export type NewCopilotMessageRow = typeof copilotMessages.$inferInsert;

// ─── Knowledge Suggestions ────────────────────────────────────────────────────

export const knowledgeSuggestions = sqliteTable(
  "knowledge_suggestions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "new_faq",
        "add_faq_pair",
        "refine_faq_pair",
        "new_sop",
        "add_sop",
        "refine_sop",
        "update_pdf",
        "update_webpage",
        "update_context",
      ],
    }).notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    targetResourceId: text("target_resource_id").references(
      () => resources.id,
      { onDelete: "set null" },
    ),
    targetGuidelineId: text("target_guideline_id").references(
      () => guidelines.id,
      { onDelete: "set null" },
    ),
    targetPageId: text("target_page_id").references(() => crawledPages.id, {
      onDelete: "set null",
    }),
    sourceConversationId: text("source_conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    suggestion: text("suggestion").notNull(), // JSON payload
    reasoning: text("reasoning"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_knowledge_suggestions_project").on(table.projectId),
    index("idx_knowledge_suggestions_status").on(table.status),
  ],
);

export type KnowledgeSuggestionRow = typeof knowledgeSuggestions.$inferSelect;
export type NewKnowledgeSuggestionRow =
  typeof knowledgeSuggestions.$inferInsert;

// ─── Ticket Config ────────────────────────────────────────────────────────

export const ticketConfig = sqliteTable(
  "ticket_config",
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
    uniqueIndex("idx_ticket_config_project").on(table.projectId),
  ],
);

export type TicketConfigRow = typeof ticketConfig.$inferSelect;
export type NewTicketConfigRow = typeof ticketConfig.$inferInsert;

// ─── Tickets ──────────────────────────────────────────────────────────────

export const tickets = sqliteTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    visitorId: text("visitor_id"),
    title: text("title").notNull().default("Ticket"),
    data: text("data").notNull(), // JSON object of { fieldLabel: value }
    status: text("status", {
      enum: ["open", "in_progress", "resolved", "closed"],
    })
      .notNull()
      .default("open"),
    priority: text("priority", {
      enum: ["low", "medium", "high", "urgent"],
    })
      .notNull()
      .default("medium"),
    // Nullable FK to users.id. No team-membership enforcement at the DB layer —
    // validation lives in TicketService.updateTicket against the owner's team.
    assigneeId: text("assignee_id").references(() => authSchema.users.id, {
      onDelete: "set null",
    }),
    dueDate: integer("due_date", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_tickets_project").on(table.projectId),
    uniqueIndex("idx_tickets_conversation").on(table.conversationId),
    index("idx_tickets_status").on(table.status),
    index("idx_tickets_assignee").on(table.assigneeId),
    index("idx_tickets_priority").on(table.priority),
  ],
);

export type TicketRow = typeof tickets.$inferSelect;
export type NewTicketRow = typeof tickets.$inferInsert;

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
    // When true the member can access every project under the owner. When false
    // access is limited to the projects listed in team_member_projects. Admins
    // always have full access regardless of this flag. Defaults true so existing
    // members keep the account-wide access they had before per-project scoping.
    accessAllProjects: integer("access_all_projects", { mode: "boolean" })
      .notNull()
      .default(true),
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

// ─── Team Member Project Access ─────────────────────────────────────────────────
// Maps a scoped team member (accessAllProjects = false) to the specific projects
// they're allowed to access. Rows are cascade-deleted with the member or project.

export const teamMemberProjects = sqliteTable(
  "team_member_projects",
  {
    id: text("id").primaryKey(),
    teamMemberId: text("team_member_id")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_team_member_projects_unique").on(
      table.teamMemberId,
      table.projectId,
    ),
    index("idx_team_member_projects_member").on(table.teamMemberId),
    index("idx_team_member_projects_project").on(table.projectId),
  ],
);

export type TeamMemberProjectRow = typeof teamMemberProjects.$inferSelect;
export type NewTeamMemberProjectRow = typeof teamMemberProjects.$inferInsert;

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
    alerted80: integer("alerted_80", { mode: "boolean" })
      .notNull()
      .default(false),
    alerted100: integer("alerted_100", { mode: "boolean" })
      .notNull()
      .default(false),
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

// ─── MCP OAuth ───────────────────────────────────────────────────────────────

export const mcpOAuthClients = sqliteTable(
  "mcp_oauth_clients",
  {
    id: text("id").primaryKey(),
    clientName: text("client_name").notNull(),
    redirectUris: text("redirect_uris").notNull(),
    grantTypes: text("grant_types").notNull(),
    responseTypes: text("response_types").notNull(),
    scope: text("scope").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("idx_mcp_oauth_clients_created").on(table.createdAt)],
);

export type McpOAuthClientRow = typeof mcpOAuthClients.$inferSelect;
export type NewMcpOAuthClientRow = typeof mcpOAuthClients.$inferInsert;

export const mcpOAuthAuthorizations = sqliteTable(
  "mcp_oauth_authorizations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpOAuthClients.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_mcp_oauth_authorizations_user").on(table.userId),
    index("idx_mcp_oauth_authorizations_client").on(table.clientId),
  ],
);

export type McpOAuthAuthorizationRow =
  typeof mcpOAuthAuthorizations.$inferSelect;
export type NewMcpOAuthAuthorizationRow =
  typeof mcpOAuthAuthorizations.$inferInsert;

export const mcpOAuthAuthCodes = sqliteTable(
  "mcp_oauth_auth_codes",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpOAuthClients.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    scope: text("scope").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_mcp_oauth_auth_codes_hash").on(table.codeHash),
    index("idx_mcp_oauth_auth_codes_client").on(table.clientId),
    index("idx_mcp_oauth_auth_codes_user").on(table.userId),
  ],
);

export type McpOAuthAuthCodeRow = typeof mcpOAuthAuthCodes.$inferSelect;
export type NewMcpOAuthAuthCodeRow = typeof mcpOAuthAuthCodes.$inferInsert;

export const mcpOAuthTokens = sqliteTable(
  "mcp_oauth_tokens",
  {
    id: text("id").primaryKey(),
    authorizationId: text("authorization_id")
      .notNull()
      .references(() => mcpOAuthAuthorizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpOAuthClients.id, { onDelete: "cascade" }),
    accessTokenHash: text("access_token_hash").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    scope: text("scope").notNull(),
    accessExpiresAt: integer("access_expires_at", {
      mode: "timestamp",
    }).notNull(),
    refreshExpiresAt: integer("refresh_expires_at", {
      mode: "timestamp",
    }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_mcp_oauth_tokens_access_hash").on(table.accessTokenHash),
    uniqueIndex("idx_mcp_oauth_tokens_refresh_hash").on(table.refreshTokenHash),
    index("idx_mcp_oauth_tokens_authorization").on(table.authorizationId),
    index("idx_mcp_oauth_tokens_user").on(table.userId),
    index("idx_mcp_oauth_tokens_client").on(table.clientId),
  ],
);

export type McpOAuthTokenRow = typeof mcpOAuthTokens.$inferSelect;
export type NewMcpOAuthTokenRow = typeof mcpOAuthTokens.$inferInsert;

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

// ─── Greetings ────────────────────────────────────────────────────────────────

export const greetings = sqliteTable(
  "greetings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    imageUrl: text("image_url"),
    // Focal point for the image as "X% Y%"; null = centered.
    imagePosition: text("image_position"),
    // "landscape" (wide banner crop) or "square"; null = landscape.
    imageAspect: text("image_aspect"),
    title: text("title").notNull(),
    description: text("description"),
    ctaText: text("cta_text"),
    ctaLink: text("cta_link"),
    authorId: text("author_id").references(() => authSchema.users.id, {
      onDelete: "set null",
    }),
    allowedPages: text("allowed_pages"),
    delaySeconds: integer("delay_seconds").notNull().default(3),
    durationSeconds: integer("duration_seconds").notNull().default(15),
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
    index("idx_greetings_project_sort").on(table.projectId, table.sortOrder),
  ],
);

export type GreetingRow = typeof greetings.$inferSelect;
export type NewGreetingRow = typeof greetings.$inferInsert;

// ─── Visitor Bans ────────────────────────────────────────────────────────────

export const visitorBans = sqliteTable(
  "visitor_bans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    visitorId: text("visitor_id").notNull(),
    visitorEmail: text("visitor_email"),
    reason: text("reason"),
    bannedBy: text("banned_by", { enum: ["dashboard", "agent"] })
      .notNull()
      .default("dashboard"),
    bannedFromConversationId: text("banned_from_conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_visitor_bans_project_visitor").on(
      table.projectId,
      table.visitorId,
    ),
    index("idx_visitor_bans_project_email").on(
      table.projectId,
      table.visitorEmail,
    ),
  ],
);

export type VisitorBanRow = typeof visitorBans.$inferSelect;
export type NewVisitorBanRow = typeof visitorBans.$inferInsert;

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
  copilotMessages,
  knowledgeSuggestions,
  ticketConfig,
  tickets,
  subscriptions,
  teamMembers,
  usage,
  apiKeys,
  mcpOAuthClients,
  mcpOAuthAuthorizations,
  mcpOAuthAuthCodes,
  mcpOAuthTokens,
  tools,
  toolExecutions,
  guidelines,
  visitorBans,
  greetings,
  helpCategories,
  helpArticles,
} as const;
