# Real-time message delivery

The widget uses a live connection for the conversation. Maven's replies stream as they are generated. Replies from the dashboard, Telegram, and Slack appear in the visitor's open widget without a refresh.

The widget connects when it opens a conversation. On a later page load, it restores a saved conversation and reconnects. The connection recovers after network interruptions.

When a person owns a conversation, new visitor messages go to the human routes that joined the conversation. A message from one connected channel does not go to every connected channel automatically.

When a reply arrives while the widget is closed or the page is in the background, ReplyMaven can show a browser notification if the visitor granted permission. The launcher shows a dot for an unread reply. See [browser notifications](https://replymaven.com/docs/conversations/browser-notifications).
