import { z } from "zod";
import {
  FAQ_DESCRIPTION_MAX_CHARS,
  FAQ_PAIR_MAX_CHARS,
  FAQ_SET_MAX_CHARS,
  getFaqSetTotalLength,
} from "../shared/faq-limits";

// ─── Host Allow/Deny Helpers (shared by helpCustomUrl + helpTestProxy) ───────
function isLikelyIp(host: string): boolean {
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (/^\d+$/.test(h)) return true;
  if (/^0x[0-9a-f]+(\.|$)/i.test(h)) return true;
  if (/^[0-9a-f:]+(\.\d+){0,3}$/i.test(h) && h.includes(":")) return true;
  return false;
}

function isAllowedHelpHost(host: string): boolean {
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "workers.dev" ||
    host === "pages.dev" ||
    host === "r2.cloudflarestorage.com"
  ) {
    return false;
  }
  if (
    host.endsWith(".workers.dev") ||
    host.endsWith(".r2.cloudflarestorage.com") ||
    host.endsWith(".pages.dev")
  ) {
    return false;
  }
  if (isLikelyIp(host)) return false;
  return true;
}

function isPermittedHelpUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return isAllowedHelpHost(host);
  } catch {
    return false;
  }
}

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
  introMessageDelay: z.number().int().min(0).max(30).optional(),
  introMessageDuration: z.number().int().min(0).max(120).optional(),
  autoCannedDraft: z.boolean().optional(),
  autoRefinement: z.boolean().optional(),
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
  helpCustomUrl: z
    .string()
    .url("Must be a valid URL")
    .max(2048)
    .refine((u) => u.startsWith("https://"), "Must use HTTPS")
    .refine((u) => !u.endsWith("/"), "Must not end with a trailing slash")
    .refine(
      (u) => {
        try {
          const host = new URL(u).hostname.toLowerCase();
          return host !== "replymaven.com" && !host.endsWith(".replymaven.com");
        } catch {
          return false;
        }
      },
      "Cannot point at replymaven.com",
    )
    .refine(isPermittedHelpUrl, "Host is not allowed")
    .nullable()
    .optional(),
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

export const faqPairSchema = z
  .object({
    question: z.string().min(1, "Question is required").max(500),
    answer: z.string().min(1, "Answer is required").max(5000),
  })
  .refine(
    (pair) => pair.question.length + pair.answer.length <= FAQ_PAIR_MAX_CHARS,
    { message: `Q&A pair exceeds ${FAQ_PAIR_MAX_CHARS} characters` },
  );

const faqPairsArraySchema = z
  .array(faqPairSchema)
  .min(1, "At least one Q&A pair is required")
  .max(50, "Maximum 50 Q&A pairs allowed")
  .refine((pairs) => getFaqSetTotalLength(pairs) <= FAQ_SET_MAX_CHARS, {
    message: `FAQ set exceeds ${FAQ_SET_MAX_CHARS} total characters`,
  });

const faqDescriptionSchema = z
  .string()
  .max(
    FAQ_DESCRIPTION_MAX_CHARS,
    `Description must be ${FAQ_DESCRIPTION_MAX_CHARS} characters or fewer`,
  )
  .optional();

export const createResourceSchema = z.object({
  type: z.enum(["webpage", "pdf", "faq"]),
  title: z.string().min(1, "Title is required").max(200),
  url: z.string().max(2048).optional(),
  content: z.string().max(10000).optional(),
});

export const createFaqResourceSchema = z.object({
  type: z.literal("faq"),
  title: z.string().min(1, "Title is required").max(200),
  description: faqDescriptionSchema,
  pairs: faqPairsArraySchema,
});

export const updateFaqResourceSchema = z.object({
  title: z.string().min(1, "Title is required").max(200).optional(),
  description: faqDescriptionSchema,
  pairs: faqPairsArraySchema,
});

export const updateResourceContentSchema = z.object({
  title: z.string().min(1, "Title is required").max(200).optional(),
  content: z.string().min(1, "Content is required").max(100000),
});

export const generateFaqRequestSchema = z.object({
  topic: z.string().min(3, "Topic must be at least 3 characters").max(500),
  sourceResourceIds: z.array(z.string().min(1)).max(50).optional(),
  targetPairCount: z.number().int().min(3).max(15).optional(),
});

export const movePairSchema = z.object({
  destResourceId: z.string().min(1, "Destination required"),
  pairIndex: z.number().int().min(0),
});

export const applyFaqSplitSchema = z.object({
  buckets: z
    .array(
      z.object({
        title: z.string().min(1, "Title is required").max(200),
        description: faqDescriptionSchema,
        pairs: faqPairsArraySchema,
      }),
    )
    .min(2, "At least 2 buckets are required")
    .max(5, "Maximum 5 buckets allowed"),
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
  history: z
    .array(
      z.object({
        role: z.enum(["visitor", "bot", "agent"]),
        content: z.string().max(10000),
      }),
    )
    .max(50)
    .optional(),
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
export const agentReplySchema = z
  .object({
    content: z.string().max(5000).optional().default(""),
    imageUrl: z.string().max(500).optional(),
  })
  .refine((data) => data.content.trim().length > 0 || !!data.imageUrl, {
    message: "Reply must include text or an image",
  });

// ─── Send Message as Email ────────────────────────────────────────────────────
export const sendMessageAsEmailSchema = z.object({
  messageId: z.string().min(1),
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

// ─── Tickets ──────────────────────────────────────────────────────────────
export const ticketStatusEnum = z.enum([
  "open",
  "in_progress",
  "resolved",
  "closed",
]);
export const ticketPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);

export const ticketFieldSchema = z.object({
  label: z.string().min(1, "Label is required").max(100),
  type: z.enum(["text", "textarea"]),
  required: z.boolean().default(false),
});

export const updateTicketConfigSchema = z.object({
  enabled: z.boolean().optional(),
  description: z.string().max(500).nullable().optional(),
  fields: z
    .array(ticketFieldSchema)
    .max(10, "Maximum 10 fields allowed")
    .optional(),
});

export const submitTicketSchema = z.object({
  visitorId: z.string().min(1).max(100).optional(),
  visitorName: z.string().max(100).optional(),
  visitorEmail: z.string().email().optional(),
  data: z.record(z.string(), z.string().max(5000)),
});

export const updateTicketSchema = z.object({
  status: ticketStatusEnum.optional(),
  priority: ticketPriorityEnum.optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  dueDate: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),
});

export const bulkUpdateTicketStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  status: ticketStatusEnum,
});

