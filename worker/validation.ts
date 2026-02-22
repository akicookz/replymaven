import { z } from "zod";

// ─── Projects ─────────────────────────────────────────────────────────────────
export const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100),
  domain: z.string().max(255).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100).optional(),
  domain: z.string().max(255).nullable().optional(),
});

// ─── Project Settings ─────────────────────────────────────────────────────────
export const updateProjectSettingsSchema = z.object({
  toneOfVoice: z
    .enum(["professional", "friendly", "casual", "formal", "custom"])
    .optional(),
  customTonePrompt: z.string().max(2000).nullable().optional(),
  introMessage: z.string().max(1000).optional(),
  autoCannedDraft: z.boolean().optional(),
});

// ─── Widget Config ────────────────────────────────────────────────────────────
export const updateWidgetConfigSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color")
    .optional(),
  backgroundColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color")
    .optional(),
  textColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color")
    .optional(),
  headerText: z.string().min(1).max(200).optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  position: z.enum(["bottom-right", "bottom-left"]).optional(),
  borderRadius: z.number().min(0).max(50).optional(),
  fontFamily: z.string().max(100).optional(),
  customCss: z.string().max(5000).nullable().optional(),
});

// ─── Quick Actions ────────────────────────────────────────────────────────────
export const createQuickActionSchema = z.object({
  label: z.string().min(1, "Label is required").max(50),
  action: z.string().min(1, "Action is required").max(500),
  icon: z.string().max(50).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

// ─── Quick Topics ─────────────────────────────────────────────────────────────
export const createQuickTopicSchema = z.object({
  label: z.string().min(1, "Label is required").max(100),
  prompt: z.string().min(1, "Prompt is required").max(500),
  sortOrder: z.number().int().min(0).optional(),
});

// ─── Resources ────────────────────────────────────────────────────────────────
export const createResourceSchema = z.object({
  type: z.enum(["webpage", "pdf", "faq"]),
  title: z.string().min(1, "Title is required").max(200),
  url: z.string().max(2048).optional(),
  content: z.string().max(10000).optional(),
});

// ─── Conversations ────────────────────────────────────────────────────────────
export const createConversationSchema = z.object({
  visitorId: z.string().min(1).max(100),
  visitorName: z.string().max(100).optional(),
  visitorEmail: z.string().email().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1, "Message cannot be empty").max(5000),
});

// ─── Agent Reply ──────────────────────────────────────────────────────────────
export const agentReplySchema = z.object({
  content: z.string().min(1, "Reply cannot be empty").max(5000),
});

// ─── Canned Responses ─────────────────────────────────────────────────────────
export const createCannedResponseSchema = z.object({
  trigger: z.string().min(1, "Trigger is required").max(500),
  response: z.string().min(1, "Response is required").max(5000),
});

export const updateCannedResponseSchema = z.object({
  trigger: z.string().min(1).max(500).optional(),
  response: z.string().min(1).max(5000).optional(),
  status: z.enum(["draft", "approved", "rejected"]).optional(),
});

// ─── Telegram ─────────────────────────────────────────────────────────────────
export const updateTelegramSchema = z.object({
  telegramBotToken: z.string().max(255).optional(),
  telegramChatId: z.string().max(100).optional(),
});

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const createApiKeySchema = z.object({
  label: z.string().min(1, "Label is required").max(100),
});

// ─── Onboarding ───────────────────────────────────────────────────────────────
export const onboardingStep1Schema = z.object({
  websiteName: z.string().min(1, "Website name is required").max(100),
  websiteUrl: z.string().url("Must be a valid URL").max(2048),
  companyName: z.string().min(1, "Company name is required").max(200),
  industry: z.string().min(1, "Industry is required").max(100),
});

export const onboardingContextSchema = z.object({
  companyContext: z.string().min(1, "Context is required").max(10000),
});

export const onboardingWidgetSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color"),
  borderRadius: z.number().min(0).max(50),
  fontFamily: z.string().max(100),
});
