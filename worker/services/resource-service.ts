import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, inArray } from "drizzle-orm";
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

export interface SourceReference {
  title: string;
  url: string | null;
  type: "webpage" | "pdf" | "faq";
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
      if (resource.type === "pdf") {
        // Clean up both legacy and canonical PDF artifacts.
        const textKey = `${projectId}/${id}-text.md`;
        const legacyPdfKey = `${projectId}/${id}.pdf`;
        if (resource.r2Key !== textKey) {
          await this.r2.delete(textKey);
        }
        if (resource.r2Key !== legacyPdfKey) {
          await this.r2.delete(legacyPdfKey);
        }
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
        body: JSON.stringify({
          url: page.url,
          gotoOptions: {
            waitUntil: "networkidle2",
          },
          rejectRequestPattern: ["/^.*\\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff|mp4|webm|ogg|mp3|wav|woff2?|ttf|eot|otf|css)$/i"],
        }),
      });

      if (!mdResponse.ok) {
        await this.db
          .update(crawledPages)
          .set({ status: "failed" })
          .where(eq(crawledPages.id, pageId));
        return false;
      }

      const mdData = (await mdResponse.json()) as { success: boolean; result: string };
      if (!mdData.success || !mdData.result) {
        await this.db
          .update(crawledPages)
          .set({ status: "failed" })
          .where(eq(crawledPages.id, pageId));
        return false;
      }

      // Upload updated content to R2
      const r2Key = page.r2Key ?? `${projectId}/page-${crypto.randomUUID()}.md`;
      await this.r2.put(r2Key, mdData.result, {
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
    description?: string | null,
  ): Promise<ResourceRow | null> {
    const resource = await this.getResourceById(id, projectId);
    if (!resource || resource.type !== "faq") return null;

    const updates: Record<string, unknown> = {
      content: JSON.stringify(pairs),
    };
    if (title) {
      updates.title = title;
    }
    if (description !== undefined) {
      updates.description = description;
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
        .set({ r2Key, status: "indexed", lastIndexedAt: new Date() })
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
      const pdfR2Key = `${projectId}/${resourceId}.pdf`;
      await this.r2.put(pdfR2Key, file, {
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
        r2Key: pdfR2Key,
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
        // Canonical key for retrieval/source mapping should point to text.
        updates.r2Key = textR2Key;
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

  // ─── Source Resolution ───────────────────────────────────────────────────────

  /**
   * Given a list of R2 filenames from AI Search results, resolve them to
   * display-ready source references (title + URL + type). Returns sources for
   * all resource types: webpages (clickable), PDFs (label only), and FAQs (label only).
   */
  async resolveSourceReferenceMap(
    projectId: string,
    filenames: string[],
  ): Promise<Map<string, SourceReference>> {
    const sourceMap = new Map<string, SourceReference>();
    const uniqueFilenames = [...new Set(filenames)];
    if (uniqueFilenames.length === 0) {
      return sourceMap;
    }

    const projectPrefix = `${projectId}/`;

    // Filenames that follow the `{projectId}/{resourceId}-text.md` or
    // `{projectId}/{resourceId}.pdf` patterns resolve to PDF resources; pull
    // the candidate resource ids up front so we can batch a single resources
    // lookup for them.
    const pdfResourceIdByFilename = new Map<string, string>();
    for (const filename of uniqueFilenames) {
      if (!filename.startsWith(projectPrefix)) continue;
      if (filename.endsWith("-text.md")) {
        const id = filename
          .slice(projectPrefix.length, -"-text.md".length)
          .trim();
        if (id) pdfResourceIdByFilename.set(filename, id);
      } else if (filename.endsWith(".pdf")) {
        const id = filename
          .slice(projectPrefix.length, -".pdf".length)
          .trim();
        if (id) pdfResourceIdByFilename.set(filename, id);
      }
    }

    // Three batched D1 reads cover every resolution path:
    //   1. crawled pages indexed by r2_key → webpage sources
    //   2. resources indexed by id → PDFs referenced via filename pattern
    //   3. resources indexed by r2_key → catch-all for FAQ/PDF/webpage with
    //      no crawled_pages row.
    const crawledPageRows = await this.db
      .select({
        r2Key: crawledPages.r2Key,
        url: crawledPages.url,
        resourceId: crawledPages.resourceId,
        pageTitle: crawledPages.pageTitle,
      })
      .from(crawledPages)
      .where(
        and(
          eq(crawledPages.projectId, projectId),
          inArray(crawledPages.r2Key, uniqueFilenames),
        ),
      );

    const crawledPageByFilename = new Map<
      string,
      (typeof crawledPageRows)[number]
    >();
    for (const row of crawledPageRows) {
      if (row.r2Key) crawledPageByFilename.set(row.r2Key, row);
    }

    const crawledResourceIds = [
      ...new Set(crawledPageRows.map((row) => row.resourceId)),
    ];
    const pdfResourceIds = [...new Set(pdfResourceIdByFilename.values())];
    const resourceIdsToLookup = [
      ...new Set([...crawledResourceIds, ...pdfResourceIds]),
    ];

    const [resourcesById, resourcesByKey] = await Promise.all([
      resourceIdsToLookup.length === 0
        ? Promise.resolve([] as Array<{
            id: string;
            type: "webpage" | "pdf" | "faq";
            title: string;
            url: string | null;
          }>)
        : this.db
            .select({
              id: resources.id,
              type: resources.type,
              title: resources.title,
              url: resources.url,
            })
            .from(resources)
            .where(
              and(
                eq(resources.projectId, projectId),
                inArray(resources.id, resourceIdsToLookup),
              ),
            ),
      this.db
        .select({
          r2Key: resources.r2Key,
          type: resources.type,
          title: resources.title,
          url: resources.url,
        })
        .from(resources)
        .where(
          and(
            eq(resources.projectId, projectId),
            inArray(resources.r2Key, uniqueFilenames),
          ),
        ),
    ]);

    const resourceRowById = new Map(
      resourcesById.map((row) => [row.id, row] as const),
    );
    const resourceRowByR2Key = new Map<
      string,
      (typeof resourcesByKey)[number]
    >();
    for (const row of resourcesByKey) {
      if (row.r2Key) resourceRowByR2Key.set(row.r2Key, row);
    }

    for (const filename of uniqueFilenames) {
      const crawled = crawledPageByFilename.get(filename);
      if (crawled) {
        const parent = resourceRowById.get(crawled.resourceId);
        if (parent && parent.type === "webpage" && crawled.url) {
          sourceMap.set(filename, {
            title: crawled.pageTitle || parent.title,
            url: crawled.url,
            type: "webpage",
          });
          continue;
        }
      }

      const pdfResourceId = pdfResourceIdByFilename.get(filename);
      if (pdfResourceId) {
        const pdf = resourceRowById.get(pdfResourceId);
        if (pdf && pdf.type === "pdf") {
          sourceMap.set(filename, {
            title: pdf.title,
            url: null,
            type: "pdf",
          });
          continue;
        }
      }

      const byKey = resourceRowByR2Key.get(filename);
      if (!byKey) continue;
      if (byKey.type === "webpage" && byKey.url) {
        sourceMap.set(filename, {
          title: byKey.title,
          url: byKey.url,
          type: "webpage",
        });
      } else if (byKey.type === "pdf") {
        sourceMap.set(filename, {
          title: byKey.title,
          url: null,
          type: "pdf",
        });
      } else if (byKey.type === "faq") {
        sourceMap.set(filename, {
          title: byKey.title,
          url: null,
          type: "faq",
        });
      }
    }

    return sourceMap;
  }

  async resolveSourcesFromFilenames(
    projectId: string,
    filenames: string[],
  ): Promise<SourceReference[]> {
    if (filenames.length === 0) return [];

    const sourceMap = await this.resolveSourceReferenceMap(projectId, filenames);
    const sources: SourceReference[] = [];
    const seenSourceKeys = new Set<string>();

    for (const filename of filenames) {
      const source = sourceMap.get(filename);
      if (!source) continue;

      const dedupeKey = this.getSourceReferenceDedupKey(source);
      if (seenSourceKeys.has(dedupeKey)) {
        continue;
      }

      seenSourceKeys.add(dedupeKey);
      sources.push(source);
    }

    return sources;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private faqPairsToMarkdown(title: string, pairs: FaqPair[]): string {
    const sections = pairs.map(
      (pair) =>
        `## Q: ${pair.question}\n\n${pair.answer}`,
    );
    return `# FAQ: ${title}\n\n${sections.join("\n\n---\n\n")}`;
  }

  private getSourceReferenceDedupKey(source: SourceReference): string {
    if (source.type === "webpage" && source.url) {
      return `webpage:${source.url}`;
    }

    return `${source.type}:${source.title}`;
  }
}
