import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, or, gt, isNull, desc } from "drizzle-orm";
import {
  visitorBans,
  type VisitorBanRow,
  type NewVisitorBanRow,
} from "../db";

export class VisitorBanService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async banVisitor(
    data: Omit<NewVisitorBanRow, "id" | "createdAt">,
  ): Promise<VisitorBanRow> {
    const id = crypto.randomUUID();
    await this.db.insert(visitorBans).values({ id, ...data });
    const rows = await this.db
      .select()
      .from(visitorBans)
      .where(eq(visitorBans.id, id))
      .limit(1);
    return rows[0]!;
  }

  async unbanVisitor(banId: string, projectId: string): Promise<boolean> {
    const result = await this.db
      .delete(visitorBans)
      .where(
        and(eq(visitorBans.id, banId), eq(visitorBans.projectId, projectId)),
      );
    return (result?.meta?.changes ?? 0) > 0;
  }

  async isVisitorBanned(
    projectId: string,
    visitorId: string,
    visitorEmail?: string | null,
  ): Promise<VisitorBanRow | null> {
    const now = new Date();
    const conditions = [
      eq(visitorBans.projectId, projectId),
      or(isNull(visitorBans.expiresAt), gt(visitorBans.expiresAt, now)),
    ];

    const idMatch = await this.db
      .select()
      .from(visitorBans)
      .where(
        and(
          ...conditions,
          eq(visitorBans.visitorId, visitorId),
        ),
      )
      .limit(1);
    if (idMatch[0]) return idMatch[0];

    if (visitorEmail) {
      const emailMatch = await this.db
        .select()
        .from(visitorBans)
        .where(
          and(
            ...conditions,
            eq(visitorBans.visitorEmail, visitorEmail),
          ),
        )
        .limit(1);
      if (emailMatch[0]) return emailMatch[0];
    }

    return null;
  }

  async getBannedVisitors(
    projectId: string,
    limit = 50,
    offset = 0,
  ): Promise<VisitorBanRow[]> {
    return this.db
      .select()
      .from(visitorBans)
      .where(eq(visitorBans.projectId, projectId))
      .orderBy(desc(visitorBans.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async getBanCount(projectId: string): Promise<number> {
    const rows = await this.db
      .select({ id: visitorBans.id })
      .from(visitorBans)
      .where(eq(visitorBans.projectId, projectId));
    return rows.length;
  }
}
