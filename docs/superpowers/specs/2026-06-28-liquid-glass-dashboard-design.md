# Liquid-Glass Dashboard Overhaul — Design

**Date:** 2026-06-28
**Scope of this spec:** Foundation (design tokens + app shell) and the Conversations inbox.
**Reference:** `~/Downloads/design_handoff_replymaven_inbox 2/` (v2 — README + `ReplyMaven Mail.dc.html`, the dark primary). Supersedes v1.

## Overview

Re-skin the ReplyMaven dashboard from its current flat dark theme into the macOS
"Liquid Glass" Apple-Mail language fused with Superhuman's keyboard-first speed:
a full-viewport, translucent, three-pane inbox over a soft wallpaper gradient.

This pass delivers the **visual foundation** (a reusable glass token layer + the new
shell) and the **inbox** (Conversations rebuilt as a 3-pane mail view). Other pages
(Dashboard, Knowledgebase, Help, Widget, Billing) inherit the new shell and wallpaper
now and get full per-page reskins in later passes.

## Decisions (locked with user)

1. **Accent → Apple blue `#0a84ff`** globally (replaces orange `#f97316`). Existing
   shadcn components inherit it via the core token flip.
2. **Token approach → extend, not replace.** Flip core accent tokens + add a
   namespaced glass token layer registered in `@theme inline`. No inline rgba/sizes
   in components — everything references a token.
3. **Sidebar IA → adopt the handoff structure** (Inbox / Workspace / Widget), mapping
   filters to real conversation state.
4. **Data gaps → no fabrication.** Omit **category** and **sentiment** entirely (no
   schema, no UI — rows show flag + name only). Reuse existing spam/ban for
   "Flagged"/"Flag-as-spam"/"Block". **Add snooze** and **priority** as real features
   (new columns + actions). [updated: priority now in, per v2 mocks.]
5. **System timeline → a new `system` role on the existing `messages` table** (same
   thread channel), not a separate events table. Visitor-facing reads filter it out so
   internal events never reach the customer's widget; the dashboard renders them as
   centered pills.

### Design philosophy: no dividers (handoff v2 + user preference)

Per handoff v2 and the user's standing rule: **avoid borders/dividers to separate
regions.** Separate with spacing, translucent fills, and elevation. The *only* hairline
allowed is the `.5px` row separator inside the message list. The sidebar account row has
**no** top border. The old `.glow-surface*`/`border-t` patterns are not carried into the
new surfaces.

## 1. Token architecture (built first)

All tokens live in `src/theme.css`. Two parts:

### 1a. Flip core accent to blue
- `--brand: #0a84ff`, `--brand-dark: #0060df`, `--brand-soft: #409cff`.
- `--primary`, `--ring` already alias `--brand` → become blue automatically.
- Add label shades: `--brand-label: #5ea2ff` (Maven/AI), `--brand-label-human: #9ad0ff`.

### 1b. Glass token layer (new), registered in `@theme inline`

| Group | Tokens | Tailwind utility |
|---|---|---|
| Wallpaper | `--wallpaper` (3 stacked radial-gradients on `#0b0c0f`) | `bg-wallpaper` |
| Glass surfaces | `--glass-sidebar` `rgba(28,28,32,.52)`, `--glass-list` `rgba(24,24,27,.78)`, `--glass-reading` `rgba(20,20,23,.72)`, `--glass-bar` `rgba(22,22,26,.5)`, `--glass-button` `rgba(255,255,255,.07)`, `--glass-raised` `rgba(255,255,255,.12)`, `--glass-focus` `rgba(37,38,44,.96)`, `--glass-peek-1/-2` `rgba(48,49,56,.92)`/`rgba(43,44,51,.94)` | `bg-glass-sidebar` … |
| Blur | `--blur-panel: 40px`, `--blur-bar: 24px` | `backdrop-blur-panel` / `-bar` |
| Hairlines | `--hairline: rgba(255,255,255,.07)`, `--hairline-strong: rgba(255,255,255,.16)`, `--hairline-inset: rgba(255,255,255,.1)` (glass-button inset) | `border-hairline` |
| Text ramp | `--ink-1 #fff … --ink-8 #6e6e73` (8 steps per handoff) | `text-ink-3` … |
| Category* | `--cat-account #409cff`, `--cat-dns #7d7aff`, `--cat-billing #30d158`, `--cat-rendering #ff9f0a`, `--cat-hosting #ff6482` | `text-cat-dns` |
| Status dots | `--dot-green #30d158`, `--dot-orange #ff9f0a`, `--dot-yellow #ffd60a`, `--dot-gray #98989d`, `--dot-blue #0a84ff` | `bg-dot-orange` |
| Bubbles | `--bubble-received rgba(118,118,128,.28)`, `--bubble-sent #0a84ff` | `bg-bubble-received` |
| Radii | `--radius-row: 9px`, `--radius-glass: 9px`, `--radius-bubble: 20px`, `--radius-card: 15px`, `--radius-keycap: 4px` | `rounded-row`, `rounded-bubble` … |

