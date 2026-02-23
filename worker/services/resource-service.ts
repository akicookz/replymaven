import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import {
  resources,
  type ResourceRow,
  type NewResourceRow,
} from "../db";

export class ResourceService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private r2: R2Bucket,
  ) {}

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

    // Delete from R2 if there's an r2Key
    if (resource.r2Key) {
      await this.r2.delete(resource.r2Key);
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

  // ─── Resource Ingestion ─────────────────────────────────────────────────────

  async ingestWebpage(
    projectId: string,
    resourceId: string,
    url: string,
    title: string,
  ): Promise<void> {
    try {
      // Fetch the webpage content
      const response = await fetch(url);
      if (!response.ok) {
        await this.updateResourceStatus(resourceId, projectId, "failed");
        return;
      }

      const html = await response.text();

      // Simple HTML to text extraction (strip tags)
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // Upload as markdown to R2 under project folder
      const r2Key = `${projectId}/${resourceId}.md`;
      const markdown = `# ${title}\n\nSource: ${url}\n\n${text}`;
      await this.r2.put(r2Key, markdown, {
        customMetadata: {
          context: `Web page: ${title} (${url})`,
        },
      });

      // Update resource record
      await this.db
        .update(resources)
        .set({ r2Key, status: "indexed", lastIndexedAt: new Date() })
        .where(and(eq(resources.id, resourceId), eq(resources.projectId, projectId)));
    } catch (err) {
      console.error(`Webpage ingestion failed for resource ${resourceId}:`, err);
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
      // Upload FAQ as markdown to R2
      const r2Key = `${projectId}/${resourceId}.md`;
      const markdown = `# FAQ: ${title}\n\n${content}`;
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

      await this.db
        .update(resources)
        .set({ r2Key, status: "indexed", lastIndexedAt: new Date() })
        .where(and(eq(resources.id, resourceId), eq(resources.projectId, projectId)));
    } catch (err) {
      console.error(`PDF ingestion failed for resource ${resourceId}:`, err);
      await this.updateResourceStatus(resourceId, projectId, "failed");
    }
  }
}
