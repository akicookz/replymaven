import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, count, and, sql, isNull } from "drizzle-orm";
import {
  projects,
  resources,
  helpArticles,
} from "../db";
import type { PublicConversationStore } from "../conversations/public-conversation-store";

export class DashboardService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private conversationStore: PublicConversationStore,
  ) {}

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
        publishedArticles: 0,
        conversationsByDay: [],
        conversationsByStatus: [],
        recentConversations: [],
      };
    }

    const projectIds = userProjects.map((p) => p.id);
    const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;
    const analytics = await this.conversationStore.getAnalytics(
      projectIds,
      sevenDaysAgo,
    );

    // External sources only — article mirrors are counted as articles below
    const resourceCounts = await this.db
      .select({ total: count() })
      .from(resources)
      .where(
        and(
          sql`${resources.projectId} IN (${sql.join(
            projectIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          isNull(resources.sourceArticleId),
        ),
      );

    const articleCounts = await this.db
      .select({ total: count() })
      .from(helpArticles)
      .where(
        and(
          sql`${helpArticles.projectId} IN (${sql.join(
            projectIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          eq(helpArticles.status, "published"),
        ),
      );

    return {
      totalProjects: projectId ? undefined : userProjects.length,
      totalConversations: analytics.totalConversations,
      activeConversations: analytics.activeConversations,
      totalMessages: analytics.totalMessages,
      totalResources: resourceCounts[0]?.total ?? 0,
      publishedArticles: articleCounts[0]?.total ?? 0,
      conversationsByDay: analytics.conversationsByDay,
      conversationsByStatus: analytics.conversationsByStatus,
      recentConversations: analytics.recentConversations,
    };
  }
}
