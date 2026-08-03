# Marketing Positioning and Feature Pages

**Date:** 2026-08-03
**Status:** Approved in conversation

## Goal

Reposition ReplyMaven around one concrete business promise: excellent support creates customers who stay, recommend the product, and bring in more customers. Prove that promise with less daily support work, a fast human inbox, a self-maintaining help center, action-taking AI, and MCP access to customer conversations.

The new marketing copy must be short, specific, and product-led. It must not read like an essay or explain the product as a long process.

## Audience

The primary audience is founder-led and lean SaaS teams that need to support customers without spending the day in a support queue or hiring a large customer-support team.

## Positioning

### Primary promise

> Turn support into a word-of-mouth growth engine.

### Concrete outcome

ReplyMaven reduces the routine support work that reaches a founder or support team. Maven answers from company knowledge, takes approved actions, and brings in a human only for high-stakes conversations that require judgment.

### Market framing

Use Helply's outcome-led positioning pattern as strategic inspiration, not as copy to reproduce. Lead with completed work, name recognizable support tasks, and use product capabilities as proof. ReplyMaven's distinct proof points are:

- A keyboard-first inbox designed to be cleared quickly.
- A built-in help center powered by the same knowledge as Maven.
- Actions that retrieve live data, trigger workflows, escalate conversations, and create Linear or GitHub issues.
- MCP access that brings real support conversations into AI-assisted product planning.
- High-confidence human handoff with customer context and prior resolution attempts.

Do not reuse Helply's wording, visual identity, revenue-signal claims, pricing claims, or customer metrics.

## Copy rules

- No em dashes in customer-facing copy.
- No long editorial paragraphs.
- Keep supporting paragraphs to one or two short sentences.
- Prefer concrete nouns and verbs: refunds, upgrades, bugs, account changes, create, pull, resolve, escalate.
- Avoid placeholders such as "sharp outcome," "delightful experience," "powerful platform," and "seamless workflow."
- Headlines sell an outcome. Supporting copy names the work ReplyMaven performs.
- Do not add unverified statistics or invented customer proof.
- Use **ReplyMaven** for the platform and **Maven** for the AI support hire.

## Public site architecture

The public marketing surface will include:

- `/` for the primary positioning and product overview.
- `/ai-agent` for Maven's answers, actions, and high-stakes handoff.
- `/inbox` for the keyboard-first human support workflow.
- `/help-center` for public documentation and automated maintenance.
- `/actions` for data lookups, workflows, escalations, Linear, and GitHub.
- `/mcp` for bringing support conversations into external AI workflows.

Every feature page uses the same marketing header, footer, CTA behavior, typography, spacing, and responsive layout as the homepage.

## Homepage design

### 1. Hero

**Headline**

> Turn support into a word-of-mouth growth engine.

**Description**

> Hand troubleshooting, upgrades, refunds, account changes, and repetitive questions to your new AI support hire. Maven learns your docs and product, takes action for customers, and brings you in only when the stakes are high and judgment is needed.

**Primary CTA:** Start free trial  
**Secondary CTA:** See ReplyMaven in action

The existing inbox product visual remains the primary hero proof.

### 2. Inbox and help-center proof

Place this section immediately below the hero. Use two large product blocks rather than a paragraph-led statement section.

#### Inbox

**Title**

> Go through your support inbox in minutes

**Description**

> ReplyMaven gives you the context and helps draft the reply. Browse, research, draft, and resolve in one screen, without reaching for your mouse.

Use the existing Focus View screenshot. Highlight keyboard navigation, customer context, drafting, and resolution without turning the copy into a feature checklist.

#### Help center

**Title**

> Keep your help center up to date, on autopilot

**Description**

> Reduce support-related churn. Write and maintain helpful docs with ReplyMaven's built-in help center. Maven keeps articles current and suggests additions and refreshes.

Use a help-center editor or published help-center visual. The visual should show a suggested refresh or addition, not a generic article list.

### 3. Actions

**Title**

> Give Maven the tools to finish the job

**Description**

> Connect ReplyMaven to your product and support stack. Maven pulls live customer data, triggers workflows, escalates urgent requests, and creates Linear or GitHub issues with the full conversation attached.

**Proof points**

- **Pull customer data:** Check accounts, orders, subscriptions, and product status before replying.
- **Take action:** Process upgrades, refunds, account changes, and custom workflows through product APIs.
- **Escalate with context:** Send high-stakes cases to the team with customer history and resolution attempts attached.
- **Create product tickets:** Turn confirmed bugs into Linear or GitHub issues without copying the conversation by hand.

