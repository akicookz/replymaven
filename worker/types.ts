import { type User, type Session } from "better-auth";
import { type DrizzleD1Database } from "drizzle-orm/d1";

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
  };
}
