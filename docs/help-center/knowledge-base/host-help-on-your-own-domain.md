# Host help on your own domain

You can serve your help center at a path on your own site, such as `https://yourdomain.com/docs`.

Do this as a **200 rewrite**, not a 301. Visitors stay on your domain. ReplyMaven renders the HTML.

## Order

1. Set up the rewrite on your host.
2. Send `X-ReplyMaven-Help-Proxy: 1`, or send `X-Forwarded-Host` set to your domain. Vercel and Netlify usually send `X-Forwarded-Host` for you.
3. Also rewrite `/docs/sitemap.xml` and `/docs/robots.txt`.
4. In Help Center Settings, click **Test connection**.
5. Save the custom URL only after the test passes.

If you save first, `https://replymaven.com/help/<your-slug>` 301s to your path. The rewrite then follows that 301 and loops.

## What ReplyMaven does

- `replymaven.com/help/<your-slug>` is noindex. Google should not rank the hosted URL.
- After you save a custom URL, a direct visit to the hosted path 301s to your path.
- The rewrite still gets a 200, with no noindex, because of the proxy header or `X-Forwarded-Host`.
- Canonical tags, sitemap, and in-page links use your URL.

## Cloudflare Worker

Use a Worker on your zone with a `/docs*` route. Transform Rules cannot proxy to ReplyMaven. They only rewrite the path on your own origin.

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/docs" && !url.pathname.startsWith("/docs/")) {
      return fetch(request);
    }
    const upstream = new URL(
      url.pathname.replace(/^\/docs/, "/help/<your-slug>") + url.search,
      "https://replymaven.com",
    );
    const headers = new Headers(request.headers);
    headers.set("X-ReplyMaven-Help-Proxy", "1");
    headers.set("X-Forwarded-Host", url.host);
    return fetch(upstream, { headers, redirect: "manual" });
  },
};
```

## Next.js middleware

`middleware.ts` at the app root. Fetch with `redirect: "manual"` so a later 301 from the hosted path does not loop.

```ts
import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const upstream = new URL(
    pathname.replace(/^\/docs/, "/help/<your-slug>") + search,
    "https://replymaven.com",
  );
  const headers = new Headers(request.headers);
  headers.set("X-ReplyMaven-Help-Proxy", "1");
  headers.set("X-Forwarded-Host", request.nextUrl.host);
  const res = await fetch(upstream, { headers, redirect: "manual" });
  return new NextResponse(res.body, { status: res.status, headers: res.headers });
}

export const config = { matcher: ["/docs", "/docs/:path*"] };
```

## AWS CloudFront

Set the origin to `replymaven.com`. Add a cache behavior for `/docs*`. Use a Lambda@Edge origin-request function to rewrite the path and set the headers:

```js
export async function handler(event) {
  const request = event.Records[0].cf.request;
  const viewerHost = request.headers.host[0].value;
  request.uri = request.uri.replace(/^\/docs/, "/help/<your-slug>");
  request.headers["x-replymaven-help-proxy"] = [
    { key: "X-ReplyMaven-Help-Proxy", value: "1" },
  ];
  request.headers["x-forwarded-host"] = [
    { key: "X-Forwarded-Host", value: viewerHost },
  ];
  request.headers.host = [{ key: "Host", value: "replymaven.com" }];
  return request;
}
```

Dashboard snippets for Cloudflare, Vercel, Netlify, Nginx, Next.js, and AWS CloudFront are in **Help Center Settings → Reverse proxy setup**.

> [!WARNING]
> Use a 200 rewrite on your side. A 301 from your domain to `replymaven.com/help/...` splits SEO and will not pass the connection test.