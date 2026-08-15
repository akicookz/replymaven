---
title: Telegram live agent handoff
slug: telegram
excerpt: Get handoff notifications in Telegram and reply to visitors without leaving it.
---

Connect a Telegram bot to receive live agent handoff notifications and reply directly from Telegram.

## Setup

:::steps
::step Create a Telegram bot
Create a bot via [@BotFather](https://t.me/BotFather) and copy the bot token.
::step Add the token
Paste it in the dashboard under **Telegram → Bot Token**.
::step Connect your chat
Add the bot to your Telegram group, or get your personal chat ID, and paste the chat ID.
::step Test it
Click "Test Connection" to confirm messages arrive.
:::

## How it works

- On handoff, the bot sends a message to your Telegram chat with the conversation summary and visitor info. New conversations, bookings, and contact form submissions can also notify you.
- **Reply to the bot's message** in Telegram to send a response directly to the visitor's chat. The visitor sees it in real time.
- While a conversation is with an agent, the AI is completely silent and every visitor message is forwarded to Telegram.

## @BotName commands

Type `@BotName` (your bot's configured name) in a reply thread to control the bot:

| Command | Effect |
| --- | --- |
| `@BotName` | Hand the conversation back to the AI. |
| `@BotName` + instructions | Hand back with private instructions the AI follows silently (for example "offer them a refund if they ask again"). |
| `@BotName` + a request to respond | The AI immediately answers the visitor as directed (for example "explain how pricing works"). |
| `@BotName we're done here` | Close the conversation. |

> [!TIP]
> The commands are understood by intent, not exact syntax. Write them the way you would tell a teammate.
