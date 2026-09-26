import type {
  SidechatMessageOrigin,
  SidechatStatus,
} from "../../shared/sidechat-agent";
import type { AppEnv } from "../types";

// Origins whose reply goes back over a channel. Dashboard and MCP read the
// Sidechat directly, so nothing is mirrored for them.
export type SidechatTurnOrigin = Exclude<SidechatMessageOrigin, "dashboard">;
export type BotNameCommandOrigin = SidechatMessageOrigin;
export type SidechatClaimResult = "claimed" | "busy" | "failed";

export type StartSidechatTurnResult =
  | { accepted: true; status: "working" }
  | { accepted: false; reason: "busy" | "archived" | "failed" | "duplicate" };

export interface StartSidechatTurnInput {
  conversationId: string;
  text: string;
  origin: SidechatMessageOrigin;
  // Access principal for tools. The project owner for channel turns until the
  // author is known (phase 6).
  actorUserId: string;
  // Verified human behind the message, "" when unknown.
  authorUserId?: string;
  authorDisplayName?: string | null;
  // External id from the channel; doubles as the Sidechat message id so a
  // redelivered webhook cannot start a second turn.
  channelMessageId?: string | null;
  replyThreadId?: string | null;
  replyRecipient?: string | null;
}

export interface StartSidechatTurnPort {
  getPublicConversation(conversationId: string): Promise<{
    archivedAt: number | null;
  } | null>;
  registerSidechat(conversationId: string): Promise<{ status: SidechatStatus }>;
  claimWorking(): SidechatClaimResult;
  writeLastSidechatTurnOrigin(origin: SidechatTurnOrigin | null): Promise<void>;
  submitServerSidechatTurn(
    input: StartSidechatTurnInput,
  ): Promise<"accepted" | "rejected" | "duplicate">;
  releaseClaim(): Promise<void>;
  confirmWorking(): void;
}

export async function runStartSidechatTurn(
  input: StartSidechatTurnInput,
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
    const submitted = await port.submitServerSidechatTurn(input);
    if (submitted !== "accepted") {
      await port.releaseClaim();
      return {
        accepted: false,
        reason: submitted === "duplicate" ? "duplicate" : "failed",
      };
    }
    port.confirmWorking();
    return { accepted: true, status: "working" };
  } catch (error) {
    await port.releaseClaim();
    throw error;
  }
}

export async function startSidechatTurn(
  input: StartSidechatTurnInput & {
    projectId: string;
    env: Pick<AppEnv, "MAVEN_PROJECT_AGENT">;
  },
): Promise<StartSidechatTurnResult> {
  const { getAgentByName } = await import("agents");
  const parent = await getAgentByName(
    input.env.MAVEN_PROJECT_AGENT,
    input.projectId,
  ) as {
    startSidechatTurn(fields: StartSidechatTurnInput): Promise<StartSidechatTurnResult>;
  };
  return parent.startSidechatTurn({
    conversationId: input.conversationId,
    text: input.text,
    origin: input.origin,
    actorUserId: input.actorUserId,
    authorUserId: input.authorUserId,
    authorDisplayName: input.authorDisplayName,
    channelMessageId: input.channelMessageId,
    replyThreadId: input.replyThreadId,
    replyRecipient: input.replyRecipient,
  });
}
