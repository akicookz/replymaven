---
title: Open the contact form
slug: open-the-contact-form
excerpt: Open the widget's "Leave a message" form from your own buttons and links.
---

Open the contact form programmatically. If the widget is closed, it opens first:

```javascript
window.ReplyMaven.openInquiryForm();
```

`openTicketForm()` is also exposed as an alias.

The contact form must be enabled in your project settings under **Support Chat → Chat Widget → Actions**.

> [!TIP]
> Wire this to a "Contact us" button in your navigation or footer. Visitors who prefer not to chat can leave a structured message instead.

See [Contact form](/help/replymaven/integrations/contact-form) for configuring the form itself.
