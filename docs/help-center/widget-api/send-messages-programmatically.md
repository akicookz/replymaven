# Send a message programmatically

Use `sendMessage()` to submit a visitor message from your page:

```javascript
window.ReplyMaven?.sendMessage("How do I reset my password?");
```

The widget opens chat and submits the text as a visitor message. It creates a conversation if needed. If the stored conversation is closed, the next visitor message can reopen that same conversation.

Maven does not always send an automatic reply. For example, a teammate may own the conversation, or a project rule may prevent a reply. Do not use this call to send private or hidden text. Visitors see the submitted message in the chat.

Common patterns:

```javascript
document.querySelector("#billing-help")?.addEventListener("click", () => {
  window.ReplyMaven?.sendMessage("I have a question about billing");
});

window.ReplyMaven?.sendMessage(`I got error ${errorCode} while saving`);
```

Set [page context](https://replymaven.com/docs/widget-api/page-context) first if Maven needs app state that is not in the current URL.
