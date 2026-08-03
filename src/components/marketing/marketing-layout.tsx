import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import AuthModal from "@/components/AuthModal";
import { LogoIcon } from "@/components/Logo";
import {
  MarketingActionsContext,
  useMarketingActions,
  type MarketingInterval,
  type MarketingPlanId,
} from "@/components/marketing/marketing-context";
import { Cta } from "@/components/ui/cta";
import { useSubscription } from "@/hooks/use-subscription";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface MarketingLayoutProps {
  children: ReactNode;
  title: string;
  description: string;
}

const productLinks = [
  { label: "AI Agent", to: "/ai-agent" },
  { label: "Inbox", to: "/inbox" },
  { label: "Help Center", to: "/help-center" },
  { label: "Actions", to: "/actions" },
  { label: "MCP", to: "/mcp" },
] as const;

function useMarketingMetadata(title: string, description: string) {
  const location = useLocation();

  useEffect(() => {
    document.title = title;

    let descriptionTag = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (!descriptionTag) {
      descriptionTag = document.createElement("meta");
      descriptionTag.name = "description";
      document.head.append(descriptionTag);
    }
    descriptionTag.content = description;

    let canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.append(canonical);
    }
    canonical.href = `https://replymaven.com${location.pathname}`;
  }, [description, location.pathname, title]);
}

function MarketingHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isLoggedIn, startTrial } = useMarketingActions();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-4">
      <nav
        aria-label="Primary navigation"
        className="relative mx-auto flex min-h-14 max-w-6xl items-center justify-between rounded-2xl bg-[#0f1015]/85 px-3 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_18px_50px_-30px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:px-4"
      >
        <Link
          to="/"
          className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-ink-1"
          aria-label="ReplyMaven home"
        >
          <LogoIcon className="h-5 w-auto shrink-0" />
          <span className="text-[15px] font-semibold tracking-tight">
            ReplyMaven
          </span>
        </Link>

        <div className="hidden items-center lg:flex">
          {productLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                "flex min-h-10 items-center rounded-lg px-3 text-[13px] transition-colors duration-150",
                location.pathname === link.to
                  ? "bg-white/[0.06] text-ink-1"
                  : "text-ink-5 hover:text-ink-1",
              )}
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/#pricing"
            className="flex min-h-10 items-center rounded-lg px-3 text-[13px] text-ink-5 transition-colors duration-150 hover:text-ink-1"
          >
            Pricing
          </Link>
        </div>

        <div className="flex items-center gap-1.5">
          <Cta
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => navigate(isLoggedIn ? "/app" : "/docs")}
          >
            {isLoggedIn ? "Dashboard" : "Docs"}
          </Cta>
          <Cta variant="primary" size="sm" onClick={startTrial}>
            {isLoggedIn ? "Open app" : "Start free"}
          </Cta>
          <button
            type="button"
            className="relative flex size-10 items-center justify-center rounded-xl text-ink-3 transition-[background-color,color] duration-150 hover:bg-white/[0.06] hover:text-ink-1 lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls="marketing-mobile-menu"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <span
              className={cn(
                "absolute transition-[opacity,filter,scale] duration-300 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
                mobileOpen
                  ? "scale-100 opacity-100 blur-0"
                  : "scale-[0.25] opacity-0 blur-[4px]",
              )}
            >
              <X className="size-5" />
            </span>
            <span
              className={cn(
                "transition-[opacity,filter,scale] duration-300 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
                mobileOpen
                  ? "scale-[0.25] opacity-0 blur-[4px]"
                  : "scale-100 opacity-100 blur-0",
              )}
            >
              <Menu className="size-5" />
            </span>
          </button>
        </div>

        <div
          id="marketing-mobile-menu"
          className={cn(
            "absolute inset-x-0 top-[calc(100%+8px)] origin-top rounded-2xl bg-[#111217]/95 p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_24px_60px_-24px_rgba(0,0,0,0.95)] backdrop-blur-2xl transition-[opacity,transform,visibility] duration-200 motion-reduce:transition-none lg:hidden",
            mobileOpen
              ? "visible translate-y-0 opacity-100"
              : "invisible -translate-y-2 opacity-0",
          )}
        >
          {productLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                "flex min-h-11 items-center rounded-xl px-3 text-sm transition-colors duration-150",
                location.pathname === link.to
                  ? "bg-white/[0.06] text-ink-1"
                  : "text-ink-4 hover:bg-white/[0.04] hover:text-ink-1",
              )}
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/#pricing"
            className="flex min-h-11 items-center rounded-xl px-3 text-sm text-ink-4 transition-colors duration-150 hover:bg-white/[0.04] hover:text-ink-1"
          >
            Pricing
          </Link>
        </div>
      </nav>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="px-6 pb-10 pt-20">
      <div className="mx-auto max-w-6xl rounded-[28px] bg-white/[0.025] p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] sm:p-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Link to="/" className="inline-flex min-h-11 items-center gap-2">
              <LogoIcon className="h-5 w-auto text-ink-1" />
              <span className="text-[15px] font-semibold text-ink-1">
                ReplyMaven
              </span>
            </Link>
            <p className="mt-3 max-w-sm text-pretty text-sm leading-6 text-ink-6">
              Turn support into a word-of-mouth growth engine.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-7">
              Product
            </p>
            <div className="mt-4 grid gap-1">
              {productLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex min-h-10 items-center text-sm text-ink-5 transition-colors duration-150 hover:text-ink-1"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-7">
              Resources
            </p>
            <div className="mt-4 grid gap-1">
              <Link
                to="/docs"
                className="flex min-h-10 items-center text-sm text-ink-5 transition-colors duration-150 hover:text-ink-1"
              >
                Documentation
              </Link>
              <Link
                to="/#pricing"
                className="flex min-h-10 items-center text-sm text-ink-5 transition-colors duration-150 hover:text-ink-1"
              >
                Pricing
              </Link>
            </div>
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 text-sm text-ink-7 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; 2026 ReplyMaven. All rights reserved.</p>
          <p>Built for teams that care about every customer.</p>
        </div>
      </div>
    </footer>
  );
}

