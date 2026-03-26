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
  introMessage: z.string().max(200).optional(),
  showIntroBubble: z.boolean().optional(),
  autoCannedDraft: z.boolean().optional(),
  companyName: z.string().max(200).nullable().optional(),
  companyUrl: z
    .string()
    .url("Must be a valid URL")
    .max(2048)
    .nullable()
    .optional(),
  companyContext: z.string().max(10000).nullable().optional(),
  botName: z
    .string()
    .max(16, "Bot name must be 16 characters or less")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Only letters, numbers, hyphens, and underscores",
    )
    .nullable()
    .optional(),
  agentName: z
    .string()
    .max(50, "Agent name must be 50 characters or less")
    .nullable()
    .optional(),
  introMessageAuthorId: z.string().max(100).nullable().optional(),
  autoCloseMinutes: z.number().int().min(5).max(1440).nullable().optional(),
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
  headerSubtitle: z.string().max(200).nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  position: z.enum(["bottom-right", "bottom-left", "center-inline"]).optional(),
  borderRadius: z.number().min(0).max(50).optional(),
  fontFamily: z.string().max(100).optional(),
  customCss: z.string().max(5000).nullable().optional(),
  bannerUrl: z.string().max(500).nullable().optional(),
  homeTitle: z.string().min(1).max(200).optional(),
  homeSubtitle: z.string().max(500).nullable().optional(),
  allowedPages: z.string().max(2000).nullable().optional(),
  botMessageBgColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color")
    .optional(),
  botMessageTextColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color")
    .optional(),
  visitorMessageBgColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color")
    .nullable()
    .optional(),
  visitorMessageTextColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color")
    .nullable()
    .optional(),
  backgroundStyle: z
    .enum(["solid", "blurred"])
    .optional(),
});

// ─── Quick Actions ────────────────────────────────────────────────────────────
export const createQuickActionSchema = z.object({
  type: z.enum(["prompt", "link", "inquiry"]),
  label: z.string().min(1, "Label is required").max(100),
  action: z.string().max(2048).optional().default(""),
  icon: z.string().max(50).optional().default("link"),
  showOnHome: z.boolean().optional().default(false),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateQuickActionSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  action: z.string().max(2048).optional(),
  icon: z.string().max(50).optional(),
  showOnHome: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

// ─── Resources ────────────────────────────────────────────────────────────────

export const faqPairSchema = z.object({
  question: z.string().min(1, "Question is required").max(500),
  answer: z.string().min(1, "Answer is required").max(5000),
});

export const createResourceSchema = z.object({
  type: z.enum(["webpage", "pdf", "faq"]),
  title: z.string().min(1, "Title is required").max(200),
  url: z.string().max(2048).optional(),
  content: z.string().max(10000).optional(),
});

export const createFaqResourceSchema = z.object({
  type: z.literal("faq"),
  title: z.string().min(1, "Title is required").max(200),
  pairs: z
    .array(faqPairSchema)
    .min(1, "At least one Q&A pair is required")
    .max(50, "Maximum 50 Q&A pairs allowed"),
});

export const updateFaqResourceSchema = z.object({
  title: z.string().min(1, "Title is required").max(200).optional(),
  pairs: z
    .array(faqPairSchema)
    .min(1, "At least one Q&A pair is required")
    .max(50, "Maximum 50 Q&A pairs allowed"),
});

export const updateResourceContentSchema = z.object({
  title: z.string().min(1, "Title is required").max(200).optional(),
  content: z.string().min(1, "Content is required").max(100000),
});

export const updateCrawledPageContentSchema = z.object({
  content: z.string().min(1, "Content is required").max(100000),
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
  imageUrl: z.string().max(500).optional(),
  pageContext: z.record(z.string(), z.string()).optional(),
});

export const updateVisitorEmailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export const updateConversationPublicSchema = z.object({
  visitorName: z.string().max(100).optional(),
  visitorEmail: z.string().email().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
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

// ─── Inquiries ────────────────────────────────────────────────────────────
export const inquiryFieldSchema = z.object({
  label: z.string().min(1, "Label is required").max(100),
  type: z.enum(["text", "textarea"]),
  required: z.boolean().default(false),
});

export const updateInquiryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  description: z.string().max(500).nullable().optional(),
  fields: z
    .array(inquiryFieldSchema)
    .max(10, "Maximum 10 fields allowed")
    .optional(),
});

export const submitInquirySchema = z.object({
  visitorId: z.string().min(1).max(100).optional(),
  visitorName: z.string().max(100).optional(),
  visitorEmail: z.string().email().optional(),
  data: z.record(z.string(), z.string().max(5000)),
});

export const updateInquiryStatusSchema = z.object({
  status: z.enum(["new", "replied", "closed"]),
});

// ─── Tools ────────────────────────────────────────────────────────────────────

const toolParameterSchema = z.object({
  name: z.string().min(1, "Parameter name is required").max(100),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().max(500).default(""),
  required: z.boolean().default(true),
  enum: z.array(z.string().max(100)).max(20).optional(),
});

const responseMappingSchema = z
  .object({
    resultPath: z.string().max(200).optional(),
    summaryTemplate: z.string().max(500).optional(),
  })
  .optional()
  .nullable();

export const createToolSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Must start with a letter and contain only lowercase letters, numbers, and underscores",
    ),
  displayName: z.string().min(1, "Display name is required").max(100),
  description: z.string().min(1, "Description is required").max(500),
  endpoint: z.string().url("Must be a valid URL").max(2048),
  method: z.enum(["GET", "POST"]).default("POST"),
  headers: z.record(z.string(), z.string().max(2048)).optional(),
  parameters: z.array(toolParameterSchema).max(10).default([]),
  responseMapping: responseMappingSchema,
  enabled: z.boolean().default(true),
  timeout: z.number().int().min(1000).max(30000).default(10000),
});

export const updateToolSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  endpoint: z.string().url().max(2048).optional(),
  method: z.enum(["GET", "POST"]).optional(),
  headers: z.record(z.string(), z.string().max(2048)).optional().nullable(),
  parameters: z.array(toolParameterSchema).max(10).optional(),
  responseMapping: responseMappingSchema,
  enabled: z.boolean().optional(),
  timeout: z.number().int().min(1000).max(30000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const testToolSchema = z.object({
  params: z.record(z.string(), z.unknown()),
});

// ─── Billing ──────────────────────────────────────────────────────────────────

export const createCheckoutSchema = z.object({
  plan: z.enum(["starter", "standard", "business"]),
  interval: z.enum(["monthly", "annual"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

// ─── Profile ──────────────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  workTitle: z.string().max(100).nullable().optional(),
  profilePicture: z.string().max(500).nullable().optional(),
});

// ─── Team Members ─────────────────────────────────────────────────────────────

export const inviteTeamMemberSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  role: z.enum(["admin", "member"]),
});

export const updateTeamMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

// ─── Guidelines (SOPs) ───────────────────────────────────────────────────────

export const createGuidelineSchema = z.object({
  condition: z.string().min(1, "Condition is required").max(500),
  instruction: z.string().min(1, "Instruction is required").max(2000),
  enabled: z.boolean().optional(),
});

export const updateGuidelineSchema = z.object({
  condition: z.string().min(1).max(500).optional(),
  instruction: z.string().min(1).max(2000).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
