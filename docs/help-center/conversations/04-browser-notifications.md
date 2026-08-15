---
title: Browser notifications and unread badges
slug: browser-notifications
excerpt: How visitors are alerted to new replies when they look away.
---

ReplyMaven uses the browser's [Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notification) to alert visitors when a reply arrives. It works while the page is open; no service worker is required.

## Permission flow

1. By default, the widget requests notification permission when a conversation is handed off to a human agent.
2. The browser shows its native permission prompt.
3. If granted, the visitor receives desktop notifications for new replies while the widget is minimized or the tab is in the background.
4. Clicking the notification opens and focuses the widget.

To ask earlier, call `window.ReplyMaven.requestNotifications()`. See [Request notification permission](/help/replymaven/widget-api/request-notification-permission).

## Unread badge

When new messages arrive while the widget is closed, a red badge with the unread count appears on the trigger button. The badge clears when the visitor opens the widget.

## When notifications trigger

- A new **agent message** arrives (from Telegram or the dashboard) while the widget is closed.
- A new **bot message** arrives while the widget is closed.
- The tab is in the background.

Notifications are **not** shown when the widget is open and the tab is active. The visitor is already looking at the chat.
