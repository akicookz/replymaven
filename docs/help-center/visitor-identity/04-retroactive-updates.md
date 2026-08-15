---
title: Retroactive identity updates
slug: retroactive-updates
excerpt: identify() and setMetadata() update conversations that already exist.
---

Both `identify()` and `setMetadata()` work retroactively. If a conversation already exists, the widget syncs the updated data to the server. New metadata is merged with existing metadata; it does not replace it.

```javascript
// Visitor starts chatting anonymously, then logs in.
// The existing conversation picks up their identity:
window.ReplyMaven.identify({
  name: "Jane Smith",
  email: "jane@example.com",
});

// Later, update just the metadata
window.ReplyMaven.setMetadata({
  lastPurchase: "2026-01-15",
  lifetimeValue: "$1,200",
});
```

This means you never have to wait for identity before letting a visitor chat. Let them start anonymously and enrich the conversation whenever data becomes available.
