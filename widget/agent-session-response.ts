export type AgentSessionFailureAction = "retire" | "unavailable";

export function classifyAgentSessionFailure(
  status: number,
  error: string | null,
): AgentSessionFailureAction {
  // A project that is not cut over yet has no transport at all, but the
  // conversation still exists: never retire the visitor's stored thread.
  if (status === 409 && error === "agent_runtime_not_cut_over") {
    return "unavailable";
  }
  if (
    status === 404 ||
    status === 410 ||
    (status === 409 && error === "archived_conversation")
  ) {
    return "retire";
  }
  return "unavailable";
}
