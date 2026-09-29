# Complete API reference

The widget adds these methods to `window.ReplyMaven` after its script loads. The `screen` value is optional. It can be `"home"`, `"chat"`, `"form"`, or `"greetings"`.

| Method | Description | Return value |
| --- | --- | --- |
| `open(screen?, args?)` | Open the widget on a screen. For `"greetings"`, `args` can be `{ id }` to open one card. | `boolean`: true when the panel is open or the greeting request succeeds. |
| `close(screen?, args?)` | Close the panel. With `screen: "greetings"`, dismiss the card stack or the card in `args.id`. | No value. |
| `toggle(screen?, args?)` | Toggle the panel or greeting stack/card. | `boolean`: current panel-open state for panel calls; greeting calls report whether the request opened it. |
| `expand(args?)` | Expand the panel, or the greeting card in `args.id`. | `boolean`: true when the request is accepted. |
| `shrink(args?)` | Shrink the panel, or the greeting card in `args.id`. | `boolean`: true when the request is accepted. |
| `sendMessage(text)` | Open chat and submit a visitor message. | No value. |
| `identify({ name?, email?, phone?, metadata? })` | Set unsigned visitor details. Name and email can sync to the current conversation. Phone remains in the browser. | No value. |
| `identify({ token })` | Verify and link a visitor with a server-issued signed token. | Promise. Await it to detect a rejected token. |
| `reset()` | Rotate the local visitor ID and clear local conversation identity state. | No value. |
| `setMetadata(values)` | Merge string metadata into the conversation details. | No value. |
| `setPageContext(values)` | Replace page context sent with messages. String, finite number, and boolean values are accepted. | No value. |
| `requestNotifications()` | Ask the browser to allow notifications. | No value. |
| `track(handler)` | Send greeting analytics events to a host callback. | No value. |

Use optional chaining if your code can run before the widget script:

```javascript
window.ReplyMaven?.open("chat");
```

The API is not ready until the script has loaded. `open("form")` opens the configured contact form. There are no `openInquiryForm()` or `openTicketForm()` methods.

## Guides

- [Open, close, and toggle the widget](https://replymaven.com/docs/widget-api/open-close-toggle)
- [Send a message programmatically](https://replymaven.com/docs/widget-api/send-messages-programmatically)
- [Open the contact form](https://replymaven.com/docs/widget-api/open-the-contact-form)
- [Send page context to the AI](https://replymaven.com/docs/widget-api/page-context)
- [Track widget events](https://replymaven.com/docs/widget-api/track-widget-events)
- [Identify visitors with identify()](https://replymaven.com/docs/visitor-identity/identify-visitors)
- [Signed identity tokens](https://replymaven.com/docs/visitor-identity/signed-identity-tokens)
- [Attach custom metadata](https://replymaven.com/docs/visitor-identity/custom-metadata)
