---
title: Identify visitors with identify()
slug: identify-visitors
excerpt: Link a visitor's identity to their conversation as soon as they log in.
---

The `identify()` method links a visitor's identity to their chat conversation. Call it as soon as you know who the visitor is, typically after they log in:

```javascript
// After your auth callback
function onUserLogin(user) {
  window.ReplyMaven.identify({
    name: user.fullName,
    email: user.email,
    phone: user.phone,
    metadata: {
      userId: user.id,
      plan: user.subscription.plan,
      signupDate: user.createdAt,
    },
  });
}
```

| Property | Type | Description |
| --- | --- | --- |
| `name` | string | Visitor's display name. |
| `email` | string | Visitor's email address. Used for handoff notifications. |
| `phone` | string | Visitor's phone number. |
| `metadata` | Record&lt;string, string&gt; | Arbitrary key-value pairs, visible in the dashboard conversation detail. |

This information is visible to agents in the dashboard and helps provide personalized support.

> [!INFO]
> Unsigned `identify()` updates the current conversation only. It never creates a customer profile or attaches earlier threads. For verified cross-device identity, use [signed identity tokens](/help/replymaven/visitor-identity/signed-identity-tokens).

If a conversation already exists, `identify()` retroactively updates it on the server. You do not need to call it before the first message. When the visitor logs out or switches accounts, call `window.ReplyMaven.reset()` to rotate the visitor ID and clear conversation state.
