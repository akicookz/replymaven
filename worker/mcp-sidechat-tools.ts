import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  confirmedMutationSchema,
  getAccessibleProject,
  requireScope,
  textResult,
  type McpRequestContext,
} from "./mcp-tool-helpers";
import {
  getSidechatStatus,
  type SidechatStatusView,
} from "./services/sidechat-status";
import {
  startSidechatTurn,
  type StartSidechatTurnResult,
} from "./services/start-sidechat-turn";

export function registerSidechatTools(
  server: McpServer,
  context: McpRequestContext,
  deps?: {
    startSidechatTurn?: typeof startSidechatTurn;
    getSidechatStatus?: typeof getSidechatStatus;
  },
): void {
  registerAskMavenTool(server, context, deps?.startSidechatTurn ?? startSidechatTurn);
  registerGetSidechatStatusTool(
    server,
    context,
    deps?.getSidechatStatus ?? getSidechatStatus,
  );
}

function askMavenConfirmation(result: StartSidechatTurnResult): string {
  if (result.accepted) return "Maven is looking into that.";
  if (result.reason === "busy") return "Maven is already working on this.";
  return "Maven could not start that. Open Sidechat in the dashboard.";
}

function registerAskMavenTool(
  server: McpServer,
  context: McpRequestContext,
  startTurn: typeof startSidechatTurn,
): void {
  server.registerTool(
    "ask_maven",
    {
      title: "Ask Maven",
      description:
        "Start a private Sidechat investigate turn. Maven may look up billing or product data. The result stays in the dashboard until a human sends it.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        conversationId: z
          .string()
          .min(1)
          .describe("ReplyMaven conversation ID."),
        text: z
          .string()
          .min(1)
          .max(5_000)
          .describe("What Maven should look into."),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, conversationId, text }) => {
      requireScope(context, "conversations:reply");
      await getAccessibleProject(context, projectId);
      const conversation = await context.conversationStore.getOperational(
        projectId,
        conversationId,
      );
      if (!conversation) throw new Error("Conversation not found");

      const started = await startTurn({
        projectId,
        conversationId: conversation.id,
        text,
        actorUserId: context.userId,
        origin: "mcp",
        env: context.env,
      });
      return textResult({
        ok: true,
        accepted: started.accepted,
        status: started.accepted ? started.status : undefined,
        confirmation: askMavenConfirmation(started),
      });
    },
  );
}

function registerGetSidechatStatusTool(
  server: McpServer,
  context: McpRequestContext,
  readStatus: typeof getSidechatStatus,
): void {
  server.registerTool(
    "get_sidechat_status",
    {
      title: "Get Sidechat status",
      description:
        "Read whether Maven is working, waiting for approval, or has a draft. Does not return the draft or the private transcript.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        conversationId: z
          .string()
          .min(1)
          .describe("ReplyMaven conversation ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, conversationId }) => {
      requireScope(context, "conversations:reply");
      await getAccessibleProject(context, projectId);
      const conversation = await context.conversationStore.getOperational(
        projectId,
        conversationId,
      );
      if (!conversation) throw new Error("Conversation not found");

      const status = await readStatus({
        projectId,
        conversationId: conversation.id,
        env: context.env,
      });
      const view: SidechatStatusView = status ?? {
        status: "idle",
        hasDraft: false,
        waitingApproval: false,
      };
      return textResult({
        status: view.status,
        hasDraft: view.hasDraft,
        waitingApproval: view.waitingApproval,
      });
    },
  );
}
