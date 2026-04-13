import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import AuthModal from "@/components/AuthModal";
import { useSession } from "@/lib/auth-client";
import { useSubscription } from "@/hooks/use-subscription";
import {
  MessageSquare,
  Globe,
  Bot,
  Code,
  FileText,
  Palette,
  Check,
  ChevronDown,
  ArrowRight,
  Sparkles,
  Send,
  Zap,
  Wrench,
  Heart,
  Shield,
  BookOpen,
  ClipboardList,
  Users,
  FolderOpen,
  Mail,
  LayoutDashboard,
  Inbox,
  Search,
  ExternalLink,
  BarChart3,
  Clock,
  CheckCircle2,
  AlertCircle,
  User,
  Phone,
  Building2,
  ChevronRight,
  Play,
  RefreshCw,
  TrendingUp,
  Eye,
} from "lucide-react";
import { pricingPlans } from "@/components/PricingCards";
import { cn } from "@/lib/utils";

// ─── FAQ Data ─────────────────────────────────────────────────────────────────

const faqItems = [
  {
    question: "How long does setup take?",
    answer:
      "Most teams are live in under 5 minutes. Add your knowledge sources, customize the look, copy one script tag onto your site, and you're done. No engineering work required.",
  },
  {
    question: "How accurate are the AI responses?",
    answer:
      "ReplyMaven uses retrieval-augmented generation (RAG) over your actual knowledge base -- docs, FAQs, and web pages you provide. The AI only answers from your content, so responses are grounded and accurate. When confidence is low, it automatically hands off to a human.",
  },
  {
    question: "Can I customize the widget's appearance?",
    answer:
      "Completely. You control colors, fonts, border radius, position, header text, avatar, tone of voice, intro message, quick actions, and even inject custom CSS. The widget will look native to your brand.",
  },
  {
    question: "What happens when the bot can't answer?",
    answer:
      "The conversation is seamlessly handed off to a live agent via Telegram. The agent sees the full conversation history and can reply directly -- the visitor sees the response in the same chat window. No context is lost.",
  },
  {
    question: "Is my data secure?",
    answer:
      "Your data stays on Cloudflare's global network. API keys and tokens are AES-GCM encrypted at rest. We don't train on your data or share it with third parties. Each project's knowledge base is fully isolated.",
  },
  {
    question: "Can I try it before committing?",
    answer:
      "Yes. Sign up for free and explore the full dashboard, add knowledge sources, and test the widget on your site.",
  },
];

// ─── FAQ Accordion Item ───────────────────────────────────────────────────────

function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-left cursor-pointer group"
      >
        <span className="font-normal text-foreground text-[15px] pr-4 group-hover:text-primary transition-colors">
          {question}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-quaternary shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid transition-all duration-200 ease-in-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <p className="pb-5 text-sm text-muted-foreground leading-relaxed">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Logo (inline for landing — light mode version) ──────────────────────────

function LandingLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-xl glow-surface flex items-center justify-center shrink-0">
        <svg viewBox="0 0 28 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-auto">
          <path
            d="M24 32H6C2.6875 32 0 29.3125 0 26V6C0 2.6875 2.6875 0 6 0H25C26.6562 0 28 1.34375 28 3V21C28 22.3062 27.1625 23.4187 26 23.8312V28C27.1063 28 28 28.8937 28 30C28 31.1063 27.1063 32 26 32H24ZM6 24C4.89375 24 4 24.8937 4 26C4 27.1063 4.89375 28 6 28H22V24H6Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <span className="font-semibold tracking-tight text-[15px] text-foreground">
        ReplyMaven
      </span>
    </div>
  );
}

// ─── Noise Card ─────────────────────────────────────────────────────────────

function NoiseCard({
  children,
  className,
  style,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  as?: "div" | "section";
}) {
  return (
    <Tag className={cn("relative overflow-hidden", className)} style={style}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "url(/dots.svg)",
          backgroundRepeat: "repeat",
          backgroundSize: "8px 8px",
          opacity: 0.5,
        }}
      />
      <div className="relative">{children}</div>
    </Tag>
  );
}

// ─── Light-Mode Pricing ──────────────────────────────────────────────────────

type PlanId = "starter" | "standard" | "business";
type Interval = "monthly" | "annual";

const PLAN_RANK: Record<PlanId, number> = { starter: 0, standard: 1, business: 2 };

function getLandingCtaLabel(
  cardPlan: PlanId,
  cardInterval: Interval,
  currentPlan?: PlanId | null,
  currentInterval?: Interval | null,
): string {
  if (!currentPlan || !currentInterval) return "Start 7-day free trial";
  const isSamePlan = cardPlan === currentPlan;
  const isSameInterval = cardInterval === currentInterval;
  if (isSamePlan && isSameInterval) return "Manage Plan";
  if (isSamePlan && !isSameInterval) return cardInterval === "annual" ? "Switch to annual" : "Switch to monthly";
  return PLAN_RANK[cardPlan] > PLAN_RANK[currentPlan] ? "Upgrade" : "Downgrade";
}

