---
title: Agent handoff
slug: agent-handoff
excerpt: What happens when the AI hands a conversation to a human.
---

When the AI cannot answer confidently, or the visitor explicitly asks for a human, the conversation is handed off:

1. The AI says a natural handoff message, for example "Let me connect you with an engineer!"
2. The conversation status changes to `waiting_agent`.
3. Your team is notified in Telegram with the recent messages, visitor info, and a dashboard link. See [Telegram live agent handoff](/help/replymaven/integrations/telegram).
4. The widget asks the visitor for their email so you can follow up if they leave.
5. Browser notification permission is requested so the visitor hears back even with the tab in the background.

From handoff onward the AI is completely silent. Visitor messages are forwarded to your team, and agent replies (from Telegram or the dashboard) appear in the widget in real time.

An agent hands control back to the AI with a `@BotName` command in Telegram, optionally with private instructions the bot follows silently, or closes the conversation.

> [!TIP]
> Set your bot name and the human agent label (for example "an engineer") in project settings. The handoff message uses them, so it reads naturally for your team.
