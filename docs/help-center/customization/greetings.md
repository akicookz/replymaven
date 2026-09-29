# Greeting cards

Greetings are cards that appear above the widget launcher before a visitor opens chat. Use a short message to welcome visitors or an announcement to share an update.

Manage greetings under **Maven → Greetings**. Each greeting can be enabled or disabled, placed in an order, and limited to matching page paths. A greeting can have an author, title, description, image, or call-to-action link. Announcement cards can also use an uploaded video and a poster image.

Set when the card appears with **Show after**. Set **Hide after** to make it disappear after a chosen time, or choose **Never**. Automatic hiding does not save a dismissal. A visitor's dismissal is saved on that browser. When the visitor has a signed customer identity, the dismissal can also follow the customer to another device.

Use the widget API to open a greeting stack or one greeting by ID. See [Open, close, and toggle the widget](https://replymaven.com/docs/widget-api/open-close-toggle). The host page can receive greeting analytics events with [`track()`](https://replymaven.com/docs/widget-api/track-widget-events).

> [!INFO]
> Greeting cards are displayed before chat opens. The widget hides the cards while chat is open. A greeting CTA opens its configured link.
