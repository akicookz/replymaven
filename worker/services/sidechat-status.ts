import type { UIMessage } from "ai";
import type { SidechatStatus } from "../../shared/sidechat-agent";
import type { AppEnv } from "../types";

export function sidechatPingText(status: SidechatStatus): string | null {
  if (status === "working") return "Maven is looking into that.";
  if (status === "waiting_approval") {
    return "Maven needs approval in the dashboard.";
  }
  if (status === "ready") return "Maven has a draft in the dashboard.";
  if (status === "failed") {
    return "Maven could not finish. Open Sidechat in the dashboard.";
  }
  return null;
}

export function readLastSidechatTurnOrigin(
  metadata: Record<string, unknown>,
): "telegram" | "slack" | null {
  const value = metadata.lastSidechatTurnOrigin;
  return value === "telegram" || value === "slack" ? value : null;
}

export function hasSettledReplyDraft(messages: UIMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    return message.parts.some((part) => {
      const record = part as Record<string, unknown>;
      if (
        record.type === "tool-present_reply_draft" &&
        record.state === "output-available"
      ) {
        return true;
      }
      return record.type === "data-reply-draft";
    });
  }
  return false;
}

export interface SidechatStatusView {
  status: SidechatStatus;
  hasDraft: boolean;
  waitingApproval: boolean;
}

export async function getSidechatStatus(input: {
  projectId: string;
  conversationId: string;
  env: Pick<AppEnv, "MAVEN_PROJECT_AGENT">;
}): Promise<SidechatStatusView | null> {
  const { getAgentByName } = await import("agents");
  const parent = await getAgentByName(
    input.env.MAVEN_PROJECT_AGENT,
    input.projectId,
  ) as {
    getSidechatStatusView(conversationId: string): Promise<SidechatStatusView | null>;
  };
  return parent.getSidechatStatusView(input.conversationId);
}
