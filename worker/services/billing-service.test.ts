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
});
