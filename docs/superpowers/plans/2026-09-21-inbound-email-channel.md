# Inbound email channel implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Read `AGENTS.md` first and follow it. There is no test suite in this repo (no `*.test.ts`, no `test` script) — do not add mocked DOM or component tests. Validate with `bun run lint`, `bunx tsc -b --force`, and real browser / real email verification.

**Goal:** Support emails sent to a tenant's own address (`support@acme.com`, forwarded to ReplyMaven) land as conversations in the dashboard, Maven answers them in an email-appropriate voice, attachments are preserved, and the outbound email template is rewritten text-first.

**Architecture:** Inbound mail arrives at `{slug}@updates.replymaven.com` (directly, or forwarded from any tenant address). The project is resolved from the **envelope recipient only**; forward headers label the originating address but never pick the tenant. A new headless turn runner executes Maven outside the WebSocket path. Conversation channel lives in `metadata`, so there is no Agent SQLite migration.

**Scope out:** per-tenant sending domains (replies come from `{slug}@updates.replymaven.com`), HTML-fidelity inbound/outbound rendering, Telegram/Slack as customer channels, outbound event webhooks.

---

## Global constraints

- Bun only. Never npm or yarn.
- Follow the **UI rules** in `AGENTS.md`. They are hard rules: no separators or divider borders, no long descriptions, no accordions, no `Sparkles`, design tokens only, radius tracks height, `inset-ring-*` over `border-*`, every action needs visible feedback.
- Function declarations for named functions and components. Arrow functions only for inline callbacks.
- No nested ternaries. Prefer `??` over `||`.
- Never hand-write a SQL migration or edit `meta/_journal.json`. Edit `worker/db/schema.ts`, then `bun run db:generate`, then confirm the generated SQL covers every change.
- The public WebSocket turn (`handlePublicChatMessage`) is not modified. The email path gets its own headless runner.
- Only the envelope recipient may resolve a project. `To:`, `Cc:`, `Delivered-To` and friends are attacker-controlled.
- Widget behaviour must be byte-identical after this work. Every new prompt/adapter path takes a channel argument that defaults to today's behaviour.

---

## Verified findings this plan depends on

Confirmed by reading code and by querying the live Resend account. Re-verify anything that looks stale before relying on it.

| Finding | Evidence |
|---|---|
| Cold email is dropped today | `worker/index.ts:2325` logs `inbound_email.unroutable` and returns ok |
| `getRecentByVisitorEmail` has no recency window — returns the newest non-archived conversation for that address at any age or status | `worker/agents/maven/conversation-directory.ts:363`; the handler then reopens it at `worker/index.ts:2417` |
| Our outbound `Message-ID` does not survive. Resend sends via Amazon SES, which overwrites it | Set at `worker/services/email-service.ts:503`; a real reply carried `In-Reply-To: <...@email.amazonses.com>`. The `In-Reply-To` lookup at `worker/index.ts:2282` has never matched anything; every reply actually routes via the quoted-dashboard-link fallback in `worker/services/inbound-email-routing.ts` |
| The webhook payload already carries `subject`, `message_id` and `attachments[]`, all discarded | `ReceivedEmailEventData` in `node_modules/resend/dist/index.d.mts`; handler reads only `email_id`, `from`, `to` at `worker/index.ts:2094` |
| Gmail quote stripping never fires | `worker/index.ts:2246` tests `/^On .+ wrote:$/i`, which needs `wrote:` on the same line. Gmail wraps it onto the next line. Confirmed in a real received message |
| No signature stripping at all | Real inbound messages carry full signature blocks and legal disclaimers into the bubble |
| Public turns are socket-only | `worker/agents/maven/maven-chat-agent.ts:1196` rejects anything without a visitor connection claim. `appendVisitorMessage` (line 2183) only persists, it does not run a turn |
| A headless full-Maven turn already exists as precedent | `worker/chat-runtime/contact-support/run-contact-support-follow-up.ts` runs `runMavenTurn`, collects visible text, persists via `addPublicBotMessageIfOwnershipMatches`, meters billing |
| `buildChannelContract()` is hardcoded to `Channel: public` and takes no arguments | `worker/chat-runtime/prompt/build-support-system-prompt.ts:22` |
| The client cannot tell an email message from a widget one | `adaptPublicMessage` never maps `origin`, `readMetadata` never validates it — `src/lib/inbox/public-message-adapter.ts:96` |
| Attachments are images-only end to end | `imageUrls` in `shared/maven-conversation.ts:23`; upload route allows JPEG/PNG/WebP at 5MB max, `worker/index.ts:1029` |
| Retention only sweeps `imageUrls` | `worker/services/conversation-retention-service.ts:108` |
| `/api/uploads/:key` has no auth and caches `public, max-age=31536000, immutable` | `worker/index.ts:8128` |
| Attachment `download_url` is valid for **1 hour**; the attachment itself persists, so a retry can request a fresh URL | Resend receiving/attachments docs |
| Resend receiving is a catch-all: "You will receive emails sent to any address at your Resend domain" | Resend receiving docs. Plus-addressing is not named explicitly — **verify in Phase 0** |
| `ExpandableToolCard` is already built on Popover | `src/components/tools/ExpandableToolCard.tsx:4` |
| `toolAudienceSchema` enforces `.min(1)` | `worker/validation.ts:698` — blocks turning both audiences off |
| `sanitize-html` is already a dependency and already runs in the Worker | `worker/helpdesk-render/render-markdown.ts:621` |