function LandingPricing({
  onCtaClick,
  currentPlan,
  currentInterval,
  onManagePlan,
}: {
  onCtaClick: (planId: PlanId, interval: Interval) => void;
  currentPlan?: PlanId | null;
  currentInterval?: Interval | null;
  onManagePlan?: () => void;
}) {
  const [interval, setInterval] = useState<Interval>("monthly");

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-1 p-1 rounded-full bg-muted w-fit">
        <button
          type="button"
          onClick={() => setInterval("monthly")}
          className={cn(
            "px-5 py-2 rounded-full text-sm font-medium transition-all",
            interval === "monthly"
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setInterval("annual")}
          className={cn(
            "px-5 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2",
            interval === "annual"
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Annual
          <span className="text-[11px] text-foreground font-semibold">
            2 months free
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {pricingPlans.map((plan) => {
          const price = interval === "monthly" ? plan.monthlyPrice : Math.floor(plan.annualPrice / 12);
          const ctaLabel = getLandingCtaLabel(plan.id, interval, currentPlan, currentInterval);
          const isCurrent = plan.id === currentPlan && interval === currentInterval;

          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-2xl p-7 transition-shadow",
                plan.highlighted
                  ? "bg-card ring-2 ring-foreground/20 shadow-lg shadow-foreground/[0.05]"
                  : "bg-card ring-1 ring-border shadow-sm",
                isCurrent && "ring-2 ring-foreground/30",
              )}
            >
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="text-[11px] glow-surface px-3 py-1 rounded-full font-medium">
                    Current Plan
                  </span>
                </div>
              )}

              <div className="space-y-4 pb-6">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm text-muted-foreground">{plan.name}</h3>
                  {plan.highlighted && plan.badge && (
                    <span className="text-[11px] glow-surface px-2 py-0.5 rounded-full font-medium">
                      {plan.badge}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-semibold text-foreground tracking-tight">
                    ${price}
                  </span>
                  <span className="text-quaternary text-sm">
                    /mo
                    {interval === "annual" && (
                      <span className="ml-1 text-xs text-quaternary">
                        (${plan.annualPrice}/yr)
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{plan.description}</p>
              </div>

              <ul className="space-y-3 flex-1 pb-7">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm">
                    <Check className="w-4 h-4 text-foreground shrink-0 mt-0.5" />
                    <span className="text-quaternary">{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => {
                  if (ctaLabel === "Manage Plan" && onManagePlan) {
                    onManagePlan();
                  } else {
                    onCtaClick(plan.id, interval);
                  }
                }}
                className={cn(
                  "w-full rounded-xl h-11 text-sm font-medium transition-colors cursor-pointer text-white",
                  plan.highlighted ? "glow-surface" : "bg-foreground hover:brightness-110",
                )}
                style={undefined}
              >
                {ctaLabel}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [authOpen, setAuthOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<{
    plan: string;
    interval: string;
  } | null>(null);

  const { data: session } = useSession();
  const { data: subData } = useSubscription();
  const isLoggedIn = !!session?.user;
  const currentPlan = isLoggedIn
    ? (subData?.subscription?.plan as "starter" | "standard" | "business" | undefined) ?? null
    : null;
  const currentInterval = isLoggedIn
    ? (subData?.subscription?.interval as "monthly" | "annual" | undefined) ?? null
    : null;

  function handlePricingCta(planId: "starter" | "standard" | "business", interval: "monthly" | "annual") {
    if (isLoggedIn) {
      navigate(`/app/onboarding?plan=${planId}&interval=${interval}`);
      return;
    }
    setSelectedPlan({ plan: planId, interval });
    setAuthOpen(true);
  }

  function handleGenericCta() {
    if (isLoggedIn) {
      navigate("/app");
      return;
    }
    setSelectedPlan(null);
    setAuthOpen(true);
  }

  function handleManagePlan() {
    navigate("/app/account");
  }

  const callbackParam = searchParams.get("callback");
  const authCallbackUrl = selectedPlan
    ? `/app/onboarding?plan=${selectedPlan.plan}&interval=${selectedPlan.interval}`
    : callbackParam
      ? callbackParam
      : "/app";

  return (
    <div className="light min-h-screen bg-background text-foreground scroll-smooth overflow-x-hidden">

      {/* ── Navigation (floating pill) ────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-4 px-4">
        <nav className="bg-background/80 backdrop-blur-xl rounded-full px-2 pl-5 h-12 flex items-center gap-1 shadow-[0_2px_20px_-4px_rgba(0,0,0,0.1)] border border-border/50">
          <Link to="/" className="shrink-0 mr-3">
            <LandingLogo />
          </Link>

          <div className="hidden md:flex items-center gap-0.5">
            <a href="#features" className="px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors">
              Features
            </a>
            <a href="#pricing" className="px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors">
              Pricing
            </a>
            <a href="#faq" className="px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors">
              FAQ
            </a>
            <Link to="/docs" className="px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors">
              Docs
            </Link>
          </div>

          <div className="flex items-center gap-2 ml-3">
            {isLoggedIn ? (
              <button
                type="button"
                onClick={() => navigate("/app")}
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors px-3"
              >
                Dashboard
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGenericCta}
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors px-3"
              >
                Log in
              </button>
            )}
            <button
              type="button"
              onClick={handleGenericCta}
              className="glow-surface px-5 py-1.5 rounded-full text-[13px] font-medium transition-all"
            >
              Get Started
            </button>
          </div>
        </nav>
      </header>

      {/* ── Hero Section ───────────────────────────────────────────────── */}
      <NoiseCard as="section" className="pt-36 pb-28 rounded-b-4xl border-b border-glow-surface" style={{ background: "linear-gradient(180deg, #fdf6ee 0%, #faf3ea 30%, #f7efe4 60%, #ffffff 100%)" }}>
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h1 className="font-heading text-5xl sm:text-6xl lg:text-[4.5rem] font-normal text-foreground tracking-tight leading-[1.1] mb-6">
            AI customer support agent
            <br />
            that knows your product
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-10">
            Train your AI agent on your docs, FAQs, and web pages. Go live with a fully branded chat widget in minutes. Automate 90% of support queries.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <button
              type="button"
              onClick={handleGenericCta}
              className="glow-surface px-8 py-3.5 rounded-full text-[15px] font-medium transition-all inline-flex items-center gap-2"
            >
              Try ReplyMaven Free
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-center gap-6 text-sm text-quaternary">
            <span className="flex items-center gap-1.5">
              <Check className="w-4 h-4 text-foreground" />
              7-day free trial
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="w-4 h-4 text-foreground" />
              5-minute setup
            </span>
            <span className="flex items-center gap-1.5 hidden sm:flex">
              <Check className="w-4 h-4 text-foreground" />
              Cancel anytime
            </span>
          </div>
        </div>

        {/* Product mock — dark dashboard matching the real app */}
        <div className="max-w-5xl mx-auto px-6 mt-16">
          <div className="rounded-4xl overflow-hidden shadow-[0_8px_60px_-12px_rgba(0,0,0,0.25)]" style={{ background: "#0b0600" }}>
            <div className="px-4 py-3 flex items-center gap-2 border-b border-white/[0.06]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                <div className="w-3 h-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="flex-1 text-center">
                <span className="text-[11px] text-white/30">replymaven.com/app</span>
              </div>
            </div>
            <div className="flex">
              {/* Sidebar */}
              <div className="hidden md:flex flex-col w-56 shrink-0 border-r border-white/[0.06] p-4 gap-4" style={{ background: "#0c0c10" }}>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg glow-surface flex items-center justify-center">
                    <svg viewBox="0 0 28 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-auto text-white">
                      <path d="M24 32H6C2.6875 32 0 29.3125 0 26V6C0 2.6875 2.6875 0 6 0H25C26.6562 0 28 1.34375 28 3V21C28 22.3062 27.1625 23.4187 26 23.8312V28C27.1063 28 28 28.8937 28 30C28 31.1063 27.1063 32 26 32H24ZM6 24C4.89375 24 4 24.8937 4 26C4 27.1063 4.89375 28 6 28H22V24H6Z" fill="currentColor" />
                    </svg>
                  </div>
                  <span className="text-[11px] font-semibold text-white/90">ReplyMaven</span>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(249,115,22,0.12)", boxShadow: "inset 0 8px 8px -6px rgba(249,115,22,0.25)" }}>
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-medium text-white/90">Dashboard</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg">
                    <MessageSquare className="w-3.5 h-3.5 text-white/30" />
                    <span className="text-[11px] text-white/40">Conversations</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg">
                    <FolderOpen className="w-3.5 h-3.5 text-white/30" />
                    <span className="text-[11px] text-white/40">Knowledgebase</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg">
                    <Inbox className="w-3.5 h-3.5 text-white/30" />
                    <span className="text-[11px] text-white/40">Inquiries</span>
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-[8px] text-white/20 uppercase tracking-wider font-medium px-2.5 mb-1">Configure</p>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg">
                      <Palette className="w-3.5 h-3.5 text-white/30" />
                      <span className="text-[11px] text-white/40">Widget Configuration</span>
                    </div>
                    <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg">
                      <Zap className="w-3.5 h-3.5 text-white/30" />
                      <span className="text-[11px] text-white/40">Quick Actions and Tools</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Main content */}
              <div className="flex-1 p-5 space-y-4 min-w-0" style={{ background: "#0b0600" }}>
                <div>
                  <p className="text-sm font-bold text-white/90">Hello, Maven</p>
                  <p className="text-[11px] text-white/30">What are you working on?</p>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { icon: MessageSquare, label: "Total Conversations", value: "334" },
                    { icon: Users, label: "Active Conversations", value: "1" },
                    { icon: FolderOpen, label: "Knowledge Resources", value: "2" },
                    { icon: Bot, label: "Pending Drafts", value: "0" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl p-3 border border-white/[0.06]" style={{ background: "#0c0c10" }}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "#1c1c22" }}>
                          <s.icon className="w-3 h-3 text-white/30" />
                        </div>
                        <span className="text-[9px] text-white/40 font-medium">{s.label}</span>
                      </div>
                      <span className="text-xl font-bold text-white/90">{s.value}</span>
                    </div>
                  ))}
                </div>

                {/* Chart + Inquiries row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="rounded-xl p-4 border border-white/[0.06]" style={{ background: "#0c0c10" }}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-semibold text-white/70">Conversations over time</span>
                      <span className="flex items-center gap-1 text-[9px] text-white/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-white/40" /> Conversations
                      </span>
                    </div>
                    <div className="flex gap-[3px] items-end h-16">
                      {[18, 22, 14, 16, 12, 15, 4].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t-sm min-h-[3px]" style={{ height: `${(h / 24) * 100}%`, background: "rgba(249,115,22,0.25)", boxShadow: "inset 0 4px 4px -2px rgba(249,115,22,0.4)" }} />
                      ))}
                    </div>
                    <div className="flex gap-[3px] mt-1.5">
                      {["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"].map((d) => (
                        <span key={d} className="flex-1 text-center text-[7px] text-white/20">{d}</span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl p-4 border border-white/[0.06]" style={{ background: "#0c0c10" }}>
                    <span className="text-[11px] font-semibold text-white/70">Recent Inquiries</span>
                    <div className="mt-3 space-y-2">
                      {[
                        { name: "Sarah Chen", email: "sarah@brightpath.io", time: "33m ago" },
                        { name: "Marcus Rivera", email: "marcus@novastack.dev", time: "4h ago" },
                        { name: "Emily Larsson", email: "emily@clearviewhq.com", time: "10h ago" },
                      ].map((item) => (
                        <div key={item.name} className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(249,115,22,0.08)" }}>
                            <Mail className="w-2.5 h-2.5 text-white/40" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-medium text-white/80 truncate">{item.name}</p>
                            <p className="text-[8px] text-white/25 truncate">{item.email}</p>
                          </div>
                          <span className="text-[8px] text-white/20 shrink-0">{item.time}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Recent Conversations */}
                <div className="rounded-xl border border-white/[0.06]" style={{ background: "#0c0c10" }}>
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-white/70">Recent Conversations</span>
                      <span className="text-[9px] text-white/30 bg-white/[0.06] px-1.5 py-0.5 rounded-full">5</span>
                    </div>
                    <span className="text-[9px] text-white/30">See all</span>
                  </div>
                  <div>
                    {[
                      { flag: "🇺🇸", name: "Sarah Chen", loc: "San Francisco, California", status: "Active", statusColor: "#22c55e", time: "28m ago" },
                      { flag: "🇬🇧", name: "James Abbott", loc: "London, England", status: "Closed", statusColor: "#8a8a96", time: "1h ago" },
                      { flag: "🇩🇪", name: "Lena Müller", loc: "Berlin, Germany", status: "Closed", statusColor: "#8a8a96", time: "2h ago" },
                    ].map((c) => (
                      <div key={c.name} className="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.02] transition-colors">
                        <div className="relative shrink-0">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px]" style={{ background: "#1c1c22" }}>
                            {c.flag}
                          </div>
                          {c.status === "Active" && (
                            <span className="absolute -bottom-px -right-px w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-[#0c0c10]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-medium text-white/80 truncate">{c.name}</p>
                          <p className="text-[8px] text-white/25 truncate flex items-center gap-0.5">
                            <Globe className="w-2 h-2" /> {c.loc}
                          </p>
                        </div>
                        <span
                          className="text-[8px] font-medium px-1.5 py-0.5 rounded-full border"
                          style={{
                            color: c.statusColor,
                            backgroundColor: `${c.statusColor}15`,
                            borderColor: `${c.statusColor}30`,
                          }}
                        >
                          {c.status}
                        </span>
                        <span className="text-[8px] text-white/20">{c.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </NoiseCard>

      {/* ── Feature Pillars ──────────────────────────────────────────── */}
      <section id="features" className="py-28 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-normal text-foreground tracking-tight leading-[1.15]">
            Not just a chatbot,
            <br />
            it's <span className="italic text-foreground">your</span> 10x support engineer.
          </h2>

          <div className="flex flex-wrap items-start justify-center gap-10 sm:gap-14 mt-16">
            {[
              { icon: BookOpen, label: "Trained on your docs" },
              { icon: Wrench, label: "Connect your tools" },
              { icon: Users, label: "Part of your team" },
              { icon: BarChart3, label: "Analytics" },
              { icon: Palette, label: "Customizable" },
            ].map((item) => (
              <div key={item.label} className="flex flex-col items-center gap-3 w-36">
                <item.icon className="w-8 h-8 text-foreground" strokeWidth={1.3} />
                <span className="text-sm text-foreground font-medium">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature 1: AI Chat Widget (Lavender) ─────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <NoiseCard className="rounded-[2rem] p-14 lg:p-20 min-h-[70vh] flex items-center" style={{ background: "#e8e0f4" }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center w-full">
              <div className="order-2 lg:order-1">
                <div className="bg-card rounded-2xl shadow-lg overflow-hidden max-w-sm w-full">
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full glow-surface flex items-center justify-center">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">Acme Support</p>
                      <p className="text-[11px] text-quaternary flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Online
                      </p>
                    </div>
                  </div>

                  <div className="px-4 pt-2 pb-1 flex gap-2">
                    {["Pricing", "How to integrate", "Refund policy"].map((topic) => (
                      <span key={topic} className="text-[10px] px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
                        {topic}
                      </span>
                    ))}
                  </div>

                  <div className="px-4 py-4 space-y-3 bg-muted/50">
                    <div className="flex items-end gap-2">
                      <div className="w-6 h-6 rounded-full glow-surface flex items-center justify-center shrink-0">
                        <Sparkles className="w-3 h-3" />
                      </div>
                      <div className="bg-card rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[13px] text-foreground shadow-sm max-w-[260px]">
                        Hi! I'm Luna, your AI assistant. How can I help?
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <div className="glow-surface rounded-2xl rounded-br-sm px-3.5 py-2.5 text-[13px] max-w-[240px]">
                        How do I integrate the widget?
                      </div>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="w-6 h-6 rounded-full glow-surface flex items-center justify-center shrink-0">
                        <Sparkles className="w-3 h-3" />
                      </div>
                      <div className="space-y-1.5">
                        <div className="bg-card rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[13px] text-foreground shadow-sm max-w-[260px]">
                          Just add a single script tag to your HTML:
                          <code className="block mt-1.5 text-[11px] bg-muted rounded-lg px-2.5 py-1.5 font-mono text-muted-foreground">
                            {'<script src="widget.js" />'}
                          </code>
                        </div>
                        <div className="flex items-center gap-3 px-1">
                          <div className="flex items-center gap-1">
                            <BookOpen className="w-3 h-3 text-quaternary" />
                            <span className="text-[10px] text-quaternary">Getting Started Guide</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <ExternalLink className="w-2.5 h-2.5 text-quaternary" />
                            <span className="text-[10px] text-quaternary">API Docs</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <div className="glow-surface rounded-2xl rounded-br-sm px-3.5 py-2.5 text-[13px] max-w-[240px]">
                        Can I customize the colors?
                      </div>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="w-6 h-6 rounded-full glow-surface flex items-center justify-center shrink-0">
                        <Sparkles className="w-3 h-3" />
                      </div>
                      <div className="bg-card rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[13px] text-foreground shadow-sm max-w-[260px]">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          Yes! Full customization available
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="px-3 py-2.5 flex items-center gap-2 bg-card">
                    <div className="flex-1 bg-muted rounded-full px-3.5 py-2 text-[13px] text-quaternary">
                      Type a message...
                    </div>
                    <div className="w-8 h-8 rounded-full glow-surface flex items-center justify-center">
                      <Send className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="order-1 lg:order-2 space-y-5">
                <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider">
                  AI Chat
                </p>
                <h2 className="font-heading text-3xl sm:text-4xl lg:text-[2.75rem] font-normal text-foreground tracking-tight leading-[1.15]">
                  Smart answers,
                  <br />
                  grounded in your docs
                </h2>
                <p className="text-muted-foreground leading-relaxed max-w-md">
                  Retrieval-augmented generation searches your docs, FAQs, and web pages. Every response cites its source -- no hallucination.
                </p>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {[
                    { icon: Globe, label: "Web resources" },
                    { icon: FileText, label: "PDF indexing" },
                    { icon: Bot, label: "AI responses" },
                    { icon: Sparkles, label: "RAG search" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2.5 text-sm text-foreground">
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </NoiseCard>
        </div>
      </section>

      {/* ── Feature 2: Knowledge Base (Blue) ──────────────────────────── */}
      <section className="py-24 md:py-36 px-6">
        <div className="max-w-6xl mx-auto">
          <NoiseCard className="rounded-[2rem] p-14 lg:p-20 min-h-[70vh] flex items-center" style={{ background: "#dbeffe" }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center w-full">
              <div className="space-y-5">
                <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider">
                  Knowledge Base
                </p>
                <h2 className="font-heading text-3xl sm:text-4xl lg:text-[2.75rem] font-normal text-foreground tracking-tight leading-[1.15]">
                  Train your very own
                  <br />
                  support agent — on your docs
                </h2>
                <p className="text-muted-foreground leading-relaxed max-w-md">
                  Upload docs, paste URLs, create FAQs. Everything is automatically indexed and searchable. The AI only answers from your verified knowledge.
                </p>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {[
                    { icon: Globe, label: "Web pages" },
                    { icon: FileText, label: "PDFs" },
                    { icon: BookOpen, label: "FAQs" },
                    { icon: Search, label: "Auto-indexing" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2.5 text-sm text-foreground">
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-card rounded-2xl shadow-lg overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-foreground" />
                    <span className="text-sm font-medium text-foreground">Knowledge Base</span>
                    <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">6 resources</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-muted rounded-lg px-2.5 py-1.5">
                    <Search className="w-3 h-3 text-quaternary" />
                    <span className="text-[11px] text-quaternary">Search...</span>
                  </div>
                </div>
                <div className="px-4 pb-4 space-y-2">
                  {[
                    { type: "webpage", icon: Globe, title: "Getting Started Guide", url: "docs.acme.com/getting-started", status: "indexed", time: "2m ago" },
                    { type: "pdf", icon: FileText, title: "API Reference v3.2.pdf", url: "12 pages · 2.4 MB", status: "indexed", time: "1h ago" },
                    { type: "faq", icon: BookOpen, title: "Billing & Pricing FAQ", url: "8 questions", status: "indexed", time: "3h ago" },
                    { type: "webpage", icon: Globe, title: "Troubleshooting Guide", url: "docs.acme.com/troubleshooting", status: "indexing", time: "Just now" },
                    { type: "pdf", icon: FileText, title: "Security Whitepaper.pdf", url: "24 pages · 5.1 MB", status: "indexed", time: "1d ago" },
                  ].map((resource) => (
                    <div key={resource.title} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/50 hover:bg-muted transition-colors">
                      <div className="w-8 h-8 rounded-lg glow-surface flex items-center justify-center shrink-0">
                        <resource.icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-foreground truncate">{resource.title}</p>
                        <p className="text-[11px] text-quaternary truncate">{resource.url}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {resource.status === "indexed" ? (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                            <CheckCircle2 className="w-3 h-3" />
                            Indexed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] text-amber-600">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Indexing
                          </span>
                        )}
                        <span className="text-[10px] text-quaternary">{resource.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 bg-muted/30 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-1">
                      <div className="w-5 h-5 rounded-full glow-surface flex items-center justify-center text-[8px]">AI</div>
                    </div>
                    <span className="text-[11px] text-quaternary">RAG search active · 847 chunks indexed</span>
                  </div>
                  <span className="text-[11px] text-foreground font-medium flex items-center gap-1 cursor-pointer">
                    Add resource <ChevronRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </div>
          </NoiseCard>
        </div>
      </section>

      {/* ── Feature 3: Tool Calls (Green) ─────────────────────────────── */}
      <section className="py-24 md:py-36 px-6">
        <div className="max-w-6xl mx-auto">
          <NoiseCard className="rounded-[2rem] p-14 lg:p-20 min-h-[70vh] flex items-center" style={{ background: "#d5edda" }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center w-full">
              <div className="order-2 lg:order-1">
                <div className="bg-card rounded-2xl shadow-lg overflow-hidden">
                  <div className="px-4 py-3 flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-foreground" />
                    <span className="text-sm font-medium text-foreground">Tool Configuration</span>
                  </div>
                  <div className="px-4 pb-4 space-y-3">
                    <div className="rounded-xl bg-muted/50 overflow-hidden">
                      <div className="px-3 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md glow-surface flex items-center justify-center">
                            <Search className="w-3 h-3" />
                          </div>
                          <span className="text-[12px] font-medium text-foreground">lookup_order</span>
                        </div>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                      </div>
                      <div className="px-3 pb-2.5">
                        <div className="bg-card rounded-lg p-2.5 font-mono text-[10px] text-foreground/70 space-y-1">
                          <p className="text-quaternary">// Request</p>
                          <p><span className="text-blue-600">GET</span> /api/orders/{'{order_id}'}</p>
                          <p className="text-quaternary mt-2">// Response</p>
                          <p>{'{'} <span className="text-emerald-600">"status"</span>: <span className="text-amber-600">"shipped"</span>,</p>
                          <p>{'  '}<span className="text-emerald-600">"tracking"</span>: <span className="text-amber-600">"1Z999..."</span> {'}'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-muted/50 overflow-hidden">
                      <div className="px-3 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md glow-surface flex items-center justify-center">
                            <RefreshCw className="w-3 h-3" />
                          </div>
                          <span className="text-[12px] font-medium text-foreground">check_inventory</span>
                        </div>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                      </div>
                      <div className="px-3 pb-2.5">
                        <div className="bg-card rounded-lg p-2.5 font-mono text-[10px] text-foreground/70 space-y-1">
                          <p className="text-quaternary">// Request</p>
                          <p><span className="text-blue-600">POST</span> /api/inventory/check</p>
                          <p className="text-quaternary mt-2">// Response</p>
                          <p>{'{'} <span className="text-emerald-600">"in_stock"</span>: <span className="text-blue-600">true</span>,</p>
                          <p>{'  '}<span className="text-emerald-600">"quantity"</span>: <span className="text-blue-600">47</span> {'}'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-muted/50 px-3 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md glow-surface flex items-center justify-center">
                          <Zap className="w-3 h-3" />
                        </div>
                        <span className="text-[12px] font-medium text-foreground">create_ticket</span>
                      </div>
                      <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">Draft</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="order-1 lg:order-2 space-y-5">
                <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider">
                  Tools & Actions
                </p>
                <h2 className="font-heading text-3xl sm:text-4xl lg:text-[2.75rem] font-normal text-foreground tracking-tight leading-[1.15]">
                  Go beyond
                  <br />
                  static answers
                </h2>
                <p className="text-muted-foreground leading-relaxed max-w-md">
                  Connect your AI to any REST API. The bot autonomously looks up orders, checks inventory, or triggers workflows -- 24/7.
                </p>
                <button
                  type="button"
                  onClick={handleGenericCta}
                  className="inline-flex items-center gap-2 bg-foreground/[0.07] hover:bg-foreground/[0.12] text-foreground px-5 py-2.5 rounded-full text-sm font-medium transition-colors"
                >
                  Learn more
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </NoiseCard>
        </div>
      </section>

      <section className="py-24 md:py-36 px-6">
        <div className="max-w-6xl mx-auto">
          <NoiseCard className="rounded-[2rem] p-14 lg:p-20 min-h-[70vh] flex items-center" style={{ background: "#f5f3ee" }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center w-full">
              <div className="space-y-5">
                <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider">
                  Analytics
                </p>
                <h2 className="font-heading text-3xl sm:text-4xl lg:text-[2.75rem] font-normal text-foreground tracking-tight leading-[1.15]">
                  See the full picture,
                  <br />
                  in real time
                </h2>
                <p className="text-muted-foreground leading-relaxed max-w-md">
                  Track conversations, response quality, handoff rates, and visitor engagement. Know exactly how your AI agent is performing.
                </p>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {[
                    { icon: BarChart3, label: "Conversation trends" },
                    { icon: Clock, label: "Response times" },
                    { icon: TrendingUp, label: "Resolution rates" },
                    { icon: Eye, label: "Live monitoring" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2.5 text-sm text-foreground">
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-card rounded-2xl shadow-lg overflow-hidden">
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      { label: "Total Conversations", value: "1,247", change: "+12%" },
                      { label: "AI Resolved", value: "89%", change: "+4%" },
                      { label: "Avg Response", value: "1.2s", change: "-0.3s" },
                    ].map((stat) => (
                      <div key={stat.label} className="rounded-xl bg-muted/50 p-3">
                        <p className="text-[10px] text-quaternary">{stat.label}</p>
                        <p className="text-lg font-semibold text-foreground mt-0.5">{stat.value}</p>
                        <p className="text-[10px] text-emerald-600 font-medium">{stat.change}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl bg-muted/50 p-3">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-medium text-foreground">Conversations this week</span>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-[9px] text-quaternary">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "rgba(249,115,22,0.6)" }} /> AI
                        </span>
                        <span className="flex items-center gap-1 text-[9px] text-quaternary">
                          <span className="w-1.5 h-1.5 rounded-full bg-foreground/20" /> Agent
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-[3px] items-end h-20">
                      {[
                        { ai: 32, agent: 4 },
                        { ai: 28, agent: 6 },
                        { ai: 45, agent: 3 },
                        { ai: 38, agent: 5 },
                        { ai: 42, agent: 2 },
                        { ai: 35, agent: 7 },
                        { ai: 22, agent: 1 },
                      ].map((d, i) => (
                        <div key={i} className="flex-1 flex flex-col gap-[1px] justify-end h-full">
                          <div className="rounded-t-sm" style={{ height: `${(d.ai / 50) * 100}%`, background: "rgba(249,115,22,0.3)", boxShadow: "inset 0 4px 4px -2px rgba(249,115,22,0.4)" }} />
                          <div className="rounded-b-sm bg-foreground/10" style={{ height: `${(d.agent / 50) * 100}%` }} />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-[3px] mt-1.5">
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                        <span key={d} className="flex-1 text-center text-[8px] text-quaternary">{d}</span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl bg-muted/50 p-3">
                    <span className="text-[11px] font-medium text-foreground">Active Conversations</span>
                    <div className="mt-2 space-y-1.5">
                      {[
                        { name: "Sarah Chen", msg: "How do I upgrade my plan?", time: "2m", status: "ai" },
                        { name: "James Abbott", msg: "I need help with the API", time: "5m", status: "agent" },
                        { name: "Lena Müller", msg: "Can I get a refund?", time: "8m", status: "ai" },
                      ].map((conv) => (
                        <div key={conv.name} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <User className="w-3 h-3 text-quaternary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-foreground truncate">{conv.name}</p>
                            <p className="text-[10px] text-quaternary truncate">{conv.msg}</p>
                          </div>
                          <span className="text-[9px] text-quaternary shrink-0">{conv.time}</span>
                          <span className={cn(
                            "text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
                            conv.status === "ai" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700",
                          )}>
                            {conv.status === "ai" ? "AI" : "Agent"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </NoiseCard>
        </div>
      </section>

      {/* ── Feature 5: Inquiry Forms (Pink) ───────────────────────────── */}
      <section className="py-24 md:py-36 px-6">
        <div className="max-w-6xl mx-auto">
          <NoiseCard className="rounded-[2rem] p-14 lg:p-20 min-h-[70vh] flex items-center" style={{ background: "#f4e0e8" }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center w-full">
              <div className="order-2 lg:order-1">
                <div className="bg-card rounded-2xl shadow-lg overflow-hidden max-w-sm w-full">
                  <div className="px-4 py-3 flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-foreground" />
                    <span className="text-sm font-medium text-foreground">Contact Form</span>
                  </div>
                  <div className="px-4 pb-4 space-y-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-foreground">Full Name</label>
                      <div className="bg-muted rounded-lg px-3 py-2 text-[13px] text-foreground">
                        Sarah Chen
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-foreground">Email</label>
                      <div className="bg-muted rounded-lg px-3 py-2 text-[13px] text-foreground flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-quaternary" />
                        sarah@brightpath.io
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-foreground">Phone</label>
                      <div className="bg-muted rounded-lg px-3 py-2 text-[13px] text-foreground flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-quaternary" />
                        +1 (555) 012-3456
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-foreground">Company</label>
                      <div className="bg-muted rounded-lg px-3 py-2 text-[13px] text-foreground flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-quaternary" />
                        BrightPath Inc.
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-foreground">Message</label>
                      <div className="bg-muted rounded-lg px-3 py-2 text-[13px] text-quaternary min-h-[60px]">
                        I'd like to discuss enterprise pricing for our team of 50+...
                      </div>
                    </div>
                    <div className="glow-surface rounded-xl py-2.5 text-center text-[13px] font-medium">
                      Submit Inquiry
                    </div>
                  </div>
                  <div className="px-4 py-2.5 bg-muted/30 flex items-center gap-2">
                    <AlertCircle className="w-3 h-3 text-quaternary" />
                    <span className="text-[10px] text-quaternary">Notifies via Telegram & email</span>
                  </div>
                </div>
              </div>

              <div className="order-1 lg:order-2 space-y-5">
                <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider">
                  Inquiry Forms
                </p>
                <h2 className="font-heading text-3xl sm:text-4xl lg:text-[2.75rem] font-normal text-foreground tracking-tight leading-[1.15]">
                  Capture leads
                  <br />
                  without friction
                </h2>
                <p className="text-muted-foreground leading-relaxed max-w-md">
                  Customizable contact forms with validation, pre-filled visitor data, and instant notifications to your team via Telegram and email.
                </p>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {[
                    { icon: ClipboardList, label: "Custom fields" },
                    { icon: Mail, label: "Email alerts" },
                    { icon: Send, label: "Telegram notify" },
                    { icon: Shield, label: "Spam protection" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2.5 text-sm text-foreground">
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </NoiseCard>
        </div>
      </section>

      {/* ── Feature 6: Live Agent Handoff (Warm neutral) ──────────────── */}
      <section className="pb-24 px-6">
        <div className="max-w-6xl mx-auto">
          <NoiseCard className="rounded-[2rem] p-14 lg:p-20 min-h-[70vh] flex items-center" style={{ background: "#f0ebe3" }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center w-full">
              <div className="space-y-5">
                <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider">
                  Live Agent Handoff
                </p>
                <h2 className="font-heading text-3xl sm:text-4xl lg:text-[2.75rem] font-normal text-foreground tracking-tight leading-[1.15]">
                  Seamless escalation
                  <br />
                  when AI isn't enough
                </h2>
                <p className="text-muted-foreground leading-relaxed max-w-md">
                  When the bot can't answer confidently, it hands off to a human via Telegram. The agent sees the full history and replies in the same chat window.
                </p>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {[
                    { icon: MessageSquare, label: "Telegram relay" },
                    { icon: Users, label: "Full context" },
                    { icon: Bot, label: "AI handback" },
                    { icon: Zap, label: "Instant notify" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2.5 text-sm text-foreground">
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-card rounded-2xl shadow-lg overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-foreground" />
                  <span className="text-sm font-medium text-foreground">Conversation</span>
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium ml-auto">
                    Waiting for agent
                  </span>
                </div>
                <div className="px-4 py-4 space-y-3 bg-muted/30">
                  <div className="flex items-end gap-2">
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <User className="w-3 h-3 text-quaternary" />
                    </div>
                    <div className="bg-card rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[13px] text-foreground shadow-sm max-w-[260px]">
                      I have a very specific billing issue with my annual plan renewal.
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="w-6 h-6 rounded-full glow-surface flex items-center justify-center shrink-0">
                      <Sparkles className="w-3 h-3" />
                    </div>
                    <div className="bg-card rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[13px] text-foreground shadow-sm max-w-[260px]">
                      Let me connect you with an engineer who can help with billing specifics. One moment!
                    </div>
                  </div>
                  <div className="flex items-center justify-center py-2">
                    <div className="flex items-center gap-2 bg-amber-50 rounded-full px-3 py-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      <span className="text-[11px] text-amber-700 font-medium">Agent notified via Telegram</span>
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <User className="w-3 h-3 text-blue-700" />
                    </div>
                    <div className="space-y-1">
                      <div className="bg-blue-50 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[13px] text-foreground shadow-sm max-w-[260px]">
                        Hi! I can see your account. Let me fix that billing cycle issue right now.
                      </div>
                      <p className="text-[10px] text-quaternary px-1">Alex · Support Engineer · via Telegram</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </NoiseCard>
        </div>
      </section>

      {/* ── How It Works ───────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 md:py-36 px-6 bg-muted">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider mb-4">
              How It Works
            </p>
            <h2 className="font-heading text-3xl sm:text-4xl lg:text-[2.75rem] font-normal text-foreground tracking-tight leading-[1.15]">
              Go live in minutes
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-card rounded-2xl p-8 space-y-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background text-sm font-semibold">1</span>
                <div className="w-10 h-10 rounded-xl glow-surface flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
              </div>
              <h3 className="text-lg font-medium text-foreground">Add your knowledge</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Upload docs, paste URLs, or write FAQs. Everything is indexed automatically.</p>
              <div className="bg-muted rounded-xl p-3 space-y-2 mt-2">
                {[
                  { icon: Globe, label: "docs.acme.com", status: true },
                  { icon: FileText, label: "API Reference.pdf", status: true },
                  { icon: BookOpen, label: "Billing FAQ", status: false },
                ].map((r) => (
                  <div key={r.label} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md glow-surface flex items-center justify-center">
                      <r.icon className="w-2.5 h-2.5" />
                    </div>
                    <span className="text-[11px] text-foreground flex-1 truncate">{r.label}</span>
                    {r.status ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <RefreshCw className="w-3 h-3 text-amber-600 animate-spin" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card rounded-2xl p-8 space-y-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background text-sm font-semibold">2</span>
                <div className="w-10 h-10 rounded-xl glow-surface flex items-center justify-center">
                  <Palette className="w-5 h-5" />
                </div>
              </div>
              <h3 className="text-lg font-medium text-foreground">Customize your bot</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Match brand colors, set tone of voice, configure quick actions. Make it yours.</p>
              <div className="bg-muted rounded-xl p-3 space-y-2.5 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-quaternary">Primary Color</span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-full" style={{ background: "#f97316" }} />
                    <span className="text-[10px] text-foreground font-mono">#f97316</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-quaternary">Tone</span>
                  <span className="text-[10px] bg-card text-foreground px-2 py-0.5 rounded-full">Friendly</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-quaternary">Bot Name</span>
                  <span className="text-[10px] text-foreground">Luna</span>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-2xl p-8 space-y-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background text-sm font-semibold">3</span>
                <div className="w-10 h-10 rounded-xl glow-surface flex items-center justify-center">
                  <Code className="w-5 h-5" />
                </div>
              </div>
              <h3 className="text-lg font-medium text-foreground">Embed & go live</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Copy one script tag into your site. Your AI support bot is live and ready.</p>
              <div className="bg-muted rounded-xl p-3 mt-2">
                <div className="font-mono text-[10px] text-foreground/70 leading-relaxed">
                  <span className="text-quaternary">{'<!-- Add to your HTML -->'}</span>
                  <br />
                  <span className="text-blue-600">{'<script'}</span>
                  <br />
                  {'  '}<span className="text-emerald-600">src</span>=<span className="text-amber-600">"widget.js"</span>
                  <br />
                  {'  '}<span className="text-emerald-600">data-project</span>=<span className="text-amber-600">"your-slug"</span>
                  <br />
                  <span className="text-blue-600">{'>'}</span><span className="text-blue-600">{'</script>'}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
                  <Play className="w-3 h-3 text-emerald-600" />
                  <span className="text-[10px] text-emerald-600 font-medium">Widget is live!</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider mb-4">
              Pricing
            </p>
            <h2 className="font-heading text-3xl sm:text-4xl lg:text-[2.75rem] font-normal text-foreground tracking-tight leading-[1.15]">
              Powerful AI support agent
              <br className="hidden sm:block" />
              at unbeatable price
            </h2>
          </div>

          <LandingPricing
            onCtaClick={handlePricingCta}
            currentPlan={currentPlan}
            currentInterval={currentInterval}
            onManagePlan={handleManagePlan}
          />

          <div className="mt-8 bg-muted rounded-2xl p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="space-y-2 md:max-w-xs shrink-0">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-medium text-foreground">Enterprise</h3>
                  <span className="text-[11px] glow-surface px-2.5 py-1 rounded-full font-medium">
                    Custom Pricing
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  For organizations with advanced needs. Unlimited everything with dedicated support.
                </p>
              </div>

              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {[
                  "Unlimited projects & messages",
                  "SLA & uptime guarantee",
                  "Dedicated account manager",
                  "SSO & advanced security",
                ].map((feature) => (
                  <span key={feature} className="flex items-center gap-2 text-sm text-foreground">
                    <Check className="w-4 h-4 text-foreground shrink-0" />
                    {feature}
                  </span>
                ))}
              </div>

              <button
                type="button"
                onClick={handleGenericCta}
                className="shrink-0 inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-full text-sm font-medium hover:brightness-110 transition-all"
              >
                Contact Sales
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-24 px-6 bg-muted">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider mb-4">
              FAQ
            </p>
            <h2 className="font-heading text-3xl sm:text-4xl lg:text-[2.75rem] font-normal text-foreground tracking-tight leading-[1.15]">
              Frequently asked questions
            </h2>
          </div>

          <div className="bg-card rounded-2xl px-8 py-2">
            {faqItems.map((item) => (
              <FaqItem
                key={item.question}
                question={item.question}
                answer={item.answer}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ─────────────────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <NoiseCard className="rounded-[2rem] px-10 py-14 text-center" style={{ background: "#d5edda" }}>
            <h2 className="font-heading italic text-3xl sm:text-4xl lg:text-5xl font-normal text-foreground tracking-tight mb-4">
              Let's get started
            </h2>
            <p className="text-muted-foreground text-lg mb-8">
              Start your 7-day free trial today.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                type="button"
                onClick={handleGenericCta}
                className="glow-surface px-8 py-3.5 rounded-full text-[15px] font-medium transition-all inline-flex items-center gap-2"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </NoiseCard>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="bg-foreground max-w-7xl rounded-t-4xl mx-auto text-background pt-16 md:pt-24 pb-8 px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-14">
            <div className="col-span-2 md:col-span-1 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl glow-surface flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 28 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-auto">
                    <path
                      d="M24 32H6C2.6875 32 0 29.3125 0 26V6C0 2.6875 2.6875 0 6 0H25C26.6562 0 28 1.34375 28 3V21C28 22.3062 27.1625 23.4187 26 23.8312V28C27.1063 28 28 28.8937 28 30C28 31.1063 27.1063 32 26 32H24ZM6 24C4.89375 24 4 24.8937 4 26C4 27.1063 4.89375 28 6 28H22V24H6Z"
                      fill="currentColor"
                    />
                  </svg>
                </div>
                <span className="font-semibold tracking-tight text-[15px]">ReplyMaven</span>
              </div>
              <p className="text-sm text-background/50 leading-relaxed">
                AI-powered customer support that knows your product.
              </p>
            </div>

            <div className="space-y-4">
              <h4 className="text-[11px] font-medium text-background/40 uppercase tracking-wider">
                Product
              </h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Features", href: "#features" },
                  { label: "Pricing", href: "#pricing" },
                  { label: "FAQ", href: "#faq" },
                ].map((item) => (
                  <li key={item.label}>
                    <a href={item.href} className="text-sm text-background/60 hover:text-background transition-colors">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <h4 className="text-[11px] font-medium text-background/40 uppercase tracking-wider">
                Resources
              </h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Documentation", href: "/docs" },
                  { label: "Getting Started", href: "/docs" },
                ].map((item) => (
                  <li key={item.label}>
                    <Link to={item.href} className="text-sm text-background/60 hover:text-background transition-colors">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="text-[11px] font-medium text-background/40 uppercase tracking-wider">
                Legal
              </h4>
              <ul className="space-y-2.5">
                {["Privacy Policy", "Terms of Service"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-background/60 hover:text-background transition-colors">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-background/10 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-background/40">
              &copy; {new Date().getFullYear()} ReplyMaven. All rights reserved.
            </p>
            <a href="https://launchfast.shop/" target="_blank" className={cn("text-sm text-background/40 flex items-center gap-2 hover:text-background/60 transition-colors")}>
              <Heart className="w-4 h-4 text-background/40" /> LaunchFast.shop product
            </a>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} callbackURL={authCallbackUrl} />
    </div>
  );
}

export default Landing;
