# Liquid-Glass Dashboard Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the ReplyMaven dashboard into the macOS "Liquid Glass" Apple-Mail language — a full-viewport, translucent, three-pane keyboard-first inbox — built on a reusable glass design-token layer, plus snooze/priority/system-event features.

**Architecture:** A namespaced glass token layer extends the existing shadcn token system in `src/theme.css` (accent flips orange→Apple blue). The app shell (`Layout.tsx`) becomes a translucent sidebar over a wallpaper gradient with new Inbox/Workspace/Widget IA. `Conversations.tsx` is rebuilt into focused inbox components (list, reading pane, composer, focus view) that reuse the existing data/WS/Copilot layer. Three new conversation data points (`system` message role, `snoozedUntil`, `priority`) land in one Drizzle migration.

**Tech Stack:** Bun · React 19 + React Router 7 · TanStack Query · Tailwind v4 (`@theme inline`) · shadcn/ui (new-york) · lucide-react · Hono on Cloudflare Workers · Drizzle ORM + D1.

**Spec:** `docs/superpowers/specs/2026-06-28-liquid-glass-dashboard-design.md`
**Design reference:** `~/Downloads/design_handoff_replymaven_inbox 2/` — open `ReplyMaven Mail.dc.html` in a browser to compare pixel-for-pixel; `README.md` has every value.

## Global Constraints

