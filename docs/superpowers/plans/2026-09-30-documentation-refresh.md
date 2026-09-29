# Documentation refresh implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. User approved implementation on 2026-09-30.

**Goal:** Correct the audited documentation and remove the LaunchFast.shop attribution and copyright footer row.

**Architecture:** Keep reviewed Markdown articles under docs/help-center using the live category/article slugs. Preserve live URLs and useful existing content. Help-center records are separate from application deployment. Prepare complete reviewable content before any publication decision.

**Tech Stack:** Markdown, existing React marketing shell, existing help-center editor and API.

**Spec:** The completed documentation audit at /Users/akbar/.codex/visualizations/2026/09/29/01a0ee56-5d97-75a2-9ea2-ffd3493d9019/documentation-audit/documentation-audit.md and the user's footer removal request.

## Global constraints

- No tests may be written. Use static validation, lint, build, and browser click-through.
- No push, pull, deployment, or migrations.
- Delegate implementation to capable cheaper models. Commit by logical checkpoint, with no attribution.
- Preserve factual content; validate audit corrections against current code. Do not claim unverified behavior.
- No UI redesign, new controls, new borders, or dependencies.

## Review focus

Check widget return types, ownership and reply routing, per-tool scope exceptions, help-center publication behavior, and external email provider instructions. Validate links and distinguish local source updates from live published content.

### Task 1: Footer

- [x] Trace MarketingFooter uses and remove the attribution/copyright row and unused Heart import; remove spacing belonging only to that row.
- [x] Browser click-through on landing and another marketing route at desktop and mobile widths.
- [x] Commit footer checkpoint after validation (`fef3c08`).

### Task 2: Widget and related article sources

- [x] Copy and revise published articles for getting-started, widget-api, visitor-identity, customization, advanced, and integrations/contact-form using identical slugs.
- [x] Add greeting/event tracking guidance. Preserve valid current content.
- [x] Review examples and commit documentation checkpoint (`b824a15`).

### Task 3: MCP and knowledge/help-center sources

- [x] Revise all MCP and knowledge-base articles; include all 34 tools and five scopes, practical parameters and precise confirmation behavior.
- [x] Add help-center authoring, organization, settings and search guides. Record category descriptions separately.
- [x] Review against source and commit documentation checkpoint (`9cae928`).

### Task 4: Conversations, channels, and contributor guide

- [x] Revise conversations and remaining integration articles. Add Slack/account linking and private Maven thread guidance.
- [x] Correct factual contributor guide drift without changing user rules.
- [x] Review against source. Slack scopes, install sequence, visitor invocation syntax, email exclusion, and Telegram group privacy instructions were corrected after review.
- [x] Commit documentation checkpoint (`1690d97`).

### Task 5: Integration and delivery

- [x] Account for all 40 existing articles and new articles in a manifest/readme. Local sources contain 49 articles: 40 updates and 9 new articles.
- [x] Validate Markdown, internal links, code examples and rendered footer. Typecheck, build, and browser checks passed. Lint had 0 errors and 17 existing warnings.
- [x] Preserve final local checkpoints. The final scoped review and all 49 rendered articles passed validation.
- [ ] Publish reviewed article updates. ReplyMaven MCP is configured but its tools are not available in this chat. No deployment or publication is claimed.
