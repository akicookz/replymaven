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

// ─── Home Links ───────────────────────────────────────────────────────────────

export const homeLinks = sqliteTable(
  "home_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    icon: text("icon").notNull().default("link"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [index("idx_home_links_project").on(table.projectId)],
);

export type HomeLinkRow = typeof homeLinks.$inferSelect;
export type NewHomeLinkRow = typeof homeLinks.$inferInsert;

// ─── Quick Actions ────────────────────────────────────────────────────────────

export const quickActions = sqliteTable(
  "quick_actions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    action: text("action").notNull(),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [index("idx_quick_actions_project").on(table.projectId)],
);

export type QuickActionRow = typeof quickActions.$inferSelect;
export type NewQuickActionRow = typeof quickActions.$inferInsert;

// ─── Quick Topics ─────────────────────────────────────────────────────────────

export const quickTopics = sqliteTable(
  "quick_topics",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    prompt: text("prompt").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [index("idx_quick_topics_project").on(table.projectId)],
);

export type QuickTopicRow = typeof quickTopics.$inferSelect;
export type NewQuickTopicRow = typeof quickTopics.$inferInsert;

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
    status: text("status", { enum: ["pending", "indexed", "failed"] })
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
  quickTopics,
  resources,
  conversations,
  messages,
  cannedResponses,
  apiKeys,
} as const;