- **Bun only** — never npm/yarn. Commands: `bun run build`, `bun run lint`, `bun run dev`, `bun run db:generate`, `bun run db:migrate:dev`.
- **No commits unless the user explicitly asks** (project rule). Suggested commit messages are given per task; do **not** run `git commit` on your own. Never co-author commits.
- **Never hand-write SQL migrations** — generate via `bun run db:generate` after editing `worker/db/schema.ts`.
- **No test framework exists.** Verify each task with: `bun run build` (tsc typecheck + vite build), `bun run lint`, and — for UI — `bun run dev` + side-by-side comparison with the handoff HTML. Do NOT add a test runner.
- **Cloudflare Workers-compatible only** — no Node-only APIs, no JSDOM at runtime.
- **Design-system values are tokens; layout uses utilities.** No inline rgba/hex colors anywhere in components, and no design-system value (glass surfaces, blur, text-ramp ink, core radii row/glass/bubble/card/keycap) inline — those reference tokens/`.glass-*` utilities defined in `src/theme.css`/`src/index.css`. One-off layout (paddings, positional offsets, column widths, the focus card's 18px radius) MAY use Tailwind utilities including arbitrary `[Npx]` where the handoff is pixel-specific — this is how shadcn itself works.
- **No dividers/borders to separate regions** — use spacing, translucent fills, elevation. The only hairline allowed is the `.5px` message-list row separator.
- **Read any file start-to-finish before editing it.**
- **Accent is Apple blue `#0a84ff`.** Category/sentiment are omitted (no data). Snooze, priority, and `system` events are real.

---

## File Structure

**Tokens / global CSS**
- `src/theme.css` — MODIFY: flip accent to blue; add glass token layer + `@theme inline` registrations.
- `src/index.css` — MODIFY: add `.glass-*`, `.keycap`, `.system-pill` component utilities; set `body` wallpaper; retire `.glow-surface*` usage in new surfaces.

**Shell**
- `src/components/Layout.tsx` — MODIFY: glass sidebar, traffic-light header, Inbox/Workspace/Widget IA, Tickets unlinked, Configuration entry, account row (no separator), wallpaper shell.

**Data layer (Worker)**
- `worker/db/schema.ts` — MODIFY: `messages.role` += `"system"`; `conversations` += `snoozedUntil`, `priority`.
- `worker/services/chat-service.ts` — MODIFY: `addSystemMessage`; filter `system` from visitor reads; extend list query + counts for inbox filters; snooze/priority setters.
- `worker/validation.ts` — MODIFY: `snoozeSchema`, `prioritySchema`.
- `worker/index.ts` — MODIFY: snooze + priority endpoints; emit system events at handoff/join/auto-suggest/snooze; pass inbox filter to list query.

**Inbox UI (new components)**
- `src/lib/inbox/filters.ts` — CREATE: filter definitions + types.
- `src/lib/inbox/country-flag.ts` — CREATE: ISO country code → emoji.
- `src/lib/inbox/system-events.ts` — CREATE: event-kind → dot color + label helpers.
- `src/components/inbox/MessageList.tsx` — CREATE: Col 2.
- `src/components/inbox/ConversationRow.tsx` — CREATE: one list row.
- `src/components/inbox/ReadingPane.tsx` — CREATE: Col 3 shell (scroll container).
- `src/components/inbox/ReadingHeader.tsx` — CREATE: sticky toolbar + user bar.
- `src/components/inbox/ChatThread.tsx` — CREATE: date dividers + bubbles + system pills.
- `src/components/inbox/MessageBubble.tsx` — CREATE: one bubble.
- `src/components/inbox/SystemPill.tsx` — CREATE: one centered event pill.
- `src/components/inbox/Composer.tsx` — CREATE: draft pill + actions.
- `src/components/inbox/FocusView.tsx` — CREATE: stacked-card focus mode.
- `src/components/inbox/PriorityMenu.tsx` — CREATE: click-to-set priority.
- `src/pages/Conversations.tsx` — MODIFY (rebuild orchestrator): owns layout, selection, `view` state, keyboard, data wiring; renders the components above.

**IA consolidation**
- `src/pages/Configuration.tsx` — CREATE: tabbed shell over Appearance/Installation/Greetings.
- `src/App.tsx` — MODIFY: add `/configuration` route; redirect old widget routes into tabs.

---

## Phase A — Foundation (tokens + shell)

### Task 1: Glass token layer + accent flip

**Files:**
- Modify: `src/theme.css`
- Modify: `src/index.css`

**Interfaces:**
- Produces (Tailwind utilities consumed by every later task): color utilities `bg-glass-sidebar|list|reading|bar|button|raised|focus|peek-1|peek-2`, `bg-bubble-received|sent`, `bg-dot-{green,orange,yellow,gray,blue}`, `text-ink-1..8`, `text-brand-label`, `text-brand-label-human`, `border-hairline`, `border-hairline-strong`; radii `rounded-row|glass|bubble|card|keycap`; component classes `.glass-sidebar .glass-list .glass-reading .glass-bar .glass-button .glass-focus .keycap .system-pill`; `body` carries the wallpaper.

- [ ] **Step 1: Flip the accent + add glass tokens in `src/theme.css`.** In the `:root` block, change the brand scale and add the glass layer. Replace the three brand lines:

```css
  /* Apple-blue accent scale (was orange) */
  --brand: #0a84ff;
  --brand-dark: #0060df;
  --brand-soft: #409cff;
  --brand-label: #5ea2ff;        /* Maven / AI sent-bubble label */
  --brand-label-human: #9ad0ff;  /* human agent sent-bubble label */
```

Then, still inside `:root`, append the glass layer:

```css
  /* ─── Liquid-Glass layer ─────────────────────────────────────────── */
  --wallpaper-base: #0b0c0f;
  --glass-sidebar: rgba(28, 28, 32, 0.52);
  --glass-list: rgba(24, 24, 27, 0.78);
  --glass-reading: rgba(20, 20, 23, 0.72);
  --glass-bar: rgba(22, 22, 26, 0.5);
  --glass-button: rgba(255, 255, 255, 0.07);
  --glass-raised: rgba(255, 255, 255, 0.12);
  --glass-focus: rgba(37, 38, 44, 0.96);
  --glass-peek-1: rgba(48, 49, 56, 0.92);
  --glass-peek-2: rgba(43, 44, 51, 0.94);

  --blur-panel: 40px;
  --blur-bar: 24px;

  --hairline: rgba(255, 255, 255, 0.07);
  --hairline-strong: rgba(255, 255, 255, 0.16);
  --hairline-inset: rgba(255, 255, 255, 0.1);

  --ink-1: #ffffff;
  --ink-2: #f5f5f7;
  --ink-3: #e5e5ea;
  --ink-4: #c7c7cc;
  --ink-5: #aeaeb2;
  --ink-6: #98989d;
  --ink-7: #8e8e93;
  --ink-8: #6e6e73;

  --dot-green: #30d158;
  --dot-orange: #ff9f0a;
  --dot-yellow: #ffd60a;
  --dot-gray: #98989d;
  --dot-blue: #0a84ff;

  --bubble-received: rgba(118, 118, 128, 0.28);
  --bubble-sent: #0a84ff;

  --rad-row: 9px;
  --rad-glass: 9px;
  --rad-bubble: 20px;
  --rad-card: 15px;
  --rad-keycap: 4px;
```
> **Note:** radius source vars use a `--rad-*` prefix so they don't collide with Tailwind's `--radius-*` theme namespace (registered in Step 2). Blur stays as `--blur-panel`/`--blur-bar` — consumed only inside the `.glass-*` utilities via `var()`, so it is NOT registered as a Tailwind utility.

- [ ] **Step 2: Register the tokens as Tailwind utilities in the `@theme inline` block of `src/theme.css`.** Append inside the existing `@theme inline { … }`:

```css
  /* Glass surfaces → bg-glass-* / etc. */
  --color-glass-sidebar: var(--glass-sidebar);
  --color-glass-list: var(--glass-list);
  --color-glass-reading: var(--glass-reading);
  --color-glass-bar: var(--glass-bar);
  --color-glass-button: var(--glass-button);
  --color-glass-raised: var(--glass-raised);
  --color-glass-focus: var(--glass-focus);
  --color-glass-peek-1: var(--glass-peek-1);
  --color-glass-peek-2: var(--glass-peek-2);
  --color-bubble-received: var(--bubble-received);
  --color-bubble-sent: var(--bubble-sent);

  --color-hairline: var(--hairline);
  --color-hairline-strong: var(--hairline-strong);

  --color-ink-1: var(--ink-1);
  --color-ink-2: var(--ink-2);
  --color-ink-3: var(--ink-3);
  --color-ink-4: var(--ink-4);
  --color-ink-5: var(--ink-5);
  --color-ink-6: var(--ink-6);
  --color-ink-7: var(--ink-7);
  --color-ink-8: var(--ink-8);
  --color-brand-label: var(--brand-label);
  --color-brand-label-human: var(--brand-label-human);

  --color-dot-green: var(--dot-green);
  --color-dot-orange: var(--dot-orange);
  --color-dot-yellow: var(--dot-yellow);
  --color-dot-gray: var(--dot-gray);
  --color-dot-blue: var(--dot-blue);

  /* Radii → rounded-row / rounded-bubble / … (source vars are --rad-*) */
  --radius-row: var(--rad-row);
  --radius-glass: var(--rad-glass);
  --radius-bubble: var(--rad-bubble);
  --radius-card: var(--rad-card);
  --radius-keycap: var(--rad-keycap);
```
> Do **not** register `--blur-*` here — blur is applied only inside the `.glass-*` component utilities via `backdrop-filter: blur(var(--blur-panel))`, so it needs no Tailwind utility.

- [ ] **Step 3: Add component utilities + wallpaper in `src/index.css`.** After the `@layer base { … }` block, add a components layer:

```css
@layer components {
  /* Wallpaper lives on body; panes are translucent over it. */
  body {
    background-color: var(--wallpaper-base);
    background-image:
      radial-gradient(90% 80% at 6% -5%, rgba(58, 96, 142, 0.55), transparent 60%),
      radial-gradient(80% 90% at 102% 8%, rgba(104, 64, 132, 0.5), transparent 55%),
      radial-gradient(80% 80% at 60% 110%, rgba(40, 92, 104, 0.42), transparent 60%);
    background-attachment: fixed;
  }

  .glass-sidebar { background: var(--glass-sidebar); backdrop-filter: blur(var(--blur-panel)); }
  .glass-list { background: var(--glass-list); backdrop-filter: blur(var(--blur-panel)); }
  .glass-reading { background: var(--glass-reading); backdrop-filter: blur(var(--blur-panel)); }
  .glass-bar { background: var(--glass-bar); backdrop-filter: blur(var(--blur-bar)); }

  .glass-button {
    background: var(--glass-button);
    box-shadow: inset 0 0 0 0.5px var(--hairline-inset);
    transition: background 0.12s;
  }
  .glass-button:hover { background: var(--glass-raised); }

  .glass-focus {
    background: var(--glass-focus);
    backdrop-filter: blur(var(--blur-bar));
    box-shadow: inset 0 0 0 0.5px var(--hairline-strong);
  }

  .keycap {
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--glass-raised);
    border-radius: var(--rad-keycap);
    font-size: 10.5px; font-weight: 600; color: var(--ink-4);
    min-width: 17px; height: 17px; padding: 0 4px;
  }

  .system-pill {
    display: inline-flex; align-items: center; gap: 6px;
    background: rgba(255, 255, 255, 0.05);
    box-shadow: inset 0 0 0 0.5px var(--hairline);
    border-radius: 20px; padding: 5px 13px;
    font-size: 11.5px; color: var(--ink-6);
  }
}
```

- [ ] **Step 4: Typecheck + build.** Run: `bun run build`
Expected: build succeeds (tsc + vite), no errors.

- [ ] **Step 5: Visual smoke check.** Run `bun run dev`, open the app. Existing primary buttons/links (e.g. the user menu, a shadcn `Button`) should now render **blue** instead of orange (proves the accent flip propagated through `--primary`). The page background should show the soft wallpaper gradient.

Suggested commit (only if user asks): `feat(tokens): add liquid-glass token layer and flip accent to apple blue`

---

### Task 2: Glass app shell + sidebar IA (`Layout.tsx`)

**Files:**
- Modify: `src/components/Layout.tsx` (read fully first)

**Interfaces:**
- Consumes: Task 1 utilities (`.glass-sidebar`, `bg-glass-raised`, `border-hairline`, `text-ink-*`).
- Produces: a sidebar with three sections whose Inbox items deep-link to `…/conversations?filter=<id>` (filter ids from `src/lib/inbox/filters.ts`, Task 7 — until then use string literals `needs-you|all|snoozed|resolved|flagged`).

- [ ] **Step 1: Rebuild the sidebar container + header.** Change the `<aside>` classes from `bg-sidebar` to `glass-sidebar border-r border-hairline`, width `md:w-[248px]`. Replace the logo row with the macOS chrome: three decorative traffic-light dots + wordmark.

```tsx
{/* macOS chrome */}
<div className="flex items-center gap-2 px-4 h-12">
  <span className="flex items-center gap-[6px]" aria-hidden>
    <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
    <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
    <span className="w-3 h-3 rounded-full bg-[#28c840]" />
  </span>
  <Link to="/app" className="text-[13px] font-semibold text-ink-2">ReplyMaven</Link>
</div>
```
(The traffic-light hexes are a macOS-standard decorative element, not theme tokens — acceptable inline per the spec's icon/asset note.)

- [ ] **Step 2: Replace `mainNav`/`widgetNav` with the three new sections.** Update the nav data:

```tsx
const inboxNav = currentProject ? [
  { label: "Needs You",         filter: "needs-you", icon: Inbox },
  { label: "All Conversations", filter: "all",       icon: Mail },
  { label: "Snoozed",           filter: "snoozed",   icon: Clock },
  { label: "Resolved",          filter: "resolved",  icon: CheckCircle2 },
  { label: "Flagged",           filter: "flagged",   icon: Flag },
].map((i) => ({ ...i, href: `/app/projects/${currentProject.id}/conversations?filter=${i.filter}` })) : [];

const workspaceNav = currentProject ? [
  { label: "Dashboard",     href: `/app/projects/${currentProject.id}`,              icon: LayoutDashboard, exact: true },
  { label: "Knowledgebase", href: `/app/projects/${currentProject.id}/knowledgebase`, icon: FolderOpen, badge: suggestionCountsData?.total ?? 0 },
  { label: "Help Center",   href: `/app/projects/${currentProject.id}/help`,          icon: BookOpen },
] : [];

const widgetNav = currentProject ? [
  { label: "Configuration", href: `/app/projects/${currentProject.id}/configuration`, icon: Palette },
  { label: "Home Screen",   href: `/app/projects/${currentProject.id}/widget/home`,    icon: Home },
  { label: "Quick Actions", href: `/app/projects/${currentProject.id}/quick-actions`,  icon: Zap },
] : [];
```
Import `Inbox`, `Mail`, `Flag` from `lucide-react` (add to the existing import). **Remove** the `Ticket`/`MessageSquare`/`Megaphone`/`Code` nav usages (Tickets unlinked; Conversations now lives in the Inbox section; Greetings/Installation move under Configuration).

- [ ] **Step 3: Render the three sections with uppercase headers + per-row counts.** Add a `SectionHeader` (11px/600 uppercase `text-ink-7`) and update `NavLink` so the active row uses `bg-glass-raised text-ink-1` with the icon + count tinted `text-[--brand]` (instead of `glow-surface-subtle`). Inbox rows show a right-aligned count (`text-ink-7`, blue when active); active state matches by the `filter` query param via `useSearchParams`. Workspace/Widget rows show no count (except Knowledgebase badge).

- [ ] **Step 3b: Fetch inbox counts for the badges.** The Layout needs the per-filter counts. Add a query mirroring the existing `suggestionCountsData` pattern, hitting the lightweight counts endpoint added in Task 5:

```tsx
const { data: inboxCounts } = useQuery<Record<string, number>>({
  queryKey: ["inbox-counts", currentProject?.id],
  queryFn: async () => {
    const res = await fetch(`/api/projects/${currentProject!.id}/inbox-counts`);
    if (!res.ok) return {};
    return res.json();
  },
  enabled: !!currentProject,
  staleTime: 30_000,
});
```
Render each Inbox row's count as `inboxCounts?.[item.filter] ?? 0`. (Task 5 adds the endpoint; until then the badges render 0 — non-blocking.)

- [ ] **Step 4: Account row — remove the separator.** In the bottom user `<Popover>` block, delete the `border-t`/divider above it (no-dividers rule). Keep the avatar/name/email/chevron. Leave the existing user menu contents intact.

- [ ] **Step 5: Main content shell.** The `<main>` stays `flex-1 overflow-y-auto`, but remove the hard `bg-background` from the root `div` so the body wallpaper shows through; root becomes `flex h-screen` (no bg). Non-inbox pages keep their `p-4 md:p-8` padding.

- [ ] **Step 6: Build + lint.** Run: `bun run build && bun run lint`
Expected: both pass.

- [ ] **Step 7: Visual check.** `bun run dev` → sidebar is translucent over the wallpaper, three sections render, traffic lights + wordmark up top, active row is blue-tinted on a raised glass fill, account row has no line above it. Compare to the handoff sidebar.

Suggested commit: `feat(shell): liquid-glass sidebar with inbox/workspace/widget IA`

---

## Phase B — Data layer (one migration + service + API)

### Task 3: Schema — `system` role, `snoozedUntil`, `priority`

**Files:**
- Modify: `worker/db/schema.ts` (read the `messages` and `conversations` tables first)
- Generates: `drizzle/` migration (via `db:generate`)

**Interfaces:**
- Produces: `messages.role` ∈ `visitor|bot|agent|system`; `conversations.snoozedUntil: Date|null`; `conversations.priority: "low"|"medium"|"high"` (default `"medium"`).

- [ ] **Step 1: Add `system` to the messages role enum.** In `worker/db/schema.ts`, change:

```ts
role: text("role", { enum: ["visitor", "bot", "agent", "system"] }).notNull(),
```

- [ ] **Step 2: Add the two conversation columns.** In the `conversations` table, after `visitorLastOnlineAt`:

```ts
snoozedUntil: integer("snoozed_until", { mode: "timestamp" }),
priority: text("priority", { enum: ["low", "medium", "high"] })
  .notNull()
  .default("medium"),
```

- [ ] **Step 3: Generate the migration.** Run: `bun run db:generate`
Expected: a new file appears under `drizzle/` (e.g. `00NN_*.sql`) altering `messages`/`conversations`. Do NOT edit it by hand.

- [ ] **Step 4: Apply locally.** Run: `bun run db:migrate:dev`
Expected: migration applies to the local D1 with no error.

- [ ] **Step 5: Typecheck.** Run: `bun run build`
Expected: passes; `ConversationRow`/`MessageRow` inferred types now include the new fields.

Suggested commit: `feat(db): add system message role, snoozedUntil, priority`

---

### Task 4: ChatService — system writes, visitor filter, inbox filters

**Files:**
- Modify: `worker/services/chat-service.ts` (read methods at lines 36–92, 495–585 first)

**Interfaces:**
- Consumes: Task 3 schema.
- Produces:
  - `addSystemMessage(conversationId: string, kind: SystemEventKind, content: string): Promise<MessageRow>`
  - `SystemEventKind = "flagged" | "joined" | "snoozed" | "snooze_ended" | "drafted"` (exported)
  - `setSnooze(conversationId, projectId, until: Date | null): Promise<void>`
  - `setPriority(conversationId, projectId, priority): Promise<void>`
  - `getConversationsByProject(..., inboxFilter?: InboxFilter)` extended; `getInboxCounts(projectId): Promise<Record<InboxFilter, number>>`
  - `InboxFilter = "needs-you" | "all" | "snoozed" | "resolved" | "flagged"` (exported)

- [ ] **Step 1: Export the event/filter types + add `addSystemMessage`.** System messages store the `kind` in `sources` (existing JSON column) and must NOT bump `lastActivityAt` (so a snooze doesn't reorder the list). Add near the top of the class file:

```ts
export type SystemEventKind = "flagged" | "joined" | "snoozed" | "snooze_ended" | "drafted";
export type InboxFilter = "needs-you" | "all" | "snoozed" | "resolved" | "flagged";
```

Method (does its own insert; no activity bump):

```ts
async addSystemMessage(
  conversationId: string,
  kind: SystemEventKind,
  content: string,
): Promise<MessageRow> {
  const id = crypto.randomUUID();
  const now = new Date();
  const sources = JSON.stringify({ systemKind: kind });
  await this.db.insert(messages).values({
    id, conversationId, role: "system", content, sources, createdAt: now,
  });
  return {
    id, conversationId, role: "system", content, sources,
    imageUrl: null, senderName: null, senderAvatar: null, userId: null,
    createdAt: now, emailedAt: null,
  };
}
```

- [ ] **Step 2: Filter `system` out of visitor-facing reads.** In `getMessages` and `getMessagesSince`, add `ne(messages.role, "system")` to the `where`. (`getMessagesBefore`/`getRecentMessages` are dashboard-only — leave them, so the dashboard sees system pills.) Ensure `ne` is imported from `drizzle-orm`.

`getMessages`:
```ts
.where(and(eq(messages.conversationId, conversationId), ne(messages.role, "system")))
```
`getMessagesSince`:
```ts
.where(and(
  eq(messages.conversationId, conversationId),
  ne(messages.role, "system"),
  gt(messages.createdAt, new Date(since)),
))
```

- [ ] **Step 3: Add snooze/priority setters.**

```ts
async setSnooze(conversationId: string, projectId: string, until: Date | null): Promise<void> {
  await this.db.update(conversations)
    .set({ snoozedUntil: until })
    .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)));
}

async setPriority(conversationId: string, projectId: string, priority: "low" | "medium" | "high"): Promise<void> {
  await this.db.update(conversations)
    .set({ priority })
    .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)));
}
```

- [ ] **Step 4: Extend the list query for inbox filters.** Add an optional `inboxFilter` param to `getConversationsByProject` (keep the existing `statusFilter` for back-compat callers). Build conditions:
  - `needs-you`: `eq(status,"waiting_agent")` AND (`isNull(snoozedUntil)` OR `lte(snoozedUntil, now)`)
  - `snoozed`: `gt(snoozedUntil, now)`
  - `resolved`: `eq(status,"closed")`
  - `flagged`: `eq(closeReason,"spam")`
  - `all`: `ne(status,"closed")` (open) — matches the handoff "All Conversations" = active queue

```ts
async getConversationsByProject(
  projectId: string, limit = 50, offset = 0,
  statusFilter: "open" | "closed" | "all" = "all",
  searchQuery?: string,
  inboxFilter?: InboxFilter,
): Promise<ConversationRow[]> {
  const now = new Date();
  const conditions = [eq(conversations.projectId, projectId)];
  if (inboxFilter) {
    switch (inboxFilter) {
      case "needs-you":
        conditions.push(eq(conversations.status, "waiting_agent"));
        conditions.push(or(isNull(conversations.snoozedUntil), lte(conversations.snoozedUntil, now))!);
        break;
      case "snoozed": conditions.push(gt(conversations.snoozedUntil, now)); break;
      case "resolved": conditions.push(eq(conversations.status, "closed")); break;
      case "flagged": conditions.push(eq(conversations.closeReason, "spam")); break;
      case "all": conditions.push(ne(conversations.status, "closed")); break;
    }
  } else if (statusFilter === "open") {
    conditions.push(ne(conversations.status, "closed"));
  } else if (statusFilter === "closed") {
    conditions.push(eq(conversations.status, "closed"));
  }
  // … existing searchQuery block unchanged …
  // … existing select/order/limit/offset unchanged …
}
```
Import `isNull`, `lte` from `drizzle-orm` (alongside the existing `and, or, eq, ne, gt, lt, like, sql, desc`).

- [ ] **Step 5: Add `getInboxCounts`.** One grouped query for status + a `snoozed` count + a `flagged` count:

```ts
async getInboxCounts(projectId: string): Promise<Record<InboxFilter, number>> {
  const now = new Date();
  const [statusRows, snoozed, flagged] = await Promise.all([
    this.db.select({ status: conversations.status, count: sql<number>`count(*)` })
      .from(conversations).where(eq(conversations.projectId, projectId))
      .groupBy(conversations.status),
    this.db.select({ count: sql<number>`count(*)` }).from(conversations)
      .where(and(eq(conversations.projectId, projectId), gt(conversations.snoozedUntil, now))),
    this.db.select({ count: sql<number>`count(*)` }).from(conversations)
      .where(and(eq(conversations.projectId, projectId), eq(conversations.closeReason, "spam"))),
  ]);
  let waiting = 0, open = 0, closed = 0;
  for (const r of statusRows) {
    if (r.status === "waiting_agent") waiting = r.count;
    if (r.status !== "closed") open += r.count;
    if (r.status === "closed") closed = r.count;
  }
  return {
    "needs-you": waiting, all: open, snoozed: snoozed[0]?.count ?? 0,
    resolved: closed, flagged: flagged[0]?.count ?? 0,
  };
}
```
(Note: `needs-you` count is a simple `waiting_agent` count; the snoozed-exclusion refinement is applied in the list query, not the badge — acceptable, documented.)

- [ ] **Step 6: Typecheck.** Run: `bun run build`
Expected: passes.

Suggested commit: `feat(chat-service): system messages, visitor filter, inbox filters`

---

### Task 5: Worker endpoints — snooze, priority, list filter, event emission

**Files:**
- Modify: `worker/validation.ts` (follow the existing zod schema style, e.g. `banVisitorSchema`)
- Modify: `worker/index.ts` (list endpoint ~6120; close ~6717; ban ~6777; copilot auto-suggest ~6690–6715)

**Interfaces:**
- Consumes: Task 4 service methods.
- Produces routes: `POST …/conversations/:convId/snooze {until:number|null}`; `PATCH …/conversations/:convId/priority {priority}`; list endpoint accepts `?filter=<InboxFilter>`.

- [ ] **Step 1: Validation schemas** in `worker/validation.ts`:

```ts
export const snoozeSchema = z.object({ until: z.number().int().positive().nullable() });
export const prioritySchema = z.object({ priority: z.enum(["low", "medium", "high"]) });
```

- [ ] **Step 2: List endpoint reads `?filter`.** In the `GET /api/projects/:id/conversations` handler (~6131), parse and pass through, and swap counts to the inbox shape:

```ts
const inboxFilter = c.req.query("filter") as InboxFilter | undefined;
// pass inboxFilter as the 6th arg to getConversationsByProject(...)
// replace getConversationCounts(project.id) with getInboxCounts(project.id)
```
Import `InboxFilter` type from the chat-service module. Keep the auto-close block guarded by `inboxFilter !== "resolved"` (don't auto-close while viewing resolved).

- [ ] **Step 3: Snooze endpoint.** Add after the `close` handler:

```ts
.post("/api/projects/:id/conversations/:convId/snooze", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");
  const projectService = new ProjectService(db);
  const project = await projectService.getProjectById(c.req.param("id"));
  if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id))
    return c.json({ error: "Not found" }, 404);
  const parsed = validate(snoozeSchema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const chatService = new ChatService(db);
  const convId = c.req.param("convId");
  const until = parsed.data.until ? new Date(parsed.data.until) : null;
  await chatService.setSnooze(convId, project.id, until);
  if (until) {
    await chatService.addSystemMessage(convId, "snoozed",
      `Snoozed until ${until.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
  } else {
    await chatService.addSystemMessage(convId, "snooze_ended", "Snooze ended");
  }
  return c.json({ ok: true });
})
```

- [ ] **Step 4: Priority endpoint.**

```ts
.patch("/api/projects/:id/conversations/:convId/priority", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");
  const projectService = new ProjectService(db);
  const project = await projectService.getProjectById(c.req.param("id"));
  if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id))
    return c.json({ error: "Not found" }, 404);
  const parsed = validate(prioritySchema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  await new ChatService(db).setPriority(c.req.param("convId"), project.id, parsed.data.priority);
  return c.json({ ok: true });
})
```

- [ ] **Step 4b: Inbox-counts endpoint** (powers the sidebar badges from `Layout.tsx`):

```ts
.get("/api/projects/:id/inbox-counts", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");
  const projectService = new ProjectService(db);
  const project = await projectService.getProjectById(c.req.param("id"));
  if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id))
    return c.json({ error: "Not found" }, 404);
  return c.json(await new ChatService(db).getInboxCounts(project.id));
})
```

- [ ] **Step 5: Emit "drafted" on auto-suggest.** In the copilot auto-suggest handler (the `handleCopilotTurn({…, isAutoSuggest: true})` route ~6690), after kicking off the draft add a system pill (best-effort, non-blocking):

```ts
c.executionCtx.waitUntil(
  new ChatService(db).addSystemMessage(c.req.param("convId"), "drafted",
    "Maven drafted a reply from KB").catch(() => {}),
);
```

- [ ] **Step 6: Emit "flagged" on bot→human handoff and "joined" on first agent reply.** Locate the handoff/escalation path (search `worker/` for where `status` becomes `"waiting_agent"`) and the agent-send path (where an `agent` message is created via `addMessage`). At the handoff transition, call `addSystemMessage(convId, "flagged", "Maven flagged this for human review")` once. On the first `agent` message for a conversation, call `addSystemMessage(convId, "joined", \`${agentName} joined the conversation\`)`. Guard "joined" so it fires once (only when the conversation has no prior `agent` message).

- [ ] **Step 7: Imports + typecheck.** Add `snoozeSchema, prioritySchema` to the validation import block in `worker/index.ts`. Run: `bun run build`
Expected: passes.

- [ ] **Step 8: Smoke test the API.** Run `bun run dev` (or `wrangler dev`), then exercise snooze/priority with the browser devtools network tab or curl while logged in; confirm `200 {ok:true}` and that a `system` row appears in the dashboard message list (next phase renders it) but NOT in the widget `/messages` payload.

Suggested commit: `feat(api): snooze + priority endpoints, inbox filter, system events`

---

## Phase C — Inbox UI

### Task 6: Inbox helpers (filters, country flag, system events)

**Files:**
- Create: `src/lib/inbox/filters.ts`
- Create: `src/lib/inbox/country-flag.ts`
- Create: `src/lib/inbox/system-events.ts`

**Interfaces:**
- Produces: `INBOX_FILTERS`, `InboxFilter`, `filterTitle(f)`; `countryFlag(code?: string): string`; `systemEventDot(kind): string` (a `bg-dot-*` class), `parseSystemKind(sources): SystemEventKind | null`.

- [ ] **Step 1: `filters.ts`.**

```ts
export type InboxFilter = "needs-you" | "all" | "snoozed" | "resolved" | "flagged";
export const INBOX_FILTERS: { id: InboxFilter; title: string }[] = [
  { id: "needs-you", title: "Needs You" },
  { id: "all", title: "All Conversations" },
  { id: "snoozed", title: "Snoozed" },
  { id: "resolved", title: "Resolved" },
  { id: "flagged", title: "Flagged" },
];
export function filterTitle(f: InboxFilter): string {
  return INBOX_FILTERS.find((x) => x.id === f)?.title ?? "Needs You";
}
```

- [ ] **Step 2: `country-flag.ts`** (ISO-3166 alpha-2 → regional-indicator emoji):

```ts
export function countryFlag(code?: string | null): string {
  if (!code || code.length !== 2) return "";
  const cc = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
```

- [ ] **Step 3: `system-events.ts`.**

```ts
export type SystemEventKind = "flagged" | "joined" | "snoozed" | "snooze_ended" | "drafted";
export function parseSystemKind(sources?: string | null): SystemEventKind | null {
  if (!sources) return null;
  try { return (JSON.parse(sources).systemKind as SystemEventKind) ?? null; } catch { return null; }
}
export function systemEventDot(kind: SystemEventKind | null): string {
  switch (kind) {
    case "flagged": return "bg-dot-orange";
    case "joined": return "bg-dot-blue";
    case "snooze_ended": return "bg-dot-green";
    case "drafted": return "bg-dot-blue";
    case "snoozed": default: return "bg-dot-gray";
  }
}
```

- [ ] **Step 4: Typecheck.** Run: `bun run build` → passes.

Suggested commit: `feat(inbox): filter/flag/system-event helpers`

---

### Task 7: Orchestrator data wiring (`Conversations.tsx`)

> Read the **entire** current `src/pages/Conversations.tsx` first. It already implements: list fetch (`/api/projects/:id/conversations`), `/updates` polling, `useConversationWs`, presence, `use-copilot`, message send, close. **Preserve all of it.** This task re-wires that data into the new layout shell; Tasks 8–13 supply the presentational pieces.

**Files:**
- Modify: `src/pages/Conversations.tsx`

**Interfaces:**
- Consumes: Task 6 helpers; the list endpoint now returns `{ conversations, counts: Record<InboxFilter,number>, … }`.
- Produces (props passed to child components): `selectedId`, `setSelectedId`, `view: "split"|"focus"`, `filter: InboxFilter`, `conversations`, `counts`, `messages`, send/close/snooze/priority/rewrite handlers (exact signatures below).

- [ ] **Step 1: Read `filter` from the URL and feed the list query.** Use `useSearchParams`; `const filter = (searchParams.get("filter") as InboxFilter) ?? "needs-you";`. Add `filter` to the list `queryKey` and append `&filter=${filter}` to the fetch URL. Surface `counts` from the response to the sidebar via the existing query cache (the sidebar reads the same `counts` shape — expose it through the query the Layout already runs, or lift counts into the list response consumed here).

- [ ] **Step 2: Replace the page's outer JSX with the 3-pane / focus switch.** Keep all hooks/handlers above the return. The return becomes:

```tsx
if (view === "focus" && selected) {
  return <FocusView conversation={selected} messages={messages}
    index={selectedIndex} total={conversations.length}
    onExit={() => setView("split")} onSend={handleSend}
    onResolve={handleResolve} onRewrite={handleRewrite} draft={draft} setDraft={setDraft} />;
}
return (
  <div className="flex h-screen min-w-0">
    <MessageList filter={filter} conversations={conversations} counts={counts}
      selectedId={selectedId} onSelect={setSelectedId}
      onResolve={handleResolve} onSnooze={handleSnooze} />
    {selected
      ? <ReadingPane conversation={selected} messages={messages}
          draft={draft} setDraft={setDraft}
          onSend={handleSend} onResolve={handleResolve} onSnooze={handleSnooze}
          onFlagSpam={handleFlagSpam} onPriority={handleSetPriority}
          onRewrite={handleRewrite} onFocus={() => setView("focus")} />
      : <div className="glass-reading flex-1 grid place-items-center text-ink-7 text-sm">
          Select a conversation
        </div>}
  </div>
);
```
(The empty state is a trivial inline element — no separate component needed.)

- [ ] **Step 3: Add the new handlers** (reuse existing close/send where present):
  - `handleSnooze(convId, until)` → `POST …/snooze {until}`, then invalidate list + messages queries.
  - `handleSetPriority(convId, priority)` → `PATCH …/priority {priority}`, invalidate detail.
  - `handleFlagSpam(convId)` → existing `POST …/close {closeReason:"spam"}`.
  - `handleResolve(convId)` → existing close with `{closeReason:"resolved"}`, then advance selection to the next item.
  - `handleRewrite()` → trigger the existing copilot auto-suggest and load its draft into `draft`.
  Keep `draft`/`setDraft` state pre-filled from the existing copilot auto-suggest (see current copilot usage).

- [ ] **Step 4: Build + lint.** Run: `bun run build && bun run lint` → pass (child components may be stubbed as `() => null` until their tasks land; create thin stubs now so the orchestrator compiles).

Suggested commit: `feat(inbox): orchestrator wiring for 3-pane + focus`

---

### Task 8: Message list + row (`MessageList.tsx`, `ConversationRow.tsx`)

**Files:**
- Create: `src/components/inbox/MessageList.tsx`
- Create: `src/components/inbox/ConversationRow.tsx`

**Interfaces:**
- Consumes: `filterTitle`, `countryFlag`; props from Task 7.
- Produces: `<MessageList>` (372px column), `<ConversationRow>`.

- [ ] **Step 1: `MessageList` shell.** `className="glass-list border-r border-hairline w-[372px] shrink-0 flex flex-col"`. Header: `filterTitle(filter)` (24px/700, `-0.5` tracking, `text-ink-1`) + subtitle "N open · M unread" (12px `text-ink-7`) + two `.glass-button` icon buttons (filter funnel, ellipsis). Search field: `h-[30px] rounded-[8px] glass-button` with a magnifier (`Search` icon) + "Search" placeholder + a `.keycap` showing `⌘K`. Body: `flex-1 overflow-y-auto px-2` mapping `conversations` → `<ConversationRow>`.

- [ ] **Step 2: `ConversationRow`.** Layout per handoff §2:
  - container `rounded-row px-[10px] pt-[9px] pb-[11px]`, hover `bg-glass-button`, selected `bg-bubble-sent`.
  - 9px left gutter holds an 8px unread dot `bg-dot-blue` (hidden when read or selected).
  - line 1: `countryFlag(meta.country)` + sender name (15px/600 `-0.2` tracking, `text-ink-2`; selected `text-white`) + right-aligned time (12px `text-ink-5`).
  - line 2: subject (13.5px, one line, `truncate`, `text-ink-3`).
  - line 3: preview (13px `text-ink-6`, `line-clamp-2`).
  - bottom hairline separator inset 28px left: a `0.5px` line `bg-hairline` (the ONLY allowed divider); hidden on selected.
  - hover-reveal quick actions top-right: two 26px `.glass-button` icons (Check = resolve, Clock = snooze), `opacity-0 group-hover:opacity-100`.
  - selected text ramp: name white, subject `text-white/95`, preview `text-white/80`, meta `text-white/70`.
  Derive subject/preview from `lastMessage`/conversation fields already present in the list payload.

- [ ] **Step 2b: Wire the unread + counts** using the existing presence/unread logic from the old page (port the helper). Subtitle counts come from `counts[filter]` + an unread tally.

- [ ] **Step 3: Build + visual.** `bun run build` then `bun run dev`. Compare a populated list to the handoff: flags render, selected row is solid blue, hover reveals the two actions, rows have no boxes/borders except the inset hairline.

Suggested commit: `feat(inbox): message list + conversation row`

---

### Task 9: Reading pane shell + header (`ReadingPane.tsx`, `ReadingHeader.tsx`, `PriorityMenu.tsx`)

**Files:**
- Create: `src/components/inbox/ReadingPane.tsx`
- Create: `src/components/inbox/ReadingHeader.tsx`
- Create: `src/components/inbox/PriorityMenu.tsx`

**Interfaces:**
- Consumes: props from Task 7; `countryFlag`.
- Produces: `<ReadingPane>` (one scroll container: sticky header → `<ChatThread/>` (Task 10) → sticky `<Composer/>` (Task 11)).

- [ ] **Step 1: `ReadingPane`.** `className="glass-reading flex-1 min-w-0 overflow-y-auto relative"`. Children in order: `<ReadingHeader … />` (sticky top), the thread, `<Composer … />` (sticky bottom). Both sticky elements use `.glass-bar` so bubbles scroll behind them.

- [ ] **Step 2: `ReadingHeader` — toolbar row.** `sticky top-0 z-[5] glass-bar`, padding `11px 22px`. Buttons are `.glass-button rounded-glass` with `text-ink-3` icons: Reply (back/reply arrow), a grouped capsule {Resolve = Check, Snooze = Clock, Flag-as-spam = Flag in `text-dot-orange`}, Assign (UserPlus + chevron). Right side: a **Focus** button (`.glass-button`, label "Focus" + `.keycap` F) wired to `onFocus`, then a 170px search field (`.glass-button rounded-[8px]`).

- [ ] **Step 3: `ReadingHeader` — user bar.** Padding `15px 30px 16px`. 44px round avatar (initials, tinted) · `countryFlag` + name (18px/600 `text-ink-1`) + verified badge (only if available) + email (12px `text-ink-7`) · meta line: status dot + "Open" + location + "In chat {duration}" + browser (all from `metadata`/timestamps, `text-ink-7`). Right: `<PriorityMenu value={priority} onChange={onPriority} />` rendering "Priority · {Medium}" (12px `text-ink-7`).

- [ ] **Step 4: `PriorityMenu`.** A shadcn `DropdownMenu` (already in `ui/`) with Low/Medium/High; trigger shows `Priority · {value}`; selecting calls `onChange`.

- [ ] **Step 5: Build + visual.** `bun run build` → `bun run dev`. Header is translucent; toolbar + user bar match the handoff; priority menu sets value and persists (reload shows it).

Suggested commit: `feat(inbox): reading pane shell + header + priority menu`

---

### Task 10: Chat thread (`ChatThread.tsx`, `MessageBubble.tsx`, `SystemPill.tsx`)

**Files:**
- Create: `src/components/inbox/ChatThread.tsx`
- Create: `src/components/inbox/MessageBubble.tsx`
- Create: `src/components/inbox/SystemPill.tsx`

**Interfaces:**
- Consumes: `messages` (includes `role:"system"` rows on the dashboard), `parseSystemKind`, `systemEventDot`, existing `renderMarkdown` from `@/lib/utils`.

- [ ] **Step 1: `ChatThread`.** Centered column `max-w-[760px] mx-auto px-[30px] pt-4 pb-[10px]`. Iterate messages; insert a **date divider** (centered 11px/600 uppercase `text-ink-8`, derived by comparing adjacent `createdAt` days, label "Tuesday"/"Yesterday"/"Today") when the day changes. For `role:"system"` rows render `<SystemPill>`; otherwise `<MessageBubble>`.

- [ ] **Step 2: `SystemPill`.** Centered `.system-pill` with a 6px dot (`systemEventDot(parseSystemKind(msg.sources))`) + `msg.content`.

- [ ] **Step 3: `MessageBubble`.** Small label row above the bubble (sender 12px/600 + time 11px `text-ink-8`). Received (`visitor`): left, `bg-bubble-received text-ink-2`, `rounded-[20px_20px_20px_6px]`. Sent (`agent`/`bot`): right, `bg-bubble-sent text-white`, `rounded-[20px_20px_6px_20px]`; label color `text-brand-label` for bot/Maven, `text-brand-label-human` for human agent. `max-w-[74%] px-[14px] py-[10px] text-[14.5px] leading-[1.5] whitespace-pre-wrap`. Body via `renderMarkdown` (reuse the existing `.prose-chat` wrapper used by the old page).

- [ ] **Step 4: Build + visual.** `bun run build` → `bun run dev`. Bubbles, tails, label colors, date dividers, and the system pills (orange/blue/gray/green dots) match the handoff thread.

Suggested commit: `feat(inbox): chat thread, bubbles, system pills`

---

### Task 11: Composer (`Composer.tsx`)

**Files:**
- Create: `src/components/inbox/Composer.tsx`

**Interfaces:**
- Consumes: `draft`, `setDraft`, `onSend`, `onResolve`, `onRewrite`.

- [ ] **Step 1: Composer.** Sticky `bottom-0 z-[5] glass-bar px-4 pt-3 pb-4`. Inner box `rounded-[20px] border border-hairline-strong bg-glass-button p-[14px_14px_11px_18px]`. An auto-growing `<textarea>` bound to `draft` (14.5px `text-ink-2`, transparent, no outline), pre-filled by the orchestrator from the Copilot auto-suggest. Action row: left paperclip (`.glass-button` 30px, attach); right group Rewrite (`.keycap` R) → `onRewrite`, Resolve (`.keycap` E) → `onResolve`, Send (32px round `bg-bubble-sent` up-arrow) → `onSend`.

- [ ] **Step 2: Auto-grow.** On input, set `textarea.style.height = "auto"; textarea.style.height = scrollHeight + "px"` (capped, e.g. `max-h-[200px] overflow-y-auto`).

- [ ] **Step 3: Build + visual.** `bun run build` → `bun run dev`. Composer is translucent, draft pre-fills, Send posts an agent message that appears as a right blue bubble; Rewrite repopulates the draft.

Suggested commit: `feat(inbox): composer with prefilled AI draft`

---

### Task 12: Keyboard handling

**Files:**
- Modify: `src/pages/Conversations.tsx`

**Interfaces:**
- Consumes: `selectedIndex`, `setSelectedId`, `view/setView`, `handleResolve`, `handleRewrite`.

- [ ] **Step 1: Add a global keydown effect** that ignores events when the target is an input/textarea/contenteditable:

```ts
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.matches?.("input, textarea, [contenteditable='true']")) return;
    if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); selectRelative(1); }
    else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); selectRelative(-1); }
    else if (e.key === "e" || e.key === "E") { if (selected) handleResolve(selected.id); }
    else if (e.key === "r" || e.key === "R") { handleRewrite(); }
    else if (e.key === "f" || e.key === "F") { setView((v) => (v === "focus" ? "split" : "focus")); }
    else if (e.key === "Escape") { setView("split"); }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [selected, conversations, view]);
```
`selectRelative(d)` clamps `selectedIndex + d` to `[0, conversations.length-1]` and sets the id.

- [ ] **Step 2: Build + manual.** `bun run build` → `bun run dev`. J/K move selection, E resolves + advances, R re-drafts, F toggles focus, Esc exits; typing in the composer does NOT trigger shortcuts.

Suggested commit: `feat(inbox): keyboard navigation (J/K/E/R/F/Esc)`

---

### Task 13: Focus view (`FocusView.tsx`)

**Files:**
- Create: `src/components/inbox/FocusView.tsx`

**Interfaces:**
- Consumes: `conversation`, `messages`, `index`, `total`, `onExit`, composer props, `countryFlag`.

- [ ] **Step 1: Layout per handoff v2 §4.** Root fills the main pane (the sidebar stays). Centered column `max-w-[680px] mx-auto pt-24`. **No top bar / no progress bar.** Exit button floats `absolute top-[18px] right-[30px]` — `.glass-button` "Exit Focus" + `.keycap` Esc → `onExit`.

- [ ] **Step 2: Stacked card.** Two peek slivers behind the top: `absolute` `top-[-9px] inset-x-[24px] h-5 rounded-t-[18px] bg-glass-peek-2` and `top-[-4px] inset-x-[13px] h-5 rounded-t-[18px] bg-glass-peek-1`. The card itself: `.glass-focus rounded-[18px] p-[22px_24px_18px] relative`.

- [ ] **Step 3: Card contents.** (1) User bar — 44px avatar, `countryFlag` + name (18px/600), email, right status pill "Open · {priority}" (a rounded `.glass-button` with a green status dot). (2) **Last 3 messages**: take the conversation's **first** message, then the two most recent; if there are skipped messages between, render a centered "···" gap marker between the first and the recent pair. Render each as a compact mini-bubble (`rounded-[16px]` with 5px tail, same color rules as `MessageBubble` but smaller padding). (3) Composer — reuse `<Composer>`.

- [ ] **Step 4: Below the card.** Left: count `"{index+1} of {total}"` in `text-[--brand]`. Right: keyboard legend — `.keycap` J `.keycap` K "next · prev", `.keycap` S "snooze", `.keycap` ⌘K "commands" (visual).

- [ ] **Step 5: Build + visual.** `bun run build` → `bun run dev`, press F. Compare to Image #3 / `ReplyMaven Mail.dc.html` focus state: single frosted stacked card, peeks visible, exit top-right, count + legend below.

Suggested commit: `feat(inbox): focus mode stacked-card view`

---

## Phase D — IA consolidation

### Task 14: Configuration page + routes

**Files:**
- Create: `src/pages/Configuration.tsx`
- Modify: `src/App.tsx` (read the routes block 144–260 first)

**Interfaces:**
- Consumes: existing default exports `WidgetAppearance`, `WidgetInstallation`, `WidgetGreetings`.

- [ ] **Step 1: `Configuration.tsx`** — a shadcn `Tabs` (from `@/components/ui/tabs`) with three tabs (Appearance / Installation / Greetings) rendering the existing page components. Tab state syncs to `?tab=`:

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import WidgetAppearance from "./WidgetAppearance";
import WidgetInstallation from "./WidgetInstallation";
import WidgetGreetings from "./WidgetGreetings";

export default function Configuration() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "appearance";
  return (
    <Tabs value={tab} onValueChange={(v) => setSp({ tab: v }, { replace: true })}>
      <TabsList>
        <TabsTrigger value="appearance">Appearance</TabsTrigger>
        <TabsTrigger value="installation">Installation</TabsTrigger>
        <TabsTrigger value="greetings">Greetings &amp; News</TabsTrigger>
      </TabsList>
      <TabsContent value="appearance"><WidgetAppearance /></TabsContent>
      <TabsContent value="installation"><WidgetInstallation /></TabsContent>
      <TabsContent value="greetings"><WidgetGreetings /></TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 2: Routes in `App.tsx`.** Add `import Configuration from "./pages/Configuration";`. Add a route `projects/:projectId/configuration` → `<Configuration />`. Convert the three old widget routes to redirects:
  - `projects/:projectId/widget` → `<Navigate to="../configuration?tab=appearance" replace />`
  - `projects/:projectId/widget/installation` → `…?tab=installation`
  - `projects/:projectId/widget/greetings` → `…?tab=greetings`
  Leave `widget/home` (Home Screen) and `quick-actions` as their own routes. Remove the Tickets nav entry already done in Task 2; the `tickets` route itself stays (non-destructive).

- [ ] **Step 3: Build + visual.** `bun run build && bun run lint` → pass. `bun run dev`: the Widget → **Configuration** nav item opens a tabbed page; old `/widget`, `/widget/installation`, `/widget/greetings` URLs redirect into the right tab.

Suggested commit: `feat(config): consolidate widget appearance/installation/greetings into Configuration tabs`

---

## Final verification (whole-feature)

- [ ] `bun run build` (full typecheck + vite) and `bun run lint` both clean.
- [ ] `bun run db:migrate:dev` applied; `bun run dev` boots.
- [ ] Side-by-side with `~/Downloads/design_handoff_replymaven_inbox 2/ReplyMaven Mail.dc.html` (split) and Image #3 (focus): sidebar, list rows (flag + name, no tags/city), reading pane (toolbar, user bar with Priority pill, bubbles, system pills), composer, and focus stacked-card all match.
- [ ] Functional pass: select via click + J/K; Resolve (E) advances; Rewrite (R) re-drafts; snooze writes a "Snoozed until…" pill and moves the convo into Snoozed; flag-as-spam moves it into Flagged; priority persists; the customer widget (`/api/widget/.../messages`) does **not** receive `system` rows.
- [ ] No inline rgba/hex/px in components (grep the new `src/components/inbox/**` for `rgba(`/`#`/`px]` — only token utilities/classes); no borders except the list-row hairline.

## Notes / deferred (from spec)

- Category, sentiment, AI summary cards: omitted (no data).
- `⌘K` palette, `Tab`-accept, `⌘↵` send: visual-only this pass.
- Snooze scheduler/notifications: lazy wake only (a snoozed convo re-surfaces when `snoozedUntil` passes, on next read).
- Tickets feature/table/route: only unlinked from nav; not deleted.
- Light-mode glass fidelity: not pursued (dark-first).
