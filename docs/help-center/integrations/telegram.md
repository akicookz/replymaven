# Connect Telegram

Telegram lets your team receive conversation alerts and work with Maven from one connected chat. Connect a bot and a group or personal chat.

## Set up Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather), then copy its token and Telegram bot username.
2. In ReplyMaven, open **Settings → Channels → Telegram** and save the token.
3. Add the bot to your Telegram group. With Telegram's default group privacy mode, a plain message may not reach the bot. Send `/start@YourTelegramBotUsername` in the group, replacing the example with the bot username from BotFather. This explicit command reaches the bot. If no Chat ID is saved yet, its first delivered message connects the group. For a personal chat, send any message to the bot. You can also paste a Chat ID in Settings → Channels.
4. Select **Send Test Message** to check delivery.

## Link each teammate

In the connected chat, reply to a message from the ReplyMaven bot, such as its test message, with `@BotName link`. `BotName` is the assistant name set in **Maven → Behavior → Persona**. It is not the Telegram bot username. Replying to the bot's message lets Telegram deliver the link request without changing group privacy settings.

Open the link while signed in to ReplyMaven. Check the Telegram account shown on the page and confirm the link.

An unlinked teammate can message Maven, but Maven cannot use that person as a verified author for customer replies or approval decisions. If you change the Telegram account, reply to a bot message with `@BotName link` again.

## Reply and ask Maven

When Maven owns a conversation, a plain teammate message is private. Maven answers in Telegram, and the customer does not see that message. To ask Maven to act, reply in the conversation's Telegram thread.

When a person owns a conversation, a plain reply in Telegram goes to the customer. The first human reply assigns the conversation to that teammate and joins Telegram to the conversation. Later visitor messages go only to joined human channels.

Use `@BotName` followed by a request to ask Maven privately while a person owns the conversation. Only a linked, verified assignee can ask Maven to send a customer reply. A bare `@BotName` returns ownership to Maven.

A request for team help does not silence Maven. A person takes over by replying to the visitor or assigning the conversation. Four hours after the latest human reply or teammate command, Maven can take over after two later qualifying visitor messages. Both messages must arrive after the wait, must not come by email, and must not call Maven by name. A future snooze delays this automatic return. See [when Maven asks your team for help](https://replymaven.com/docs/conversations/agent-handoff).