\*Category tokens are defined now (cheap, reusable) but **not consumed** in this pass
since there is no category data — they're ready for when a category model lands.

Reusable component utilities (in `@layer components` in `index.css`, token-driven):
`.glass-panel`, `.glass-button` (bg + inset hairline + hover brighten), `.keycap`,
`.system-pill`. These replace the old `.glow-surface*` utilities for the new surfaces.

### Light mode
Out of scope to perfect. The handoff is dark-only ("light is reference"). Keep the
existing `.light` block functional; do not invest in glass light-mode fidelity now.

## 2. App shell (`src/components/Layout.tsx`)

- `body` / root gets `bg-wallpaper` (fixed). Panes sit translucent over it.
- **Sidebar → 248px glass** (`bg-glass-sidebar` + `backdrop-blur-panel`, `border-r border-hairline`):
  - Top: three decorative macOS traffic-light dots + "ReplyMaven" wordmark (13px/600).
  - **Inbox** section: Needs You (count), All Conversations, Snoozed, Resolved, Flagged.
    Selected row `bg-glass-raised`, icon + count tinted blue.
  - **Workspace** section: Dashboard, Knowledgebase, Help Center. **Tickets removed**
    from nav (see IA changes below).
  - **Widget** section: **Configuration**, Home Screen, Quick Actions.
  - Bottom: gradient avatar + name/email + chevron (existing user menu). **No separator
    above it** (no-dividers rule).

### IA changes (handoff v2 + user)
- **Tickets** is removed from the dashboard nav. The page/route and `tickets` table are
  **not deleted** in this pass (non-destructive — would break existing data/links);
  just unlinked from the sidebar. Full retirement is a separate follow-up to confirm.
