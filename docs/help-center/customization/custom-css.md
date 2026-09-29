# Custom CSS

Custom CSS covers styles that the color and font pickers do not. There are two editors: one for the chat widget, one for the help center. They do not share CSS.

Custom CSS is on the Business plan. Each editor accepts up to 5000 characters. Type `.` in the editor to insert a class.

> [!WARNING]
> CSS that uses `@import`, `url()`, `javascript:` URLs, `expression()`, `behavior`, or `-moz-binding` is rejected. So is CSS that closes a style tag or injects a script.

For brand color, font, and radius without CSS, see [Colors, fonts, and border radius](https://replymaven.com/docs/customization/colors-fonts-radius).

## Chat widget

Add CSS under **Settings → Appearance → Custom CSS**. Changes apply when you save.

```css
.rm-trigger {
  width: 72px;
  height: 72px;
}

.rm-message-row.bot .rm-message {
  background: #f0f9ff;
  border: 1px solid #bae6fd;
}
```

### Widget classes

| Class | What it styles |
| --- | --- |
| `.rm-widget-container` | Outer wrapper for the launcher, greetings, and chat window |
| `.rm-chat-window` | Open chat panel |
| `.rm-trigger` | Launcher button |
| `.rm-trigger-badge` | Unread badge on the launcher |
| `.rm-header` | Conversation header |
| `.rm-header-title` | Header title |
| `.rm-header-subtitle` | Header subtitle |
| `.rm-header-avatar` | Header avatar |
| `.rm-header-close` | Header close button |
| `.rm-home` | Home screen |
| `.rm-home-title` | Home screen title |
| `.rm-home-subtitle` | Home screen subtitle |
| `.rm-home-banner` | Home screen banner |
| `.rm-home-ask` | Ask box on the home screen |
| `.rm-home-ask-input` | Ask box text field |
| `.rm-home-link` | Home screen link row |
| `.rm-messages` | Message list |
| `.rm-message-row` | One message row. Also has `.visitor`, `.bot`, or `.agent` |
| `.rm-message` | Message bubble |
| `.rm-input-area` | Composer |
| `.rm-input` | Message text field |
| `.rm-send-btn` | Send button |
| `.rm-greeting-card` | Greeting card before the chat opens |
| `.rm-greeting-title` | Greeting title |
| `.rm-greeting-desc` | Greeting body |
| `.rm-quick-topic` | Quick topic chip |
| `.rm-powered` | Powered-by footer |
| `.rm-inline-bar` | Inline input bar |

Visitor, bot, and agent bubbles:

```css
.rm-message-row.visitor .rm-message { }
.rm-message-row.bot .rm-message { }
.rm-message-row.agent .rm-message { }
```

You can also set tokens on `.rm-widget-container`:

| Token | What it styles |
| --- | --- |
| `--rm-bg` | Widget background |
| `--rm-bg-secondary` | Home screen and composer chrome |
| `--rm-text` | Primary text |
| `--rm-text-secondary` | Secondary text |
| `--rm-chat-radius` | Chat window radius |
| `--rm-bot-bg` | Bot bubble background |
| `--rm-bot-text` | Bot bubble text |
| `--rm-visitor-bg` | Visitor bubble background |
| `--rm-visitor-text` | Visitor bubble text |
| `--rm-border` | Borders |
| `--rm-input-bg` | Composer field |

> [!WARNING]
> These class names are stable, but they can change in a major release. Re-check your CSS after a major update.

## Help center

Add CSS under **Maven → Help Center → Site settings**. Saved CSS can take up to two minutes to show on live pages.

```css
:root {
  --help-heading-weight: 600;
}

.help-prose a {
  text-decoration: underline;
}
```

`--help-heading-weight` sets every heading. To change one level only, set `--help-h1-weight`, `--help-h2-weight`, `--help-h3-weight`, or `--help-h4-weight` instead. Do not set the shared knob and a per-level knob to the same value. The per-level var replaces the shared one for that heading.

Help pages already inherit brand color, font, and radius from widget appearance. You can override these tokens on `:root`:

| Token | What it styles |
| --- | --- |
| `--brand` | Links and accent |
| `--background` | Page background |
| `--foreground` | Headings and strong text |
| `--muted` | Soft surfaces |
| `--muted-foreground` | Body and secondary text |
| `--border` | Cards, tables, rules |
| `--card` | Category and article cards |
| `--code` | Code block background |
| `--code-foreground` | Code text |
| `--font-sans` | Body font |
| `--font-heading` | Heading font |
| `--radius` | Small control radius |

### Help center classes

| Class | What it styles |
| --- | --- |
| `.help-shell` | Page layout wrapper |
| `.help-sidebar` | Left category menu |
| `.help-sidebar-group-name` | Category name in the sidebar |
| `.help-sidebar-leaf` | Article link in the sidebar |
| `.help-main` | Main column |
| `.help-index-title` | Older home title class |
| `.help-index-subtitle` | Older home subtitle class |
| `.help-category-card` | Category card on the home page |
| `.help-page-title` | Category page title |
| `.help-page-subtitle` | Category page description |
| `.help-prose` | Article body |
| `.help-toc` | On-this-page list |
| `.help-breadcrumb` | Breadcrumb |
| `.help-article-nav` | Previous and next article links |

The current home heading is the first `h1` inside `.help-home`. Dark mode adds `.dark` on `html`, so `.dark .help-prose` only runs in dark mode.
