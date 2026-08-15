---
title: Attach custom metadata
slug: custom-metadata
excerpt: Track application state on a conversation with setMetadata() and identify().
---

Attach any key-value pairs to a conversation with `setMetadata()`, or through the `metadata` field of `identify()`. Metadata is visible in the dashboard conversation detail and helps agents see the visitor's application state at a glance.

```javascript
window.ReplyMaven.setMetadata({
  currentPage: "/checkout",
  cartTotal: "$149.99",
  itemCount: "3",
  experimentGroup: "variant-b",
});
```

> [!WARNING]
> Metadata values must be strings. Numbers, booleans, and objects are not supported. Convert them to strings first.

## Common patterns

```javascript
// E-commerce: track cart context
window.ReplyMaven.setMetadata({
  cartTotal: "$249.99",
  itemCount: "5",
  couponApplied: "SAVE20",
});

// SaaS: track subscription context
window.ReplyMaven.identify({
  name: "John Doe",
  email: "john@company.com",
  metadata: {
    plan: "enterprise",
    accountAge: "18 months",
    teamSize: "25",
  },
});

// Support: track the visitor's last action
window.ReplyMaven.setMetadata({
  lastAction: "clicked-upgrade-button",
  errorCode: "ERR_PAYMENT_DECLINED",
});
```

> [!INFO]
> Metadata is for your dashboard. If you want the AI to use the data when answering, send it as [page context](/help/replymaven/widget-api/page-context) instead.
