# When Maven asks your team for help

Maven can ask your team to review a conversation when it cannot answer or when a visitor asks for a person. This request does not silence Maven. It keeps helping the visitor while your team reviews the private team thread.

A person takes over by replying to the visitor or by assigning the conversation to a teammate. Maven then stops sending normal customer replies. A teammate can still ask Maven for help in the private thread.

## Set up your team channels

Open **Settings → Channels** in your project to connect Email, Telegram, or Slack. Email uses the forwarding address shown on this page. See [forward your support inbox](https://replymaven.com/docs/integrations/forward-your-support-inbox), [Telegram](https://replymaven.com/docs/integrations/telegram), and [Slack](https://replymaven.com/docs/integrations/slack).

Set the assistant name and human label under **Maven → Behavior → Persona**. You can set the assistant name once. It is locked after you save it.

## Review and take over

Open the conversation in the dashboard inbox. Its private team thread keeps teammate messages separate from the customer transcript. You can ask Maven to explain the conversation, find knowledge, or suggest an action there.

When a teammate first replies to the visitor, that teammate becomes the assignee and owns the conversation. If the reply comes from Telegram or Slack, that channel joins the conversation. Later visitor messages go only to joined human channels. A visitor who writes by email can receive an email reply. Chat replies appear in the widget.

Only the assigned teammate can ask Maven to send a customer reply while a person owns the conversation. The teammate must also be linked to a ReplyMaven account. Other teammates can ask Maven for private help, but Maven will not send their customer reply.

## Return the conversation to Maven

While a person owns the conversation, a visitor can call Maven for one answer without changing ownership. Start the message with `@BotName` and include a request after it. For example, if the assistant name is Maven: `@Maven How do I reset my password?` A mention later in the message, or `@Maven` by itself, does not ask Maven to answer the visitor. A teammate can also write `@BotName` by itself in the team channel to return ownership to Maven. Replace `BotName` with the configured assistant name.

Four hours after the latest human reply or teammate command, Maven can take over after two later qualifying visitor messages. The two messages must arrive after the four-hour wait, must not arrive by email, and must not call Maven by name. A future snooze delays this automatic return.

For channel-specific reply rules, see [Telegram](https://replymaven.com/docs/integrations/telegram), [Slack](https://replymaven.com/docs/integrations/slack), and [the private team thread](https://replymaven.com/docs/conversations/private-team-thread).