export const ticketListQuerySchema = z.object({
  status: z.array(ticketStatusEnum).optional(),
  priority: z.array(ticketPriorityEnum).optional(),
  assigneeId: z.string().min(1).optional(),
  unassigned: z.boolean().optional(),
  q: z.string().max(200).optional(),
  sortBy: z
    .enum(["createdAt", "updatedAt", "dueDate", "priority", "status"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().min(0).optional(),
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

export const usageLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(["botMessages", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  status: z
    .enum(["active", "waiting_agent", "agent_replied", "closed"])
    .optional(),
  metaKey: z.string().max(100).regex(/^[a-zA-Z0-9_]+$/, "Invalid metadata key").optional(),
  metaValue: z.string().max(200).optional(),
});

// ─── Profile ──────────────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  workTitle: z.string().max(100).nullable().optional(),
  profilePicture: z.string().max(500).nullable().optional(),
});

// ─── Email Change ─────────────────────────────────────────────────────────────

export const requestEmailChangeSchema = z.object({
  newEmail: z.string().email("Invalid email address"),
});

export const verifyEmailChangeSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

// ─── Team Members ─────────────────────────────────────────────────────────────

export const inviteTeamMemberSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  role: z.enum(["admin", "member"]),
});

export const updateTeamMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

// ─── Visitor Bans ────────────────────────────────────────────────────────────
export const banVisitorSchema = z.object({
  visitorId: z.string().min(1).max(100),
  visitorEmail: z.string().email().nullable().optional(),
  reason: z.string().max(500).optional(),
  conversationId: z.string().min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

// ─── Greetings ────────────────────────────────────────────────────────────────

const allowedPagesArraySchema = z
  .array(z.string().min(1).max(500))
  .max(50)
  .nullable()
  .optional();

export const createGreetingSchema = z.object({
  enabled: z.boolean().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  title: z.string().min(1, "Title is required").max(120),
  description: z.string().max(500).nullable().optional(),
  ctaText: z.string().max(40).nullable().optional(),
  ctaLink: z
    .string()
    .url("CTA link must be a valid URL")
    .max(2048)
    .nullable()
    .optional(),
  authorId: z.string().max(100).nullable().optional(),
  allowedPages: allowedPagesArraySchema,
  delaySeconds: z.number().int().min(0).max(60).optional(),
  durationSeconds: z.number().int().min(0).max(120).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateGreetingSchema = z.object({
  enabled: z.boolean().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  ctaText: z.string().max(40).nullable().optional(),
  ctaLink: z.string().url().max(2048).nullable().optional(),
  authorId: z.string().max(100).nullable().optional(),
  allowedPages: allowedPagesArraySchema,
  delaySeconds: z.number().int().min(0).max(60).optional(),
  durationSeconds: z.number().int().min(0).max(120).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const reorderGreetingsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
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

// ─── Copilot ──────────────────────────────────────────────────────────────────
export const copilotSendMessageSchema = z.object({
  content: z.string().min(1, "Message cannot be empty").max(5000),
});

// ─── Help Categories ──────────────────────────────────────────────────────────
export const createHelpCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and hyphens")
    .optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z
    .union([
      z.string().regex(/^[A-Z][A-Za-z]{1,49}$/, "Invalid icon name"),
      z
        .string()
        .regex(
          /^\/api\/uploads\/[A-Za-z0-9._/-]+\.(jpe?g|png|webp)$/i,
          "Invalid icon image path",
        ),
    ])
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateHelpCategorySchema = createHelpCategorySchema.partial();

// ─── Help Articles ────────────────────────────────────────────────────────────
export const createHelpArticleSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  title: z.string().min(1, "Title is required").max(200),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and hyphens")
    .optional(),
  excerpt: z.string().max(280).nullable().optional(),
  content: z.string().max(100_000).optional().default(""),
  status: z.enum(["draft", "published"]).optional().default("draft"),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateHelpArticleSchema = createHelpArticleSchema
  .partial()
  .extend({
    categoryId: z.string().min(1).optional(),
  });

export const reorderHelpItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        sortOrder: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(200),
});

export const helpTestProxySchema = z.object({
  customUrl: z
    .string()
    .url("Must be a valid URL")
    .max(2048)
    .refine((u) => u.startsWith("https://"), "Must use HTTPS")
    .refine((u) => !u.endsWith("/"), "Must not end with a trailing slash")
    .refine(
      (u) => {
        try {
          const host = new URL(u).hostname.toLowerCase();
          return host !== "replymaven.com" && !host.endsWith(".replymaven.com");
        } catch {
          return false;
        }
      },
      "Cannot point at replymaven.com",
    )
    .refine(isPermittedHelpUrl, "Host is not allowed"),
});
