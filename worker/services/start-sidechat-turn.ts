import type { SidechatStatus } from "../../shared/sidechat-agent";
import type { AppEnv } from "../types";

export type SidechatTurnOrigin = "mcp" | "telegram" | "slack";
export type BotNameCommandOrigin = SidechatTurnOrigin | "dashboard";
export type SidechatClaimResult = "claimed" | "busy" | "failed";

export type StartSidechatTurnResult =
  | { accepted: true; status: "working" }
  | { accepted: false; reason: "busy" | "archived" | "failed" };

export interface StartSidechatTurnPort {
  getPublicConversation(conversationId: string): Promise<{
    archivedAt: number | null;
  } | null>;
  registerSidechat(conversationId: string): Promise<{ status: SidechatStatus }>;
  claimWorking(): SidechatClaimResult;
  writeLastSidechatTurnOrigin(origin: SidechatTurnOrigin | null): Promise<void>;
  submitServerSidechatTurn(input: {
    text: string;
    actorUserId: string;
  }): Promise<boolean>;
  releaseClaim(): Promise<void>;
  confirmWorking(): void;
}

export async function runStartSidechatTurn(
  input: {
    conversationId: string;
    text: string;
    actorUserId: string;
    origin: BotNameCommandOrigin;
  },
  port: StartSidechatTurnPort,
): Promise<StartSidechatTurnResult> {
  const conversation = await port.getPublicConversation(input.conversationId);
  if (!conversation || conversation.archivedAt !== null) {
    return { accepted: false, reason: "archived" };
  }

  const registered = await port.registerSidechat(input.conversationId);
  // Shortcut: skip the claim write when register already shows a live turn.
  // claimWorking is the atomic guard for overlapping starts.
  if (
    registered.status === "working" ||
    registered.status === "waiting_approval"
  ) {
    return { accepted: false, reason: "busy" };
  }
  const claimed = port.claimWorking();
  if (claimed === "busy") return { accepted: false, reason: "busy" };
  if (claimed === "failed") return { accepted: false, reason: "failed" };

  try {
    await port.writeLastSidechatTurnOrigin(
      input.origin === "dashboard" ? null : input.origin,
    );
    const accepted = await port.submitServerSidechatTurn({
      text: input.text,
      actorUserId: input.actorUserId,
    });
    if (!accepted) {
      await port.releaseClaim();
      return { accepted: false, reason: "failed" };
    }
    port.confirmWorking();
    return { accepted: true, status: "working" };
  } catch (error) {
    await port.releaseClaim();
    throw error;
  }
}

export async function startSidechatTurn(input: {
  projectId: string;
  conversationId: string;
  text: string;
  actorUserId: string;
  origin: BotNameCommandOrigin;
  env: Pick<AppEnv, "MAVEN_PROJECT_AGENT">;
}): Promise<StartSidechatTurnResult> {
  const { getAgentByName } = await import("agents");
  const parent = await getAgentByName(
    input.env.MAVEN_PROJECT_AGENT,
    input.projectId,
  ) as {
    startSidechatTurn(fields: {
      conversationId: string;
      text: string;
      actorUserId: string;
      origin: BotNameCommandOrigin;
    }): Promise<StartSidechatTurnResult>;
  };
  return parent.startSidechatTurn({
    conversationId: input.conversationId,
    text: input.text,
    actorUserId: input.actorUserId,
    origin: input.origin,
  });
}
