# Inbox Rework: Compose Keybinding, Human-Review Conversations, No Auto-Resolve

**Date:** 2026-07-02
**Status:** Approved (design discussed and refined with user)

## Goals

1. Remove the suggested-replies feature (Copilot auto-suggest) — it never worked well.
2. Add a Shift+Tab keybinding in the inbox composer: the agent types an instruction (e.g. "tell him we do not offer trial extensions") and the AI writes a polished visitor-ready message matching the project's configured tone.
3. Remove the tickets concept. Escalations become conversations that need human review: the bot posts a detailed AI summary of the visitor's inquiry into the conversation (highlighted, dashboard-only) and pings the dashboard user. The visitor-facing contact form stays, repurposed to start a normal conversation.
4. Conversations needing human review (`waiting_agent`) are never auto-resolved — they stay in Needs You until the user deals with them.

## 1. Remove suggested replies (Copilot auto-suggest)

### Frontend removals

- `src/pages/Conversations.tsx`: the `needsReply`-gated auto-suggest trigger effect, `suggestionText` memo, auto-fill-on-rewrite effect, `handleRewrite` / `handleUseSuggestion` / `handleDismissSuggestion`, suggestion props passed to `ReadingPane`, copilot hook instantiations, and the `r`/`R` global shortcut.
- `src/components/inbox/ReadingPane.tsx`: the "Suggested reply" chip and its props.
- `src/components/inbox/Composer.tsx`: the "Rewrite" button (replaced by the Compose button, see §2).
- `src/components/inbox/FocusView.tsx`: rewrite wiring (gets Compose instead).
- `src/components/CopilotDrawer.tsx`: delete (already dead code).
- `src/lib/use-copilot.ts`: delete.
- `src/lib/use-conversation-ws.ts`: remove the `copilot:message:new` handler.

### Backend removals

- Routes in `worker/index.ts`: `GET/POST .../copilot/messages`, `POST .../copilot/auto-suggest`.
- `worker/chat-runtime/orchestration/handle-copilot-turn.ts`, `worker/chat-runtime/prompt/build-copilot-system-prompt.ts`, `worker/services/copilot-service.ts`.
- `worker/realtime/broadcast.ts`: `copilotRowToPayload`, `broadcastCopilotMessage`; `shared/ws-events.ts`: `CopilotMessagePayload` and the `copilot:message:new` event.
- `worker/validation.ts`: `copilotSendMessageSchema`.
- Drop the `copilot_messages` table (schema removal + Drizzle-generated migration). No remaining reader once suggestions are gone.
- The `drafted` system-event kind is no longer produced; it stays in the frontend `SystemEventKind` union so historical rows still render.

## 2. Shift+Tab: instruction → composed message

### UX

