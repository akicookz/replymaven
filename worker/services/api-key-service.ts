import { and, desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { apiKeys } from "../db/schema";

export interface ApiKeySummary {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
}

async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Project keys authenticate inbound integrations only. Never return stored hashes.
export class ApiKeyService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async list(projectId: string): Promise<ApiKeySummary[]> {
    const rows = await this.db.select({
      id: apiKeys.id, label: apiKeys.label, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt,
    }).from(apiKeys).where(eq(apiKeys.projectId, projectId))
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  async create(projectId: string, label: string): Promise<{ apiKey: ApiKeySummary; key: string }> {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const encoded = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    const key = `rm_key_${encoded}`;
    const createdAt = new Date();
    const apiKey = { id: crypto.randomUUID(), label, prefix: key.slice(0, 14), createdAt: createdAt.toISOString() };
    await this.db.insert(apiKeys).values({
      ...apiKey, projectId, keyHash: await hashKey(key), createdAt,
    });
    return { apiKey, key };
  }

  async authenticate(projectId: string, key: string): Promise<{ keyId: string; projectId: string } | null> {
    if (!key || key.length > 512 || /\s/u.test(key)) return null;
    const rows = await this.db.select({ keyId: apiKeys.id, projectId: apiKeys.projectId })
      .from(apiKeys).where(and(eq(apiKeys.projectId, projectId), eq(apiKeys.keyHash, await hashKey(key))))
      .limit(1);
    return rows[0] ?? null;
  }

  async revoke(projectId: string, keyId: string): Promise<boolean> {
    const rows = await this.db.delete(apiKeys)
      .where(and(eq(apiKeys.projectId, projectId), eq(apiKeys.id, keyId)))
      .returning({ id: apiKeys.id });
    return rows.length > 0;
  }
}
