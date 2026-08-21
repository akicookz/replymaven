export function canAutoCloseConversationStatus(status: string): boolean {
  // Human-owned conversations must stay open so the second post-idle visitor
  // message can hand control back to AI.
  return status !== "closed" &&
    status !== "waiting_agent" &&
    status !== "agent_replied";
}
