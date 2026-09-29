# Use the private team thread

Each customer conversation has a private team thread in the dashboard inbox. It is separate from the customer's transcript. Teammates can ask Maven questions there, review its suggestions, and use supported actions without exposing those messages to the customer.

The private thread is available from a conversation in the dashboard. Open the conversation and choose its team thread. Telegram, Slack, and email can also carry teammate messages for a conversation when that channel is connected.

## What a teammate message does

When Maven owns the conversation, a teammate's message in Telegram, Slack, or email goes to Maven in the private thread. Maven replies in that channel thread. A message in the dashboard private thread stays there.

When a person owns the conversation, a plain reply from a connected human channel goes to the customer. The first human reply sets that teammate as the assignee and joins the channel to the conversation. Later customer messages go only to the joined human routes.

Use `@BotName` followed by a request to ask Maven privately while a person owns the conversation. Only a linked, verified teammate who is the assignee can ask Maven to send a customer reply. Other teammates can still ask Maven questions in the private thread.

A bare `@BotName` in Telegram or Slack returns ownership to Maven. In the dashboard, choose Maven in the Assign menu. Maven can also take over four hours after the latest human reply or teammate command, once two later qualifying visitor messages arrive. Both messages must arrive after the wait, must not come by email, and must not call Maven by name. A future snooze delays that automatic return. See [when Maven asks your team for help](https://replymaven.com/docs/conversations/agent-handoff).

## Customer replies and email

Maven's `reply_to_conversation` action posts a message in the customer chat. It does not send email. Use `email_customer` when a teammate wants a message sent to the customer's email address. This needs an email address on the conversation and a linked, verified assignee.

If a teammate replies from Telegram or Slack while the visitor wrote by email or is offline, Maven may offer to email that reply. Check the private thread and approve or ask for the email action there.

## Approvals

Some connected tools pause for teammate approval before they run. Review the action and its details in the private thread, then approve or reject it. Maven continues after the decision. Only a linked, verified teammate can decide an approval.
