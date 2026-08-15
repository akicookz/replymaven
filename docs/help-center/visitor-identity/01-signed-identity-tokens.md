---
title: Signed identity tokens
slug: signed-identity-tokens
excerpt: Verify who a visitor is with server-issued tokens and keep their history on one customer profile.
---

Signed identify connects a widget visitor to a project-scoped customer profile without trusting browser-supplied data. Your server issues a short-lived signed token; the widget presents it:

```javascript
// Fetch a token from YOUR backend, then:
await window.ReplyMaven.identify({ token });
```

## How it works

- The token is an HMAC-SHA256 payload signed with your project's identity secret. It carries at least a stable `externalId` or an email, and may also carry name, phone, and custom fields.
- Create or rotate the secret in the dashboard. It is shown once; store it server-side only.
- Recommended token lifetime is 15 minutes. One hour is the maximum.
- Exact visitor history stays together across devices: conversations from each verified device attach to the same customer profile.

## Rules to build against

- Prefer a stable application `externalId` over email as the primary identifier.
- Call `identify({ token })` as soon as authenticated data is available. Start with only `externalId` if that is all you have, then identify again when email, name, or other fields become available.
- Signed identify returns a promise and is processed in invocation order. Await it so a rejected token is observable.
- Conflicts fail without changing data. An unmatched signed account never relabels existing history, and customers are never auto-merged.
- Call `window.ReplyMaven.reset()` before logout or account switching.

> [!DANGER]
> Never ship the identity secret to browser code. Tokens must be created on your server.
