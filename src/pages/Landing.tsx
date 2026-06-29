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
  Check,
  ChevronDown,
  ArrowRight,
  Sparkles,
  Send,
  Zap,
  Wrench,
  Heart,
  BookOpen,
  Users,
  FolderOpen,
  Mail,
  Search,
  CheckCircle2,
  User,
  Calendar,
  Tag,
} from "lucide-react";
import { pricingPlans } from "@/components/PricingCards";
import { LogoIcon } from "@/components/Logo";
import { cn } from "@/lib/utils";

// ─── Pastel illustration gradients ─────────────────────────────────────────────

const GRADIENTS = {
  sage: "linear-gradient(150deg, #e4efe1 0%, #f4f1e7 100%)",
  cream: "linear-gradient(150deg, #f6edda 0%, #faf4ea 100%)",
  lavender: "linear-gradient(150deg, #e8e6f6 0%, #f0eff9 100%)",
  blue: "linear-gradient(150deg, #dcecfb 0%, #eef5fd 100%)",
  pink: "linear-gradient(150deg, #f6e2ec 0%, #faeef3 100%)",
  mist: "linear-gradient(150deg, #e6ecf0 0%, #f1f3f5 100%)",
} as const;

const DOTS = {
  backgroundImage: "url(/dots.svg)",
  backgroundRepeat: "repeat",
  backgroundSize: "8px 8px",
} as const;

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

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-left cursor-pointer group"
      >
        <span className="font-medium text-foreground text-base pr-4 transition-opacity group-hover:opacity-60">
          {question}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid transition-all duration-200 ease-in-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <p className="pb-5 text-[15px] text-muted-foreground leading-relaxed">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Logo ───────────────────────────────────────────────────────────────────

function LandingLogo() {
  return (
    <div className="flex items-center gap-2">
      <LogoIcon className="h-5 w-auto text-foreground shrink-0" />
      <span className="font-medium tracking-tight text-[15px] text-foreground">
        ReplyMaven
      </span>
    </div>
  );
}

// ─── Feature Card (pastel panel + mock + heading) ─────────────────────────────

