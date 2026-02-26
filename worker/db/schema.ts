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
    toneOfVoice: text("tone_of_voice", {
      enum: ["professional", "friendly", "casual", "formal", "custom"],
    })
      .notNull()
      .default("professional"),
    customTonePrompt: text("custom_tone_prompt"),
    introMessage: text("intro_message").default(
      "Hi there! How can I help you today?",
    ),
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
  (table) => [
    uniqueIndex("idx_project_settings_project").on(table.projectId),
  ],
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
    avatarUrl: text("avatar_url"),
    position: text("position", { enum: ["bottom-right", "bottom-left"] })
      .notNull()
      .default("bottom-right"),
    borderRadius: real("border_radius").notNull().default(16),
    fontFamily: text("font_family").notNull().default("system-ui"),
    customCss: text("custom_css"),
    bannerUrl: text("banner_url"),
    homeTitle: text("home_title").notNull().default("How can we help?"),
    homeSubtitle: text("home_subtitle"),
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
      enum: ["prompt", "link", "contact_form", "booking"],
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
    status: text("status", { enum: ["pending", "crawled", "failed", "skipped"] })
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

// ─── Contact Form Config ──────────────────────────────────────────────────

export const contactFormConfig = sqliteTable(
  "contact_form_config",
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
    uniqueIndex("idx_contact_form_config_project").on(table.projectId),
  ],
);

export type ContactFormConfigRow = typeof contactFormConfig.$inferSelect;
export type NewContactFormConfigRow = typeof contactFormConfig.$inferInsert;

// ─── Contact Form Submissions ─────────────────────────────────────────────

export const contactFormSubmissions = sqliteTable(
  "contact_form_submissions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    visitorId: text("visitor_id"),
    data: text("data").notNull(), // JSON object of { fieldLabel: value }
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_contact_form_submissions_project").on(table.projectId),
  ],
);

export type ContactFormSubmissionRow =
  typeof contactFormSubmissions.$inferSelect;
export type NewContactFormSubmissionRow =
  typeof contactFormSubmissions.$inferInsert;

// ─── Booking Config ───────────────────────────────────────────────────────────

export const bookingConfig = sqliteTable(
  "booking_config",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    timezone: text("timezone").notNull().default("America/New_York"),
    slotDuration: integer("slot_duration").notNull().default(30), // 15, 30, or 60 minutes
    bufferTime: integer("buffer_time").notNull().default(0), // minutes between slots
    bookingWindowDays: integer("booking_window_days").notNull().default(14),
    minAdvanceHours: integer("min_advance_hours").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_booking_config_project").on(table.projectId),
  ],
);

export type BookingConfigRow = typeof bookingConfig.$inferSelect;
export type NewBookingConfigRow = typeof bookingConfig.$inferInsert;

// ─── Availability Rules ──────────────────────────────────────────────────────

export const availabilityRules = sqliteTable(
  "availability_rules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(), // 0=Sunday, 6=Saturday
    startTime: text("start_time").notNull(), // "09:00" HH:mm in owner timezone
    endTime: text("end_time").notNull(), // "17:00" HH:mm in owner timezone
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_availability_rules_project").on(table.projectId),
    index("idx_availability_rules_day").on(table.projectId, table.dayOfWeek),
  ],
);

export type AvailabilityRuleRow = typeof availabilityRules.$inferSelect;
export type NewAvailabilityRuleRow = typeof availabilityRules.$inferInsert;

// ─── Bookings ─────────────────────────────────────────────────────────────────

export const bookings = sqliteTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    visitorName: text("visitor_name").notNull(),
    visitorEmail: text("visitor_email").notNull(),
    visitorPhone: text("visitor_phone"),
    notes: text("notes"),
    startTime: integer("start_time", { mode: "timestamp" }).notNull(),
    endTime: integer("end_time", { mode: "timestamp" }).notNull(),
    timezone: text("timezone").notNull(), // visitor's timezone at time of booking
    status: text("status", { enum: ["confirmed", "cancelled"] })
      .notNull()
      .default("confirmed"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_bookings_project").on(table.projectId),
    index("idx_bookings_project_start").on(table.projectId, table.startTime),
    index("idx_bookings_status").on(table.status),
  ],
);

export type BookingRow = typeof bookings.$inferSelect;
export type NewBookingRow = typeof bookings.$inferInsert;

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
    method: text("method", { enum: ["GET", "POST"] }).notNull().default("POST"),
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
    conversationId: text("conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
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
  contactFormConfig,
  contactFormSubmissions,
  bookingConfig,
  availabilityRules,
  bookings,
  apiKeys,
  tools,
  toolExecutions,
} as const;
