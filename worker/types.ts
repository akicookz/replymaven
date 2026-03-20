import { type User, type Session } from "better-auth";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { type SubscriptionRow } from "./db/schema";

// ─── Plan Types ───────────────────────────────────────────────────────────────

export type Plan = "starter" | "standard" | "business";
export type BillingInterval = "monthly" | "annual";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export interface PlanLimits {
  plan: Plan;
  maxProjects: number;
  maxMessagesPerMonth: number;
  maxKnowledgeSources: number;
  maxSeats: number;
  pdfIndexing: boolean;
  telegram: boolean;
  customTone: boolean;
  autoCannedDraft: boolean;
  customCss: boolean;
  tools: boolean;
}

// Extend Env with secrets not in generated wrangler types
export interface AppEnv extends Env {
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  ENCRYPTION_KEY: string;
  GEMINI_API_KEY: string;
  OPENAI_API_KEY: string;
  AI_MODEL: string;
  BROWSER_RENDERING_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_STARTER_MONTHLY_PRICE_ID: string;
  STRIPE_STARTER_ANNUAL_PRICE_ID: string;
  STRIPE_STANDARD_MONTHLY_PRICE_ID: string;
  STRIPE_STANDARD_ANNUAL_PRICE_ID: string;
  STRIPE_BUSINESS_MONTHLY_PRICE_ID: string;
  STRIPE_BUSINESS_ANNUAL_PRICE_ID: string;
  UPLOADS: R2Bucket;
  CONVERSATIONS_CACHE: KVNamespace;
  AI: Ai;
  CRAWL_QUEUE: Queue<CrawlMessage>;
}

export interface HonoAppContext {
  Bindings: AppEnv;
  Variables: {
    user: User | null;
    session: Session | null;
    db: DrizzleD1Database<Record<string, unknown>>;
    subscription: SubscriptionRow | null;
    planLimits: PlanLimits | null;
    effectiveUserId: string | null;
  };
}
