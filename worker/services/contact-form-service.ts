import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { ticketConfig, type TicketConfigRow } from "../db";

// Config for the widget's contact form (formerly "ticket form"). Still reads
// the `ticket_config` table — table keeps its name, only the concept
// upstream (conversation-first "Needs You", no ticket rows) has changed.
export class ContactFormService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  // ─── Config ───────────────────────────────────────────────────────────────

  async getConfig(projectId: string): Promise<TicketConfigRow | null> {
    const rows = await this.db
      .select()
      .from(ticketConfig)
      .where(eq(ticketConfig.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertConfig(
    projectId: string,
    updates: {
      enabled?: boolean;
      description?: string | null;
      fields?: Array<{ label: string; type: string; required: boolean }>;
    },
  ): Promise<TicketConfigRow> {
    const existing = await this.getConfig(projectId);

    if (existing) {
      const setData: Record<string, unknown> = {};
      if (updates.enabled !== undefined) setData.enabled = updates.enabled;
      if (updates.description !== undefined)
        setData.description = updates.description;
      if (updates.fields !== undefined)
        setData.fields = JSON.stringify(updates.fields);

      await this.db
        .update(ticketConfig)
        .set(setData)
        .where(eq(ticketConfig.projectId, projectId));

      return (await this.getConfig(projectId))!;
    }

    const id = crypto.randomUUID();
    await this.db.insert(ticketConfig).values({
      id,
      projectId,
      enabled: updates.enabled ?? false,
      description:
        updates.description ?? "We'll get back to you within 1-2 hours.",
      fields: updates.fields ? JSON.stringify(updates.fields) : "[]",
    });
    return (await this.getConfig(projectId))!;
  }
}
