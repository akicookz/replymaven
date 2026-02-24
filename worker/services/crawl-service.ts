import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, count } from "drizzle-orm";
import robotsParser from "robots-parser";
import {
  crawledPages,
  resources,
  type CrawledPageRow,
} from "../db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrawlMessage {
  resourceId: string;
  projectId: string;
  url: string;
  depth: number;
  maxDepth: number;
  maxPages: number;
}

interface BrowserRenderingLinksResponse {
  success: boolean;
  result: string[];
}

interface BrowserRenderingMarkdownResponse {
  success: boolean;
  result: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_PAGES_DEFAULT = 50;
const MAX_DEPTH_DEFAULT = 1;
const USER_AGENT = "ReplyMaven Bot/1.0 (https://replymaven.com)";

// ─── Robots.txt cache (per-isolate, keyed by origin) ──────────────────────────

const robotsCache = new Map<string, { robot: ReturnType<typeof robotsParser>; expiresAt: number }>();

async function getRobots(origin: string): Promise<ReturnType<typeof robotsParser> | null> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.robot;
  }

  try {
    const robotsUrl = `${origin}/robots.txt`;
    const res = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });

    const text = res.ok ? await res.text() : "";
    const robot = robotsParser(robotsUrl, text);

    // Cache for 10 minutes
    robotsCache.set(origin, { robot, expiresAt: Date.now() + 600_000 });
    return robot;
  } catch {
    // If we can't fetch robots.txt, allow everything
    const robot = robotsParser(`${origin}/robots.txt`, "");
    robotsCache.set(origin, { robot, expiresAt: Date.now() + 600_000 });
    return robot;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class CrawlService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private r2: R2Bucket,
    private accountId: string,
    private apiToken: string,
  ) {}

  private get browserApiBase(): string {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/browser-rendering`;
  }

  // ─── Start Crawl ─────────────────────────────────────────────────────────

  async startCrawl(
    projectId: string,
    resourceId: string,
    url: string,
    queue: Queue<CrawlMessage>,
  ): Promise<void> {
    // Normalize URL
    const normalizedUrl = this.normalizeUrl(url);

    // Delete old crawled pages for this resource (supports re-crawl / reindex)
    const oldPages = await this.db
      .select({ r2Key: crawledPages.r2Key })
      .from(crawledPages)
      .where(eq(crawledPages.resourceId, resourceId));

    // Clean up old R2 objects
    for (const page of oldPages) {
      if (page.r2Key) {
        await this.r2.delete(page.r2Key);
      }
    }

    // Remove old crawled page records
    await this.db
      .delete(crawledPages)
      .where(eq(crawledPages.resourceId, resourceId));

    // Insert seed page into crawled_pages
    const id = crypto.randomUUID();
    await this.db.insert(crawledPages).values({
      id,
      resourceId,
      projectId,
      url: normalizedUrl,
      status: "pending",
      depth: 0,
    });

    // Update resource status to crawling
    await this.db
      .update(resources)
      .set({ status: "crawling" })
      .where(and(eq(resources.id, resourceId), eq(resources.projectId, projectId)));

    // Send to queue
    await queue.send({
      resourceId,
      projectId,
      url: normalizedUrl,
      depth: 0,
      maxDepth: MAX_DEPTH_DEFAULT,
      maxPages: MAX_PAGES_DEFAULT,
    });
  }

  // ─── Process URL (called from queue consumer) ────────────────────────────

  async processUrl(
    message: CrawlMessage,
    queue: Queue<CrawlMessage>,
  ): Promise<void> {
    const { resourceId, projectId, url, depth, maxDepth, maxPages } = message;

    // 1. Check if this page has already been crawled (or is being processed)
    const existing = await this.getCrawledPage(resourceId, url);
    if (existing && existing.status !== "pending") {
      return; // Already processed
    }

    // 1b. Cross-resource dedup: skip non-seed pages already crawled by another resource
    if (depth > 0) {
      const alreadyCrawledElsewhere = await this.isUrlCrawledInProject(
        projectId,
        url,
        resourceId,
      );
      if (alreadyCrawledElsewhere) {
        // Mark as skipped so it shows in UI
        if (existing) {
          await this.db
            .update(crawledPages)
            .set({ status: "skipped" })
            .where(
              and(
                eq(crawledPages.resourceId, resourceId),
                eq(crawledPages.url, url),
              ),
            );
        } else {
          await this.db.insert(crawledPages).values({
            id: crypto.randomUUID(),
            resourceId,
            projectId,
            url,
            status: "skipped",
            depth,
          });
        }
        await this.checkAndFinalizeResource(resourceId, projectId);
        return;
      }
    }

    // 2. Check page count limit
    const currentCount = await this.getCrawledPageCount(resourceId);
    if (currentCount >= maxPages) {
      // Mark resource as indexed since we hit the limit
      await this.finalizeResource(resourceId, projectId);
      return;
    }

    // 3. Check robots.txt
    try {
      const origin = new URL(url).origin;
      const robot = await getRobots(origin);
      if (robot && robot.isDisallowed(url, USER_AGENT)) {
        // Mark page as failed (disallowed by robots.txt)
        await this.markPageStatus(resourceId, url, "failed");
        await this.checkAndFinalizeResource(resourceId, projectId);
        return;
      }
    } catch {
      // Invalid URL, skip
      await this.markPageStatus(resourceId, url, "failed");
      await this.checkAndFinalizeResource(resourceId, projectId);
      return;
    }

    // 4. Fetch page content via Browser Rendering /markdown API
    let markdown: string;
    let pageTitle: string;
    try {
      const mdResult = await this.fetchMarkdown(url);
      markdown = mdResult.markdown;
      pageTitle = mdResult.title || url;
    } catch (err) {
      console.error(`Browser Rendering /markdown failed for ${url}:`, err);
      await this.markPageStatus(resourceId, url, "failed");
      await this.checkAndFinalizeResource(resourceId, projectId);
      return;
    }

    // Skip if content is too thin
    if (markdown.trim().length < 50) {
      await this.markPageStatus(resourceId, url, "failed");
      await this.checkAndFinalizeResource(resourceId, projectId);
      return;
    }

    // 5. Upload markdown to R2
    const urlHash = await this.hashUrl(url);
    const r2Key = `${projectId}/page-${urlHash}.md`;
    const content = `# ${pageTitle}\n\nSource: ${url}\n\n${markdown}`;

    await this.r2.put(r2Key, content, {
      customMetadata: {
        context: `Web page: ${pageTitle} (${url})`,
        resourceId,
        projectId,
      },
    });

    // 6. Mark page as crawled in DB
    if (existing) {
      await this.db
        .update(crawledPages)
        .set({ status: "crawled", r2Key })
        .where(
          and(
            eq(crawledPages.resourceId, resourceId),
            eq(crawledPages.url, url),
          ),
        );
    } else {
      // Shouldn't happen normally, but handle race conditions
      await this.db.insert(crawledPages).values({
        id: crypto.randomUUID(),
        resourceId,
        projectId,
        url,
        r2Key,
        status: "crawled",
        depth,
      });
    }

    // 7. Discover links if we haven't hit max depth
    if (depth < maxDepth) {
      try {
        const links = await this.fetchLinks(url);
        const seedOrigin = new URL(url).origin;

        // Filter to same-domain, deduplicate, normalize
        const newUrls = new Set<string>();
        for (const link of links) {
          try {
            const resolved = new URL(link, url);
            // Same origin only
            if (resolved.origin !== seedOrigin) continue;

            const normalized = this.normalizeUrl(resolved.href);

            // Skip anchors, javascript:, mailto:, etc.
            if (!normalized.startsWith("http")) continue;

            // Skip common non-content paths
            if (this.shouldSkipUrl(normalized)) continue;

            newUrls.add(normalized);
          } catch {
            // Invalid URL, skip
          }
        }

        // Check how many more pages we can crawl
        const updatedCount = await this.getCrawledPageCount(resourceId);
        const remaining = maxPages - updatedCount;

        let enqueued = 0;
        for (const newUrl of newUrls) {
          if (enqueued >= remaining) break;

          // Check if already in crawled_pages for this resource
          const alreadyExists = await this.getCrawledPage(resourceId, newUrl);
          if (alreadyExists) continue;

          // Cross-resource dedup: skip if already crawled by another resource in this project
          const crawledElsewhere = await this.isUrlCrawledInProject(
            projectId,
            newUrl,
            resourceId,
          );
          if (crawledElsewhere) {
            // Record as skipped so it shows in the UI
            await this.db.insert(crawledPages).values({
              id: crypto.randomUUID(),
              resourceId,
              projectId,
              url: newUrl,
              status: "skipped",
              depth: depth + 1,
            });
            continue;
          }

          // Insert as pending
          await this.db.insert(crawledPages).values({
            id: crypto.randomUUID(),
            resourceId,
            projectId,
            url: newUrl,
            status: "pending",
            depth: depth + 1,
          });

          // Send to queue
          await queue.send({
            resourceId,
            projectId,
            url: newUrl,
            depth: depth + 1,
            maxDepth,
            maxPages,
          });

          enqueued++;
        }
      } catch (err) {
        console.error(`Link discovery failed for ${url}:`, err);
        // Non-fatal: we still crawled the page content successfully
      }
    }

    // 8. Check if all pages for this resource are done
    await this.checkAndFinalizeResource(resourceId, projectId);
  }

  // ─── Browser Rendering API Helpers ──────────────────────────────────────

  private async fetchMarkdown(url: string): Promise<{ markdown: string; title: string }> {
    const res = await fetch(`${this.browserApiBase}/markdown`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        gotoOptions: {
          waitUntil: "networkidle2",
        },
        rejectRequestPattern: ["/^.*\\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff|mp4|webm|ogg|mp3|wav|woff2?|ttf|eot|otf|css)$/i"],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Browser Rendering /markdown returned ${res.status}: ${text}`);
    }

    const data = (await res.json()) as BrowserRenderingMarkdownResponse;
    if (!data.success) {
      throw new Error("Browser Rendering /markdown returned success=false");
    }

    // Extract title from first heading in markdown
    const titleMatch = data.result.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "";

    return {
      markdown: data.result,
      title,
    };
  }

  private async fetchLinks(url: string): Promise<string[]> {
    const res = await fetch(`${this.browserApiBase}/links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        gotoOptions: {
          waitUntil: "networkidle2",
        },
        excludeExternalLinks: true,
        rejectRequestPattern: ["/^.*\\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff|mp4|webm|ogg|mp3|wav|woff2?|ttf|eot|otf|css)$/i"],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Browser Rendering /links returned ${res.status}: ${text}`);
    }

    const data = (await res.json()) as BrowserRenderingLinksResponse;
    if (!data.success) {
      throw new Error("Browser Rendering /links returned success=false");
    }

    return data.result;
  }

  // ─── DB Helpers ─────────────────────────────────────────────────────────

  private async getCrawledPage(
    resourceId: string,
    url: string,
  ): Promise<CrawledPageRow | null> {
    const rows = await this.db
      .select()
      .from(crawledPages)
      .where(
        and(
          eq(crawledPages.resourceId, resourceId),
          eq(crawledPages.url, url),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async isUrlCrawledInProject(
    projectId: string,
    url: string,
    excludeResourceId?: string,
  ): Promise<CrawledPageRow | null> {
    const rows = await this.db
      .select()
      .from(crawledPages)
      .where(
        and(
          eq(crawledPages.projectId, projectId),
          eq(crawledPages.url, url),
          eq(crawledPages.status, "crawled"),
        ),
      )
      .limit(1);

    const match = rows[0] ?? null;
    // If we found a match but it belongs to the same resource we're crawling, ignore it
    if (match && excludeResourceId && match.resourceId === excludeResourceId) {
      return null;
    }
    return match;
  }

  private async getCrawledPageCount(resourceId: string): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(crawledPages)
      .where(eq(crawledPages.resourceId, resourceId));
    return result[0]?.value ?? 0;
  }

  private async markPageStatus(
    resourceId: string,
    url: string,
    status: CrawledPageRow["status"],
  ): Promise<void> {
    await this.db
      .update(crawledPages)
      .set({ status })
      .where(
        and(
          eq(crawledPages.resourceId, resourceId),
          eq(crawledPages.url, url),
        ),
      );
  }

  private async checkAndFinalizeResource(
    resourceId: string,
    projectId: string,
  ): Promise<void> {
    // Count pending pages for this resource
    const pendingRows = await this.db
      .select({ value: count() })
      .from(crawledPages)
      .where(
        and(
          eq(crawledPages.resourceId, resourceId),
          eq(crawledPages.status, "pending"),
        ),
      );

    const pendingCount = pendingRows[0]?.value ?? 0;
    if (pendingCount === 0) {
      await this.finalizeResource(resourceId, projectId);
    }
  }

  private async finalizeResource(
    resourceId: string,
    projectId: string,
  ): Promise<void> {
    // Count successfully crawled pages
    const crawledRows = await this.db
      .select({ value: count() })
      .from(crawledPages)
      .where(
        and(
          eq(crawledPages.resourceId, resourceId),
          eq(crawledPages.status, "crawled"),
        ),
      );

    const crawledCount = crawledRows[0]?.value ?? 0;
    const finalStatus = crawledCount > 0 ? "indexed" : "failed";

    await this.db
      .update(resources)
      .set({
        status: finalStatus,
        lastIndexedAt: finalStatus === "indexed" ? new Date() : undefined,
      })
      .where(and(eq(resources.id, resourceId), eq(resources.projectId, projectId)));
  }

  // ─── URL Helpers ────────────────────────────────────────────────────────

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      // Remove fragment
      u.hash = "";
      // Remove trailing slash (except for root)
      if (u.pathname !== "/" && u.pathname.endsWith("/")) {
        u.pathname = u.pathname.slice(0, -1);
      }
      // Sort query params for consistency
      u.searchParams.sort();
      return u.href;
    } catch {
      return url;
    }
  }

  private shouldSkipUrl(url: string): boolean {
    const skipPatterns = [
      /\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff?)$/i,
      /\.(css|js|map|woff2?|ttf|eot|otf)$/i,
      /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|tar|gz|rar)$/i,
      /\.(mp3|mp4|avi|mov|webm|ogg|wav)$/i,
      /\/(wp-admin|wp-includes|wp-content\/plugins)\//i,
      /\/(login|logout|signup|register|auth|admin)\b/i,
      /[?&](utm_|ref=|fbclid=|gclid=)/i,
    ];
    return skipPatterns.some((p) => p.test(url));
  }

  private async hashUrl(url: string): Promise<string> {
    const data = new TextEncoder().encode(url);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  }
}
