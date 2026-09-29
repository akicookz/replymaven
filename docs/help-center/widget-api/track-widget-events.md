# Track widget events

Use `window.ReplyMaven.track()` to send greeting-card events to your analytics tool:

```javascript
window.ReplyMaven?.track((event, properties) => {
  posthog.capture(event, properties);
});
```

The callback receives an event name and a string property object. The current greeting events are:

| Event | When it fires |
| --- | --- |
| `replymaven_greeting_seen` | A greeting card becomes visible. It fires once per card during the page session. |
| `replymaven_greeting_dismissed` | A visitor dismisses a greeting card. |
| `replymaven_greeting_cta_click` | A visitor clicks a greeting card's call to action. |

Each event includes `greeting_id` and `greeting_title`.

Register the callback as early as possible. Setting a new callback replaces the previous one. If an event occurs before a callback is set, the widget holds up to 50 events in memory and delivers them when you register a callback. If no callback is set before the page closes, those events are lost.

The widget does not send events to a vendor by itself. Your callback decides where to send them. See [Greeting cards](https://replymaven.com/docs/customization/greetings) for card behavior.
