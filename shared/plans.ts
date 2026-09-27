// Plan catalog shared by the worker (enforcement) and the app (pricing, billing).
// Keep free of worker-only imports so the SPA and widget bundles can use it.

export type PlanId = "business" | "enterprise";

export const PLAN_IDS: readonly PlanId[] = ["business", "enterprise"];

export type FeatureKey =
  | "widget"
  | "widget_customization"
  | "quick_actions"
  | "greetings"
  | "contact_form"
  | "page_context"
  | "signed_identify"
  | "custom_css"
  | "shared_inbox"
  | "focus_mode"
  | "sidechat"
  | "email_channel"
  | "telegram"
  | "slack"
  | "knowledge_web"
  | "knowledge_pdf"
  | "knowledge_faq"
  | "sops"
  | "help_center"
  | "help_custom_domain"
  | "custom_tone"
  | "http_tools"
  | "mcp_connections"
  | "mcp_server"
  | "customers"
  | "visitor_bans"
  | "priority_support"
  | "sso"
  | "scim"
  | "sla"
  | "security_review"
  | "dedicated_mcp";

export type LimitKey =
  | "aiMessagesPerMonth"
  | "seats"
  | "projects"
  | "knowledgePages";

/** null means "set per contract". */
export type PlanLimits = Record<LimitKey, number | null>;
export type LimitOverrides = Partial<Record<LimitKey, number>>;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  selfServe: boolean;
  /** null = contact sales. */
  monthlyPriceUsd: number | null;
  /** Price per month when billed yearly (2 months free). */
  annualPriceUsd: number | null;
  limits: PlanLimits;
  features: ReadonlySet<FeatureKey>;
}

export const FEATURE_LABELS: Record<FeatureKey, { label: string; group: string }> = {
  widget: { label: "Embeddable chat widget", group: "Widget" },
  widget_customization: { label: "Colors, fonts, position, home screen", group: "Widget" },
  quick_actions: { label: "Quick actions", group: "Widget" },
  greetings: { label: "Greeting cards with image and video", group: "Widget" },
  contact_form: { label: "Contact form and tickets", group: "Widget" },
  page_context: { label: "Page context and metadata", group: "Widget" },
  signed_identify: { label: "Signed customer identity", group: "Widget" },
  custom_css: { label: "Custom CSS", group: "Widget" },
  shared_inbox: { label: "Shared inbox with assign, snooze, priority", group: "Inbox" },
  focus_mode: { label: "Focus mode and keyboard shortcuts", group: "Inbox" },
  sidechat: { label: "Sidechat with Maven", group: "Inbox" },
  email_channel: { label: "Email in via inbox forwarding", group: "Channels" },
  telegram: { label: "Telegram replies and alerts", group: "Channels" },
  slack: { label: "Slack replies and alerts", group: "Channels" },
  knowledge_web: { label: "Website crawling", group: "Knowledge" },
  knowledge_pdf: { label: "PDFs", group: "Knowledge" },
  knowledge_faq: { label: "FAQs", group: "Knowledge" },
  sops: { label: "SOPs", group: "Knowledge" },
  help_center: { label: "Hosted help center with tabs and search", group: "Help center" },
  help_custom_domain: { label: "Help center on your own domain", group: "Help center" },
  custom_tone: { label: "Custom tone of voice", group: "AI" },
  http_tools: { label: "Custom HTTP tools", group: "Actions" },
  mcp_connections: { label: "Connect MCP servers to Maven", group: "Actions" },
  mcp_server: { label: "ReplyMaven MCP server", group: "Agents" },
  customers: { label: "Customer profiles and history", group: "Customers" },
  visitor_bans: { label: "Visitor bans", group: "Safety" },
  priority_support: { label: "Priority support", group: "Support" },
  sso: { label: "SSO", group: "Enterprise" },
  scim: { label: "SCIM user provisioning", group: "Enterprise" },
  sla: { label: "99.9% uptime guarantee", group: "Enterprise" },
  security_review: { label: "Security review and DPA", group: "Enterprise" },
  dedicated_mcp: { label: "Dedicated MCP deployment", group: "Enterprise" },
};

