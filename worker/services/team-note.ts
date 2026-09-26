import { logError, logInfo } from "../observability";
import type { AppEnv } from "../types";
import { startSidechatTurn } from "./start-sidechat-turn";

export const TEAM_HELP_TRIGGER = "Team help requested.";

// Tell the team a customer needs a person. Maven writes the note in a
// system-origin Sidechat turn; if that turn cannot start (Maven is mid-turn
// with a teammate, or it fails), a plain factual note goes out instead so the
// team always hears. `noteKey` dedupes: a second call for the same request is
// a no-op.
export async function requestTeamNote(input: {
  projectId: string;
  conversationId: string;
  actorUserId: string;
  noteKey: string;
  env: Pick<AppEnv, "MAVEN_PROJECT_AGENT">;
}): Promise<void> {
  let reason: string | null = null;
  try {
    const started = await startSidechatTurn({
      projectId: input.projectId,
      env: input.env,
      conversationId: input.conversationId,
      text: TEAM_HELP_TRIGGER,
      origin: "system",
      actorUserId: input.actorUserId,
      authorUserId: "",
      channelMessageId: `system:team-note:${input.noteKey}`,
    });
    if (started.accepted || started.reason === "duplicate") {
      logInfo("team_request.note_turn", {
        projectId: input.projectId,
        conversationId: input.conversationId,
        accepted: started.accepted,
      });
      return;
    }
    reason = started.reason;
  } catch (error) {
    reason = "error";
    logError("team_request.note_turn_failed", error, {
      projectId: input.projectId,
      conversationId: input.conversationId,
    });
  }
  logInfo("team_request.note_fallback", {
    projectId: input.projectId,
    conversationId: input.conversationId,
    reason,
  });
  try {
    const { getAgentByName } = await import("agents");
    const parent = await getAgentByName(
      input.env.MAVEN_PROJECT_AGENT,
      input.projectId,
    ) as { postTeamNoteFallback(conversationId: string): Promise<void> };
    await parent.postTeamNoteFallback(input.conversationId);
  } catch (error) {
    logError("team_request.note_fallback_failed", error, {
      projectId: input.projectId,
      conversationId: input.conversationId,
    });
  }
}
