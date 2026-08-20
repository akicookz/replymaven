import { useState, type ReactNode, type SVGProps } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProxySetupGuideProps {
  projectSlug: string;
}

interface GuideTab {
  id: string;
  label: string;
  Logo: (props: SVGProps<SVGSVGElement>) => ReactNode;
  build: (slug: string) => string;
}

const GUIDE_URL =
  "https://replymaven.com/docs/knowledge-base/host-help-on-your-own-domain";

function CloudflareLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M16.51 16.87c.35-.15.65-.4.84-.72.38-.65.35-1.47-.08-2.08a2.02 2.02 0 0 0-1.72-.8l-.18.01-.13-.1a3.86 3.86 0 0 0-2.85-1.2c-.3 0-.6.04-.9.11l-.27.08-.2-.2a2.97 2.97 0 0 0-4.55 1.4l-.07.22-.24.05a2.17 2.17 0 0 0-1.67 2.1c0 .18.02.36.07.54l.06.2h11.9Z" />
    </svg>
  );
}

function VercelLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 2 24 22.53H0L12 2Z" />
    </svg>
  );
}

function NetlifyLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M6.75 12 12 6.75 17.25 12 12 17.25 6.75 12Zm5.25-9.5L2.5 12 12 21.5 21.5 12 12 2.5Z" />
    </svg>
  );
}

function NextjsLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c2.24 0 4.3-.74 5.96-2L9.2 8.4h1.86l6.16 8.96A7.96 7.96 0 0 0 20 12c0-4.42-3.58-8-8-8Zm-.2 5.2h1.7v7.55h-1.7V7.2Z" />
    </svg>
  );
}

function AwsLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M6.8 13.6c.7.5 2.2 1 3.9 1 1.9 0 3.3-.6 3.3-1.5 0-.7-.6-1.1-2-1.4l-1.5-.3c-2.2-.5-3.6-1.5-3.6-3.3 0-2.1 1.9-3.6 4.9-3.6 1.7 0 3 .4 3.8.8l-.8 1.8c-.6-.3-1.7-.7-3-.7-1.7 0-2.5.6-2.5 1.3 0 .7.7 1 2.2 1.4l1.4.3c2.4.6 3.8 1.6 3.8 3.4 0 2.2-1.8 3.8-5.4 3.8-1.9 0-3.6-.4-4.6-1l.1-2Z" />
      <path d="M5.4 19.2c2.4 1.8 5.9 2.8 8.8 2.8 2.2 0 4.3-.5 6-1.4.4-.2.7.1.5.5-1.8 3-6.1 4-10 3.2-2.4-.5-4.6-1.6-6.1-3-.3-.3 0-.7.8-.2Z" />
    </svg>
  );
}

function NginxLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 2 3.5 7v10L12 22l8.5-5V7L12 2Zm-.7 5.8h1.6L16 14.4V7.8h1.6v8.4h-1.7l-3.2-6.8v6.8H11.1L7.8 9.3v7h-1.6V7.8h1.8l3.3 6.8V7.8Z" />
    </svg>
  );
}

const GUIDES: GuideTab[] = [
  {
    id: "cloudflare",
    label: "Cloudflare",
    Logo: CloudflareLogo,
    build: (slug) =>
      `// Cloudflare Worker on your zone. Add a route for /docs*
// Transform Rules cannot proxy to replymaven.com. Use a Worker.

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/docs" && !url.pathname.startsWith("/docs/")) {
      return fetch(request);
    }
    const upstream = new URL(
      url.pathname.replace(/^\\/docs/, "/help/${slug}") + url.search,
      "https://replymaven.com",
    );
    const headers = new Headers(request.headers);
    headers.set("X-ReplyMaven-Help-Proxy", "1");
    headers.set("X-Forwarded-Host", url.host);
    return fetch(upstream, { headers, redirect: "manual" });
  },
};`,
  },
  {
    id: "vercel",
    label: "Vercel",
    Logo: VercelLogo,
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
    Logo: NetlifyLogo,
    build: (slug) =>
      `# netlify.toml or _redirects — status 200, not 301.
# Netlify sends X-Forwarded-Host as your domain. That is enough.
/docs                https://replymaven.com/help/${slug}                200
/docs/*              https://replymaven.com/help/${slug}/:splat         200`,
  },
  {
    id: "nextjs",
    label: "Next.js",
    Logo: NextjsLogo,
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
    label: "CloudFront",
    Logo: AwsLogo,
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
  {
    id: "nginx",
    label: "Nginx",
    Logo: NginxLogo,
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

      <p className="text-xs text-muted-foreground">
        The hosted URL{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">
          replymaven.com/help/{projectSlug}
        </code>{" "}
        is noindex. After you save, it 301s to your path.{" "}
        <a
          href={GUIDE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-foreground underline underline-offset-2"
        >
          Full guide
          <ExternalLink className="size-3" />
        </a>
      </p>

      <div className="grid grid-cols-3 gap-2">
        {GUIDES.map((guide) => (
          <button
            key={guide.id}
            type="button"
            onClick={() => setActiveTab(guide.id)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl px-2 py-3 text-xs font-medium transition-colors",
              activeTab === guide.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted",
            )}
          >
            <guide.Logo className="size-5" />
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
    </div>
  );
}

export default ProxySetupBody;
