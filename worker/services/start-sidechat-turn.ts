import type {
  SidechatMessageOrigin,
  SidechatStatus,
} from "../../shared/sidechat-agent";
import type { AppEnv } from "../types";

// Origins whose reply goes back over a channel. Dashboard and MCP read the
// Sidechat directly, so nothing is mirrored for them.
export type SidechatTurnOrigin = Exclude<SidechatMessageOrigin, "dashboard">;
export type SidechatClaimResult = "claimed" | "busy" | "failed";

export type StartSidechatTurnResult =
  | { accepted: true; status: "working" }
  | { accepted: false; reason: "archived" | "failed" | "duplicate" };

export interface StartSidechatTurnInput {
  conversationId: string;
  text: string;
  origin: SidechatMessageOrigin;
  // Access principal for tools: the verified teammate who wrote, or the
  // project owner for system turns that nobody wrote.
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
  // A message that arrives during a live turn waits in the child's queue;
  // only the first one claims the status and sends the "working" line.
  let claimedByThisTurn = false;
  if (registered.status !== "working") {
    const claimed = port.claimWorking();
    if (claimed === "failed") return { accepted: false, reason: "failed" };
    claimedByThisTurn = claimed === "claimed";
  }

  try {
    await port.writeLastSidechatTurnOrigin(
      input.origin === "dashboard" ? null : input.origin,
    );
    const submitted = await port.submitServerSidechatTurn(input);
    if (submitted !== "accepted") {
      if (claimedByThisTurn) await port.releaseClaim();
      return {
        accepted: false,
        reason: submitted === "duplicate" ? "duplicate" : "failed",
      };
    }
    if (claimedByThisTurn) port.confirmWorking();
    return { accepted: true, status: "working" };
  } catch (error) {
    if (claimedByThisTurn) await port.releaseClaim();
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

interface TeammateThreadTurnInput extends StartSidechatTurnInput {
  createdBy: string;
  telegramRootId: string | null;
  slackRootTs: string | null;
  emailThread: { subject: string; byUser: Record<string, string> } | null;
}

async function projectAgent(
  env: Pick<AppEnv, "MAVEN_PROJECT_AGENT">,
  projectId: string,
) {
  const { getAgentByName } = await import("agents");
  return await getAgentByName(env.MAVEN_PROJECT_AGENT, projectId) as {
    startTeammateThreadTurn(
      fields: TeammateThreadTurnInput,
    ): Promise<StartSidechatTurnResult>;
    isTeammateThreadId(threadId: string): Promise<boolean>;
  };
}

// UUID-shaped and stable for the first message, so a redelivered webhook
// lands in the same thread as the same message.
export async function deriveTeammateThreadId(
  projectId: string,
  channel: string,
  externalMessageId: string,
): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`teammate-thread:${projectId}:${channel}:${externalMessageId}`),
  ));
  const hex = [...digest.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export async function startTeammateThreadTurn(
  input: TeammateThreadTurnInput & {
    projectId: string;
    env: Pick<AppEnv, "MAVEN_PROJECT_AGENT">;
  },
): Promise<StartSidechatTurnResult> {
  const parent = await projectAgent(input.env, input.projectId);
  return parent.startTeammateThreadTurn({
    conversationId: input.conversationId,
    text: input.text,
    origin: input.origin,
    actorUserId: input.actorUserId,
    authorUserId: input.authorUserId,
    authorDisplayName: input.authorDisplayName,
    channelMessageId: input.channelMessageId,
    replyThreadId: input.replyThreadId,
    replyRecipient: input.replyRecipient,
    createdBy: input.createdBy,
    telegramRootId: input.telegramRootId,
    slackRootTs: input.slackRootTs,
    emailThread: input.emailThread,
  });
}

export async function isTeammateThread(input: {
  projectId: string;
  env: Pick<AppEnv, "MAVEN_PROJECT_AGENT">;
  threadId: string;
}): Promise<boolean> {
  const parent = await projectAgent(input.env, input.projectId);
  return parent.isTeammateThreadId(input.threadId);
}
