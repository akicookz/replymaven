# Identify visitors with identify()

Call `identify()` when your app knows a visitor's name or email, often after login:

```javascript
window.ReplyMaven?.identify({
  name: user.fullName,
  email: user.email,
  metadata: {
    accountId: String(user.id),
    plan: user.subscription.plan,
  },
});
```

| Property | Type | How it is used |
| --- | --- | --- |
| `name` | string | Visitor name shown on the conversation. |
| `email` | string | Visitor email shown on the conversation and used for follow-up. |
| `phone` | string | Kept in widget memory. Unsigned identify does not send it to the conversation or customer profile. |
| `metadata` | string values | Merged into the conversation metadata shown in the dashboard. |

If a conversation already exists, the widget syncs the name and email to it. If not, the values are used when the conversation is created. `identify()` does not create a customer profile or link earlier conversations. Use [signed identity tokens](https://replymaven.com/docs/visitor-identity/signed-identity-tokens) to verify an app identity and connect it to a project customer profile. A signed token can set the customer's phone.

Call `window.ReplyMaven.reset()` before logout or account switching. This rotates the browser's visitor ID and clears its conversation state.