---

### Phase 0: Verify mail behaviour before building

Both routing decisions depend on observed behaviour. Do not skip.

- [ ] **Step 1: Plus-addressing test.** Send to `{someslug}+ctest@updates.replymaven.com`. Confirm the webhook fires and record exactly what `data.to` contains.
- [ ] **Step 2: Forwarding test.** Set a forwarding rule from a real mailbox to `{someslug}@updates.replymaven.com`, send through it, then dump the full `headers` map from `resend.emails.receiving.get(emailId)`.
- [ ] **Step 3: Record the answers.** Specifically: is `data.to` the envelope recipient or the `To:` header, and which of `Delivered-To` / `X-Forwarded-To` / `X-Original-To` / `Resent-To` is present on a forwarded message.

**Decision gate:** if plus-addressing does not deliver, reply routing falls back to a quiet `ReplyMaven ref: {conversationId}` line in the email body. That pattern is already parsed by `worker/services/inbound-email-routing.ts:10`.

---

### Phase 1: Schema and shared types

**Files:**
- Modify: `worker/db/schema.ts`
- Modify: `shared/maven-conversation.ts`
- Generate: `worker/db/drizzle/*`

- [ ] **Step 1: `project_inbound_addresses` table.** Columns: `id`, `projectId` (FK, cascade delete), `address` (lowercase text), `label`, `ignored` (integer boolean, default false), `firstSeenAt`, `lastSeenAt`, plus the standard `createdAt`/`updatedAt`. Unique index on `(projectId, address)`, index on `projectId`. Export `ProjectInboundAddressRow` / `NewProjectInboundAddressRow`.

  Rows are created by **discovery**, when mail arrives. There is no add form.

- [ ] **Step 2: `project_settings.inboundEmailEnabled`.** Integer boolean, default false. Inbound email is opt-in per project so existing tenants do not suddenly receive conversations from stray mail.

- [ ] **Step 3: Message attachments.** Add `attachments: Array<{ url: string; filename: string; contentType: string; size: number }>` to `PublicMessageRecord` and `PublicMessageMetadata` in `shared/maven-conversation.ts`, alongside the existing `imageUrls`. Default `[]` everywhere so existing records stay valid.

- [ ] **Step 4:** `bun run db:generate`, then read the generated SQL and confirm it covers both schema changes. A column added without a matching migration only fails in production.

**Conversation channel is not a column.** It lives in conversation `metadata` as `channel: "widget" | "email"`, `subject`, and `inboundAddress`. The directory already stores `metadata_json` and parses it into every summary (`worker/agents/maven/conversation-directory.ts:97`), so the inbox gets it with no Agent SQLite migration. If a proper inbox channel filter is wanted later, promote `channel` to a directory column using the existing `ALTER TABLE` pattern at `conversation-directory.ts:871`.

---

### Phase 2: Inbound routing and content cleaning

**Files:**
- Modify: `worker/services/inbound-email-routing.ts`
- Create: `worker/services/inbound-email-content.ts`
- Create: `worker/services/inbound-address-service.ts`
- Modify: `worker/index.ts` (the `/api/webhooks/inbound-mail` handler, currently lines ~2022–2653)

- [ ] **Step 1: Recipient resolution.** Add `resolveInboundRecipient({ payload, headers })` to `inbound-email-routing.ts`. Build a candidate list from `data.to`, `Delivered-To`, `X-Forwarded-To`, `X-Original-To`, `Resent-To`, then `To:` and `Cc:`. Match each against `{slug}[+c{conversationId}]@updates.replymaven.com` and against the address table.

  **Only the envelope recipient resolves the project.** Header candidates label the originating address and nothing more. Routing on a bare `To:` header would let anyone inject messages into any tenant's inbox by forging it.