Use one large action timeline showing a customer request, data lookup, completed action, and final reply. Place supported integration marks below the timeline.

### 4. High-stakes handoff

**Title**

> Maven knows when to bring you in

**Description**

> Set the guardrails. Maven resolves routine work and hands high-stakes conversations to your team with the customer history, what it found, and what it already tried.

Use a compact before-and-after handoff visual. Avoid a procedural step list.

### 5. MCP

**Title**

> Turn support tickets into product decisions

**Description**

> Bring real customer conversations into Claude, Cursor, and other MCP clients. Find recurring problems, prioritize feature requests, update your knowledge base, and reply to customers from the same workflow.

**Proof points**

- **Ask across support:** Find what blocks upgrades, creates churn risk, or produces repeat tickets.
- **Spot product patterns:** Group bugs and feature requests by frequency, customer, and urgency.
- **Close the loop:** Update support knowledge and reply to affected customers from the same AI workflow.

Show a prompt pulling conversations from ReplyMaven with three outputs: a product decision, a Linear or GitHub issue, and updated documentation.

### 6. Pricing, FAQ, and closing CTA

Keep the current pricing data and authenticated CTA behavior. Rewrite surrounding copy to follow the new voice rules. The FAQ should answer objections directly and avoid explaining internal implementation details unless they establish trust.

The closing CTA repeats the primary promise and starts a trial. It does not introduce a new slogan.

## Feature-page structure

Each feature page contains five compact parts:

1. Outcome-led hero with one product visual.
2. Three or four concrete jobs the feature completes.
3. One realistic customer scenario shown inside the product.
4. Links to two related feature pages.
5. Trial CTA using the homepage promise.

### AI agent page

Lead with the work Maven completes: troubleshooting, account questions, plan changes, refunds, and configured product actions. Show high-confidence resolution and human handoff as one continuous experience.

### Inbox page

Lead with the approved "Go through your support inbox in minutes" copy. Prove it with Focus View, keyboard navigation, customer context, AI drafting, priority, snooze, and resolution.

### Help-center page

Lead with the approved "Keep your help center up to date, on autopilot" copy. Show authoring, suggestions, publishing, branded delivery, and the shared knowledge used by Maven.

### Actions page

Lead with the approved "Give Maven the tools to finish the job" copy. Show data retrieval, API actions, escalations, Linear, GitHub, Slack, Discord, automation webhooks, and custom HTTP tools.

### MCP page

Lead with the approved "Turn support tickets into product decisions" copy. Show conversation discovery, cross-conversation analysis, replies, and knowledge updates from an MCP client.

## Component design

Refactor the public marketing UI into reusable components rather than duplicating the current monolithic landing page:

- `MarketingShell` owns the page background and shared structure.
- `MarketingHeader` owns navigation, session-aware actions, and the mobile menu.
- `MarketingFooter` owns product, resource, and legal links.
- `MarketingHero` renders the eyebrow, headline, description, CTAs, and optional product visual.
- `MarketingSection` provides consistent section width and spacing.
- `FeatureProof` pairs concise copy with a screenshot or code-native product mock.
- `RelatedFeatures` links feature pages without repeating their full descriptions.
- `MarketingCta` reuses the current authentication and onboarding flow.
- `useMarketingMetadata` sets each route's title, description, and canonical URL.

Use spacing and subtle surface contrast between sections. Do not use horizontal rules or row-separator borders.

## Responsive behavior

- Copy precedes product proof on small screens.
- Two-column sections stack into one column.
- Product screenshots remain legible and may use focused crops on narrow screens.
- Navigation exposes every feature page through an accessible mobile menu.
- CTA labels and core claims remain unchanged across breakpoints.

## Accessibility

- Preserve semantic heading order.
- Give every product image meaningful alternative text.
- Keep navigation and CTAs keyboard accessible.
- Respect reduced-motion preferences.
- Maintain readable contrast for muted marketing copy.

## Verification

- Run the repository's lint, type-check, test, and production build commands.
- Smoke-test `/`, `/ai-agent`, `/inbox`, `/help-center`, `/actions`, and `/mcp` directly and through client-side navigation.
- Verify logged-out and logged-in CTA behavior.
- Capture desktop and mobile screenshots for every public marketing route.
- Review every rendered page for overflow, unreadable screenshots, duplicate copy, em dashes, long paragraphs, and unsupported claims.

## Out of scope

- Adding new backend action integrations or MCP tools.
- Building the help-center suggestion engine itself.
- Publishing or deploying the site.
- Inventing customer testimonials, logos, metrics, or ROI claims.
