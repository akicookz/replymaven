import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Conversation, Message } from "@/lib/inbox/types";
import ChatThread from "./ChatThread";

test("renders review summaries as a compact human-review event", () => {
  const conversation: Conversation = {
    id: "conversation-1",
    visitorId: "visitor-1",
    visitorName: "Aki",
    visitorEmail: "aki@example.com",
    status: "waiting_agent",
    closeReason: null,
    metadata: null,
    visitorLastSeenAt: null,
    visitorPresence: null,
    visitorLastOnlineAt: null,
    createdAt: "2026-08-01T03:00:00.000Z",
    updatedAt: "2026-08-01T03:00:00.000Z",
  };
  const messages: Message[] = [
    {
      id: "review-1",
      role: "system",
      content: "Contact form submission\nYour name: Aki\nYour message: Help",
      sources: JSON.stringify({ systemKind: "review_summary" }),
      createdAt: "2026-08-01T03:00:00.000Z",
    },
  ];

  const html = renderToStaticMarkup(
    createElement(ChatThread, {
      messages,
      conversation,
      onDeleteMessage: () => {},
    }),
  );

  expect(html).toContain("Flagged for human review");
  expect(html).not.toContain("Contact form submission");
  expect(html).not.toContain("Your name: Aki");
});
