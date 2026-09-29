# Open, close, and toggle the widget

Use `window.ReplyMaven` to open or close the widget from your own button:

```html
<button type="button" onclick="window.ReplyMaven?.open('chat')">
  Chat with us
</button>
```

The supported screens are `"home"`, `"chat"`, and `"form"`. `"greetings"` controls the greeting cards above the launcher. If you omit the screen, the widget opens its default view.

```javascript
window.ReplyMaven?.open("form");
window.ReplyMaven?.close();
window.ReplyMaven?.toggle("chat");
```

Use a greeting ID to open, toggle, or dismiss one card:

```javascript
window.ReplyMaven?.open("greetings", { id: "welcome-card-id" });
window.ReplyMaven?.toggle("greetings", { id: "welcome-card-id" });
window.ReplyMaven?.close("greetings", { id: "welcome-card-id" });
```

Calling `close("greetings", { id })` saves the dismissal. Calling `close("greetings")` dismisses the visible stack. A normal `close()` closes the panel; it does not delete the conversation.

Use `expand()` and `shrink()` to change panel size. Pass `{ id }` to resize one rich greeting card instead. These methods return `true` when the request is accepted, even if the target already has that size. They return `false` if the target is unavailable. A `center-inline` widget cannot expand or shrink as a panel.

For panel calls, `open()` returns whether the panel is open after the call. `toggle()` returns the panel's open state after the call. A greeting `open` or `toggle` call returns true when its request opens that greeting or stack. For greeting toggles, false means it closed the greeting or could not open it. These results describe the final state or whether a greeting request succeeded, not necessarily whether the call changed the state. The API is available after the widget script loads. If your code can run earlier, use a load callback or optional chaining.

See the [complete API reference](https://replymaven.com/docs/widget-api/api-reference) for all methods.