- **Configuration** is a new consolidated Widget page (tabbed shell) that hosts the
  existing **Appearance**, **Installation**, and **Greetings & News** pages as tabs.
  Those page components are reused as-is (they inherit the glass shell; no full reskin
  this pass). **Home Screen** and **Quick Actions** (renamed from "Quick Actions &
  Tools") stay as their own nav items.
- Team/project switchers retained, restyled to glass.
- Non-inbox routes keep their current page internals but render on the glass `main`.
- Mobile: sidebar stays a slide-over; the 3-pane collapses (see §3).

## 3. Inbox rebuild (`src/pages/Conversations.tsx`)

Full-viewport flex, `h-screen`, no page scroll; each pane scrolls internally.

### Col 2 — message list (372px, `bg-glass-list` blur-panel)
- Header: title from active filter ("Needs You"), subtitle "N open · M unread",
  two glass icon buttons (filter, ⋯).
- Search field (`rounded-[8px]`, `bg-glass-button`) with magnifier + ⌘K keycap.
- **Rows** (`rounded-row`, hover `bg-glass-button`): unread blue dot · **country flag**
  (emoji from `metadata.country`) + sender name + time · subject (1 line ellipsis) ·
  preview (2-line clamp) · hairline separator inset 28px. Hover reveals quick actions
  (Resolve ✓, Snooze ⏰). **Selected row = `bg-bubble-sent` (blue)** with the handoff's
  white/translucent text ramp.
- **No category tag and no city line** (handoff v2 removed both). Location still appears
  in the reading-pane meta line, just not in list rows.

### Col 3 — reading pane (`flex-1`, `bg-glass-reading` blur-panel)
One scroll container holding sticky header → thread → sticky composer.
- **Sticky glass header** (`bg-glass-bar` blur-bar), two rows:
  - Toolbar: Reply · capsule {Resolve, Snooze, Flag-as-spam (orange flag)} · Assign ·
    right: Focus `F` button + search field.
  - User bar: 44px tinted avatar + initials · flag + name + verified badge + email ·
    status dot + "Open"/location/"In chat…"/browser (from `metadata`) · right:
    **"Priority · {priority}"** (from the new `priority` field — see §6), click-to-set.
- **Thread** (centered `max-w-[760px]`):
  - Date dividers (derived from message timestamps).
  - **System-event pills** — real `system`-role messages in the thread, positioned by
    timestamp: "Maven flagged this for human review", "{agent} joined", "Snoozed
    until …", "Snooze ended", "Maven drafted a reply from KB · …". Dot color derived
    from the event kind. Written at the moment the event occurs (see §4/§5); never
    fabricated retroactively.
  - **Bubbles**: customer = left, `bg-bubble-received`, `rounded-bubble` w/ 6px tail;
    agent/Maven = right, `bg-bubble-sent`. Label color: Maven AI `--brand-label`,
    human `--brand-label-human`. Markdown via existing `renderMarkdown`.
- **Sticky glass composer** (`bg-glass-bar` blur-bar):
  - Input box (`rounded-[20px]`, `border-hairline-strong`): auto-growing textarea
    **pre-filled with the existing Copilot auto-suggest draft** when available.
  - Action row: paperclip (attach) · Rewrite `R` · Resolve `E` · Send (32px round blue).

### Keyboard (ignored while typing)
Wire: `J`/`↓` next, `K`/`↑` prev, `E` resolve (advance), `R` rewrite (Copilot
re-draft), `F` toggle Focus, `Esc` exit Focus. Visual-only: `⌘K`, `Tab`, `⌘↵`.

### Focus view (`view: 'split' | 'focus'`) — per handoff v2
Toggled by `F`. The list + reading panes are replaced by one conversation centered
(`max-w-[680px]`) on the blurred dark pane. **Minimal: no top bar, no "FOCUS · SWEEP"
label, no progress bar.**
- **Exit** button floats top-right (`absolute top-[18px] right-[30px]`) — "Exit Focus `Esc`".
- **One frosted stacked card** (`bg-[--glass-focus]` ≈ `rgba(37,38,44,.96)`,
  `backdrop-blur-bar`, `border-hairline-strong`, `rounded-[18px]`, `p-[22px_24px_18px]`):
  1. **User bar** — 44px avatar, flag + name (18px/600), email, status pill
     ("Open · {priority}") right.
  2. **Last 3 messages** as compact mini-bubbles (`rounded-[16px]` 5px tail): the
     conversation's **original** message, a centered "···" gap marker for skipped
     middle, then the two most recent — story reads start-to-now.
  3. **Composer** — the *same* component as the split view (draft pill + attach +
     Rewrite `R` / Resolve `E` / Send).
- **Stacked-card peeks**: two thin slivers behind the card top (`absolute top-[-9px]/-4px`,
  inset 24/13px, `rounded-t-[18px]`, dark fills) conveying queue depth.
- **Below the card**: count "N of 7" (blue) bottom-left + keyboard legend
  (`J K` next·prev, `S` snooze, `⌘K` commands) right.
Summary/sentiment/citation cards **omitted** (no data) — already gone in handoff v2.
Built as the final inbox piece; deferrable without blocking the rest.

### Reuse / mapping
- Thread, presence, location/browser → existing Conversations data + `metadata`.
- Composer suggested reply + Rewrite + KB citations → existing `copilotMessages`
  (`autoSuggest`, `sources`) + Copilot endpoints.
- Resolve → existing close-as-resolved. Flag-as-spam → existing spam close (+ optional
  ban). Block → existing `VisitorBanService`.

## 4. System events (`system` message role)

- **Schema:** add `"system"` to the `messages.role` enum. System rows carry the
  display text in `content` and an event `kind` (for dot color) — `kind` stored in a
  small JSON via the existing `sources`/metadata convention (no extra column). Migration
  via `bun run db:generate`.
- **Isolation:** visitor-facing reads (`getMessages`, `getMessagesSince` on the
  `/api/widget/...` route) filter `role != 'system'`; agent reads (`getMessagesBefore`)
  include them. The widget renderer already only branches on `bot|agent|visitor`.
- **Emitted on:** bot→human handoff ("Maven flagged this for human review", orange),
  first agent join ("{agent} joined", blue), snooze/unsnooze (gray/green), Copilot
  auto-suggest draft ("Maven drafted a reply from KB · …", blue). Each writes one
  `system` message at the moment it happens via `ChatService`.
- **Render:** dashboard thread maps `kind`→dot color and renders the centered pill.

## 5. Snooze (new feature)

- **Schema:** add `snoozedUntil: integer("snoozed_until", { mode: "timestamp" })`
  (nullable) to `conversations`. Same migration as §4.
- **API:** `POST /api/projects/:id/conversations/:cid/snooze` `{ until }` and an unsnooze
  (clear). Validation in `worker/validation.ts`. Each call also writes a §4 `system`
  message ("Snoozed until …" / "Snooze ended").
- **Sidebar filters:**
  - **Snoozed** = `snoozedUntil > now`.
  - **Needs You** = `waiting_agent` AND not currently snoozed.
  - **All Conversations** = all open. **Resolved** = `closed`.
  - **Flagged** = spam (`closeReason = "spam"`). Block/ban stays an *action*
    (existing `VisitorBanService`), not a sidebar view.
- **UI:** Snooze action in list-row hover, toolbar capsule, and composer. Snooze wake is
  lazy (on read, `snoozedUntil <= now` clears it and emits "Snooze ended") — no
  scheduler in this pass.

## 6. Priority (new feature)

- **Schema:** add `priority: text("priority", { enum: ["low","medium","high"] })`
  default `"medium"` to `conversations`. Same migration as §4/§5.
- **API:** `PATCH …/conversations/:cid` accepts `priority` (or a dedicated endpoint).
  Validation in `worker/validation.ts`.
- **UI:** shown as "Priority · {priority}" in the reading-pane user bar (split) and as
  the "Open · {priority}" status pill in Focus. Click-to-set via a small menu. No
  sidebar filter for priority this pass.

## Configuration page (Widget IA consolidation)

- New route/page **Configuration** that tabs between the existing `WidgetAppearance`,
  `WidgetInstallation`, and `WidgetGreetings` page components (reused as-is). Tabs use
  the existing `ui/tabs`. Lives under the Widget nav section alongside Home Screen and
  Quick Actions. Existing deep-link routes kept as redirects into the right tab.

## Build order

1. Token layer (`theme.css` + component utilities). **First, per user instruction.**
2. App shell / sidebar (`Layout.tsx`) + wallpaper + IA (Inbox/Workspace/Widget,
   Tickets unlinked, Configuration entry).
3. Schema + migration (one migration): `system` role (§4) + `snoozedUntil` (§5) +
   `priority` (§6); ChatService event writers + visitor-read filter; snooze/priority API.
4. List pane.
5. Reading pane (header → thread → composer).
6. Keyboard handling.
7. Focus view.
8. Configuration consolidation page.

## Non-goals / deferred

- Category, sentiment, AI summary cards (no data — omitted; rows show flag + name only).
- Full per-page reskin of non-inbox pages (they inherit shell + wallpaper; Configuration
  only wraps existing pages in tabs, no internal reskin).
- Deleting the Tickets feature/table/route (only unlinked from nav this pass).
- Snooze scheduler/notifications (lazy wake only); priority has no sidebar filter.
- Light-mode glass fidelity.
- Command palette (`⌘K`), Tab-accept, `⌘↵` send wiring (visual only this pass).

## Open questions

None — all resolved. ("Flagged" = spam-closed; block/ban is an action. Category &
sentiment omitted; **snooze + priority added**. Tickets unlinked from nav (not deleted).
Widget consolidated under a new **Configuration** tab page. System events ride the
`system` message role.)
