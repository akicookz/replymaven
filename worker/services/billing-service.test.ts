import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db";
import { type AppEnv } from "../types";
import { BillingService } from "./billing-service";

function createUsageLogHarness(): {
  service: BillingService;
  sqlite: Database;
} {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE projects (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE conversations (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    visitor_name text,
    visitor_email text,
    status text DEFAULT 'active' NOT NULL,
    metadata text,
    created_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE messages (
    id text PRIMARY KEY NOT NULL,
    conversation_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  const db = drizzleSqlite(sqlite, { schema });
  const env = {
    STRIPE_SECRET_KEY: "sk_test_usage_log",
    STRIPE_STARTER_MONTHLY_PRICE_ID: "price_starter_monthly",
    STRIPE_STARTER_ANNUAL_PRICE_ID: "price_starter_annual",
    STRIPE_STANDARD_MONTHLY_PRICE_ID: "price_standard_monthly",
    STRIPE_STANDARD_ANNUAL_PRICE_ID: "price_standard_annual",
    STRIPE_BUSINESS_MONTHLY_PRICE_ID: "price_business_monthly",
    STRIPE_BUSINESS_ANNUAL_PRICE_ID: "price_business_annual",
  } as unknown as AppEnv;
  return {
    service: new BillingService(
      db as unknown as DrizzleD1Database<Record<string, unknown>>,
      env,
    ),
    sqlite,
  };
}

describe("BillingService message usage", () => {
  test("usage logs count bot messages", async () => {
    const { service, sqlite } = createUsageLogHarness();
    sqlite.query("INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)")
      .run("project-1", "user-1", "Support");
    sqlite.query(`INSERT INTO conversations (
      id, project_id, visitor_name, visitor_email, status, created_at
    ) VALUES (?, ?, ?, ?, 'active', unixepoch())`)
      .run("conv-1", "project-1", "Alice", "alice@example.com");
    sqlite.query(`INSERT INTO messages (
      id, conversation_id, role, content, created_at
    ) VALUES (?, ?, 'bot', ?, unixepoch())`)
      .run("public-bot", "conv-1", "Public answer");

    const result = await service.getUsageLog("user-1", null, {
      limit: 25,
      offset: 0,
      sortBy: "createdAt",
      sortOrder: "desc",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.botMessageCount).toBe(1);
  });

  test("credits one persisted Agent message exactly once across retries", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE users (
      id text PRIMARY KEY NOT NULL
    )`);
    sqlite.exec(`CREATE TABLE usage (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      period_start integer NOT NULL,
      messages_used integer DEFAULT 0 NOT NULL,
      alerted_80 integer DEFAULT 0 NOT NULL,
      alerted_100 integer DEFAULT 0 NOT NULL,
      created_at integer DEFAULT (unixepoch()) NOT NULL,
      UNIQUE(user_id, period_start)
    )`);
    sqlite.exec(`CREATE TABLE message_usage_credits (
      message_id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_start integer NOT NULL,
      created_at integer DEFAULT (unixepoch()) NOT NULL
    )`);
    sqlite.exec(`CREATE TRIGGER message_usage_credits_increment
      AFTER INSERT ON message_usage_credits
      BEGIN
        INSERT INTO usage (
          id, user_id, period_start, messages_used,
          alerted_80, alerted_100, created_at
        ) VALUES (
          'usage_' || NEW.message_id,
          NEW.user_id, NEW.period_start, 1, 0, 0, unixepoch()
        )
        ON CONFLICT(user_id, period_start)
        DO UPDATE SET messages_used = messages_used + 1;
      END`);
    sqlite.query("INSERT INTO users (id) VALUES (?)").run("user-1");
    const db = drizzleSqlite(sqlite, { schema });
    const service = new BillingService(
      db as unknown as DrizzleD1Database<Record<string, unknown>>,
      { STRIPE_SECRET_KEY: "sk_test_usage_credit" } as AppEnv,
    );

    const periodOne = {
      plan: "starter",
      currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      interval: "monthly",
    } as Parameters<BillingService["incrementMessageUsageOnce"]>[2];
    const periodTwo = {
      ...periodOne,
      currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
    };

    await Promise.all([
      service.incrementMessageUsageOnce("assistant-1", "user-1", periodOne),
      service.incrementMessageUsageOnce("assistant-1", "user-1", periodOne),
    ]);
    await service.incrementMessageUsageOnce("assistant-1", "user-1", periodOne);
    await service.incrementMessageUsageOnce("assistant-2", "user-1", periodOne);
    await service.incrementMessageUsageOnce("assistant-3", "user-1", periodTwo);

    const rows = sqlite.query(`SELECT period_start, messages_used
      FROM usage ORDER BY period_start`).all() as Array<{
        period_start: number;
        messages_used: number;
      }>;
    expect(rows.map((row) => row.messages_used)).toEqual([2, 1]);
    expect(sqlite.query("SELECT count(*) AS count FROM message_usage_credits")
      .get()).toEqual({ count: 3 });
  });
});
