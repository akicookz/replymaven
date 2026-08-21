# Idle human handoff takeover

## Goal

Return a widget conversation to AI when a human agent has stopped responding.

## Trigger

The rule applies only when a human agent owns the conversation and has sent at
least one message.

The AI takes ownership when all of these conditions are true:

1. The latest human-agent message is at least four hours old.
2. The visitor has sent two ordinary messages after that four-hour point.
3. No human agent replied between those visitor messages.

The first visitor message stays unanswered by AI and follows the existing
Telegram forwarding path. The second visitor message triggers takeover and gets
an AI response in the same widget request.

A human reply resets the rule because it becomes the latest human-agent message.
Visitor messages sent before the four-hour point do not count.

An explicit visitor `@BotName` request keeps its current one-turn behavior. It
does not count toward automatic takeover and does not change ownership.
Inbound email messages do not count. An active snooze prevents takeover.

## Scope

- Widget chat only.
- Fixed four-hour timeout.
- No dashboard setting.
- No scheduled task.
- No automatic takeover before a human has replied.
- No automatic takeover for inbound email.
- Human-owned conversations do not auto-close while they wait for the second
  qualifying visitor message.

## Runtime flow

`MavenChatAgent.handlePublicChatMessage` evaluates the rule before returning the
current `human_mode` response.

The conversation child reads its persisted transcript and finds the latest
message with author `agent`. It then counts ordinary visitor messages created
after four hours from that message. The current visitor message is already in
the Agent transcript at this point.

If the current message is the second qualifying visitor message, the child
applies the existing `ai_handed_back` ownership event. This changes
`aiParticipation` to `continuous` and status to `active`. The same request then
runs the normal AI turn. The model receives the full transcript, including the
first unanswered visitor message.

The ownership update publishes through the existing child and project
projections. The handback event does not add a visitor-visible chat message.

## Concurrency and failure behavior

The conversation child serializes public mutations. A human reply that arrives
before the second visitor message changes the latest agent timestamp and
prevents takeover. The ownership transition also requires the conversation
revision observed by the visitor turn. A concurrent human reply, snooze, or
other mutation makes the transition a no-op.

If ownership transition fails, keep human ownership, forward the visitor
message to Telegram, and return the existing no-content response. Do not run AI
without a successful ownership change.

## Tests

Add unit and Agent integration coverage for:

- One visitor message after four idle hours keeps human ownership.
- The second qualifying message hands ownership to AI and runs that turn.
- Messages before four hours do not count.
- A human reply resets the count and timeout.
- Conversations with no human-agent message do not use this rule.
- An explicit `@BotName` message does not count.
- An inbound email message does not count.
- An active snooze prevents takeover.
- Human-owned conversations do not auto-close.
- A stale conversation revision prevents handback.
- A failed ownership transition leaves the conversation in human mode.
- The handback publishes active status without adding a visible system message.
