---
title: Send page context to the AI
slug: page-context
excerpt: Give the AI live app context with setPageContext() so answers match what the visitor sees.
---

Use `setPageContext()` to send contextual data that the AI **actively uses** when it generates responses. This is different from `setMetadata()`, which is only visible in your dashboard: page context is injected into the AI prompt so the bot can tailor its answers.

The widget already sends the current page URL and title with every message, so basic page awareness works out of the box. Use `setPageContext()` to add richer, app-specific data:

```javascript
// On your pricing page — the AI will know the visitor
// is looking at pricing and can answer accordingly
window.ReplyMaven.setPageContext({
  page: "Pricing",
  plan: "Pro",
  billingCycle: "annual",
  cartTotal: "$249.00",
});
```

In a single-page app, update the context when the route changes:

```javascript
useEffect(() => {
  window.ReplyMaven.setPageContext({
    page: location.pathname,
    section: "account-settings",
  });
}, [location.pathname]);
```

## Key behaviors

- Context is sent **per message**, not stored on the conversation. It reflects where the visitor is right now.
- Each call **replaces** the previous context. It does not merge.
- Keys are freeform `Record<string, string>`. You decide what data is relevant.

> [!WARNING]
> Do not put secrets or sensitive personal data in page context. Treat it as prompt input, not private storage.