export function MarketingLayout({
  children,
  title,
  description,
}: MarketingLayoutProps) {
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("/app");
  const { data: session } = useSession();
  const { data: subscriptionData } = useSubscription();
  const isLoggedIn = Boolean(session?.user);
  const currentPlan = isLoggedIn
    ? (subscriptionData?.subscription?.plan as MarketingPlanId | undefined) ??
      null
    : null;
  const currentInterval = isLoggedIn
    ? (subscriptionData?.subscription?.interval as
        | MarketingInterval
        | undefined) ?? null
    : null;

  useMarketingMetadata(title, description);

  function openAuth(nextUrl: string) {
    setCallbackUrl(nextUrl);
    setAuthOpen(true);
  }

  function startTrial() {
    if (isLoggedIn) {
      navigate("/app");
      return;
    }
    openAuth("/app/onboarding");
  }

  function selectPlan(plan: MarketingPlanId, interval: MarketingInterval) {
    const nextUrl = `/app/onboarding?plan=${plan}&interval=${interval}`;
    if (isLoggedIn) {
      navigate(nextUrl);
      return;
    }
    openAuth(nextUrl);
  }

  function managePlan() {
    navigate("/app/account");
  }

  return (
    <MarketingActionsContext.Provider
      value={{
        isLoggedIn,
        currentPlan,
        currentInterval,
        startTrial,
        selectPlan,
        managePlan,
      }}
    >
      <div className="dark min-h-screen overflow-x-hidden bg-background font-sans text-foreground antialiased">
        <MarketingHeader />
        <main>{children}</main>
        <MarketingFooter />
        <AuthModal
          open={authOpen}
          onOpenChange={setAuthOpen}
          callbackURL={callbackUrl}
        />
      </div>
    </MarketingActionsContext.Provider>
  );
}

export function StartTrialCta({
  label = "Start free trial",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { startTrial } = useMarketingActions();

  return (
    <Cta variant="primary" size="lg" onClick={startTrial} className={className}>
      {label}
      <ArrowRight className="size-4" />
    </Cta>
  );
}