- [ ] **Step 2: Use the SDK for the fetch.** Replace the raw `fetch` to `https://api.resend.com/emails/receiving/{id}` with `resend.emails.receiving.get(emailId)`. Keep the existing 502-on-failure behaviour so Resend retries and the failure stays visible. The response is typed with `html`, `text`, `headers`, `message_id`, `subject`, `attachments[]`, so the defensive header normalisation at `worker/index.ts:2167` can go.

- [ ] **Step 3: Read the discarded fields.** `subject`, `message_id`, `attachments` from the payload at `worker/index.ts:2094`. Store `message_id` on the message record so `References` can be rebuilt as the thread grows — Resend's docs require accumulating every previous `message_id`, space separated, not just the last.

- [ ] **Step 4: Content cleaning module.** `inbound-email-content.ts` exports `stripQuotedReply(text)` and `stripSignature(text)`.
  - Quote stripping must handle Gmail's wrapped attribution. The current regex at `worker/index.ts:2246` needs `wrote:` on the same line; Gmail puts it on the next, so it never fires and the attribution line lands in the message.
  - Signature stripping cuts at the RFC 3676 `-- ` delimiter and trims trailing legal boilerplate.
  - Move the existing inline loop out of the route handler into this module.

- [ ] **Step 5: Address discovery.** `inbound-address-service.ts` upserts the originating address on every inbound message, touching `lastSeenAt`. Mail to an unregistered address is still accepted — the envelope recipient already proves the message belongs to that tenant, so a customer emailing an alias nobody registered must never vanish.

- [ ] **Step 6: Conversation resolution order.** In the handler, after the existing lookups fail:
  1. plus-addressed conversation id from the recipient
  2. `ReplyMaven ref:` in the body
  3. an **open** conversation for that sender touched within **7 days** (the existing `getRecentByVisitorEmail` has no window and must be bounded)
  4. otherwise create one

- [ ] **Step 7: Conversation creation.** Gated on `inboundEmailEnabled`. Runs after the ban check (`VisitorBanService.isVisitorBanned`) and a per-sender-address rate limit. Resolve a customer by email with `CustomerIdentityService.resolveCustomer`, creating one when absent. Visitor id is `email:<hash of projectId + address>` so `customer_visitors` continuity keeps working. Write `channel`, `subject`, `inboundAddress` into conversation metadata.

- [ ] **Step 8:** `bun run lint` and `bunx tsc -b --force`.

---

### Phase 3: Maven answers, channel-aware

