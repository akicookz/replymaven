# Send page context to the AI

Use `setPageContext()` to send app state with each visitor message. Maven can use this context when it prepares a reply. `setMetadata()` is for conversation details in the dashboard; it is not prompt context.

The widget already sends the page URL and title. Add details that the URL does not show:

```javascript
window.ReplyMaven?.setPageContext({
  page: "Pricing",
  plan: "Pro",
  billingCycle: "annual",
  cartTotal: 249.00,
});
```

In a single-page app, update context when the route or relevant app state changes:

```javascript
useEffect(() => {
  window.ReplyMaven?.setPageContext({
    page: location.pathname,
    section: "account-settings",
  });
}, [location.pathname]);
```

Each call replaces the previous context. The widget accepts an object and keeps up to 20 entries. Keys must be 1–80 characters. String values are shortened to 1,000 characters. Finite numbers and booleans are converted to strings. Other value types are dropped.

> [!WARNING]
> Page context is sent to the AI with the visitor's message. Do not include secrets or sensitive personal data.
