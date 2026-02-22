import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, count, and, sql, desc } from "drizzle-orm";
import {
  projects,
  conversations,
  messages,
  resources,
  cannedResponses,
} from "../db";

export class DashboardService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getStats(userId: string) {
    // Get all user projects
    const userProjects = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) {
      return {
        totalProjects: 0,
        totalConversations: 0,
        activeConversations: 0,
        totalMessages: 0,
        totalResources: 0,
        pendingCannedDrafts: 0,
        conversationsByDay: [],
        conversationsByStatus: [],
        recentConversations: [],
      };
    }

    const projectIds = userProjects.map((p) => p.id);
    const inClause = sql`${conversations.projectId} IN (${sql.join(
      projectIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;

    // Get conversation counts
    const conversationCounts = await this.db
      .select({
        total: count(),
        active: sql<number>`SUM(CASE WHEN ${conversations.status} IN ('active', 'waiting_agent') THEN 1 ELSE 0 END)`,
      })
      .from(conversations)
      .where(inClause);

    // Get message count
    const messageCounts = await this.db
      .select({ total: count() })
      .from(messages)
      .innerJoin(
        conversations,
        eq(messages.conversationId, conversations.id),
      )
      .where(
        sql`${conversations.projectId} IN (${sql.join(
          projectIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );

    // Get resource count
    const resourceCounts = await this.db
      .select({ total: count() })
      .from(resources)
      .where(
        sql`${resources.projectId} IN (${sql.join(
          projectIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );

    // Get pending canned response drafts
    const cannedDraftCounts = await this.db
      .select({ total: count() })
      .from(cannedResponses)
      .where(
        and(
          sql`${cannedResponses.projectId} IN (${sql.join(
            projectIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          eq(cannedResponses.status, "draft"),
        ),
      );

    // ─── Conversations by day (last 7 days) ──────────────────────────────────
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    const conversationsByDay = await this.db
      .select({
        day: sql<string>`date(${conversations.createdAt}, 'unixepoch')`.as(
          "day",
        ),
        count: count(),
      })
      .from(conversations)
      .where(
        and(
          sql`${conversations.projectId} IN (${sql.join(
            projectIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          sql`${conversations.createdAt} >= ${sevenDaysAgo}`,
        ),
      )
      .groupBy(sql`date(${conversations.createdAt}, 'unixepoch')`)
      .orderBy(sql`date(${conversations.createdAt}, 'unixepoch')`);

    // ─── Conversations by status ──────────────────────────────────────────────
    const conversationsByStatus = await this.db
      .select({
        status: conversations.status,
        count: count(),
      })
      .from(conversations)
      .where(
        sql`${conversations.projectId} IN (${sql.join(
          projectIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
      .groupBy(conversations.status);

    // ─── Recent conversations (last 5) ────────────────────────────────────────
    const recentConversations = await this.db
      .select()
      .from(conversations)
      .where(
        sql`${conversations.projectId} IN (${sql.join(
          projectIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(5);

    return {
      totalProjects: userProjects.length,
      totalConversations: conversationCounts[0]?.total ?? 0,
      activeConversations: conversationCounts[0]?.active ?? 0,
      totalMessages: messageCounts[0]?.total ?? 0,
      totalResources: resourceCounts[0]?.total ?? 0,
      pendingCannedDrafts: cannedDraftCounts[0]?.total ?? 0,
      conversationsByDay,
      conversationsByStatus,
      recentConversations,
    };
  }
}
