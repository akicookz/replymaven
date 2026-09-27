import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import AuthModal from "@/components/AuthModal";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/marketing-shell";
import { enterprisePlan } from "@/components/PricingCards";
import { usePageMeta } from "@/hooks/use-page-meta";
import { cn } from "@/lib/utils";

const FORM_SCRIPT = "https://cdn.linkycal.com/widgets/form.js";

interface LinkyCalGlobal {
  form: (options: Record<string, unknown>) => void;
}

function loadFormScript(): Promise<LinkyCalGlobal> {
  const existing = (window as Window & { LinkyCal?: LinkyCalGlobal }).LinkyCal;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${FORM_SCRIPT}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = FORM_SCRIPT;
      script.async = true;
      document.body.appendChild(script);
    }
    script.addEventListener("load", () => {
      const global = (window as Window & { LinkyCal?: LinkyCalGlobal }).LinkyCal;
      if (global) resolve(global);
      else reject(new Error("Form script loaded without LinkyCal"));
    });
    script.addEventListener("error", () => reject(new Error("Could not load the form")));
  });
}

const SALES_EMAIL = "sales@replymaven.com";

function SalesEmail() {
  const [copied, setCopied] = useState(false);
  return (
    <span className="group/email inline-flex items-center gap-1 whitespace-nowrap">
      <a href={`mailto:${SALES_EMAIL}`} className="text-ink-2 underline-offset-4 hover:underline">{SALES_EMAIL}</a>
      <button
        type="button"
        aria-label="Copy email address"
        onClick={() => {
          void navigator.clipboard.writeText(SALES_EMAIL).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        className={cn(
          "flex size-6 items-center justify-center rounded-md text-ink-6 opacity-0 transition-opacity hover:bg-glass-button hover:text-ink-1 focus-visible:opacity-100 group-hover/email:opacity-100",
          copied && "opacity-100",
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

function ContactSales() {
  usePageMeta({
    title: "Contact sales | ReplyMaven",
    description: "Talk to the ReplyMaven team about Enterprise: custom limits, SSO and SCIM, onboarding and team training, and a 99.9% uptime guarantee.",
    path: "/contact-sales",
  });
  const containerRef = useRef<HTMLDivElement>(null);
  // The iframe shrinks to fit the thank-you view; hold the tallest height so the page does not jump.
  const [formHeight, setFormHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sizes = new ResizeObserver((entries) => {
      const height = Math.round(entries[0]?.contentRect.height ?? 0);
      setFormHeight((prev) => Math.max(prev, height));
    });
    sizes.observe(container);
    return () => sizes.disconnect();
  }, []);
  const [authOpen, setAuthOpen] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    loadFormScript()
      .then((linkyCal) => {
        if (cancelled || !containerRef.current) return;
        // StrictMode mounts twice; start from an empty container each time.
        containerRef.current.innerHTML = "";
        linkyCal.form({
          projectSlug: "replymaven",
          formSlug: "contact-sales",
          container: "#linkycal-form",
          ui: { hideBanner: true, hideTitle: true, hideIntro: true },
          // The widget only derives field fills from backgroundColor; #121214 matches our input tone.
          theme: {
            primaryBg: "#2563eb",
            primaryText: "#ffffff",
            backgroundColor: "#121214",
            textColor: "#f4f4f5",
            borderRadius: 9,
          },
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="dark font-sans min-h-screen bg-background text-foreground antialiased">
      <MarketingHeader onAuth={() => setAuthOpen(true)} />

      <main>
        <div className="relative mx-auto grid max-w-6xl gap-10 px-6 pt-28 pb-24 md:pt-36 xl:grid-cols-[minmax(0,1fr)_45rem] xl:gap-12">
          <div>
            <h1 className="font-heading text-[2.4rem] leading-[1.05] font-medium tracking-[-0.03em] text-ink-1 sm:text-[3rem]">
              Talk to sales
            </h1>
            <p className="mt-5 max-w-md text-[1.05rem] leading-relaxed text-ink-5">
              Tell us about your team and support volume. We reply within one business day. Contact us via email at{" "}
              <SalesEmail />
            </p>
            <ul className="mt-10 space-y-3">
              {enterprisePlan.features.filter((f) => f !== "Everything in Business").map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-ink-5" />
                  <span className="text-ink-3">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* The form goes two-column from 768px; bleed by its iframe padding (24px, 40px from md) so fields align with the text. */}
          <div
            className="-mx-6 flex min-h-[28rem] max-w-[53rem] flex-col justify-center md:-mx-10 xl:-mt-14"
            style={formHeight ? { minHeight: formHeight } : undefined}
          >
            {status === "loading" && (
              <div className="flex h-[27rem] items-center justify-center">
                <Loader2 className="size-5 animate-spin text-ink-6" />
              </div>
            )}
            {status === "error" && (
              <div className="flex h-[27rem] flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-ink-4">The form did not load.</p>
                <Button variant="secondary" size="sm" asChild>
                  <a href={`mailto:${SALES_EMAIL}`}>Email {SALES_EMAIL}</a>
                </Button>
              </div>
            )}
            <div id="linkycal-form" ref={containerRef} />
          </div>
        </div>
      </main>

      <MarketingFooter />
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} callbackURL="/app/inbox" />
    </div>
  );
}

export default ContactSales;
