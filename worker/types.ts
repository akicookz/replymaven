import { type User, type Session } from "better-auth";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { type SubscriptionRow } from "./db/schema";
import { type CrawlMessage } from "./services/crawl-service";
import type { FeatureKey, PlanId, PlanLimits } from "../shared/plans";

// ─── Plan Types ───────────────────────────────────────────────────────────────

export type { PlanId as Plan } from "../shared/plans";
export type BillingInterval = "monthly" | "annual";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

/** What the active account may do; null limits are not enforced. */
export interface Entitlements {
  plan: PlanId;
  trialing: boolean;
  limits: PlanLimits;
  features: ReadonlySet<FeatureKey>;
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
  // Sidechat can pin a different model while AI_MODEL drives the public bot.
  // MCP tool schemas (numeric enums etc.) are rejected by Gemini's
  // function-declaration API.
  BROWSER_RENDERING_API_TOKEN: string;
  AUTORAG_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_WEBHOOK_SECRET: string;
  UPLOADS: R2Bucket;
  CONVERSATIONS_CACHE: KVNamespace;
  AI: Ai;
  CRAWL_QUEUE: Queue<CrawlMessage>;
  SIDECHAT_TOKEN_SECRET: string;
}

export interface HonoAppContext {
  Bindings: AppEnv;
  Variables: {
    user: User | null;
    session: Session | null;
    db: DrizzleD1Database<Record<string, unknown>>;
    subscription: SubscriptionRow | null;
    entitlements: Entitlements | null;
    // Active-team context (resolved + cached per request). effectiveUserId is the
    // active team's owner id.
    effectiveUserId: string | null;
    activeRole: "owner" | "admin" | "member" | null;
    activeAccessAllProjects: boolean;
    activeProjectIds: string[] | null;
  };
}
