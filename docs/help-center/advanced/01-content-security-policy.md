---
title: Content Security Policy
slug: content-security-policy
excerpt: CSP directives the widget needs to load and connect.
---

If your site uses a Content Security Policy, add the following directives:

```text
script-src 'self' https://widget.replymaven.com;
connect-src 'self' https://replymaven.com https://widget.replymaven.com wss://replymaven.com;
style-src 'self' 'unsafe-inline';
```

What each is for:

- `script-src https://widget.replymaven.com` — the widget bundle itself.
- `connect-src https://replymaven.com` and `wss://replymaven.com` — API calls and the real-time chat connection.
- `style-src 'unsafe-inline'` — the widget injects its scoped styles inline.

> [!WARNING]
> If the widget button appears but chat never connects, a missing `connect-src` entry is the most common cause. Check the browser console for CSP violations.
