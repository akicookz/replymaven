const MAX_DASHBOARD_REPLY_ID_LENGTH = 200;

export function dashboardReplyIdentity(input: {
  projectId: string;
  conversationId: string;
  userId: string;
  requestId: string | null | undefined;
}): { id?: string; idempotencyKey: string | null } {
  const requestId = input.requestId?.trim();
  if (!requestId) return { idempotencyKey: null };
  const id = requestId.slice(0, MAX_DASHBOARD_REPLY_ID_LENGTH);
  return {
    id,
    idempotencyKey:
      `dashboard:${input.projectId}:${input.conversationId}:${input.userId}:${id}`,
  };
}
