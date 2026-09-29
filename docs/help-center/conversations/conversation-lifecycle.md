# Conversation lifecycle

A conversation stays in one transcript. Its status and Maven's participation show who is handling it.

| Status | Meaning |
| --- | --- |
| `active` | Maven can answer the visitor. |
| `waiting_agent` | The team has a request to review. Maven can keep helping while the request is pending. |
| `agent_replied` | A person owns the conversation. Maven does not send normal replies to the visitor. |
| `closed` | The conversation is closed. A later visitor message can reopen the same conversation. |

## How ownership changes

- A conversation starts with Maven answering.
- When Maven requests team help, the status becomes `waiting_agent`. This asks the team to review the private team thread. It does not hand the customer conversation to a person.
- When a teammate replies to the visitor or assigns the conversation to a teammate, the status becomes `agent_replied`. Maven stops sending normal replies to the visitor. A teammate can still ask Maven for help in the private team thread.
- A teammate can return ownership to Maven by assigning the conversation to Maven. A visitor can call Maven for one answer without changing ownership. The message must start with `@BotName` and include a request after it. For example, if the assistant name is Maven: `@Maven How do I reset my password?` A mention later in the message, or `@Maven` by itself, does not ask Maven to answer the visitor.
- Four hours after the latest human reply or teammate command, two later qualifying visitor messages can return the conversation to Maven. Both messages must arrive after the wait, must not arrive by email, and must not call Maven by name. A future snooze delays this automatic return.
- A teammate can close a conversation in the dashboard or in the team thread. A new visitor message can reopen the same transcript. Archived and spam-blocked conversations have separate rules.

Maven does not draft an automatic canned reply when a conversation closes.

See [when Maven asks your team for help](https://replymaven.com/docs/conversations/agent-handoff) and [the private team thread](https://replymaven.com/docs/conversations/private-team-thread).