- Agent types an instruction into the composer and presses **Shift+Tab** (`preventDefault` so focus doesn't move), or clicks the **Compose ⇧⇥** button that replaces the old Rewrite button.
- While composing: textarea disabled, subtle "Composing…" state.
- On success: the instruction in the composer is replaced by the generated message. On failure: error toast, instruction restored untouched.
- Works in both the reading pane and focus view (shared `Composer` component).
- Guards: no-op when the draft is empty or a compose is already in flight.

### Backend

- New endpoint: `POST /api/projects/:id/conversations/:convId/compose-draft`, body `{ instruction: string }` (1–2000 chars, validated), response `{ message: string }`. Same auth as other project conversation routes; rate-limited (30/60s, same as the old auto-suggest).
- Single non-streaming `generateText` call through `createLanguageModel` + `runWithModelFallback` (keeps Gemini ⇄ GPT fallback). No persistence, no RAG/agentic pipeline — the agent supplies the substance; the AI does phrasing and tone.
- Prompt inputs: tone via `resolveToneInstruction` (single source of truth, incl. `customTonePrompt`), bot/agent name, company name/context, recent conversation transcript (last ~20 messages), and the agent's instruction. Output rules: only the visitor-facing message text, in the visitor's language, no preamble/quotes.

## 3. Tickets → human-review conversations

### 3.1 Bot-initiated escalation

The planner's `create_ticket` action is renamed to `escalate` (planner prompt, executor, types). Stored chat states may contain the legacy action name in action history — deserialization stays tolerant.

On escalate, the executor:

1. Generates a **detailed inquiry summary** via an upgraded `buildTeamRequestSummary` prompt: what the visitor wants, key details/identifiers they provided, what the bot already tried, and contact info.
2. Sets the conversation to `waiting_agent` + broadcasts (unchanged) → it appears in **Needs You**.
3. Posts the summary as a system message with new kind `review_summary` (replaces the short "Maven flagged this for human review" message; same emit-once-on-first-transition semantics). Rendered in the dashboard thread as a **highlighted callout card**: full-width in the thread flow, accent-tinted background, icon + "Needs human review" label, full summary text unclamped — visually distinct from both chat bubbles and the small `SystemPill` (no border-divider lines). System messages are already excluded from all widget reads, so visitors never see it.
4. Fires Telegram + email notifications carrying the summary and a **deep link to the conversation in the inbox** (not the tickets page).

**Deep links:** the inbox already selects a conversation from the URL (`?filter=<f>&id=<conversationId>`, synced bidirectionally in `Conversations.tsx`). This rework adds an optional `&msg=<messageId>` param: when present, the thread scrolls to that message and briefly pulses it (reusing the existing `data-msg-id` anchor + scroll mechanism from in-conversation search). Telegram links, email CTAs, and the ping toast's "View" action all use `?filter=needs-you&id=<convId>&msg=<summaryMessageId>` so the user lands directly on the highlighted summary.

Visitor feedback is unchanged: the LLM-rendered, tone/language-matched confirmation message (directive kind renamed `ticket_created` → `escalated`; the created/already-forwarded variants are computed from conversation state/metadata now that ticket rows are gone), the chat stays open, the bot stays active, and the widget requests notification permission so the visitor is notified when the agent replies.

Conversation `metadata` keys (`teamRequestSummary` etc.) keep their current names to avoid migrating existing rows.

### 3.2 Contact form (kept, repurposed)

- The widget quick-action form stays; fields remain configurable. The `ticket_config` table is kept as the contact-form config (UI copy rebranded; table rename not worth the migration churn). The dashboard config endpoints (`GET/PUT .../ticket-config`) also stay, serving the contact-form config.
- On submit, the public endpoint (existing `/api/widget/:projectSlug/inquiries` + `/tickets` paths kept for deployed-widget compatibility) now: creates a conversation with the form's message as the first visitor message, stores name/email on the conversation, sets status `waiting_agent`, and fires the Telegram/email ping with the form content. Returns the conversation id, with the response shape kept backward-compatible for cached widget bundles still expecting the old success fields.
- The widget then **drops the visitor into that chat**: their message is visible as sent, with a small widget-local note ("Sent — the team will reply here"), and follow-ups are normal chat messages.
- No bot auto-reply and no AI summary for form-created conversations — the form content is the inquiry.

### 3.3 Deletions

- `tickets` table dropped (schema removal + Drizzle migration). **Historical ticket data is permanently deleted in prod on deploy** — accepted.
- `TicketService` (config methods move to a slim contact-form config service or equivalent), all ticket CRUD/bulk/compose routes, `aiService.composeTicketReply`.
- `src/pages/Tickets.tsx` and its route; `/tickets` (and legacy `/inquiries`) URLs redirect to the inbox.
- Dashboard "Recent Tickets" widget → "Needs review" conversation list (backed by the existing `waiting_agent`/`agent_replied` recent query).
- MCP `list_tickets` tool and ticket lookups in `worker/mcp-server.ts`.
- Ticket validation schemas; `buildDynamicFormData` and the `ticketFields`/`existingTicket`/ticket-refinement plumbing through the chat runtime.
- `telegramService.notifyNewTicket` → escalation notification (summary + conversation deep link); `emailService.sendTicketNotification` → escalation email template (summary + conversation deep link).
- Conversation-detail route stops returning a `ticket` object; `DetailsPanel` shows the review summary + visitor info from conversation metadata instead.

### 3.4 Dashboard ping (all four surfaces)

A single Needs-You detector at the `Layout` level (so it works on any dashboard page) watches for conversations newly entering `waiting_agent` (via the inbox-counts/list polling; last-seen tracking persisted in localStorage so refreshes don't re-ping). When a new one appears:

- **In-app toast**: visitor name + summary/message preview + "View" action that jumps to the conversation in the inbox.
- **Notification sound**: short chime (bundled asset) alongside the toast.
- **Browser notification**: OS-level notification via the Notification API when the tab is hidden (backgrounded); permission requested from the dashboard on first ping opportunity.
- **Tab title badge**: title prefixed with the Needs You count (e.g. `(2) ReplyMaven`), cleared as the count drops.

## 4. No auto-resolve for human-review conversations

- **Stale auto-close**: `checkAndCloseStale` and `checkAndCloseStaleForProject` (worker/services/chat-service.ts) exclude conversations with status `waiting_agent`, regardless of `autoCloseMinutes`.
- **`[RESOLVED]` sentinel**: in `handle-widget-message-turn.ts`, the resolved-token handling is skipped when the conversation is in `waiting_agent` (or was escalated during the current turn) — the token is still stripped, the chat stays open, but the bot cannot close a flagged conversation. The system prompt additionally tells the model not to self-resolve escalated conversations; the deterministic guard is the enforcement.
- Explicit actions (dashboard Resolve, Telegram `close` command, agent reply → `agent_replied`) behave as today — those count as the user dealing with it.

## Error handling

- Compose-draft failure: error toast, instruction preserved in the composer.
- Escalation notification failures (Telegram/email): logged, non-blocking — same as today.
- Contact-form submission failure: widget shows the existing form error state; no conversation created.

## Testing / verification

- `bun run check` (types/lint) and existing test suite must pass.
- Manual flows: compose via Shift+Tab in reading pane + focus view; bot escalation end-to-end (summary callout, Needs You, toast/sound/notification/title, Telegram/email deep link); contact form → chat redirect → follow-up message; stale auto-close skipping `waiting_agent`; visitor "thanks, bye" on an escalated conversation not closing it.

## Migration / deploy notes

- Two destructive Drizzle migrations: drop `copilot_messages`, drop `tickets`. Deploy must run prod migrations (`bun run deploy:full` or `db:migrate:prod` before deploy), or prod will 500 on missing tables.

## Out of scope

- Streaming the composed draft token-by-token.
- A persistent "escalated" banner/status line in the widget.
- The hardcoded widget closing message on `[RESOLVED]` (pre-existing).
- Notification preference toggles (mute sound, disable browser notifications) — v1 ships all surfaces on.
