# @BotName plain-language intent

## Goal

Let a human agent tell the bot what to do in ordinary language. The model
reads the words. The worker applies the result. There is no keyword list.

`@BotName take over`, `@BotName stfu`, `@BotName be quiet`, and the same
request in another language must all work.

## Current problem

`classifyAgentCommand` maps agent text into four fixed actions: close,
handback, respond, ban. “Take over” is treated as respond: the bot speaks
once and the human still owns the thread. Silent instructions and a live
reply are different worker paths. That split does not match what the agent
wrote.

## Decision

Bare `@BotName` (no text) stays a fixed handback. No model call. Clear
stored instructions. Confirm “Bot resumed.”

Any other `@BotName <text>` is one model decision. Replace
`classifyAgentCommand` with a method that returns this object only:

```ts
interface BotNameDecision {
  ownership: "human" | "ai"
  instructions: "set" | "clear" | "keep"
  speak: "now" | "silent"
  effect: "none" | "close" | "ban"
  reason: string | null
}
```

Unknown keys are ignored. Missing fields, unknown enum values, or a
non-object payload are invalid.

Field meaning:

- `ownership` is the target owner. `human` keeps or takes human
  ownership. `ai` hands the thread to AI. Relative to current state:
  same owner is a no-op.
- `instructions` is `set` (write the raw `@BotName` text), `clear`, or
  `keep` the stored value. There is no separate replace.
- `speak` is `now` (visitor-visible bot reply) or `silent` (no bot row).
- `effect` is `none`, `close`, or `ban`. Ban still closes as spam and
  sweeps the visitor’s other open conversations.
- `reason` is required when `effect` is `ban`. Use the model string if
  it is non-empty, otherwise the raw agent text. Ignore `reason` for
  other effects.

Illegal combinations. The worker normalizes; it does not reject:

- If `effect` is `close` or `ban`, ignore `ownership`, `instructions`,
  and `speak`. Apply the effect only.
- `speak: "now"` always uses `generateDirectedResponse`. Never call
  `handlePublicChatMessage` from Telegram.

The model chooses from the words. Examples of expected decisions, not
matchers:

- “don’t mention the refund” →
  `{ ownership: "human", instructions: "set", speak: "silent", effect: "none", reason: null }`
- “take over” →
  `{ ownership: "ai", instructions: "keep", speak: "now", effect: "none", reason: null }`
- “stfu” / “be quiet” →
  `{ ownership: "ai" | "human", instructions: "set" | "keep", speak: "silent", effect: "none", reason: null }`
- “close this” →
  `{ ownership: "human", instructions: "keep", speak: "silent", effect: "close", reason: null }`
- “ban them” →
  `{ ownership: "human", instructions: "keep", speak: "silent", effect: "ban", reason: "…" }`

Illustrative English examples in the prompt are not a matcher. The model
must accept any language.

## Runtime

Keep this on the Telegram `@BotName` path in `worker/index.ts`. Replace
the respond / handback / close / ban branches with one apply step.

1. Resolve the conversation the same way as today.
2. If the mention has no text, hand back and return.
3. Ask the model for `BotNameDecision`. Pass the agent text only. Do not
   key off English phrases in code.
4. If the payload is invalid, take the failure path.
5. If `effect` is `ban` or `close`, apply that effect and return.
6. Apply `ownership`, then `instructions`, then `speak`.

A silent turn stores no visitor-visible bot message.

`speak: "now"` always calls `AiService.generateDirectedResponse`. The
history is the last 20 public messages, as today. The agent instruction
is the raw `@BotName` text. Persist with
`addPublicBotMessageIfOwnershipMatches` and the ownership snapshot taken
after the ownership step. If that persist fails, confirm that the
conversation changed. Do not call `handlePublicChatMessage`. The widget
sees the new bot row through the existing child persist broadcast.

Telegram confirmation should match what happened: resumed, saved
instructions, replied, stayed quiet, closed, or banned.

## Failure

If the model call fails or the payload is invalid, store the raw text as
instructions, keep human ownership, and do not speak. Confirm that
instructions were saved. Do not send a visitor-visible reply on a failed
parse.

A later human Telegram reply that is not an `@BotName` command stays an
agent message, as today.

## Idle takeover

Any applied `@BotName` command counts as human activity for idle takeover,
even when no agent message is stored. The idle rule must not treat
“respond” or “be quiet” as the human going silent.

If the decision hands the thread to AI, idle takeover does not apply until
a human owns the thread again.

## Prompt change

`<agent-instructions>` may tell the bot to stay silent. A silent decision
must not force a visible reply. Do not tell the model it may only “shape
the visible reply.”

## Scope

- Telegram `@BotName` commands only.
- Close and ban stay worker side effects. The model may choose them. Code
  does not look for the words “close” or “ban.”
- No dashboard setting.
- No new visitor-facing command.
- Dashboard and email agent replies are unchanged.

## Tests

Worker apply tests use canned `BotNameDecision` objects. They do not
match English phrases.

- Bare `@BotName` hands back and clears instructions.
- `{ ownership: "human", instructions: "set", speak: "silent", effect: "none" }`
  keeps the human and stores the raw text.
- `{ ownership: "ai", instructions: "keep", speak: "now", effect: "none" }`
  hands to AI and calls `generateDirectedResponse`.
- `{ speak: "silent" }` stores no visitor-visible bot row.
- `{ effect: "close" }` and `{ effect: "ban", reason: "spam" }` run the
  current worker effects and ignore speak.
- `{ effect: "ban", reason: null }` uses the raw agent text as the
  reason.
- A missing field or unknown enum takes the failure path.
- A failed model call stores the raw text and does not speak.
- An applied command updates idle-takeover activity without requiring an
  agent row.

Language examples (“take over”, “stfu”, a non-English quiet line) belong
in a model eval fixture, not in worker matchers.
