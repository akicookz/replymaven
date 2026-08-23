---
name: writing-encited-copy
description: Use when writing ReplyMaven landing pages, marketing, docs, emails, UI strings, empty states, errors, buttons, or any customer-facing copy.
---

# Writing Encited copy

## The stance

The user is the hero. Maven is the helper NPC they meet on the way to their
destination. Nobody cares about a feature until they see it carrying them to
their goal.

## The shape of every piece

Open with the use case. The reader's goal or frustration, stated as
theirs, first line. Never "ReplyMaven offers...".

Show the destination. What their world looks like once they get there.
Outcome, not capability.

Introduce the vehicle. Only now the feature: one or two lines on how it
moves them from here to there. The feature never gets more space than the
goal.

Hand them the next step. One link, one action, phrased as their move:
"Start your free trial" rather than "Learn more about live agent handoff".

## Grammar of the hero framing

Winning sentences promise the destination at full size, as the user's
move. "Get back to the product while visitors still get answers." Better
still, climb to what that unlocks: "Ship this week without sitting in the
widget." Weak versions stop at the mechanism ("Maven answers", "you get a
handoff"); always climb from the mechanism to the thing it lets them do.

Making us the subject ("we index your docs", "we ping you on Slack") is
almost never right. Second-guess every "we"; the feature or the user's own
asset usually carries the sentence better: "Maven answers from your docs",
"your Telegram thread already has what it tried". "We" survives only
for a genuinely human act: a founder note, a setup call.

Never enumerate features as a list of what we have. Each feature appears
inside the use case it serves, or not at all.

A feature with no use case attached gets cut.

Maven may be the sentence subject when it is the NPC doing the work.
"ReplyMaven" as the company subject is the same fault as "we".

## Voice

Copy is never editorial. State situations, actions, and outcomes. No
opinion flourishes, no commentary on how hard or interesting something is,
no motivational talk.

Direct talk. No setup sentences ("Here is what that buys you", "The one
thing worth doing today is X"). Say the thing.

No rhetorical questions ("Need a human instead?"). State the alternative
as a sentence: "The same thread reaches you on Telegram."

Never the "it's X, not Y" contrast punchline ("It's not a chatbot, it's
an agent", "research, not a blank ticket"). The sentence carries no
information. State the fact directly and cut the mirror clause.

Alternate sentence length. Uniform medium sentences read as generated.

No stock closers ("Reply with any questions"). A functional ask tied to a
concrete moment is fine: send a screenshot when stuck.

Contractions preferred. "You're on a free trial", not "You are on".

No em-dashes anywhere. Periods, commas, colons, semicolons.

No "all in one place" style feature enumeration. One outcome per line.

Sequence emails come from the founder, plain and short. The welcome email
is the exception: polished HTML with screenshots, from the ReplyMaven team.

## UI copy

Every string tells the user the next action or the information they need
right now. Nothing else.

Buttons and links name the action: "Start free trial", "Chat with Maven".

Empty states say what will appear and what to do to get it.

Errors say what went wrong and the next step.

Skip editorial and motivational talk entirely. No "You're doing great",
no "Almost there!", no product philosophy.

## The map: feature set → hero's goals

This map is where every piece of copy starts. It pairs each feature set with
the goals a real user is chasing when that feature happens to be the answer.
A goal is a situation in the reader's life, written in their words: "same
question landed again while I was in the code". It is never a capability of
ours: "Telegram live agent handoff" is not a goal, nobody wakes up wanting
that.

How to write from it:

Find the feature you're writing about. Then stop looking at the feature.
Pick a goal from its list; that goal is your opening line and the spine of
the whole piece. The feature enters later, as the vehicle.

The lead goal (first in each set) is the default open: the most
common, most keenly felt situation for that feature. Use it whenever the
piece talks to a broad audience, like a sequence email or a landing page.

The other goals are for targeted pieces. When you know who the reader is
(solo founder, small team, someone already in Cursor), open with their goal
instead of the lead.

One piece, one goal. If two goals fight for the opening, that's two
pieces.

Writing about something with no goal listed here? Either add its goal to
this map first (and make sure it's a real situation, not a reworded
feature), or don't write the piece.

### Named agent on the site (widget)

- Same questions keep landing while they're trying to ship
- Visitor is stuck on a page and needs an answer now
- They want the chat to look like their product
- Logged-in visitor shouldn't get asked for their email again
- They're the only person on support and can't sit in the widget

### Knowledge (help center, pages, PDFs, FAQs)

- They already answered this last week; it still isn't written down
- Visitor gets one answer in chat and another on the help page
- Docs already live as pages, PDFs, or FAQs; they don't want to rewrite them
- They want a public help center on their own domain

### Actions (approved tools)

- Visitor wants a refund, a seat, or an account lookup; they're doing it by hand
- They only want Maven to touch the tools they approved
- A bug report should become a Linear or GitHub issue with the thread

### Handoff (Telegram, Slack, @BotName)

- Maven is stuck and they need the thread where they already are, with what it tried
- Visitor shouldn't start over with a human
- They want to tell Maven what to say without writing the customer reply

### Sidechat

- They want Maven to look something up without the visitor seeing that turn
- A draft is ready and they want to read it before it goes out

### MCP

- They're already in Cursor or Claude and don't want to leave to handle a ticket
- They want to update a help article from the agent they already use

### Inbox

- They sat down for twenty minutes and need to clear what's left
- They want the draft and the customer on one screen
- They want to hand a thread back to Maven

### Pricing and trial

- They want this running this week without a sales call
- They don't want to pay each time Maven finishes a conversation

## Landing page

The public landing page keeps the existing ValueSection pattern. Do not
open those sections with a scene or a frustration line.

Each platform block is: outcome title, one or two sentence body, four
numbered labels. Titles sound like the current page: "Go through your
support inbox in minutes", "Maven can take actions and resolve tickets",
"Delegate the information lookup to Maven".

Hero H1 is locked: "Frontline support agent for founding teams".
Hero body stays the current delegate paragraph unless the user changes it.

## After writing: spit out the full readable version

Once the copy is written (or edited into files), print the complete piece as
plain readable text in the response, assembled in the order the user will
encounter it. Run the litmus test against that version, then leave it for
the user to review.

This matters most for UI copy, where the strings end up scattered across
components and nobody ever sees the whole surface in one place. Reconstruct
the screen as the user reads it: heading, body, field labels, buttons, empty
states, error messages. A string that looks fine alone reads wrong in the
flow, and this is where you catch it.

## Litmus test before shipping

Run this against the full readable version, never against scattered diffs.
Read the first line. If ReplyMaven or "we" is the subject, rewrite. Read each
feature mention. If you can't name the use case it serves in that piece, cut
it. Read every sentence once more: any sentence that only comments, motivates,
or mirrors ("it's X, not Y") gets deleted.
