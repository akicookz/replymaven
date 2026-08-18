# Landing and sign-in

The marketing site at `/` presents ReplyMaven and opens a sign-in dialog. Unauthenticated visitors never reach `/app`; they are sent back here with `?show_auth=true`.

## Sub-features

- `landing-hero` shows the product heading and primary CTA.
- `landing-login` opens the auth dialog from `Log in`.
- `landing-docs` links to public docs at `/docs`.
- `landing-auth-guard` is the unauthenticated `/app` bounce into the same dialog.

## How to get to it (user POV)

- Open `http://127.0.0.1:5173/`.
- Choose `Log in` or `Start free` / `Start free trial` in the header or hero.
- Choose `Docs` in the header.
- Visit `/app` while signed out (redirects to `/?show_auth=true`).

## Driving it with verify.mjs

Preconditions:

- Doctor passes.
- Do not complete Google or GitHub OAuth.

- **Open landing.** Run `bun .cursor/skills/verify-replymaven/scripts/verify.mjs drive landing`. The helper loads `/`, waits for the heading `Frontline support for founding teams`, and writes `evidence/landing/before.png`.
- **Open sign-in.** Choose `Log in`. A dialog named `Welcome to ReplyMaven` appears with buttons `Continue with Google` and `Continue with GitHub`. Notes record both names. Screenshot: `evidence/landing/after.png`.
- **Docs link.** The header link `Docs` has `href` ending in `/docs`. Do not require the help page to load in this recipe; that is `public-help`.
- **Auth guard (optional extra).** `GET /app` in the same browser session without cookies should land on `/` with the auth dialog. If the machine already has a session cookie in the default profile this is not Playwright's default; the helper uses a clean context. Treat a missing dialog as failure only when the URL is `/` and no dialog appeared after `Log in`.

## Gotchas

- `?show_auth=true` is stripped from the URL after the dialog opens. Assert the dialog, not the query string.
- A signed-in human session in a normal browser does not affect Playwright's clean context. Header may show `Log in` here even if the human sees `Dashboard`.
- Do not click the OAuth buttons. Proof stops at the dialog.
