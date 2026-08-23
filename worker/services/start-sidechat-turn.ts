import type { SidechatStatus } from "../../shared/sidechat-agent";
import type { AppEnv } from "../types";

export type SidechatTurnOrigin = "mcp" | "telegram" | "slack";
export type BotNameCommandOrigin = SidechatTurnOrigin | "dashboard";

export type StartSidechatTurnResult =
  | { accepted: true; status: "working" }
  | { accepted: false; reason: "busy" | "archived" | "failed" };

export interface StartSidechatTurnPort {
  getPublicConversation(conversationId: string): Promise<{
    archivedAt: number | null;
  } | null>;
  registerSidechat(conversationId: string): Promise<{ status: SidechatStatus }>;
  writeLastSidechatTurnOrigin(origin: SidechatTurnOrigin | null): Promise<void>;
  submitServerSidechatTurn(input: {
    text: string;
    actorUserId: string;
  }): Promise<boolean>;
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
  if (
    registered.status === "working" ||
    registered.status === "waiting_approval"
  ) {
    return { accepted: false, reason: "busy" };
  }

  await port.writeLastSidechatTurnOrigin(
    input.origin === "dashboard" ? null : input.origin,
  );

  const accepted = await port.submitServerSidechatTurn({
    text: input.text,
    actorUserId: input.actorUserId,
  });
  if (!accepted) return { accepted: false, reason: "failed" };
  return { accepted: true, status: "working" };
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
