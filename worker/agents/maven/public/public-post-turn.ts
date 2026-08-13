import type { PublicConversationStatus } from "../../../../shared/maven-conversation";
import type { AiParticipation } from "../../../chat-runtime/types";

export type PublicPostTurnDecision =
  | "discard"
  | "ignore"
  | "commit"
  | "commit_resolved";

interface PublicPostTurnDecisionInput {
  responseStatus: "completed" | "error" | "aborted";
  outcomeStatus: "pending" | "completed";
  assistantPersisted: boolean;
  archived: boolean;
  currentStatus: PublicConversationStatus;
  currentParticipation: AiParticipation;
  currentOwnershipRevision: number;
  capturedOwnershipRevision: number;
  aiInvoked: boolean;
  resolved: boolean;
}

export function decidePublicPostTurn(
  input: PublicPostTurnDecisionInput,
): PublicPostTurnDecision {
  if (
    input.responseStatus !== "completed" ||
    input.outcomeStatus !== "completed"
  ) return "discard";
  if (!input.assistantPersisted) return "ignore";

  const acceptedTeamRequest =
    input.currentParticipation === "assist_until_agent" &&
    input.currentStatus === "waiting_agent" &&
    input.currentOwnershipRevision === input.capturedOwnershipRevision + 1;
  const invokedDuringHumanOwnership =
    input.aiInvoked &&
    input.currentParticipation === "human_only" &&
    input.currentOwnershipRevision === input.capturedOwnershipRevision;
  if (
    input.archived ||
    input.currentStatus === "closed" ||
    (input.currentParticipation === "human_only" &&
      !invokedDuringHumanOwnership) ||
    (input.currentOwnershipRevision !== input.capturedOwnershipRevision &&
      !acceptedTeamRequest)
  ) return "discard";
  if (input.resolved && input.currentStatus === "active") {
    return "commit_resolved";
  }
  return "commit";
}
