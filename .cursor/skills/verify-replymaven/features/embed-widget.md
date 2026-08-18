# Embeddable widget

Site owners load `widget-embed.js` with `data-project`. Locally, `/test-widget.html` loads `/widget-embed.js` for slug `lovablehtml`. The launcher is a `.rm-trigger` button with no accessible name.

## Sub-features

- `widget-load` mounts `.rm-widget-container` on the test page.
- `widget-open` opens `.rm-chat-window.open`.
- `widget-close` closes the window again.

## How to get to it (user POV)

- Open `http://127.0.0.1:5173/test-widget.html`.
- Click the round launcher.
- Click it again to close.

## Driving it with verify.mjs

Preconditions:

- Doctor passes.
- `public/widget-embed.js` exists.
- `GET /api/widget/lovablehtml/config` returns 200.

- **Load page.** Run `bun .cursor/skills/verify-replymaven/scripts/verify.mjs drive widget`. Heading `Widget Test Page` is visible. `.rm-trigger` becomes visible (class `ready` may appear after config loads). Screenshot: `evidence/widget/before.png`.
- **Open chat.** Click `.rm-trigger`. `.rm-chat-window` has class `open`. Notes record header text (default `Chat with us` unless config `headerText` differs). Screenshot: `evidence/widget/after.png`.
- **Close chat.** Click `.rm-trigger` again. `.rm-chat-window` does not have class `open`.

## Gotchas

- The test page slug is hard-coded `lovablehtml`. A 404 from config means local D1 lacks that project, not that the widget bundle is broken.
- Greetings may overlay the launcher (`allowedPages`, delay). This recipe does not mock config. If a greeting intercepts the click, record it and click `.rm-greeting-close` first (`aria-label` `Dismiss` / class `.rm-greeting-close`).
- The published CDN widget at `widget.replymaven.com` is not this recipe. Local proof uses `/widget-embed.js` from `public/`.
- Do not send a visitor message. That creates a real conversation in local D1 and can page Telegram.
