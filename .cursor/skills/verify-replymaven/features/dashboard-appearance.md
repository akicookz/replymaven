# Dashboard appearance

Signed-in owners set widget look at Chat Widget → Appearance, including the Font select. Help and the embed read that saved `fontFamily`. This path is blocked without a real session.

## Sub-features

- `appearance-open` shows heading `Chat Widget` and label `Font`.
- `appearance-font-list` includes `Switzer` and `Instrument Sans`, and does not include `Lato`.
- `appearance-save` is out of scope for unattended runs (writes production-shaped local D1).

## How to get to it (user POV)

- Sign in, open a project, choose Chat Widget. URL: `/app/projects/:projectId/support-chat/widget`.
- Font is a labeled select on the Appearance tab (default tab; `?tab=actions` is Quick actions).

## Driving it with verify.mjs

Preconditions:

- Doctor passes.
- `VERIFY_STORAGE_STATE` is a Playwright `storageState` JSON from a human-exported logged-in session. If unset, **stop** and report skipped. Do not OAuth.

There is no `drive dashboard` subcommand until a storage state exists. Manual drive:

- Open `/app`. Confirm the inbox or project chrome, not the marketing heading.
- Open Chat Widget. Heading `Chat Widget`. Label `Font`. Open the select. Visible options include `Switzer`.
- Screenshot to `evidence/dashboard-appearance/after.png`. Do not click Save unless the user asked to persist.

## Gotchas

- Unauthenticated `/app` redirects to landing auth. That is `landing-auth`, not this feature.
- Team members without projects see `No projects available yet`.
- The onboarding flow is `/app/onboarding` and is a different page from Appearance.
