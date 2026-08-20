import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProxySetupGuideProps {
  projectSlug: string;
}

interface GuideTab {
  id: string;
  label: string;
  build: (slug: string) => string;
  language: string;
}

const GUIDES: GuideTab[] = [
  {
    id: "cloudflare",
    label: "Cloudflare Rules",
    language: "text",
    build: (slug) =>
      `# Cloudflare → Rules → Transform Rules → Rewrite URL
# Path matches: /docs* or /docs/*
# Rewrite to: https://replymaven.com/help/${slug}\${1}
# Also send request header: X-ReplyMaven-Help-Proxy: 1
#
# Or use a Worker:
addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/docs")) {
    const upstream = new URL(
      url.pathname.replace(/^\\/docs/, "/help/${slug}") + url.search,
      "https://replymaven.com",
    );
    const headers = new Headers(event.request.headers);
    headers.set("X-ReplyMaven-Help-Proxy", "1");
    headers.set("X-Forwarded-Host", url.host);
    event.respondWith(fetch(upstream, { headers, redirect: "manual" }));
  }
});`,
  },
  {
    id: "vercel",
    label: "Vercel",
    language: "json",
    build: (slug) =>
      `// vercel.json — use a rewrite (200), not a redirect.
// Vercel sends X-Forwarded-Host as your domain. That is enough.
{
  "rewrites": [
    { "source": "/docs", "destination": "https://replymaven.com/help/${slug}" },
    { "source": "/docs/:path*", "destination": "https://replymaven.com/help/${slug}/:path*" }
  ]
}`,
  },
  {
    id: "netlify",
    label: "Netlify",
    language: "text",
    build: (slug) =>
      `# netlify.toml or _redirects — status 200, not 301.
# Netlify sends X-Forwarded-Host as your domain. That is enough.
/docs                https://replymaven.com/help/${slug}                200
/docs/*              https://replymaven.com/help/${slug}/:splat         200`,
  },
  {
    id: "nginx",
    label: "Nginx",
    language: "nginx",
    build: (slug) =>
      `location ^~ /docs/ {
    proxy_pass https://replymaven.com/help/${slug}/;
    proxy_set_header Host replymaven.com;
    proxy_set_header X-ReplyMaven-Help-Proxy 1;
    proxy_set_header X-Forwarded-Host $host;
}
location = /docs {
    proxy_pass https://replymaven.com/help/${slug};
    proxy_set_header Host replymaven.com;
    proxy_set_header X-ReplyMaven-Help-Proxy 1;
    proxy_set_header X-Forwarded-Host $host;
}`,
  },
  {
    id: "nextjs",
    label: "Next.js",
    language: "typescript",
    build: (slug) =>
      `// middleware.ts — 200 rewrite, not a redirect.
// Use redirect: "manual" so a later 301 from the hosted path does not loop.
import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const upstream = new URL(
    pathname.replace(/^\\/docs/, "/help/${slug}") + search,
    "https://replymaven.com",
  );
  const headers = new Headers(request.headers);
  headers.set("X-ReplyMaven-Help-Proxy", "1");
  headers.set("X-Forwarded-Host", request.nextUrl.host);
  const res = await fetch(upstream, { headers, redirect: "manual" });
  return new NextResponse(res.body, {
    status: res.status,
    headers: res.headers,
  });
}

export const config = { matcher: ["/docs", "/docs/:path*"] };`,
  },
  {
    id: "aws",
    label: "AWS CloudFront",
    language: "javascript",
    build: (slug) =>
      `# CloudFront
# Origin: replymaven.com (HTTPS custom origin)
# Cache behavior path: /docs*
# Event: Lambda@Edge origin-request
#
# Rewrite /docs → /help/${slug}. Do not leave the origin path as /docs.
# That would hit ReplyMaven's own docs, not yours.

export async function handler(event) {
  const request = event.Records[0].cf.request;
  const viewerHost = request.headers.host[0].value;
  request.uri = request.uri.replace(/^\\/docs/, "/help/${slug}");
  request.headers["x-replymaven-help-proxy"] = [
    { key: "X-ReplyMaven-Help-Proxy", value: "1" },
  ];
  request.headers["x-forwarded-host"] = [
    { key: "X-Forwarded-Host", value: viewerHost },
  ];
  request.headers.host = [{ key: "Host", value: "replymaven.com" }];
  return request;
}`,
  },
];

export function ProxySetupBody({ projectSlug }: ProxySetupGuideProps) {
  const [activeTab, setActiveTab] = useState(GUIDES[0].id);
  const [copied, setCopied] = useState<string | null>(null);

  const active = GUIDES.find((g) => g.id === activeTab) ?? GUIDES[0];
  const snippet = active.build(projectSlug);

  function copyToClipboard(text: string, id: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
        <li>
          Add a <strong className="font-medium text-foreground">200 rewrite</strong>{" "}
          from <code className="rounded bg-muted px-1 py-0.5">/docs</code> to{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            https://replymaven.com/help/{projectSlug}
          </code>
          . A 301 on your side will break SEO.
        </li>
        <li>
          Send{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            X-ReplyMaven-Help-Proxy: 1
          </code>{" "}
          or{" "}
          <code className="rounded bg-muted px-1 py-0.5">X-Forwarded-Host</code>{" "}
          set to your domain. Without that, ReplyMaven 301s the hosted path
          and the rewrite loops.
        </li>
        <li>
          Also rewrite{" "}
          <code className="rounded bg-muted px-1 py-0.5">/docs/sitemap.xml</code>{" "}
          and{" "}
          <code className="rounded bg-muted px-1 py-0.5">/docs/robots.txt</code>.
        </li>
        <li>
          Use <strong className="font-medium text-foreground">Test connection</strong>
          , then save the custom URL. Do not save first.
        </li>
      </ol>

      <div className="flex flex-wrap gap-2">
        {GUIDES.map((guide) => (
          <button
            key={guide.id}
            type="button"
            onClick={() => setActiveTab(guide.id)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              activeTab === guide.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted",
            )}
          >
            {guide.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <pre className="overflow-x-auto rounded-xl bg-code text-code-foreground p-4 text-xs leading-relaxed">
          <code>{snippet}</code>
        </pre>
        <Button
          size="sm"
          variant="ghost"
          className="absolute top-2 right-2 h-8"
          onClick={() => copyToClipboard(snippet, active.id)}
        >
          {copied === active.id ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        The hosted URL{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">
          replymaven.com/help/{projectSlug}
        </code>{" "}
        is noindex. After you save, it 301s to your path.{" "}
        <a
          href="https://replymaven.com/docs/knowledge-base/host-help-on-your-own-domain"
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline underline-offset-2"
        >
          Full guide
        </a>
      </p>
    </div>
  );
}

export default ProxySetupBody;
