// Builds the dashboard deep link an agent follows from an escalation ping
// (Telegram / email / in-app toast) straight to the conversation. When a
// `msgId` is supplied the reading pane scrolls to and pulses that message
// (the `?msg=` one-shot deep-link target). All notification paths — bot
// escalation and contact-form Telegram/email — share this helper so the URL
// shape can't drift between them.
export function buildConversationDeepLink(
  baseUrl: string,
  projectId: string,
  conversationId: string,
  msgId?: string | null,
): string {
  const base =
    `${baseUrl}/app/projects/${projectId}/conversations` +
    `?filter=needs-you&id=${conversationId}`;
  return msgId ? `${base}&msg=${msgId}` : base;
}
