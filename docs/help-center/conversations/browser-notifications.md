# Browser notifications and unread replies

ReplyMaven uses the browser's [Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notification). A notification can appear while the page is open if the visitor granted permission and a new reply arrives while the widget is closed or the page is in the background. No service worker is required.

## Permission

When a conversation is handed to a person, the widget can ask the visitor for notification permission. The browser shows its own prompt. Visitors can also request permission earlier with `window.ReplyMaven.requestNotifications()`. See [request notification permission](https://replymaven.com/docs/widget-api/request-notification-permission).

Clicking a notification focuses the page and opens the chat. Notifications do not appear while the widget is open and the page is active.

## Unread marker

A small dot appears on the launcher when a new reply has not been seen. It does not show a message count. The dot clears when the visitor opens the widget or views the reply.

Notifications can be blocked by the browser or operating system. ReplyMaven cannot show a desktop notification when permission is denied.