function FeatureCard({
  gradient,
  title,
  description,
  children,
}: {
  gradient: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[1.75rem] border border-border bg-card p-3 transition-all duration-300 hover:-translate-y-1">
      <div
        className="relative rounded-[1.25rem] overflow-hidden aspect-[5/4] flex items-center justify-center"
        style={{ background: gradient }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40" style={DOTS} />
        <div className="relative w-full px-6">{children}</div>
      </div>
      <div className="px-3 pt-6 pb-3">
        <h3 className="text-xl font-medium tracking-tight text-foreground">{title}</h3>
        <p className="mt-2 text-[14px] text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

// ─── Mini mocks (illustrations inside feature panels) ─────────────────────────

function ChatMiniMock() {
  const botAvatar = (
    <div className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center shrink-0">
      <LogoIcon className="h-3.5 w-auto text-background" />
    </div>
  );
  return (
    <div className="w-full max-w-[280px] mx-auto space-y-2.5">
      <div className="flex items-end gap-2">
        {botAvatar}
        <div className="max-w-[200px] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-[11px] text-zinc-800">
          Hi! Ask me anything about Acme.
        </div>
      </div>
      <div className="flex items-end gap-2 flex-row-reverse">
        <img
          src="https://randomuser.me/api/portraits/women/68.jpg"
          alt="Visitor"
          loading="lazy"
          className="w-7 h-7 rounded-full object-cover shrink-0"
        />
        <div className="max-w-[200px] rounded-2xl rounded-br-sm bg-foreground px-3 py-2 text-[11px] text-background">
          How do I reset my password?
        </div>
      </div>
      <div className="flex items-end gap-2">
        {botAvatar}
        <div className="max-w-[210px] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-[11px] text-zinc-800">
          Open Settings → Security and tap “Reset.” I can email you the link too.
        </div>
      </div>
    </div>
  );
}

function KnowledgeMiniMock() {
  const rows = [
    { icon: Globe, label: "docs.acme.com", sub: "Web page" },
    { icon: FileText, label: "API Reference.pdf", sub: "12 pages" },
    { icon: BookOpen, label: "Billing FAQ", sub: "8 answers" },
  ];
  return (
    <div className="w-full max-w-[240px] mx-auto rounded-2xl bg-white p-2.5 space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 rounded-xl bg-black/[0.025] px-2 py-1.5">
          <div className="w-6 h-6 rounded-lg bg-white flex items-center justify-center shrink-0">
            <r.icon className="w-3 h-3 text-zinc-700" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-medium text-zinc-800 truncate">{r.label}</p>
            <p className="text-[8px] text-zinc-400">{r.sub}</p>
          </div>
          <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function WorkflowMiniMock() {
  const steps = [
    { icon: Zap, label: "Visitor asks a question", tag: "TRIGGER" },
    { icon: Search, label: "Search knowledge base" },
    { icon: Wrench, label: "Call lookup_order" },
  ];
  return (
    <div className="w-full max-w-[250px] mx-auto relative">
      <div className="absolute left-[1.45rem] top-7 bottom-7 w-px bg-black/10" />
      <div className="space-y-2.5 relative">
        {steps.map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-2"
          >
            <div className="w-7 h-7 rounded-lg bg-black/[0.04] flex items-center justify-center shrink-0">
              <s.icon className="w-3.5 h-3.5 text-zinc-700" />
            </div>
            <div className="min-w-0">
              {s.tag && (
                <p className="text-[7px] font-medium tracking-[0.12em] text-zinc-400">{s.tag}</p>
              )}
              <p className="text-[10px] font-medium text-zinc-800 leading-tight">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsMiniMock() {
  const bars = [42, 56, 36, 64, 50, 72, 54];
  return (
    <div className="w-full max-w-[240px] mx-auto rounded-2xl bg-white p-3.5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[8px] text-zinc-400">Resolved by AI</p>
          <p className="text-lg font-medium text-zinc-900 leading-none mt-0.5">89%</p>
        </div>
        <span className="text-[8px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
          +4%
        </span>
      </div>
      <div className="flex items-end gap-1 h-12">
        {bars.map((h, i) => (
          <div key={i} className="flex-1 rounded-t-sm bg-zinc-900/15" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

function FormMiniMock() {
  return (
    <div className="w-full max-w-[230px] mx-auto rounded-2xl bg-white p-3 space-y-2">
      <p className="text-[10px] font-medium text-zinc-900">Contact us</p>
      <div className="space-y-1.5">
        <div className="rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-[9px] text-zinc-700">Sarah Chen</div>
        <div className="rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-[9px] text-zinc-700 flex items-center gap-1.5">
          <Mail className="w-2.5 h-2.5 text-zinc-400" />
          sarah@acme.com
        </div>
        <div className="rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-[9px] text-zinc-400 min-h-[30px]">
          Enterprise pricing for 50+ seats…
        </div>
      </div>
      <div className="rounded-lg bg-foreground text-background text-[9px] font-medium py-1.5 text-center">
        Submit ticket
      </div>
    </div>
  );
}

function HandoffMiniMock() {
  return (
    <div className="w-full max-w-[240px] mx-auto rounded-2xl bg-white p-3 space-y-2">
      <div className="flex items-center gap-2 max-w-[88%]">
        <div className="w-5 h-5 rounded-full bg-black/[0.05] flex items-center justify-center shrink-0">
          <User className="w-2.5 h-2.5 text-zinc-400" />
        </div>
        <div className="rounded-xl rounded-bl-sm bg-black/[0.03] px-2.5 py-1.5 text-[9px] text-zinc-700">
          I have a billing dispute on my renewal.
        </div>
      </div>
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[8px] font-medium text-amber-700">
          <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
          Agent notified via Telegram
        </span>
      </div>
      <div className="flex items-center gap-2 max-w-[88%] ml-auto flex-row-reverse">
        <div className="w-5 h-5 rounded-full bg-foreground flex items-center justify-center shrink-0">
          <Sparkles className="w-2.5 h-2.5 text-background" />
        </div>
        <div className="rounded-xl rounded-br-sm bg-foreground px-2.5 py-1.5 text-[9px] text-background">
          Connecting you with Alex now.
        </div>
      </div>
    </div>
  );
}

// ─── Full chat widget (device frame) ──────────────────────────────────────────

function WidgetDeviceMock() {
  const botAvatar = (
    <div className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center shrink-0">
      <LogoIcon className="h-3.5 w-auto text-background" />
    </div>
  );
  return (
    <div className="px-5 py-6 space-y-3.5 bg-[#f4f4f6] min-h-[300px]">
      <div className="flex gap-2 items-end">
        {botAvatar}
        <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13px] text-zinc-800">
          Hi! I'm Luna. Ask me anything about Acme.
        </div>
      </div>
      <div className="flex gap-2 items-end flex-row-reverse">
        <img
          src="https://randomuser.me/api/portraits/women/68.jpg"
          alt="Visitor"
          loading="lazy"
          className="w-7 h-7 rounded-full object-cover shrink-0"
        />
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2.5 text-[13px] text-background">
          Do you integrate with Slack?
        </div>
      </div>
      <div className="flex gap-2 items-end">
        {botAvatar}
        <div className="max-w-[78%] space-y-1.5">
          <div className="rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13px] text-zinc-800">
            Yes — Slack, Telegram, and webhooks are all supported. Want the setup guide?
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 px-1">
            <BookOpen className="w-3 h-3" />
            Slack integration guide
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Integration hub illustration ─────────────────────────────────────────────

function IntegrationHub() {
  const tiles = [
    { icon: Calendar, bg: "#ffffff", fg: "#2563eb", ring: true },
    { icon: Mail, bg: "#5b8def", fg: "#ffffff" },
    { icon: Globe, bg: "#16181d", fg: "#ffffff" },
    { icon: Zap, bg: "#e8a33d", fg: "#ffffff" },
    { icon: Send, bg: "#5da9f0", fg: "#ffffff" },
    { icon: Code, bg: "#2f4538", fg: "#ffffff" },
    { icon: Sparkles, bg: "#16181d", fg: "#ffffff" },
    { icon: FileText, bg: "#8b5cf6", fg: "#ffffff" },
    { icon: Users, bg: "#2d6b7a", fg: "#ffffff" },
    { icon: Tag, bg: "#e0588f", fg: "#ffffff" },
  ];
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="grid grid-cols-5 gap-3 sm:gap-4">
        {tiles.map((t, i) => (
          <div
            key={i}
            className={cn(
              "aspect-square rounded-2xl flex items-center justify-center",
              t.ring && "ring-1 ring-black/5",
            )}
            style={{ background: t.bg }}
          >
            <t.icon className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: t.fg }} strokeWidth={2} />
          </div>
        ))}
      </div>
      <svg viewBox="0 0 500 90" className="w-full h-16 mt-1" fill="none" preserveAspectRatio="none">
        {[50, 150, 250, 350, 450].map((x, i) => (
          <path key={i} d={`M ${x} 2 C ${x} 52, 250 38, 250 88`} stroke="rgba(0,0,0,0.13)" strokeWidth="1.2" />
        ))}
      </svg>
    </div>
  );
}

// ─── Dashboard product mock (hero) ────────────────────────────────────────────

function DashboardMock() {
  return (
    <div className="flex gap-4 lg:gap-5">
      {/* Window 1 — Dashboard (2/3) */}
      <div className="flex-1 lg:flex-[2] min-w-0 rounded-3xl overflow-hidden border border-black/[0.07]" style={{ background: "#f7f7f9" }}>
        <div className="px-3.5 py-2.5 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex-1 text-center">
            <span className="text-[10px] text-black/45">replymaven.com/app</span>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-black/85">Hello, Maven</p>
            <p className="text-[11px] text-black/45">What are you working on?</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { icon: MessageSquare, label: "Total Conversations", value: "334" },
              { icon: Users, label: "Active Conversations", value: "1" },
              { icon: FolderOpen, label: "Knowledge Resources", value: "2" },
              { icon: Bot, label: "Pending Drafts", value: "0" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl p-3 border border-black/[0.08]" style={{ background: "#ffffff" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "#f0f0f2" }}>
                    <s.icon className="w-3 h-3 text-black/45" />
                  </div>
                  <span className="text-[9px] text-black/55 font-medium">{s.label}</span>
                </div>
                <span className="text-xl font-medium text-black/85">{s.value}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="rounded-xl p-4 border border-black/[0.08]" style={{ background: "#ffffff" }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-medium text-black/65">Conversations over time</span>
                <span className="flex items-center gap-1 text-[9px] text-black/45">
                  <span className="w-1.5 h-1.5 rounded-full bg-black/30" /> Conversations
                </span>
              </div>
              <div className="flex gap-[3px] items-end h-16">
                {[18, 22, 14, 16, 12, 15, 4].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-sm min-h-[3px]" style={{ height: `${(h / 24) * 100}%`, background: "rgba(0,0,0,0.13)" }} />
                ))}
              </div>
              <div className="flex gap-[3px] mt-1.5">
                {["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"].map((d) => (
                  <span key={d} className="flex-1 text-center text-[7px] text-black/35">{d}</span>
                ))}
              </div>
            </div>

            <div className="rounded-xl p-4 border border-black/[0.08]" style={{ background: "#ffffff" }}>
              <span className="text-[11px] font-medium text-black/65">Recent Tickets</span>
              <div className="mt-3 space-y-2">
                {[
                  { name: "Sarah Chen", email: "sarah@brightpath.io", time: "33m ago" },
                  { name: "Marcus Rivera", email: "marcus@novastack.dev", time: "4h ago" },
                  { name: "Emily Larsson", email: "emily@clearviewhq.com", time: "10h ago" },
                ].map((item) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(0,0,0,0.04)" }}>
                      <Mail className="w-2.5 h-2.5 text-black/55" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-black/75 truncate">{item.name}</p>
                      <p className="text-[8px] text-black/40 truncate">{item.email}</p>
                    </div>
                    <span className="text-[8px] text-black/35 shrink-0">{item.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-black/[0.08]" style={{ background: "#ffffff" }}>
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-black/65">Recent Conversations</span>
                <span className="text-[9px] text-black/45 bg-black/[0.06] px-1.5 py-0.5 rounded-full">5</span>
              </div>
              <span className="text-[9px] text-black/45">See all</span>
            </div>
            <div>
              {[
                { flag: "🇺🇸", name: "Sarah Chen", loc: "San Francisco, California", status: "Active", statusColor: "#22c55e", time: "28m ago" },
                { flag: "🇬🇧", name: "James Abbott", loc: "London, England", status: "Closed", statusColor: "#8a8a96", time: "1h ago" },
                { flag: "🇩🇪", name: "Lena Müller", loc: "Berlin, Germany", status: "Closed", statusColor: "#8a8a96", time: "2h ago" },
              ].map((c) => (
                <div key={c.name} className="flex items-center gap-3 px-4 py-2 hover:bg-black/[0.03] transition-colors">
                  <div className="relative shrink-0">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px]" style={{ background: "#f0f0f2" }}>
                      {c.flag}
                    </div>
                    {c.status === "Active" && (
                      <span className="absolute -bottom-px -right-px w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-medium text-black/75 truncate">{c.name}</p>
                    <p className="text-[8px] text-black/40 truncate flex items-center gap-0.5">
                      <Globe className="w-2 h-2" /> {c.loc}
                    </p>
                  </div>
                  <span
                    className="text-[8px] font-medium px-1.5 py-0.5 rounded-full border"
                    style={{ color: c.statusColor, backgroundColor: `${c.statusColor}15`, borderColor: `${c.statusColor}30` }}
                  >
                    {c.status}
                  </span>
                  <span className="text-[8px] text-black/35">{c.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Window 2 — Live conversation (1/3), staggered to read as a separate view */}
      <div className="hidden lg:flex lg:flex-1 min-w-0 flex-col rounded-3xl overflow-hidden border border-black/[0.07]" style={{ background: "#ffffff" }}>
        <div className="px-3.5 py-2.5 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex-1 text-center">
            <span className="text-[10px] text-black/45">replymaven.com/app/inbox</span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-3">
            <div className="relative shrink-0">
              <img src="https://randomuser.me/api/portraits/women/68.jpg" alt="" loading="lazy" className="w-7 h-7 rounded-full object-cover" />
              <span className="absolute -bottom-px -right-px w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-black/85 truncate">Sarah Chen</p>
              <p className="text-[8px] text-black/45 truncate">San Francisco, California</p>
            </div>
            <span className="text-[8px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">AI handling</span>
          </div>

          <div className="flex-1 p-3.5 space-y-2.5">
            <div className="flex justify-center">
              <span className="text-[7px] text-black/40 bg-black/[0.03] px-2 py-0.5 rounded-full">Today · 2:31 PM</span>
            </div>

            <div className="flex flex-col items-end gap-0.5">
              <div className="max-w-[82%] rounded-xl rounded-br-sm bg-foreground px-2.5 py-1.5 text-[9px] text-background">
                Where's my order #1042?
              </div>
              <span className="text-[7px] text-black/35 pr-1">2:31 PM</span>
            </div>

            <div className="flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2 py-1">
                <Wrench className="w-2.5 h-2.5 text-black/50" />
                <span className="text-[8px] font-mono text-black/60">lookup_order</span>
                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
              </span>
            </div>

            <div className="flex items-end gap-1.5">
              <div className="w-5 h-5 rounded-full bg-foreground flex items-center justify-center shrink-0">
                <LogoIcon className="h-2.5 w-auto text-background" />
              </div>
              <div className="flex flex-col items-start gap-0.5 max-w-[82%]">
                <div className="rounded-xl rounded-bl-sm bg-black/[0.04] px-2.5 py-1.5 text-[9px] text-zinc-800">
                  It shipped this morning via UPS — tracking 1Z999AA1, arriving Thursday.
                </div>
                <span className="text-[7px] text-black/35 pl-1">2:31 PM</span>
              </div>
            </div>

            <div className="flex flex-col items-end gap-0.5">
              <div className="max-w-[82%] rounded-xl rounded-br-sm bg-foreground px-2.5 py-1.5 text-[9px] text-background">
                I need it before my event Wednesday. Can it be expedited?
              </div>
              <span className="text-[7px] text-black/35 pr-1">2:32 PM</span>
            </div>

            <div className="flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-1">
                <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-[8px] font-medium text-amber-700">Summoning a human agent…</span>
              </span>
            </div>

            <div className="flex items-end gap-1.5">
              <img src="https://randomuser.me/api/portraits/men/32.jpg" alt="" loading="lazy" className="w-5 h-5 rounded-full object-cover shrink-0" />
              <div className="flex flex-col items-start gap-0.5">
                <div className="max-w-[170px] rounded-xl rounded-bl-sm bg-blue-50 px-2.5 py-1.5 text-[9px] text-zinc-800">
                  Hi, I'm Alex. Upgraded you to overnight at no charge — it'll arrive tomorrow by 10 AM.
                </div>
                <p className="text-[7px] text-black/40 pl-1">Alex · Support Engineer · 2:34 PM</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2.5">
            <div className="flex-1 h-6 rounded-full bg-black/[0.04]" />
            <div className="w-6 h-6 rounded-full bg-foreground flex items-center justify-center shrink-0">
              <Send className="w-3 h-3 text-background" />
            </div>
          </div>
        </div>
      </div>
  );
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

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
      <div className="flex items-center gap-1 p-1 rounded-full bg-muted w-fit mx-auto">
        <button
          type="button"
          onClick={() => setInterval("monthly")}
          className={cn(
            "px-5 py-2 rounded-full text-sm font-medium transition-all",
            interval === "monthly" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setInterval("annual")}
          className={cn(
            "px-5 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2",
            interval === "annual" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Annual
          <span className="text-[11px] font-medium">2 months free</span>
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
                "relative flex flex-col rounded-[1.5rem] p-7 bg-card",
                plan.highlighted ? "ring-2 ring-foreground/25" : "ring-1 ring-border",
                isCurrent && "ring-2 ring-foreground/40",
              )}
            >
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="text-[11px] bg-foreground text-background px-3 py-1 rounded-full font-medium">Current Plan</span>
                </div>
              )}

              <div className="space-y-4 pb-6">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm text-muted-foreground">{plan.name}</h3>
                  {plan.highlighted && plan.badge && (
                    <span className="text-[11px] bg-foreground text-background px-2 py-0.5 rounded-full font-medium">{plan.badge}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-medium text-foreground tracking-tight">${price}</span>
                  <span className="text-quaternary text-sm">
                    /mo
                    {interval === "annual" && <span className="ml-1 text-xs text-quaternary">(${plan.annualPrice}/yr)</span>}
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
                className="w-full rounded-xl h-11 text-sm font-medium transition-opacity cursor-pointer bg-foreground text-background hover:opacity-90"
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

// ─── Section heading helper ─────────────────────────────────────────────────

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="text-center max-w-2xl mx-auto">
      {eyebrow && (
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground mb-4">{eyebrow}</p>
      )}
      <h2 className="text-4xl sm:text-5xl font-medium tracking-tight leading-[1.05] text-foreground">{title}</h2>
      {subtitle && <p className="mt-5 text-lg text-muted-foreground leading-relaxed">{subtitle}</p>}
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [authOpen, setAuthOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<{ plan: string; interval: string } | null>(null);

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

  const steps = [
    {
      title: "Add your knowledge",
      desc: "Upload docs, paste URLs, or write FAQs. Everything is indexed automatically — no setup, no cleanup.",
    },
    {
      title: "Customize your agent",
      desc: "Match brand colors, set the tone of voice, and configure quick actions so the widget feels native to your site.",
    },
    {
      title: "Embed & go live",
      desc: "Paste one script tag or share a hosted link. Conversations and tickets start flowing in instantly.",
    },
  ];

  return (
    <div className="font-heading light min-h-screen bg-background text-foreground scroll-smooth overflow-x-hidden">
      {/* ── Navigation (floating pill) ────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-4 px-4">
        <nav className="bg-background/80 backdrop-blur-xl rounded-full px-2 pl-5 h-12 flex items-center gap-1 border border-border/50">
          <Link to="/" className="shrink-0 mr-3">
            <LandingLogo />
          </Link>

          <div className="hidden md:flex items-center gap-0.5">
            <a href="#features" className="px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors">Benefits</a>
            <a href="#how" className="px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors">How it works</a>
            <a href="#pricing" className="px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors">Pricing</a>
            <a href="#faq" className="px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors">FAQ</a>
            <Link to="/docs" className="px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors">Docs</Link>
          </div>

          <div className="flex items-center gap-2 ml-3">
            {isLoggedIn ? (
              <button type="button" onClick={() => navigate("/app")} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors px-3">Dashboard</button>
            ) : (
              <button type="button" onClick={handleGenericCta} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors px-3">Log in</button>
            )}
            <button type="button" onClick={handleGenericCta} className="bg-foreground text-background px-5 py-1.5 rounded-full text-[13px] font-medium hover:opacity-90 transition-opacity">
              Get Started
            </button>
          </div>
        </nav>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section
        className="relative pt-36 pb-28 rounded-b-[2.5rem] overflow-hidden"
        style={{ background: "linear-gradient(180deg, #eef1ec 0%, #f4f2ec 32%, #faf8f3 62%, #ffffff 100%)" }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50" style={DOTS} />
        <div className="relative max-w-5xl mx-auto px-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
          <h1 className="text-5xl sm:text-6xl lg:text-[4.75rem] font-medium text-foreground tracking-tight leading-[1.02] mb-6">
            Your 24/7 support agent
            <br />
            that can do{" "}
            <span className="underline decoration-foreground/40 decoration-[3px] underline-offset-[8px]">things</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-10">
            Train your AI agent on your docs, FAQs, and web pages. Go live with a fully branded chat widget in minutes. Automate 90% of support queries.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <button type="button" onClick={handleGenericCta} className="bg-foreground text-background px-8 py-3.5 rounded-full text-[15px] font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-2">
              Try ReplyMaven Free
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-center gap-6 text-sm text-quaternary">
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-foreground" />7-day free trial</span>
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-foreground" />5-minute setup</span>
            <span className="items-center gap-1.5 hidden sm:flex"><Check className="w-4 h-4 text-foreground" />Cancel anytime</span>
          </div>
        </div>

        <div className="relative max-w-5xl mx-auto px-6 mt-16 animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-200 fill-mode-both">
          <DashboardMock />
        </div>
      </section>

      {/* ── Feature cards (Ref 1) ─────────────────────────────────────── */}
      <section id="features" className="py-24 md:py-32 px-6">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="Benefits"
            title={<>A true support agent,<br className="hidden sm:block" /> not a chatbot</>}
            subtitle="Train it on your content, connect it to your tools, and let it resolve support around the clock — all from one platform."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            <FeatureCard
              gradient={GRADIENTS.sage}
              title="Answers you can trust"
              description="Retrieval-augmented generation answers from your docs, FAQs, and pages — every reply cites its source, no hallucination."
            >
              <ChatMiniMock />
            </FeatureCard>
            <FeatureCard
              gradient={GRADIENTS.blue}
              title="Trained on your docs"
              description="Upload PDFs, paste URLs, write FAQs. Everything is indexed and searchable the moment you add it."
            >
              <KnowledgeMiniMock />
            </FeatureCard>
            <FeatureCard
              gradient={GRADIENTS.lavender}
              title="Executes actions"
              description="Connect any REST API. The agent looks up orders, checks inventory, and triggers workflows on its own."
            >
              <WorkflowMiniMock />
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* ── Numbered steps + device frame (Ref 2) ─────────────────────── */}
      <section id="how" className="py-20 md:py-28 px-6 bg-muted/40">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <h2 className="text-4xl sm:text-5xl font-medium tracking-tight leading-[1.05] text-foreground">
              Simplify your<br />support workflow
            </h2>
            <div className="mt-10 space-y-8">
              {steps.map((s, i) => (
                <div key={s.title} className="flex gap-5">
                  <div className="shrink-0 w-11 h-11 rounded-xl bg-background border border-border flex items-center justify-center text-sm font-medium text-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-foreground">{s.title}</h3>
                    <p className="mt-1.5 text-[15px] text-muted-foreground leading-relaxed max-w-sm">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] p-5 sm:p-7" style={{ background: "#efeeea" }}>
            <div className="rounded-[1.4rem] bg-white overflow-hidden">
              <WidgetDeviceMock />
            </div>
            <div className="flex items-center justify-between mt-5 px-1">
              <p className="text-sm font-medium text-foreground">Embed anywhere — one script tag</p>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center"><Code className="w-4 h-4 text-foreground" /></span>
                <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center"><Globe className="w-4 h-4 text-foreground" /></span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-4 px-1">
              <span className="h-1.5 w-6 rounded-full bg-foreground" />
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Integration hub (Ref 3) ───────────────────────────────────── */}
      <section className="py-24 md:py-32 px-6">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <div className="relative rounded-[2rem] p-10 sm:p-16 overflow-hidden" style={{ background: "#f1f1ee" }}>
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40" style={DOTS} />
            <div className="relative">
              <IntegrationHub />
            </div>
          </div>
          <div>
            <h2 className="text-4xl sm:text-5xl font-medium tracking-tight leading-[1.05] text-foreground">
              One backend,<br />unlimited integrations
            </h2>
            <Link to="/docs" className="mt-7 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-6 py-3 text-sm font-medium hover:opacity-90 transition-opacity">
              <BookOpen className="w-4 h-4" />
              View documentation
            </Link>
            <p className="mt-7 text-lg text-muted-foreground leading-relaxed max-w-lg">
              “Connect your tools, pipe every conversation anywhere with webhooks, and let AI agents check inventory or look up orders through the built-in MCP server — seamlessly and securely.”
            </p>
          </div>
        </div>
      </section>

      {/* ── Feature cards #2 (Ref 1) ──────────────────────────────────── */}
      <section className="pb-24 md:pb-32 px-6">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            title={<>Built for real<br className="hidden sm:block" /> support teams</>}
            subtitle="Insights to improve, lead capture that converts, and a human in the loop the moment it matters."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            <FeatureCard
              gradient={GRADIENTS.cream}
              title="Shows what's working"
              description="Track conversations, resolution rates, response times, and handoffs. Know exactly how your agent performs."
            >
              <AnalyticsMiniMock />
            </FeatureCard>
            <FeatureCard
              gradient={GRADIENTS.pink}
              title="Captures every lead"
              description="Customizable forms with validation and pre-filled visitor data. Instant alerts via Telegram and email."
            >
              <FormMiniMock />
            </FeatureCard>
            <FeatureCard
              gradient={GRADIENTS.mist}
              title="Escalates to a human"
              description="When the AI isn't confident, it escalates to a human via Telegram — full context, same chat window."
            >
              <HandoffMiniMock />
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-6 bg-muted/40">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="Pricing"
            title={<>Powerful support,<br className="hidden sm:block" /> honest pricing</>}
          />
          <div className="mt-16">
            <LandingPricing
              onCtaClick={handlePricingCta}
              currentPlan={currentPlan}
              currentInterval={currentInterval}
              onManagePlan={handleManagePlan}
            />
          </div>

          <div className="mt-8 bg-card border border-border rounded-[1.5rem] p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="space-y-2 md:max-w-xs shrink-0">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-medium text-foreground">Enterprise</h3>
                  <span className="text-[11px] bg-foreground text-background px-2.5 py-1 rounded-full font-medium">Custom Pricing</span>
                </div>
                <p className="text-sm text-muted-foreground">For organizations with advanced needs. Unlimited everything with dedicated support.</p>
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

              <button type="button" onClick={handleGenericCta} className="shrink-0 inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-full text-sm font-medium hover:opacity-90 transition-opacity">
                Contact Sales
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section id="faq" className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <SectionHeading eyebrow="FAQ" title="Frequently asked questions" />
          <div className="mt-12 bg-card border border-border rounded-[1.5rem] px-8 py-2">
            {faqItems.map((item) => (
              <FaqItem key={item.question} question={item.question} answer={item.answer} />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ────────────────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="relative rounded-[2rem] px-10 py-16 text-center overflow-hidden" style={{ background: GRADIENTS.sage }}>
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40" style={DOTS} />
            <div className="relative">
              <h2 className="text-4xl sm:text-5xl font-medium text-foreground tracking-tight leading-[1.05] mb-4">
                Let's get started
              </h2>
              <p className="text-muted-foreground text-lg mb-8">Start your 7-day free trial today.</p>
              <button type="button" onClick={handleGenericCta} className="bg-foreground text-background px-8 py-3.5 rounded-full text-[15px] font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-2">
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className="bg-foreground max-w-7xl rounded-t-[2.5rem] mx-auto text-background pt-16 md:pt-24 pb-8 px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-14">
            <div className="col-span-2 md:col-span-1 space-y-4">
              <div className="flex items-center gap-2">
                <LogoIcon className="h-5 w-auto text-background shrink-0" />
                <span className="font-medium tracking-tight text-[15px]">ReplyMaven</span>
              </div>
              <p className="text-sm text-background/50 leading-relaxed">AI-powered customer support that knows your product.</p>
            </div>

            <div className="space-y-4">
              <h4 className="text-[11px] font-medium text-background/40 uppercase tracking-wider">Product</h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Benefits", href: "#features" },
                  { label: "Pricing", href: "#pricing" },
                  { label: "FAQ", href: "#faq" },
                ].map((item) => (
                  <li key={item.label}>
                    <a href={item.href} className="text-sm text-background/60 hover:text-background transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <h4 className="text-[11px] font-medium text-background/40 uppercase tracking-wider">Resources</h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Documentation", href: "/docs" },
                  { label: "Getting Started", href: "/docs" },
                ].map((item) => (
                  <li key={item.label}>
                    <Link to={item.href} className="text-sm text-background/60 hover:text-background transition-colors">{item.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="text-[11px] font-medium text-background/40 uppercase tracking-wider">Legal</h4>
              <ul className="space-y-2.5">
                {["Privacy Policy", "Terms of Service"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-background/60 hover:text-background transition-colors">{item}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-background/40">&copy; {new Date().getFullYear()} ReplyMaven. All rights reserved.</p>
            <a href="https://launchfast.shop/" target="_blank" className="text-sm text-background/40 flex items-center gap-2 hover:text-background/60 transition-colors">
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
