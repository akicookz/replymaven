---
title: Open, close, and toggle the widget
slug: open-close-toggle
excerpt: Control the chat window from your own code with window.ReplyMaven.
---

The widget exposes a JavaScript API on `window.ReplyMaven`. Use it to control the chat window programmatically:

```javascript
// Open the chat widget
window.ReplyMaven.open();

// Close the chat widget
window.ReplyMaven.close();

// Toggle open/close
window.ReplyMaven.toggle();
```

A common pattern is to open the widget from your own "Chat with us" button:

```html
<button onclick="window.ReplyMaven.open()">Chat with us</button>
```

> [!INFO]
> The API is available after the widget script loads. If your code can run earlier, guard the call: `window.ReplyMaven?.open()`.

See the [complete API reference](/help/replymaven/widget-api/api-reference) for every available method.