const SELF_SERVE_FEATURES: readonly FeatureKey[] = [
  "widget",
  "widget_customization",
  "quick_actions",
  "greetings",
  "contact_form",
  "page_context",
  "signed_identify",
  "custom_css",
  "shared_inbox",
  "focus_mode",
  "sidechat",
  "email_channel",
  "telegram",
  "slack",
  "knowledge_web",
  "knowledge_pdf",
  "knowledge_faq",
  "sops",
  "help_center",
  "help_custom_domain",
  "custom_tone",
  "http_tools",
  "mcp_connections",
  "mcp_server",
  "customers",
  "visitor_bans",
];

const ENTERPRISE_ONLY_FEATURES: readonly FeatureKey[] = [
  "sso",
  "scim",
  "sla",
  "security_review",
  "dedicated_mcp",
];

export const PLANS: Record<PlanId, PlanDefinition> = {
  business: {
    id: "business",
    name: "Business",
    selfServe: true,
    monthlyPriceUsd: 49,
    annualPriceUsd: 490,
    limits: { aiMessagesPerMonth: 500, seats: 3, projects: 5, knowledgePages: 1_000 },
    features: new Set(SELF_SERVE_FEATURES),
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    selfServe: false,
    monthlyPriceUsd: null,
    annualPriceUsd: null,
    limits: { aiMessagesPerMonth: null, seats: null, projects: null, knowledgePages: null },
    features: new Set([...SELF_SERVE_FEATURES, "priority_support", ...ENTERPRISE_ONLY_FEATURES]),
  },
};

/** Extra seats on Business, on top of the included seats. */
export const EXTRA_SEAT_PRICE_USD = { monthly: 19, annual: 190 } as const;

/** AI messages available during a free trial, on every plan. */
export const TRIAL_AI_MESSAGES = 100;

/** Characters that make one knowledge page. */
export const KNOWLEDGE_PAGE_CHARS = 2_500;

export interface MessagePack {
  id: "pack_500" | "pack_1100" | "pack_5500";
  messages: number;
  priceUsd: number;
}

/** One-time AI message packs, sold on every plan, valid for 12 months. */
export const MESSAGE_PACKS: readonly MessagePack[] = [
  { id: "pack_500", messages: 500, priceUsd: 50 },
  { id: "pack_1100", messages: 1_100, priceUsd: 100 },
  { id: "pack_5500", messages: 5_500, priceUsd: 500 },
];

export const MESSAGE_PACK_VALID_MONTHS = 12;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export function hasFeature(plan: PlanId, key: FeatureKey): boolean {
  return PLANS[plan].features.has(key);
}

/**
 * Effective limit for a plan. Overrides apply only to Enterprise, so contract
 * limits left on a row do not follow a customer who moves to a self-serve plan.
 */
export function planLimit(
  plan: PlanId,
  key: LimitKey,
  overrides?: LimitOverrides | null,
): number | null {
  if (plan === "enterprise") {
    const value = overrides?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return PLANS[plan].limits[key];
}

export function planLimits(plan: PlanId, overrides?: LimitOverrides | null): PlanLimits {
  return {
    aiMessagesPerMonth: planLimit(plan, "aiMessagesPerMonth", overrides),
    seats: planLimit(plan, "seats", overrides),
    projects: planLimit(plan, "projects", overrides),
    knowledgePages: planLimit(plan, "knowledgePages", overrides),
  };
}

/** Features a plan adds over the plan below it, in catalog order, for pricing cards. */
export function pricingFeatures(plan: PlanId): FeatureKey[] {
  const below: Record<PlanId, PlanId | null> = {
    business: null,
    enterprise: "business",
  };
  const base = below[plan];
  return (Object.keys(FEATURE_LABELS) as FeatureKey[]).filter(
    (key) => PLANS[plan].features.has(key) && (!base || !PLANS[base].features.has(key)),
  );
}

export function knowledgePagesForChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / KNOWLEDGE_PAGE_CHARS);
}

/** Parses the `limit_overrides` column; unknown keys and bad values are dropped. */
export function parseLimitOverrides(raw: string | null | undefined): LimitOverrides {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: LimitOverrides = {};
  const keys: LimitKey[] = ["aiMessagesPerMonth", "seats", "projects", "knowledgePages"];
  for (const key of keys) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      result[key] = Math.floor(value);
    }
  }
  return result;
}
