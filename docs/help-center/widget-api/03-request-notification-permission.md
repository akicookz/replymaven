---
title: Request notification permission
slug: request-notification-permission
excerpt: Ask for browser notification permission earlier than the default handoff prompt.
---

By default, the widget requests browser notification permission when a conversation is handed off to a human agent. If you want to prompt the visitor sooner, call:

```javascript
window.ReplyMaven.requestNotifications();
```

The browser shows its native permission prompt. If the visitor grants it, they receive desktop notifications for new replies while the widget is closed or the tab is in the background.

> [!TIP]
> Ask at a moment of intent, for example right after the visitor sends their first message. Unprompted permission requests get declined more often.

See [Browser notifications and unread badges](/help/replymaven/conversations/browser-notifications) for when notifications fire.
