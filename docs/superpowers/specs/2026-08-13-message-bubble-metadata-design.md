# Message Bubble Metadata and Sidechat Surfaces

**Date:** 2026-08-13  
**Status:** Approved in product conversation  
**Scope:** Shared inbox message grouping and Sidechat-only bubble surfaces

## Outcome

Message identity and delivery metadata render beneath the message content instead of above it. Consecutive messages from the same sender show metadata only beneath the final message in that sender group.

Sidechat uses quieter message surfaces: the human agent's messages use the existing neutral received-bubble surface, while Maven messages render flat without a bubble background. The public visitor conversation retains its current received and blue sent bubbles.

## Shared grouping contract

`ChatThread` owns sender-group detection because it has the ordered message list. For every message it determines whether the next visible message belongs to the same presentation sender. It passes a boolean to `MessageBubble` indicating whether that message is the final bubble in its sender group.

`MessageBubble` does not inspect DOM siblings or reconstruct grouping. It renders metadata only when the thread marks the message as the group's final bubble.

Tool traces and other Sidechat presentation rows do not split a Maven sender group. A Maven tool trace remains attached above Maven's answer, and the group's metadata appears beneath the final Maven answer. If a trace-only Maven message has no visible answer bubble, its metadata follows the trace.

## Metadata line

The line contains the information available for that message, in this order:

`Sender · time · delivery state · emailed state`

Examples:

- `Maven · 04:35 AM`
- `You · 04:35 AM · Seen`
- `Roxanne from Encited · 04:35 AM · Delivered · Emailed`

Rules:

- Align left for received messages and right for sent messages.
- Use the existing quiet ink tokens; sender, time, delivery state, and emailed state are secondary information.
- Do not use brand blue, green, or amber to emphasize metadata.
- Use tabular numerals for time.
- Preserve the detailed delivery timestamps in the existing tooltip.
- The metadata line is not placed inside the bubble surface.

## Bubble surfaces

### Public conversation

No surface change:

- Visitor messages keep the neutral received bubble.
- Agent and Maven replies keep the blue sent bubble.

### Sidechat

- Human-agent messages align right and use Maven's current neutral received-bubble background and text color instead of blue.
- Maven messages align left and render flat: no background fill, no bubble radius, and no bubble padding beyond the text's required readable inset.
- Sidechat tool execution traces remain flat above Maven's final message.
- Inline Sidechat actions remain attached to their Maven content without introducing a card surface.

## Responsive and accessibility behavior

- Preserve the current bubble width limits and sender alignment.
- Metadata wraps rather than overflowing on narrow Sidechat layouts.
- Existing delete, approval, and Add-to-reply controls retain their hit areas and keyboard behavior.
- Search-match rings continue to surround the visible message content even when Maven's Sidechat surface is flat.

## Verification

Verify in the authenticated dashboard, without mocked UI tests:

1. Public received and sent bubbles retain their current surfaces.
2. Public metadata appears below only the final bubble in each sender group.
3. Sidechat human messages use the neutral bubble rather than blue.
4. Sidechat Maven messages have no background surface.
5. Sidechat metadata appears below only the final bubble in each sender group.
6. Tool trace, Maven answer, and Maven metadata render in that order.
7. Seen, Delivered, Emailed, sender, and time use neutral secondary styling.
8. Narrow Sidechat layout has no overflow or overlapping metadata.

Run TypeScript, changed-file lint, the existing non-UI behavior suite, production build, and `git diff --check`. Do not add UI tests for this change.
