---
title: Custom CSS
slug: custom-css
excerpt: Override widget styles for advanced branding needs.
---

For advanced styling, inject custom CSS that applies inside the widget. This is useful for overriding specific styles or matching complex brand guidelines.

```css
/* Make the trigger button larger */
.rm-trigger {
  width: 72px;
  height: 72px;
}

/* Custom message bubble style */
.rm-message-row.bot .rm-message {
  background: #f0f9ff;
  border: 1px solid #bae6fd;
}
```

Add it under **Support Chat → Chat Widget → Appearance**.

> [!WARNING]
> Custom CSS operates on the widget's internal class names (prefixed with `rm-`). These are considered stable but may change in major updates. Re-check your overrides after major releases.
