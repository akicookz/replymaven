# Help and widget font

The widget catalog family in `widget_config.fontFamily` is the only font setting. Public help body and headings must use that same family. `system-ui` stays `system-ui`. There is no Inter/Switzer default split.

## Sub-features

- `config-font` reads `widget.fontFamily` from `GET /api/widget/:slug/config`.
- `help-tokens` reads `--font-sans` and `--font-heading` from that project's help HTML.
- `same-stack` proves the two CSS tokens are identical and match the config family.

## How to get to it (user POV)

- A visitor sees the widget font on the host site.
- The same visitor opens that project's help (`/help/:slug` or `/docs` for `replymaven`).

## Driving it with verify.mjs

Preconditions:

- Doctor passes.
- Slug `lovablehtml` exists (same as the test widget). Also check `/docs` (`replymaven`) in the same run.

- **Read config.** Run `bun .cursor/skills/verify-replymaven/scripts/verify.mjs drive font-contract`. For each slug (`lovablehtml`, `replymaven` via `/docs`): fetch config (or skip config for `/docs` by using slug `replymaven`), fetch help HTML.
- **Compare.** If `fontFamily` is `system-ui` or missing faces, help CSS contains `--font-sans: system-ui, sans-serif` and the same value for `--font-heading`. If it is a catalog file font (for example `Switzer`), both tokens contain `"Switzer"`. Notes: `evidence/font-contract/notes.txt`.
- **Proof.** Saving the raw `--font-sans` / `--font-heading` lines is required. A screenshot of help is extra (`evidence/font-contract/after.png`), not enough alone.

## Gotchas

- Dashboard marketing still uses Switzer headings in `src/theme.css`. That is not tenant help. Do not assert landing `font-heading` equals the widget.
- Help HTML can be cached 120 seconds. After a dashboard font save, wait or bypass cache.
- `Lato` in the database resolves to `Instrument Sans`. Assert the resolved name in CSS, not the stored alias.
- This recipe does not change `fontFamily`. It only reads.
