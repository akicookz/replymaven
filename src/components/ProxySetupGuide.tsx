import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
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
#
# Or use a Worker:
addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/docs")) {
    const upstream = new URL(
      url.pathname.replace(/^\\/docs/, "/help/${slug}") + url.search,
      "https://replymaven.com",
    );
    event.respondWith(fetch(upstream, event.request));
  }
});`,
  },
  {
    id: "vercel",
    label: "Vercel",
    language: "json",
    build: (slug) =>
      `// vercel.json
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
      `# netlify.toml or _redirects
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
}
location = /docs {
    proxy_pass https://replymaven.com/help/${slug};
    proxy_set_header Host replymaven.com;
}`,
  },
];

function ProxySetupGuide({ projectSlug }: ProxySetupGuideProps) {
  const [activeTab, setActiveTab] = useState(GUIDES[0].id);
  const [expanded, setExpanded] = useState(false);
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
    <div className="rounded-2xl bg-card/50 backdrop-blur-xl border border-border p-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            How to set up a reverse proxy
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Forward `/docs/*` from your domain to ReplyMaven.
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-5 w-5 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="mt-6 space-y-4">
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
            Make sure your proxy also forwards{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">
              /docs/sitemap.xml
            </code>{" "}
            and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">
              /docs/robots.txt
            </code>
            .
          </p>
        </div>
      )}
    </div>
  );
}

export default ProxySetupGuide;
