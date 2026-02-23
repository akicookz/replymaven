import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { extractText } from "unpdf";
import {
  resources,
  crawledPages,
  type ResourceRow,
  type NewResourceRow,
  type CrawledPageRow,
} from "../db";
import { CrawlService, type CrawlMessage } from "./crawl-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FaqPair {
  question: string;
  answer: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ResourceService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private r2: R2Bucket,
  ) {}

  // ─── Basic CRUD ─────────────────────────────────────────────────────────────

  async getResourcesByProject(projectId: string): Promise<ResourceRow[]> {
    return this.db
      .select()
      .from(resources)
      .where(eq(resources.projectId, projectId));
  }

  async getResourceById(
    id: string,
    projectId: string,
  ): Promise<ResourceRow | null> {
    const rows = await this.db
      .select()
      .from(resources)
      .where(and(eq(resources.id, id), eq(resources.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createResource(
    data: Omit<NewResourceRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<ResourceRow> {
    const id = crypto.randomUUID();
    await this.db.insert(resources).values({ id, ...data });
    return (await this.getResourceById(id, data.projectId))!;
  }

  async deleteResource(
    id: string,
    projectId: string,
  ): Promise<boolean> {
    const resource = await this.getResourceById(id, projectId);
    if (!resource) return false;

    // Delete all R2 objects: main resource key + crawled page keys
    if (resource.type === "webpage") {
      const pages = await this.getCrawledPages(id, projectId);
      const keysToDelete: string[] = [];
      for (const page of pages) {
        if (page.r2Key) keysToDelete.push(page.r2Key);
      }
      if (resource.r2Key) keysToDelete.push(resource.r2Key);
      for (const key of keysToDelete) {
        await this.r2.delete(key);
      }
    } else if (resource.r2Key) {
      await this.r2.delete(resource.r2Key);
      // Also delete the text companion for PDFs
      if (resource.type === "pdf") {
        const textKey = `${projectId}/${id}-text.md`;
        await this.r2.delete(textKey);
      }
    }

    await this.db.delete(resources).where(eq(resources.id, id));
    return true;
  }

  async updateResourceStatus(
    id: string,
    projectId: string,
    status: ResourceRow["status"],
  ): Promise<void> {
    const updates: Record<string, unknown> = { status };
    if (status === "indexed") {
      updates.lastIndexedAt = new Date();
    }
    await this.db
      .update(resources)
      .set(updates)
      .where(and(eq(resources.id, id), eq(resources.projectId, projectId)));
  }

  // ─── Content Retrieval ──────────────────────────────────────────────────────

  async getResourceContent(
    id: string,
    projectId: string,
  ): Promise<{ content: string | null; pairs?: FaqPair[] } | null> {
    const resource = await this.getResourceById(id, projectId);
    if (!resource) return null;

    if (resource.type === "faq") {
      // Try to parse structured JSON pairs from content column
      if (resource.content) {
        try {
          const pairs = JSON.parse(resource.content) as FaqPair[];
          if (Array.isArray(pairs)) {
            return { content: resource.content, pairs };
          }
        } catch {
          // Legacy format: return raw content with no structured pairs
        }
      }
      return { content: resource.content };
    }

    if (resource.type === "pdf") {
      // Return extracted text from content column
      return { content: resource.content };
    }

    if (resource.type === "webpage") {
      // For webpages, content is distributed across crawled pages
      // Return the main resource r2 content if it exists
      if (resource.r2Key) {
        const obj = await this.r2.get(resource.r2Key);
        if (obj) {
          const text = await obj.text();
          return { content: text };
        }
      }
      return { content: null };
    }

    return { content: null };
  }

  // ─── Crawled Pages ──────────────────────────────────────────────────────────

  async getCrawledPages(
    resourceId: string,
    projectId: string,
  ): Promise<CrawledPageRow[]> {
    return this.db
      .select()
      .from(crawledPages)
      .where(
        and(
          eq(crawledPages.resourceId, resourceId),
          eq(crawledPages.projectId, projectId),
        ),
      );
  }

  async getCrawledPageById(
    pageId: string,
    resourceId: string,
    projectId: string,
  ): Promise<CrawledPageRow | null> {
    const rows = await this.db
      .select()
      .from(crawledPages)
      .where(
        and(
          eq(crawledPages.id, pageId),
          eq(crawledPages.resourceId, resourceId),
          eq(crawledPages.projectId, projectId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getCrawledPageContent(
    pageId: string,
    resourceId: string,
    projectId: string,
  ): Promise<string | null> {
    const page = await this.getCrawledPageById(pageId, resourceId, projectId);
    if (!page?.r2Key) return null;

    const obj = await this.r2.get(page.r2Key);
    if (!obj) return null;
    return obj.text();
  }

  async updateCrawledPageContent(
    pageId: string,
    resourceId: string,
    projectId: string,
    content: string,
  ): Promise<boolean> {
    const page = await this.getCrawledPageById(pageId, resourceId, projectId);
    if (!page?.r2Key) return false;

    await this.r2.put(page.r2Key, content, {
      customMetadata: {
        context: `Crawled page: ${page.url}`,
      },
    });

    return true;
  }

  async deleteCrawledPage(
    pageId: string,
    resourceId: string,
    projectId: string,
  ): Promise<boolean> {
    const page = await this.getCrawledPageById(pageId, resourceId, projectId);
    if (!page) return false;

    if (page.r2Key) {
      await this.r2.delete(page.r2Key);
    }

    await this.db.delete(crawledPages).where(eq(crawledPages.id, pageId));
    return true;
  }

  async refreshCrawledPage(
    pageId: string,
    resourceId: string,
    projectId: string,
    accountId: string,
    apiToken: string,
  ): Promise<boolean> {
    const page = await this.getCrawledPageById(pageId, resourceId, projectId);
    if (!page) return false;

    // Mark as pending
    await this.db
      .update(crawledPages)
      .set({ status: "pending" })
      .where(eq(crawledPages.id, pageId));

    try {
      // Use Browser Rendering API to re-fetch the page content
      const browserApiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`;
      const mdResponse = await fetch(`${browserApiBase}/markdown`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: page.url }),
      });

      if (!mdResponse.ok) {
        await this.db
          .update(crawledPages)
          .set({ status: "failed" })
          .where(eq(crawledPages.id, pageId));
        return false;
      }

      const mdData = (await mdResponse.json()) as { success: boolean; result: { markdown: string } };
      if (!mdData.success || !mdData.result?.markdown) {
        await this.db
          .update(crawledPages)
          .set({ status: "failed" })
          .where(eq(crawledPages.id, pageId));
        return false;
      }

      // Upload updated content to R2
      const r2Key = page.r2Key ?? `${projectId}/page-${crypto.randomUUID()}.md`;
      await this.r2.put(r2Key, mdData.result.markdown, {
        customMetadata: {
          context: `Crawled page: ${page.url}`,
        },
      });

      await this.db
        .update(crawledPages)
        .set({ r2Key, status: "crawled" })
        .where(eq(crawledPages.id, pageId));

      return true;
    } catch (err) {
      console.error(`Refresh failed for crawled page ${pageId}:`, err);
      await this.db
        .update(crawledPages)
        .set({ status: "failed" })
        .where(eq(crawledPages.id, pageId));
      return false;
    }
  }

  // ─── Resource Updates ───────────────────────────────────────────────────────

  async updateFaqResource(
    id: string,
    projectId: string,
    title: string | undefined,
    pairs: FaqPair[],
  ): Promise<ResourceRow | null> {
    const resource = await this.getResourceById(id, projectId);
    if (!resource || resource.type !== "faq") return null;

    const updates: Record<string, unknown> = {
      content: JSON.stringify(pairs),
    };
    if (title) {
      updates.title = title;
    }

    await this.db
      .update(resources)
      .set(updates)
      .where(and(eq(resources.id, id), eq(resources.projectId, projectId)));

    // Re-ingest to R2 for AI Search
    const effectiveTitle = title ?? resource.title;
    await this.ingestFaqFromPairs(projectId, id, effectiveTitle, pairs);

    return this.getResourceById(id, projectId);
  }

  async updateResourceContent(
    id: string,
    projectId: string,
    title: string | undefined,
    content: string,
  ): Promise<ResourceRow | null> {
    const resource = await this.getResourceById(id, projectId);
    if (!resource) return null;

    const updates: Record<string, unknown> = { content };
    if (title) {
      updates.title = title;
    }

    await this.db
      .update(resources)
      .set(updates)
      .where(and(eq(resources.id, id), eq(resources.projectId, projectId)));

    // Re-upload content to R2 for AI Search
    if (resource.type === "pdf") {
      const r2Key = `${projectId}/${id}-text.md`;
      const effectiveTitle = title ?? resource.title;
      const markdown = `# ${effectiveTitle}\n\n${content}`;
      await this.r2.put(r2Key, markdown, {
        customMetadata: {
          context: `PDF document: ${effectiveTitle}`,
        },
      });

      await this.db
        .update(resources)
        .set({ status: "indexed", lastIndexedAt: new Date() })
        .where(and(eq(resources.id, id), eq(resources.projectId, projectId)));
    }

    return this.getResourceById(id, projectId);
  }

  // ─── Resource Ingestion ─────────────────────────────────────────────────────

  async ingestWebpage(
    projectId: string,
    resourceId: string,
    url: string,
    _title: string,
    crawlQueue: Queue<CrawlMessage>,
    accountId: string,
    apiToken: string,
  ): Promise<void> {
    try {
      const crawlService = new CrawlService(this.db, this.r2, accountId, apiToken);
      await crawlService.startCrawl(projectId, resourceId, url, crawlQueue);
    } catch (err) {
      console.error(`Crawl initiation failed for resource ${resourceId}:`, err);
      await this.updateResourceStatus(resourceId, projectId, "failed");
    }
  }

  async ingestFaq(
    projectId: string,
    resourceId: string,
    title: string,
    content: string,
  ): Promise<void> {
    try {
      // Check if content is JSON pairs or legacy plain text
      let markdown: string;
      try {
        const pairs = JSON.parse(content) as FaqPair[];
        if (Array.isArray(pairs) && pairs.length > 0 && pairs[0].question) {
          markdown = this.faqPairsToMarkdown(title, pairs);
        } else {
          markdown = `# FAQ: ${title}\n\n${content}`;
        }
      } catch {
        markdown = `# FAQ: ${title}\n\n${content}`;
      }

      const r2Key = `${projectId}/${resourceId}.md`;
      await this.r2.put(r2Key, markdown, {
        customMetadata: {
          context: `FAQ: ${title}`,
        },
      });

      await this.db
        .update(resources)
        .set({ r2Key, status: "indexed", lastIndexedAt: new Date() })
        .where(and(eq(resources.id, resourceId), eq(resources.projectId, projectId)));
    } catch (err) {
      console.error(`FAQ ingestion failed for resource ${resourceId}:`, err);
      await this.updateResourceStatus(resourceId, projectId, "failed");
    }
  }

  async ingestFaqFromPairs(
    projectId: string,
    resourceId: string,
    title: string,
    pairs: FaqPair[],
  ): Promise<void> {
    try {
      const r2Key = `${projectId}/${resourceId}.md`;
      const markdown = this.faqPairsToMarkdown(title, pairs);
      await this.r2.put(r2Key, markdown, {
        customMetadata: {
          context: `FAQ: ${title}`,
        },
      });

      await this.db
        .update(resources)
        .set({ r2Key, status: "indexed", lastIndexedAt: new Date() })
        .where(and(eq(resources.id, resourceId), eq(resources.projectId, projectId)));
    } catch (err) {
      console.error(`FAQ ingestion failed for resource ${resourceId}:`, err);
      await this.updateResourceStatus(resourceId, projectId, "failed");
    }
  }

  async ingestPdf(
    projectId: string,
    resourceId: string,
    file: ArrayBuffer,
    title: string,
  ): Promise<void> {
    try {
      // Upload PDF directly to R2 under project folder
      const r2Key = `${projectId}/${resourceId}.pdf`;
      await this.r2.put(r2Key, file, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: {
          context: `PDF document: ${title}`,
        },
      });

      // Extract text from PDF using unpdf
      let extractedText = "";
      try {
        const { text } = await extractText(new Uint8Array(file));
        extractedText = (Array.isArray(text) ? text.join("\n") : String(text)).trim();
      } catch (err) {
        console.error(`PDF text extraction failed for resource ${resourceId}:`, err);
      }

      // Store extracted text in content column for editing
      const updates: Record<string, unknown> = {
        r2Key,
        status: "indexed",
        lastIndexedAt: new Date(),
      };
      if (extractedText) {
        updates.content = extractedText;

        // Also upload extracted text as markdown to R2 for AI Search
        const textR2Key = `${projectId}/${resourceId}-text.md`;
        const markdown = `# ${title}\n\n${extractedText}`;
        await this.r2.put(textR2Key, markdown, {
          customMetadata: {
            context: `PDF document: ${title}`,
          },
        });
      }

      await this.db
        .update(resources)
        .set(updates)
        .where(and(eq(resources.id, resourceId), eq(resources.projectId, projectId)));
    } catch (err) {
      console.error(`PDF ingestion failed for resource ${resourceId}:`, err);
      await this.updateResourceStatus(resourceId, projectId, "failed");
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private faqPairsToMarkdown(title: string, pairs: FaqPair[]): string {
    const sections = pairs.map(
      (pair) =>
        `## Q: ${pair.question}\n\n${pair.answer}`,
    );
    return `# FAQ: ${title}\n\n${sections.join("\n\n---\n\n")}`;
  }
}
