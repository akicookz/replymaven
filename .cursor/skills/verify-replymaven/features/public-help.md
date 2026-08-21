# Public help center

Visitors read published help at `/docs` (ReplyMaven's own project, slug `replymaven`) or `/help/:projectSlug` for a tenant. The Worker renders HTML. Body and headings use the same widget font.

## Sub-features

- `help-home` shows `How can we help?` on `/docs`.
- `help-search` submits the searchbox `Search help center`.
- `help-theme` toggles dark mode via `Toggle dark mode`.

## How to get to it (user POV)

- Open `/docs` or `/help/replymaven` (same project; `/docs` rewrites internally).
- Open `/help/lovablehtml` for the test-widget tenant.
- Type in the search field. The rendered form action is the production canonical URL (`https://replymaven.com/docs/search`). Local proof opens `GET /docs/search?q=widget` on the instance under test.
- Use the theme button in the top bar.

## Driving it with verify.mjs

Preconditions:

- Doctor passes, including `GET /docs` 200.
- Local D1 contains the `replymaven` project with at least the help index (empty categories still render the heading).

- **Open home.** Run `bun .cursor/skills/verify-replymaven/scripts/verify.mjs drive help`. The page heading is `How can we help?`. Title contains `Help Center` or the project name. Screenshot: `evidence/help/before.png`.
- **Search.** Confirm the searchbox `Search help center` is present, then open `GET /docs/search?q=widget` on the local origin (the form action attribute is `https://replymaven.com/docs/search`). The page lists D1 title/excerpt hits first and an Explain box. Notes record the search meta line (`N results for "widget"`, `Looking for matching articles…`, or `No results for "widget"`). Screenshot: `evidence/help/after.png`.
- **Theme.** Click `Toggle dark mode`. `html` gains or loses class `dark`. Record the class before and after.

## Gotchas

- `/docs` canonical links and the search form action point at `https://replymaven.com/docs` even locally. Drive search with `GET /docs/search?q=...` on `VERIFY_BASE`.
- Custom help domains are not this recipe.
- `font-optical-sizing` and family checks belong in `help-widget-font`, not here.
- Help HTML is edge-cached with a 60s browser TTL. After a font or article save, hard-reload. Search stays uncached.
