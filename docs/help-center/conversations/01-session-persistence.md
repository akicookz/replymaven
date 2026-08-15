---
title: Session persistence
slug: session-persistence
excerpt: How conversations survive page navigations, refreshes, and returning visits.
---

The widget persists conversations across page navigations and refreshes:

- The **visitor ID** is stored in `localStorage` and reused across sessions.
- The **conversation ID** is stored in `localStorage` (per project) and restored on page load.
- On widget init, the full message history is loaded from the server and rendered.
- If the conversation ID is lost (for example, `localStorage` was cleared), the widget looks up the most recent active conversation by visitor ID as a fallback.
- Closed conversations are cleared automatically. A new conversation starts fresh.

> [!INFO]
> Because the visitor ID lives in `localStorage`, history is per browser and device by default. To keep one history across devices for logged-in users, use [signed identity tokens](/help/replymaven/visitor-identity/signed-identity-tokens).

Call `window.ReplyMaven.reset()` on logout to rotate the visitor ID so the next user of the browser does not see the previous user's conversation.
