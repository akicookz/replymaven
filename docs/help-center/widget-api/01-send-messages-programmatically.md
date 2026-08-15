---
title: Send a message programmatically
slug: send-messages-programmatically
excerpt: Trigger a chat message on behalf of the visitor from your own code.
---

Send a message on behalf of the visitor with `sendMessage`. This opens the widget if it is closed, creates a conversation if needed, and triggers the AI response:

```javascript
window.ReplyMaven.sendMessage("How do I reset my password?");
```

> [!TIP]
> Use this to trigger contextual help. For example, on an error page you can automatically send "I'm seeing an error on the checkout page" to start the conversation with context already in place.

Common patterns:

```javascript
// Help button on a specific feature
document.querySelector("#billing-help").addEventListener("click", () => {
  window.ReplyMaven.sendMessage("I have a question about billing");
});

// Preface support with the error the user just hit
window.ReplyMaven.sendMessage(`I got error ${errorCode} while saving`);
```
