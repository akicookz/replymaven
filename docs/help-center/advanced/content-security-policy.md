# Content Security Policy

If your site uses a Content Security Policy (CSP), allow the widget script, API, real-time connection, and the assets used by your configuration.

```text
script-src 'self' https://widget.replymaven.com;
connect-src 'self' https://replymaven.com https://widget.replymaven.com wss://replymaven.com;
style-src 'self' 'unsafe-inline';
font-src 'self' https://fonts.gstatic.com https://cdn.fontshare.com;
img-src 'self' data: https://replymaven.com;
media-src 'self' https://replymaven.com;
```

The widget loads from `widget.replymaven.com`. It sends API requests to `replymaven.com` and opens its real-time chat connection there. It injects inline styles. The preset fonts load from Google Fonts or Fontshare.

Your own configuration may use other image, font, or video hosts. Add each host to the matching directive: `img-src` for images and video posters, `font-src` for fonts, and `media-src` for video files. Uploaded greeting and message media use ReplyMaven's asset host. Add any custom host your team supplies.

> [!WARNING]
> CSP rules vary by site. Start with the required sources for your setup, then check the browser console for blocked resources. Do not copy a broad policy without reviewing the domains it allows.
