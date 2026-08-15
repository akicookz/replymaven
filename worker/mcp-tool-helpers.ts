import { type DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import { type ProjectRow } from "./db";
import type { PublicConversationStore } from "./conversations/public-conversation-store";
import { type HonoAppContext } from "./types";
import { ProjectService } from "./services/project-service";
import { type McpOAuthScope } from "./services/mcp-oauth-service";

type AppDb = DrizzleD1Database<Record<string, unknown>>;

export interface McpRequestContext {
  db: AppDb;
  conversationStore: PublicConversationStore;
  env: HonoAppContext["Bindings"];
  executionCtx: ExecutionContext;
  userId: string;
  userName: string;
  effectiveUserId: string;
  activeRole: "owner" | "admin" | "member" | null;
  activeAccessAllProjects: boolean;
  activeProjectIds: string[] | null;
  scopes: McpOAuthScope[];
}

export const confirmedMutationSchema = z
  .literal(true)
  .describe("Must be true after the user explicitly confirms this mutation.");

export function requireScope(
  context: McpRequestContext,
  scope: McpOAuthScope,
): void {
  if (!context.scopes.includes(scope)) {
    throw new Error(`MCP token is missing required scope: ${scope}`);
  }
}

export async function getAccessibleProject(
  context: McpRequestContext,
  projectId: string,
): Promise<ProjectRow> {
  const projectService = new ProjectService(context.db);
  const project = await projectService.getProjectById(projectId);

  if (!project || project.userId !== context.effectiveUserId) {
    throw new Error("Project not found");
  }

  if (context.activeRole === "member" && !context.activeAccessAllProjects) {
    const allowed = context.activeProjectIds ?? [];
    if (!allowed.includes(project.id)) {
      throw new Error("Project not found");
    }
  }

  return project;
}

export function textResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function serializeDate(
  value: Date | number | null | undefined,
): string | null {
  return value ? new Date(value).toISOString() : null;
}
