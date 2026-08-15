---
title: Multiple widgets
slug: multiple-widgets
excerpt: One widget per page, different projects per site section.
---

Only one widget instance is supported per page. If you need different configurations for different sections of your site, use different project slugs:

```html
<!-- On your marketing site -->
<script src="https://widget.replymaven.com/widget-embed.js"
        data-project="marketing-bot"></script>

<!-- On your app/dashboard -->
<script src="https://widget.replymaven.com/widget-embed.js"
        data-project="app-support-bot"></script>
```

Each project has its own knowledge base, appearance, conversations, and integrations, so the marketing bot and the in-app bot can answer very differently.

> [!INFO]
> Conversations do not carry over between projects. A visitor who chats on the marketing site starts fresh in the app.
