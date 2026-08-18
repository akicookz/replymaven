---
name: verify-replymaven
description: Drive the ReplyMaven web app (landing, public help, embeddable widget, widget config) the way a user does. Use when proving a UI or public-page change, checking help/widget font parity, or verifying the local Vite+Worker stack on port 5173.
---

# Verify ReplyMaven

ReplyMaven is a multi-tenant support product: a React dashboard, a public help center rendered by the Worker, and an embeddable chat widget. This skill drives those **user-facing surfaces**. Unit tests (`bun test`) are not a substitute.

Agents in this repo **must not run `bun run dev`**. A human starts the stack. The helper never starts or kills that process.

## Launch

Human-owned local stack (SPA + Worker API + help SSR):

```bash
bun install
bun run db:migrate:dev
bun run widget:build
bun run dev
```

Ready when the Vite log shows a local URL (default `http://127.0.0.1:5173/`) and `Test widget page: http://localhost:5173/test-widget.html`.

Optional, only if the proof needs a freshly rebuilt embed: `bun run widget:watch` in a second terminal. Do not upload the widget (`widget:upload` deploys to R2).

Env: `.dev.vars` must already exist (Better Auth, API keys). Do not create or print it. Local D1 is the Wrangler state under `.wrangler/` (`remote: false` on `DB`). R2/KV/AI bindings are remote.

Default base: `http://127.0.0.1:5173`. Override with `VERIFY_BASE`.

Teardown of the Vite process is the human's job. Verification cleanup never kills it.

## Doctor

Run this first whenever anything looks off:

```bash
bun .cursor/skills/verify-replymaven/scripts/verify.mjs doctor
```

It is read-only. It checks:

- `GET /` returns 200 and the landing heading `Frontline support for founding teams`
- `GET /docs` returns 200 and Help Center HTML (`How can we help?` or the project name)
- `GET /test-widget.html` returns 200 and `Widget Test Page`
- `GET /api/widget/lovablehtml/config` returns 200 JSON with a `widget` object
- Playwright is importable from `~/.preview-tools/node_modules/playwright`

Fail the run if doctor fails. Do not start a second server on 5173. Port 5173 and local D1 are shared: two drivers will collide.

## Drive

```bash
bun .cursor/skills/verify-replymaven/scripts/verify.mjs drive landing
bun .cursor/skills/verify-replymaven/scripts/verify.mjs drive help
bun .cursor/skills/verify-replymaven/scripts/verify.mjs drive widget
bun .cursor/skills/verify-replymaven/scripts/verify.mjs drive font-contract
```

Harness: Playwright Chromium from `~/.preview-tools` (same install as `bun ~/.preview-tools/shot.mjs`). The helper launches a browser, acts, writes evidence, then closes that browser.

Read `features/README.md`, then the matching feature file. Drive every listed entry point, or report the unmet precondition. Do not mark a skipped path as verified through a different path.

Stable handles (prefer these over coordinates):

| Surface | Handle |
|---|---|
| Landing heading | `role=heading` name `Frontline support for founding teams` |
| Log in | `role=button` name `Log in` |
| Auth dialog | `role=dialog` name `Welcome to ReplyMaven` |
| Google / GitHub | `role=button` name `Continue with Google` / `Continue with GitHub` |
| Docs link | `role=link` name `Docs` → `/docs` |
| Help search | `role=searchbox` name `Search help center` |
| Help theme | `role=button` name `Toggle dark mode` (`#rm-theme-toggle`) |
| Widget test page | `/test-widget.html` heading `Widget Test Page` |
| Widget launcher | `.rm-trigger` (no accessible name) |
| Open chat | `.rm-chat-window.open` |

Dashboard routes under `/app` need a Better Auth session (Google/GitHub). There is no password login and no test-only auth endpoint. Until `VERIFY_STORAGE_STATE` points at a Playwright `storageState` JSON the human exported, skip dashboard features and say so.

Do not click `Continue with Google` or `Continue with GitHub` in unattended runs. That leaves the real OAuth provider.

## Evidence

Proof directory (survives cleanup):

`.cursor/skills/verify-replymaven/evidence/`

Each drive writes `<feature>/before.png`, `<feature>/after.png`, and `<feature>/notes.txt` (URL, action, observed text, HTTP status). Font-contract also writes the config JSON snippet and the `--font-sans` / `--font-heading` declarations from help HTML.

Standards:

- Exercise the real user path (browser or public HTTP the widget/help actually use). Do not call dashboard `PUT` APIs to fake a UI save.
- Capture the action and the resulting state, not only the final screen.
- Widget font vs help font: `GET /api/widget/:slug/config` then the public help HTML. Mocks only if the feature file says to intercept config (greeting page-targeting), and the notes file must record that intercept.
- `bun test` passing is not UI proof.

## Cleanup

```bash
bun .cursor/skills/verify-replymaven/scripts/verify.mjs cleanup
```

Closes nothing the human started. Deletes no evidence. Only reminder: this run's Playwright browsers must already be closed by `drive` (the helper uses `try/finally`).

Never `killall`, never match on process name `vite` / `bun` / `workerd`.

## Helpers

All commands from the repo root. `verify.mjs` is executable.

```bash
bun .cursor/skills/verify-replymaven/scripts/verify.mjs doctor
bun .cursor/skills/verify-replymaven/scripts/verify.mjs drive <landing|help|widget|font-contract>
bun .cursor/skills/verify-replymaven/scripts/verify.mjs cleanup
```

Playwright lives in `~/.preview-tools`. If import fails, install there (`cd ~/.preview-tools && bun install`); do not add Playwright to this repo's `package.json`.
