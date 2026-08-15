---
title: Install the chat widget
slug: install-the-chat-widget
excerpt: Add the ReplyMaven widget to your website with one script tag.
---

Add the widget with one script tag. Place it anywhere in your HTML, typically just before the closing `</body>` tag:

```html
<script src="https://widget.replymaven.com/widget-embed.js"
        data-project="your-project-slug"></script>
```

Replace `your-project-slug` with your project's slug. You can find it in the dashboard under **Support Chat → Chat Widget → Installation**.

> [!TIP]
> The widget script is lightweight (about 12KB gzipped) and loads asynchronously. It does not block your page rendering.

Once the script loads, the widget appears as a floating button in the corner of your page. Visitors click it to open the chat window and start talking to your AI assistant.

## Before you go live

:::steps
::step Create a project
Sign up and create a project for your website in the [dashboard](https://replymaven.com/app).
::step Add knowledge
Add at least one knowledge source: a web page, an FAQ, or a PDF. The AI uses these to answer questions. See [Add web pages](/help/replymaven/knowledge-base/web-pages).
::step Match your brand
Set colors, fonts, and position under **Support Chat → Chat Widget → Appearance**. See [Colors, fonts, and border radius](/help/replymaven/customization/colors-fonts-radius).
::step Test the bot
Ask a few sample questions on your own site before you announce it.
:::

## Next steps

- [How ReplyMaven works](/help/replymaven/getting-started/how-replymaven-works)
- [Complete API reference](/help/replymaven/widget-api/api-reference)
