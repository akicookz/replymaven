---
title: Conversation lifecycle
slug: conversation-lifecycle
excerpt: The four states a conversation moves through, from AI chat to close.
---

Every conversation is in one of these states:

| Status | Meaning |
| --- | --- |
| `active` | The visitor is chatting with the AI bot. |
| `waiting_agent` | Human help was requested. The team has been notified. |
| `agent_replied` | A human agent has replied. The AI stays silent until an agent hands control back. |
| `closed` | The conversation has ended. |

## How states change

- A conversation starts as `active` with the AI answering.
- When the AI cannot answer confidently, or the visitor asks for a person, the status becomes `waiting_agent` and your team is notified. See [Agent handoff](/help/replymaven/conversations/agent-handoff).
- While a conversation is in `waiting_agent` or `agent_replied`, the AI is fully silenced. Visitor messages go to your team, not to the bot.
- Agents close conversations from the dashboard or from Telegram. Closed conversations are cleared in the widget; the next message starts fresh.

> [!INFO]
> After a conversation closes, ReplyMaven can analyze it and draft a reusable canned response for your team to approve.
