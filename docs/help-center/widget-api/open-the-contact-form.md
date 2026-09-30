# Open the contact form

Open the configured contact form:

```javascript
window.ReplyMaven?.open("form");
```

The form must be enabled in **Settings → Quick actions**. A screen-only call falls back to home if the form is disabled.

To prefill fields, wait for the widget script to load, then call:

```javascript
await ReplyMaven.ready();
ReplyMaven.open("form", {
  "your-name": "Sam Lee",
  "your-email": "sam@example.com",
  "your-message": "Help with order ORD-123",
});
```

The widget has one configured contact form, so no form ID is needed. Each field key comes from its label: `Your email` becomes `your-email`. Use the labels configured in your project, not necessarily these example labels.

Identifiers use Unicode normalization (NFKC), lowercase letters and numbers, with other character runs replaced by a hyphen. Renaming a field label changes its key. The project still has one contact form; multiple contact-form quick actions open that same form under their labels.

Supplied values replace those fields. Omitted fields stay unchanged. An empty string clears a field. Values must be strings of at most 5,000 characters. Prefilling does not submit anything. Required fields are checked when the visitor presses Submit.

The call returns `false` if configuration is unavailable, the form is disabled, a field key is unknown or ambiguous, or a value is invalid. Rejected calls change no fields. A successful call returns `true`.

Closing and reopening keeps the draft. A failed submission keeps it too. Successful submission or `reset()` clears it. Submitted text includes the selected form label and field labels so Maven can read the context.

Prefilling does not verify customer identity. Use [signed identity tokens](https://replymaven.com/docs/visitor-identity/signed-identity-tokens) for trusted customer continuity.
