# Connect Slack

Slack lets your team receive conversation alerts and work with Maven in a channel thread.

## Set up Slack

1. Create or open your Slack app and add a bot user.
2. Under **OAuth & Permissions**, add these bot token scopes: `chat:write` to post replies, `users:read` and `users:read.email` to match Slack users to ReplyMaven teammates. For a public channel, add `channels:history`. For a private channel, add `groups:history`.
3. Install or reinstall the app to your Slack workspace to grant these scopes. Copy the **Bot User OAuth Token**. Find the signing secret under **Basic Information → App Credentials**.
4. In ReplyMaven, open **Settings → Channels → Slack**. Enter the bot token and signing secret.
5. Under **Event Subscriptions**, enable events and set the request URL to `https://replymaven.com/api/slack/events/PROJECT_ID`, replacing `PROJECT_ID` with the project ID from your ReplyMaven project URL. Subscribe to `message.channels` for a public channel, or `message.groups` for a private channel. ReplyMaven must have the signing secret saved before Slack checks this URL.
6. Add the bot to the Slack channel. Its first verified message connects that channel. You can also enter the Channel ID in Settings → Channels.
7. If Slack asks you to reinstall after a scope change, do so and replace the saved token with the new **Bot User OAuth Token**. Select **Send Test Message** to check delivery.

If ReplyMaven says it cannot identify Slack authors, add both `users:read` and `users:read.email` under **OAuth & Permissions**, reinstall the app, then replace the saved token with the new Bot User OAuth Token.

## Link and reply

Slack users are matched to accepted ReplyMaven teammates by email. A linked, verified teammate can ask Maven to send a customer reply or decide a pending approval.

When Maven owns a conversation, a plain teammate message in its Slack thread goes to Maven privately. When a person owns it, a plain reply goes to the customer. The first human reply assigns the conversation to that teammate and joins Slack to it. Later visitor messages go only to joined human channels.

Use `@BotName` followed by a request to ask Maven privately while a person owns the conversation. A bare `@BotName` returns ownership to Maven. Only the linked assignee can ask Maven to send a customer reply.

A request for team help does not silence Maven. A person takes over by replying to the visitor or assigning the conversation. Four hours after the latest human reply or teammate command, Maven can take over after two later qualifying visitor messages. Both messages must arrive after the wait, must not come by email, and must not call Maven by name. A future snooze delays this automatic return. See [when Maven asks your team for help](https://replymaven.com/docs/conversations/agent-handoff).
