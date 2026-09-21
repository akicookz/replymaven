import { and, desc, eq } from "drizzle-orm";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import {
  projectInboundAddresses,
  type ProjectInboundAddressRow,
} from "../db/schema";

export class InboundAddressService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async listByProject(projectId: string): Promise<ProjectInboundAddressRow[]> {
    return this.db
      .select()
      .from(projectInboundAddresses)
      .where(eq(projectInboundAddresses.projectId, projectId))
      .orderBy(desc(projectInboundAddresses.lastSeenAt));
  }

  // Runs on every inbound email, so it is one statement rather than a
  // select/update/select round trip.
  async discover(
    projectId: string,
    address: string,
  ): Promise<ProjectInboundAddressRow | null> {
    const normalized = address.trim().toLowerCase();
    const now = new Date();
    const rows = await this.db
      .insert(projectInboundAddresses)
      .values({
        id: crypto.randomUUID(),
        projectId,
        address: normalized,
        label: null,
        ignored: false,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [
          projectInboundAddresses.projectId,
          projectInboundAddresses.address,
        ],
        set: { lastSeenAt: now },
      })
      .returning();
    return rows[0] ?? null;
  }

  async setIgnored(
    projectId: string,
    addressId: string,
    ignored: boolean,
  ): Promise<ProjectInboundAddressRow | null> {
    const rows = await this.db
      .update(projectInboundAddresses)
      .set({ ignored })
      .where(
        and(
          eq(projectInboundAddresses.id, addressId),
          eq(projectInboundAddresses.projectId, projectId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
