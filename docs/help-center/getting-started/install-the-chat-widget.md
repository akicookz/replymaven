# Install the chat widget

Add this script to your site, usually just before `</body>`:

```html
<script src="https://widget.replymaven.com/widget-embed.js" data-project="your-project-slug"></script>
```

Replace `your-project-slug` with your project slug. Find the code and slug in **Settings → Install**.

The script reads its project from `data-project` while it starts. Keep the attribute on the script tag. The standard snippet does not set `async` or `defer`. The script downloads the widget code before it finishes loading, so add it near the end of the page when you want the rest of the page to render first.

After the script loads, the widget appears in the position set in **Settings → Appearance**. A visitor can open it and start a conversation.

## Before you go live

:::steps
::step Create a project
Create a project for your website in the [dashboard](https://replymaven.com/app).
::step Add knowledge
Add web pages, PDFs, and FAQs under **Maven → Knowledge**. Create help articles under **Help Center → Articles**. These sources give Maven material to search.
::step Match your brand
Set the widget colors, fonts, radius, and position in **Settings → Appearance**. See [Colors, fonts, and border radius](https://replymaven.com/docs/customization/colors-fonts-radius).
::step Test the bot
Install the script on a test page. Ask sample questions before you make it available to customers.
:::

## Next steps

- [How ReplyMaven works](https://replymaven.com/docs/getting-started/how-replymaven-works)
- [Complete API reference](https://replymaven.com/docs/widget-api/api-reference)
