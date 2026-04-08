import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, count, and, sql, desc } from "drizzle-orm";
import {
  projects,
  conversations,
  messages,
  resources,
  knowledgeSuggestions,
  inquiries,
} from "../db";

export class DashboardService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getStats(userId: string, projectId?: string) {
    // Get user projects (all or filtered by projectId)
    const userProjects = projectId
      ? await this.db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      : await this.db
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
        recentInquiries: [],
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

    // Get pending knowledge suggestions
    const pendingSuggestionCounts = await this.db
      .select({ total: count() })
      .from(knowledgeSuggestions)
      .where(
        and(
          sql`${knowledgeSuggestions.projectId} IN (${sql.join(
            projectIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          eq(knowledgeSuggestions.status, "pending"),
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
      .orderBy(
        desc(
          sql`case
            when ${conversations.visitorLastSeenAt} is not null
              and ${conversations.visitorLastSeenAt} > ${conversations.updatedAt}
            then ${conversations.visitorLastSeenAt}
            else ${conversations.updatedAt}
          end`,
        ),
        desc(conversations.updatedAt),
      )
      .limit(5);

    // ─── Recent inquiries (last 5) ──────────────────────────────────────────
    const recentInquiries = await this.db
      .select()
      .from(inquiries)
      .where(
        sql`${inquiries.projectId} IN (${sql.join(
          projectIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
      .orderBy(desc(inquiries.createdAt))
      .limit(5);

    return {
      totalProjects: projectId ? undefined : userProjects.length,
      totalConversations: conversationCounts[0]?.total ?? 0,
      activeConversations: conversationCounts[0]?.active ?? 0,
      totalMessages: messageCounts[0]?.total ?? 0,
      totalResources: resourceCounts[0]?.total ?? 0,
      pendingSuggestions: pendingSuggestionCounts[0]?.total ?? 0,
      conversationsByDay,
      conversationsByStatus,
      recentConversations,
      recentInquiries,
    };
  }
}
