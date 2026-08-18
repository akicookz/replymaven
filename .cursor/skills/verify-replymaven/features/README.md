# ReplyMaven verification map

This directory is the maintained source for verifying user-facing ReplyMaven behavior. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- A human has `bun run dev` serving `http://127.0.0.1:5173` (override with `VERIFY_BASE`).
- Local D1 has been migrated (`bun run db:migrate:dev`). Help and widget proofs also need the slugs already in that database: `replymaven` (docs) and `lovablehtml` (test widget).
- `public/widget-embed.js` exists (`bun run widget:build`). Gitignore tracks this as a local file.
- `bun .cursor/skills/verify-replymaven/scripts/verify.mjs doctor` passes.
- Agents did not start the Vite process and must not start a second one.
- Do not reset `.wrangler/state`, deploy, or `widget:upload`.

## Driving conventions

- Start from the baseline unless a feature file says otherwise.
- Prefer roles and accessible names. The widget launcher has none; use `.rm-trigger`.
- Treat helper commands as literal.
- Restore nothing in local D1 after a drive: these recipes do not write product data.
- Keep proof artifacts. Cleanup does not delete them.

## Proof and skip reporting

- Capture the user action and the resulting state.
- UI proof includes a screenshot plus `notes.txt` with the observed heading or dialog name.
- HTTP proof includes status, URL, and the field asserted.
- Record the feature ID with every artifact.
- Report an unreachable path with the command and the unmet precondition.
- Do not report a skipped dashboard path as verified via the public help page.

## Feature entry contract

Each feature file starts with an H1 and one paragraph, then exactly four H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify.mjs`, `Gotchas`.

## Features

- [Landing and sign-in](./landing-auth.md) covers the marketing page and the auth dialog. Default first drive.
- [Public help center](./public-help.md) covers `/docs`, search, and the theme toggle.
- [Embeddable widget](./embed-widget.md) covers `/test-widget.html` open/close.
- [Help and widget font](./help-widget-font.md) covers the shared `fontFamily` contract.
- [Dashboard appearance](./dashboard-appearance.md) covers the signed-in Font picker. Skip without `VERIFY_STORAGE_STATE`.
