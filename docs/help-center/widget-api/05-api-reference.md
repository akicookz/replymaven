---
title: Complete API reference
slug: api-reference
excerpt: Every method available on window.ReplyMaven.
---

All methods available on `window.ReplyMaven`:

| Method | Description |
| --- | --- |
| `open()` | Open the chat widget. |
| `close()` | Close the chat widget. |
| `toggle()` | Toggle the widget open or closed. |
| `sendMessage(text)` | Send a message as the visitor. Opens the widget if closed. |
| `identify({ name, email, phone, metadata })` | Set visitor identity and custom metadata. Syncs retroactively if a conversation exists. |
| `identify({ token })` | Signed identify with a server-issued token. Connects the visitor to a customer profile. Returns a promise. |
| `reset()` | Rotate the visitor ID and clear conversation state. Call before logout or account switching. |
| `setMetadata({ ... })` | Set arbitrary key-value metadata on the conversation. Merged with existing metadata. |
| `setPageContext({ ... })` | Send app context the AI uses when answering. Replaces the previous context. |
| `requestNotifications()` | Request browser notification permission. |
| `openInquiryForm()` | Open the contact form. `openTicketForm()` is an alias. |

## Guides

- [Open, close, and toggle the widget](/help/replymaven/widget-api/open-close-toggle)
- [Send a message programmatically](/help/replymaven/widget-api/send-messages-programmatically)
- [Identify visitors with identify()](/help/replymaven/visitor-identity/identify-visitors)
- [Signed identity tokens](/help/replymaven/visitor-identity/signed-identity-tokens)
- [Attach custom metadata](/help/replymaven/visitor-identity/custom-metadata)
- [Send page context to the AI](/help/replymaven/widget-api/page-context)
