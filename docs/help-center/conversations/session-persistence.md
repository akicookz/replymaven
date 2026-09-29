# Session persistence

The widget saves the visitor ID and conversation ID in browser storage. On the next page load, it restores the saved conversation and loads its messages from the server.

If the saved conversation ID is missing or cannot be restored, the widget checks for the visitor's latest open conversation. This fallback uses the visitor ID.

A closed conversation stays in the visitor's history. If the visitor sends another message, ReplyMaven reopens the same conversation. Archived and spam-blocked conversations have separate rules.

By default, browser storage keeps the visitor's history on one browser and device. Use [signed identity tokens](https://replymaven.com/docs/visitor-identity/signed-identity-tokens) to link a logged-in visitor's history across devices. Call `window.ReplyMaven.reset()` when a user signs out if the next person must not see that browser's prior visitor session.
