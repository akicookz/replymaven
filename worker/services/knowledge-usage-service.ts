import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { projects, subscriptions } from "../db";
import { knowledgePagesForChars } from "../../shared/plans";
import { entitlementsFor } from "./billing-service";

type Db = DrizzleD1Database<Record<string, unknown>>;

// ─── Errors ───────────────────────────────────────────────────────────────────

export class KnowledgeLimitError extends Error {
  readonly code = "knowledge_limit_reached";

  constructor(
    readonly used: number,
    readonly max: number,
    readonly adding: number,
  ) {
    super(knowledgeLimitMessage(used, max, adding));
    this.name = "KnowledgeLimitError";
  }
}

export function knowledgeLimitMessage(used: number, max: number, adding: number): string {
  const left = Math.max(0, max - used);
  if (adding <= 0) {
    return `Knowledge limit reached (${used.toLocaleString("en-US")} of ${max.toLocaleString("en-US")} pages). Remove knowledge or upgrade your plan.`;
  }
  return `This adds ${adding.toLocaleString("en-US")} knowledge pages. You have ${left.toLocaleString("en-US")} left. Remove knowledge or upgrade your plan.`;
}

// ─── Keys ─────────────────────────────────────────────────────────────────────

/** Indexed knowledge is markdown under `{projectId}/`, except visitor uploads. */
export function isKnowledgeKey(key: string): boolean {
  if (!key.endsWith(".md")) return false;
  const slash = key.indexOf("/");
  if (slash <= 0) return false;
  return !key.slice(slash + 1).startsWith("chat-images/");
}

function projectIdFromKey(key: string): string {
  return key.slice(0, key.indexOf("/"));
}

function pagesForSize(size: number | undefined): number {
  return knowledgePagesForChars(size ?? 0);
}

function byteLength(value: unknown): number | null {
  if (typeof value === "string") return new TextEncoder().encode(value).length;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Blob) return value.size;
  return null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export interface KnowledgeUsage {
  used: number;
  /** null = no limit. */
  max: number | null;
}

export class KnowledgeUsageService {
  constructor(private db: Db) {}

  /** Pages used across every project the owner has, and the plan limit. */
  async getAccountUsage(ownerId: string): Promise<KnowledgeUsage> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${projects.knowledgePages}), 0)` })
      .from(projects)
      .where(eq(projects.userId, ownerId));
    const used = Number(rows[0]?.total ?? 0);
    const subs = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, ownerId))
      .limit(1);
    const max = subs[0] ? entitlementsFor(subs[0]).limits.knowledgePages : null;
    return { used, max };
  }

  async getProjectOwnerUsage(projectId: string): Promise<KnowledgeUsage | null> {
    const rows = await this.db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const ownerId = rows[0]?.userId;
    if (!ownerId) return null;
    return this.getAccountUsage(ownerId);
  }

  /** Throws KnowledgeLimitError when adding pages would pass the plan limit. */
  async assertCanAdd(projectId: string, adding: number): Promise<void> {
    const usage = await this.getProjectOwnerUsage(projectId);
    if (!usage || usage.max === null) return;
    const blocked = adding > 0 ? usage.used + adding > usage.max : usage.used >= usage.max;
    if (blocked) throw new KnowledgeLimitError(usage.used, usage.max, adding);
  }

  /** Throws KnowledgeLimitError when writing `value` at `key` would pass the limit. */
  async assertCanWrite(r2: R2Bucket, key: string, value: string): Promise<void> {
    if (!isKnowledgeKey(key)) return;
    const previous = await r2.head(key);
    const delta = pagesForSize(byteLength(value) ?? 0) - pagesForSize(previous?.size);
    if (delta > 0) await this.assertCanAdd(projectIdFromKey(key), delta);
  }

  async adjust(projectId: string, delta: number): Promise<void> {
    if (delta === 0) return;
    await this.db
      .update(projects)
      .set({ knowledgePages: sql`max(0, ${projects.knowledgePages} + ${delta})` })
      .where(eq(projects.id, projectId));
  }

  async recomputeProject(r2: R2Bucket, projectId: string): Promise<number> {
    let pages = 0;
    let cursor: string | undefined;
    do {
      const listed = await r2.list({ prefix: `${projectId}/`, cursor, limit: 1000 });
      for (const object of listed.objects) {
        if (isKnowledgeKey(object.key)) pages += pagesForSize(object.size);
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    await this.db
      .update(projects)
      .set({ knowledgePages: pages })
      .where(eq(projects.id, projectId));
    return pages;
  }

  async recomputeAll(r2: R2Bucket): Promise<{ projects: number; failed: number }> {
    const rows = await this.db.select({ id: projects.id }).from(projects);
    let failed = 0;
    for (const row of rows) {
      try {
        await this.recomputeProject(r2, row.id);
      } catch (err) {
        failed += 1;
        console.error(`[KnowledgeUsage] Recompute failed for ${row.id}:`, err);
      }
    }
    return { projects: rows.length, failed };
  }
}

// ─── Tracked Bucket ───────────────────────────────────────────────────────────

/**
 * Wraps R2 so every knowledge write keeps `projects.knowledge_pages` current and
 * is refused past the plan limit. Other keys pass through untouched.
 */
export function trackKnowledgeBucket(r2: R2Bucket, db: Db): R2Bucket {
  const usage = new KnowledgeUsageService(db);

  async function put(
    key: string,
    value: Parameters<R2Bucket["put"]>[1],
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    if (!isKnowledgeKey(key)) return r2.put(key, value, options);

    const projectId = projectIdFromKey(key);
    const previous = await r2.head(key);
    const size = byteLength(value);
    const delta = size === null ? 0 : pagesForSize(size) - pagesForSize(previous?.size);
    if (delta > 0) await usage.assertCanAdd(projectId, delta);

    const written = await r2.put(key, value, options);
    const newSize = written?.size ?? size;
    if (newSize !== null) {
      await usage.adjust(projectId, pagesForSize(newSize) - pagesForSize(previous?.size));
    }
    return written;
  }

  async function remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    const tracked = list.filter(isKnowledgeKey);
    const heads = await Promise.all(tracked.map((key) => r2.head(key)));
    await r2.delete(keys);

    const deltas = new Map<string, number>();
    tracked.forEach((key, index) => {
      const pages = pagesForSize(heads[index]?.size);
      if (pages === 0) return;
      const projectId = projectIdFromKey(key);
      deltas.set(projectId, (deltas.get(projectId) ?? 0) - pages);
    });
    for (const [projectId, delta] of deltas) await usage.adjust(projectId, delta);
  }

  return new Proxy(r2, {
    get(target, prop) {
      if (prop === "put") return put;
      if (prop === "delete") return remove;
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