**Files:**
- Create: `worker/chat-runtime/orchestration/run-channel-turn.ts`
- Modify: `worker/chat-runtime/types.ts`
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.ts`
- Modify: `worker/index.ts` (inbound handler)
- Modify: `worker/services/email-service.ts`

- [ ] **Step 1: Headless turn runner.** Model `run-channel-turn.ts` closely on `worker/chat-runtime/contact-support/run-contact-support-follow-up.ts`, which already does exactly this job for the contact form: builds history via `normalizeConversationHistory`, calls `runMavenTurn`, collects visible text through the streaming strip helpers, persists with `addPublicBotMessageIfOwnershipMatches` against an ownership snapshot, then meters with `incrementMessageUsageOnce`.

  Do **not** modify `handlePublicChatMessage`. Consolidating the two turn paths is a separate job.

- [ ] **Step 2: Channel on prompt options.** Add `channel?: "widget" | "email"` to `SupportPromptOptions` (`worker/chat-runtime/types.ts:41`).

- [ ] **Step 3: Channel contract.** `buildChannelContract()` (`build-support-system-prompt.ts:22`) takes the channel. The email variant instructs: one complete answer rather than a chat-sized fragment because a round trip costs hours not seconds; greet by name; sign off; at most one clarifying question, answered as far as possible alongside rather than blocking on it; write links as full URLs; no chat conventions.

  Widget callers pass `widget` and the emitted prompt must be unchanged from today.

- [ ] **Step 4: Outbound delivery.** After the bot message persists, send it with `sendAgentMessageEmail` and call `markEmailed`. Subject becomes `Re: {original subject}`. `In-Reply-To` is the customer's stored `message_id` and `References` accumulates every prior one, per Resend's documented pattern. Drop `Precedence: bulk` (`email-service.ts:512`) for direct replies — `Auto-Submitted: auto-generated` alone prevents loops, and `bulk` hurts deliverability.

- [ ] **Step 5: Reply routing anchor.** Send with `Reply-To: {slug}+c{conversationId}@updates.replymaven.com` (or the `ReplyMaven ref:` body line if Phase 0 ruled plus-addressing out). This must land **before** Phase 6 removes the dashboard link, which is the current routing anchor.

- [ ] **Step 6:** `bun run lint` and `bunx tsc -b --force`.

---

### Phase 4: Attachments

**Files:**
- Create: `worker/services/inbound-attachment-service.ts`
- Modify: `worker/index.ts`
- Modify: `worker/services/conversation-retention-service.ts`
- Modify: `worker/conversations/*` as needed for the new message field

- [ ] **Step 1: Fetch and store.** `resend.emails.receiving.attachments.get({ emailId, id })` returns a `download_url` valid one hour. Copy during webhook processing inside `waitUntil`. **Stream** into R2 (`env.UPLOADS.put(key, response.body)`) — never buffer, Workers have a 128MB memory ceiling and inbound mail has no documented size limit.

- [ ] **Step 2: Key layout.** Reuse `{projectId}/conversation-attachments/{conversationId}/{uuid}.{ext}` with `customMetadata.ownerType = "conversation"`, matching the widget upload route at `worker/index.ts:1066`, so retention already recognises them.

- [ ] **Step 3: Inline images.** Attachments carrying a `content_id` are `cid:` references from inside the body, not real attachments. Map those onto `imageUrls` so they render inline. Everything else goes to `attachments`.

- [ ] **Step 4: Caps.** 25MB per file, 40MB per message. Record skipped files on the message so an agent reading "see attached" is not left guessing.

- [ ] **Step 5: Retry.** On copy failure the attachment still exists on Resend's side, so a retry requests a fresh `download_url`. Only the URL expires.

- [ ] **Step 6: Retention.** `listMessageAttachments` in `conversation-retention-service.ts:108` reports only `imageUrls`. Add the new attachment keys. Without this, purged conversations leave orphaned R2 objects forever.

- [ ] **Step 7: Authenticated serving for non-images.** `/api/uploads/:key` (`worker/index.ts:8128`) has no auth and caches `public, max-age=31536000, immutable`. That is an accepted trade-off for chat images because the widget has no session, and wrong for invoices, contracts and signed documents. Add a session-authenticated project-scoped route for non-image attachments. Images keep the existing public path.

- [ ] **Step 8:** `bun run lint` and `bunx tsc -b --force`.

---

### Phase 5: Dashboard

**Files:**
- Modify: `src/lib/inbox/public-message-adapter.ts`
- Modify: `src/components/inbox/MessageBubble.tsx`
- Modify: `src/pages/Tools.tsx`

- [ ] **Step 1: Thread `origin` and `attachments` through the adapter.** `readMetadata` (`public-message-adapter.ts:65`) does not validate `origin` and `adaptPublicMessage` (line 96) does not map it, so the client currently cannot distinguish an email message from a widget one. Add both fields.

- [ ] **Step 2: Meta line.** The row already exists at `MessageBubble.tsx:174` rendering `{senderLabel} · {time} · {status}` at `text-[11px] text-ink-7`, with a `Mail` icon precedent. Add one segment for email messages:

  ```
  Jonny Shipman · via support@acme.com · 13:27
  ```

  Widget messages stay exactly as they are. Naming the default channel is noise.

- [ ] **Step 3: Attachment chips** under the bubble, using existing primitives.

- [ ] **Step 4: Email card on the Tools page.** Reuse `ExpandableToolCard` like the Telegram and Slack presets — it is already a Popover, so no new component. Card row carries the on/off switch and a `Configure ›` text button with a **right** chevron only.

  Popover content:

  ```
  Forward to
  [ acme@updates.replymaven.com              ⧉ ]
  Add this in Google Workspace or Microsoft 365.

  Addresses
    support@acme.com      Receiving · 2h    ⋯
    help@acme.com         Receiving · 3d    ⋯
    billing@acme.com      New               ⋯
  ```

  One description line total — where to paste the address is the one thing the tenant will actually go looking for. No other subtitles. Empty state: `Nothing yet. Addresses appear here as mail arrives.` The `⋯` menu offers Ignore, which moves the row to a muted Ignored state rather than deleting it, so the action has a visible result.

  Do **not** copy two things from the Telegram card: it flips `ChevronDown`/`ChevronRight` (`ExpandableToolCard.tsx:42`) and it nests an `Accordion` for help text (`Tools.tsx:1671`). Both break the current UI rules.

- [ ] **Step 5:** Verify in the real authenticated browser at the affected route and viewport. Exercise the interaction. Do not infer from a successful build.

---

### Phase 6: Email template rewrite

**Files:**
- Modify: `worker/services/email-service.ts`

Current shape: grey page tint, a 480px shell at `border-radius: 24px`, the message nested inside a *second* grey card at `border-radius: 18px`, under a coloured "{agent} replied" banner, above a pill CTA. The message is the least prominent element in its own email.

- [ ] **Step 1: Rewrite `wrapEmail` (line 71) and `sendAgentMessageEmail` (line 443).** Remove the page tint, the shell radius, the nested card, the banner and the pill button. 560px measure, 16px/1.6, left aligned, message text directly on the page. The tenant accent survives as the link colour only. One muted footer line.

- [ ] **Step 2: Keep what works.** The dark-mode block, the `data-ogsc`/`data-ogsb` Outlook.com handling and the `<!--[if mso]>` conditional all stay.

- [ ] **Step 3: Update `htmlToText` (line 124).** It only understands the markup these templates emit. A multipart message with a matching plain-text part scores materially better with spam filters, so this must not silently degrade.

- [ ] **Step 4: Remove `— ReplyMaven Team`** from tenant-facing mail. Your brand should not sign your tenants' support replies. It stays on platform mail (OTP, welcome, team invites, billing).

- [ ] **Step 5: Remove the "View Conversation" button** from visitor-facing mail. It links to `/app/projects/.../conversations/...`, which the recipient cannot open. Only safe once Phase 3 Step 5 has moved routing to the reply address.

- [ ] **Step 6:** Send real mail to a real inbox and check rendering in Gmail (light and dark), Apple Mail and Outlook.

---

### Phase 7: Tools policy fields cleanup

Independent of everything above. Can land first.

**Files:**
- Modify: `src/pages/Tools.tsx`
- Modify: `worker/validation.ts`

- [ ] **Step 1: Strip the descriptions** in `ToolPolicyFields` (`Tools.tsx:430`). Remove the `Availability` heading and its line, the two per-row helper sentences, and the Access description. Each restates its own label. The Webhook URL help line stays — where to find that URL is genuinely non-obvious.

- [ ] **Step 2: Remove forced selection.** Drop the empty-array guard in `updateAudience` (`Tools.tsx:445`) and the `disabled={isOnlyAudience}` on the switch (line 473). A switch that silently refuses to move reads as broken.

- [ ] **Step 3: Relax the schema.** Drop `.min(1)` from `toolAudienceSchema` (`worker/validation.ts:698`), or the save returns 400. Zero audiences is coherent: `getEnabledToolsForChannel` filters by channel, so a tool with no channels is simply never offered to Maven.

- [ ] **Step 4: Switch size.** It renders `size="sm"` (14×24px) inside a `min-h-10` row against a two-line label. Use the default (18×32px). With descriptions gone each row is a single `text-sm` line and the weights balance.

- [ ] **Step 5: Replace the Access `Select`** with a third switch row, `Can make changes` — off is read, on is write, which is exactly equivalent since `write` is a superset. A 112px dropdown under two switches is a third control shape in a three-row list.

- [ ] **Step 6: Drop the `rounded-xl bg-muted/20 p-4` wrapper.** It existed to group a titled region; with the title gone it is an arbitrary box. Spacing does the job.

Result:

```
Webhook URL *
[ https://discord.com/api/webhooks/...          ]
Channel settings → Integrations → Webhooks → New Webhook, then copy the URL.

Available to visitors                       ●──
Available in sidechat                       ──○
Can make changes                            ──○

[ Save ]
```

- [ ] **Step 7:** Verify in the real authenticated browser.

---

## Final validation

- [ ] `bun run lint`
- [ ] `bunx tsc -b --force` (plain `tsc -b` is incremental and reports success off a stale cache)
- [ ] `bun run build`
- [ ] Forward a real email from a real mailbox. Confirm the conversation appears in the inbox with its subject as the title.
- [ ] Confirm Maven's reply arrives, reads like an email rather than a chat message, and threads under the original in Gmail.
- [ ] Confirm an attachment round-trips and opens from the dashboard.
- [ ] Reply to Maven's message and confirm it lands on the same conversation.
- [ ] Confirm the widget is unchanged: send a widget message and check the transcript, prompt behaviour and meta line all match pre-change behaviour.
- [ ] Report any pre-existing lint or type failures separately from new ones.

## Deployment

Ask before deploying. Push to `main` auto-deploys the worker, but D1 migrations are manual — run `bun run db:migrate:prod` or production 500s on the missing columns.
