---
title: Single-page applications
slug: spa-integration
excerpt: Load the widget once in React, Vue, or Next.js and keep it across route changes.
---

If your site is a single-page application (React, Vue, Next.js, and so on), the widget script only needs to load once. It persists across route changes automatically.

```jsx
// Option 1: In index.html
<script src="https://widget.replymaven.com/widget-embed.js"
        data-project="your-project-slug"></script>

// Option 2: Load dynamically in a React effect
useEffect(() => {
  const script = document.createElement("script");
  script.src = "https://widget.replymaven.com/widget-embed.js";
  script.setAttribute("data-project", "your-project-slug");
  script.async = true;
  document.body.appendChild(script);

  return () => {
    document.body.removeChild(script);
  };
}, []);
```

Keep the AI's picture of the app current on route changes:

```javascript
// In your router's afterEach hook or a useEffect
window.ReplyMaven?.setPageContext({
  page: window.location.pathname,
});
```

> [!INFO]
> The widget auto-sends the page URL and title with each message even without this. Use `setPageContext` for app state the URL does not carry. See [Send page context to the AI](/help/replymaven/widget-api/page-context).
