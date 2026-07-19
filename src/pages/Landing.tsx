import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import AuthModal from "@/components/AuthModal";
import { useSession } from "@/lib/auth-client";
import { useSubscription } from "@/hooks/use-subscription";
import {
  Check,
  ChevronDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Heart,
  Inbox,
  Mail,
  Clock,
  Flag,
  CheckCircle2,
  FileText,
  Plug,
  Command,
  CornerDownLeft,
  CornerUpLeft,
  Paperclip,
  Wand2,
  ChevronRight,
  PanelLeftClose,
  LayoutDashboard,
  FolderOpen,
  Palette,
  Home,
  Zap,
  UserPlus,
  MoreHorizontal,
  SlidersHorizontal,
  Search,
} from "lucide-react";
import { pricingPlans } from "@/components/PricingCards";
import { LogoIcon } from "@/components/Logo";
import { Cta } from "@/components/ui/cta";
import { cn } from "@/lib/utils";

// ─── FAQ Data ─────────────────────────────────────────────────────────────────

const faqItems = [
  {
    question: "How long does setup take?",
    answer:
      "Most teams are live in under five minutes. Point Maven at your docs, drop one script tag on your site, and conversations start flowing into the inbox. No engineering project required.",
  },
  {
    question: "How does the AI agent resolve tickets?",
    answer:
      "Maven answers from your docs, FAQs, and SOPs using retrieval-augmented generation, so every reply is grounded and cites its source. It triages the queue, and with your tools connected it takes real actions — looking up an order, checking status, triggering a workflow — then resolves the ticket. When it isn't confident, it hands off to a human with full context.",
  },
  {
    question: "What is MCP support?",
    answer:
      "Your support stack is exposed over the Model Context Protocol, so any AI agent — yours or your customers' — can read tickets, look up orders, resolve issues, and update your docs programmatically, with scoped, secure access. It's support built for an AI-native workflow.",
  },
  {
    question: "Do you host our help center?",
    answer:
      "Yes. Publish a hosted help center from the same knowledge base Maven answers from — write once, and your articles power both the AI agent and your public docs site.",
  },
  {
    question: "Is my data secure?",
    answer:
      "Your data stays on Cloudflare's global network. API keys and tokens are AES-GCM encrypted at rest. We don't train on your data or share it with third parties, and each project's knowledge base is fully isolated.",
  },
  {
    question: "Can I try it before committing?",
    answer:
      "Yes. Start a free trial and explore the whole platform — inbox, AI agent, knowledge base, and MCP — and test the widget on your own site before you pay.",
  },
];

// ─── Small primitives ───────────────────────────────────────────────────────

/** Mono structural label, e.g. a section number or FIG marker. */
function Mono({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-[11px] uppercase tracking-[0.14em] tabular-nums",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Glass window frame for product mocks. */
function Window({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-hairline-strong bg-[#0d0e12] overflow-hidden shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── Inbox mock: faithful 3-pane support dashboard ───────────────────────────

const NAV_INBOX = [
  { icon: Inbox, label: "Needs You", count: "3" },
  { icon: Mail, label: "All Conversations", count: "871", active: true },
  { icon: Clock, label: "Snoozed", count: "0" },
  { icon: CheckCircle2, label: "Resolved", count: "871" },
  { icon: Flag, label: "Flagged", count: "1" },
];
const NAV_WORKSPACE = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: FolderOpen, label: "Knowledgebase" },
  { icon: BookOpen, label: "Help Center" },
];
const NAV_WIDGET = [
  { icon: Palette, label: "Configuration" },
  { icon: Home, label: "Home Screen" },
  { icon: Zap, label: "Quick Actions" },
];

const INBOX_ROWS = [
  { flag: "🇺🇸", name: "Marcus Bennett", email: "marcus@brightlabs.io", sub: "I was charged $90 but my plan is $49/mo — can you check?", t: "12h", sel: true },
  { flag: "🇬🇧", name: "Priya Shah", email: "priya@oakhouse.co", sub: "Maven drafted a reply from your docs", t: "22h" },
  { flag: "🇩🇪", name: "Lukas Weber", email: "lukas@finchpay.de", sub: "Can you help me connect a custom domain to my app?", t: "1d" },
  { flag: "🇸🇪", name: "Anna Lindqvist", email: "anna@nordipanel.se", sub: "I think I was double-charged on the Pro plan this month.", t: "22h", unread: true },
  { flag: "🇫🇷", name: "Camille Laurent", email: "camille@belleve.fr", sub: "How do I add a second teammate to my workspace?", t: "4d" },
  { flag: "🇨🇦", name: "Owen Clarke", email: "owen@maplestack.ca", sub: "The chat widget isn’t loading on mobile — any ideas?", t: "4d" },
  { flag: "🇳🇱", name: "Daan Visser", email: "daan@tulipgrid.nl", sub: "Is there a way to export all conversations to CSV?", t: "5d" },
];

// A real SaaS support scenario — billing proration + a teammate invite the
// agent actually executes. (m = Maven AI, v = visitor)
const INBOX_THREAD: { who: "m" | "v"; t: string; body: React.ReactNode; src?: string }[] = [
  { who: "m", t: "2:49 PM", src: "Billing · proration policy", body: <>Found it. You upgraded from <span className="font-semibold">Starter</span> to <span className="font-semibold">Pro</span> on Jun 18, so this invoice has a one-time prorated charge of $41 for the mid-cycle upgrade, plus the $49 Pro base. Next month it’ll be a flat $49.</> },
  { who: "v", t: "2:50 PM", body: <>Ah, that makes sense. Can I add a teammate to the plan too?</> },
  { who: "m", t: "2:50 PM", body: <>Absolutely — Pro includes 5 seats and you’re using 2. You can invite them under <span className="font-semibold">Settings → Members</span>, or share their email and I’ll send it now.</> },
  { who: "v", t: "2:52 PM", body: <>Could you invite sam@brightlabs.io?</> },
  { who: "m", t: "2:53 PM", body: <>Done ✅ I’ve sent Sam an invite to join your workspace as an <span className="font-semibold">Editor</span> — they’ll get an email to set up their account.</> },
  { who: "v", t: "2:54 PM", body: <>Perfect, thank you so much!</> },
  { who: "m", t: "2:54 PM", body: <>Anytime, Marcus! 🙌 I’ll keep this open in case you need anything else with the upgrade. Have a great day!</> },
];

function NavGroup({ title, items }: { title: string; items: { icon: React.ComponentType<{ className?: string }>; label: string; count?: string; active?: boolean }[] }) {
  return (
    <div>
      <Mono className="block px-2 pt-3 pb-1 text-ink-7">{title}</Mono>
      <div className="space-y-0.5">
        {items.map((it) => (
          <div key={it.label} className={cn("flex items-center gap-2.5 px-2 py-[7px] rounded-lg text-[12.5px]", it.active ? "bg-brand/15 text-ink-1" : "text-ink-5")}>
            <it.icon className={cn("w-[15px] h-[15px] shrink-0", it.active ? "text-brand" : "text-ink-6")} />
            <span className="flex-1 truncate">{it.label}</span>
            {it.count && <span className={cn("text-[10.5px] tabular-nums", it.active ? "text-brand" : "text-ink-7")}>{it.count}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function InboxMock() {
  return (
    <Window className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_236px] lg:grid-cols-[208px_280px_minmax(0,1fr)] grid-rows-[600px] h-[600px]">
      {/* ── Sidebar ── */}
      <aside className="hidden lg:flex flex-col px-3 pt-3 pb-2 border-r border-hairline min-h-0 overflow-hidden">
        <div className="flex items-center justify-between px-2 h-9">
          <div className="flex items-center gap-2">
            <LogoIcon className="h-[18px] w-auto text-foreground shrink-0" />
            <span className="text-[13px] font-semibold text-ink-1">ReplyMaven</span>
          </div>
          <PanelLeftClose className="w-4 h-4 text-ink-6" />
        </div>
        <button type="button" className="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-hairline">
          <span className="text-[13px] font-medium text-ink-2 flex-1 text-left">Northwind</span>
          <ChevronDown className="w-3.5 h-3.5 text-ink-6" />
        </button>
        <nav className="flex-1 mt-1">
          <NavGroup title="Inbox" items={NAV_INBOX} />
          <NavGroup title="Workspace" items={NAV_WORKSPACE} />
          <NavGroup title="Widget" items={NAV_WIDGET} />
        </nav>
        <div className="px-2 py-2 rounded-lg bg-white/[0.03] mt-2">
          <div className="flex items-center justify-between">
            <Mono className="text-ink-7">Business</Mono>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full w-[11%] rounded-full bg-brand" /></div>
          <p className="text-[10px] text-ink-7 mt-1">215 / 2,000 messages</p>
        </div>
        <div className="flex items-center gap-2.5 px-1 pt-2.5">
          <span className="w-7 h-7 rounded-full bg-brand/15 text-brand text-[11px] font-semibold inline-flex items-center justify-center">A</span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-ink-2 truncate">Alex Rivera</p>
            <p className="text-[10.5px] text-ink-6 truncate">alex@northwind.com</p>
          </div>
        </div>
      </aside>

      {/* ── Conversation list ── */}
      <div className="hidden sm:flex flex-col border-r border-hairline min-h-0">
        <div className="px-3.5 pt-3.5 pb-2 flex items-start justify-between">
          <div>
            <h3 className="text-[17px] font-bold tracking-[-0.3px] text-ink-1">All Conversations</h3>
            <p className="text-[11px] text-ink-7 mt-0.5">871 total · 0 unread</p>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-6 h-6 rounded-md bg-white/[0.05] inline-flex items-center justify-center text-ink-5"><SlidersHorizontal className="w-3 h-3" /></span>
            <span className="w-6 h-6 rounded-md bg-white/[0.05] inline-flex items-center justify-center text-ink-5"><MoreHorizontal className="w-3 h-3" /></span>
          </div>
        </div>
        <div className="px-3 pb-2">
          <div className="h-8 rounded-lg bg-white/[0.04] flex items-center gap-2 px-2.5">
            <Search className="w-3 h-3 text-ink-6" />
            <span className="text-[12px] text-ink-6 flex-1">Search</span>
            <span className="keycap text-ink-7">⌘K</span>
          </div>
        </div>
        <div className="flex-1 overflow-hidden px-2 space-y-px">
          {INBOX_ROWS.map((c) => (
            <div key={c.name} className={cn("flex items-start gap-2 rounded-[9px] px-2.5 py-2.5", c.sel && "bg-bubble-sent")}>
              <span className={cn("w-1.5 h-1.5 rounded-full mt-[7px] shrink-0", c.unread && !c.sel ? "bg-brand" : "bg-transparent")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-[13.5px] font-semibold truncate", c.sel ? "text-white" : "text-ink-2")}>{c.flag} {c.name}</span>
                  <span className={cn("text-[10.5px] shrink-0", c.sel ? "text-white/70" : "text-ink-6")}>{c.t}</span>
                </div>
                <p className={cn("text-[12px] truncate mt-px", c.sel ? "text-white/95" : "text-ink-4")}>{c.email}</p>
                <p className={cn("text-[12px] truncate mt-0.5", c.sel ? "text-white/80" : "text-ink-6")}>{c.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Reading pane ── */}
      <div className="flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* toolbar */}
        <div className="flex items-center justify-between px-3 h-11 border-b border-hairline">
          <div className="flex items-center gap-1">
            {[CornerUpLeft, CheckCircle2, Clock, Flag].map((Ic, i) => (
              <span key={i} className="w-7 h-7 rounded-md hover:bg-white/[0.05] inline-flex items-center justify-center text-ink-5"><Ic className="w-3.5 h-3.5" /></span>
            ))}
            <span className="ml-1 px-2 h-7 rounded-md inline-flex items-center gap-1 text-ink-5 text-[11px]"><UserPlus className="w-3.5 h-3.5" /><ChevronDown className="w-3 h-3" /></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-2 h-7 inline-flex items-center gap-1.5 rounded-md text-[11px] text-ink-3 border border-hairline-strong">Focus <span className="keycap text-ink-6">F</span></span>
            <span className="hidden md:flex w-32 h-7 rounded-md bg-white/[0.04] items-center gap-1.5 px-2 text-ink-6 text-[11px]"><Search className="w-3 h-3" /> Search…</span>
          </div>
        </div>
        {/* user bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-hairline">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-full bg-brand/15 text-brand text-[12px] font-semibold inline-flex items-center justify-center shrink-0">MB</span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-ink-1 truncate">🇺🇸 Marcus Bennett</p>
              <p className="text-[11px] text-ink-6 flex items-center gap-1.5 flex-wrap">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-dot-green inline-block" /> Open</span>
                <span className="text-ink-8">·</span> Austin, TX
                <span className="text-ink-8">·</span> Pro plan
                <span className="text-ink-8">·</span> Chrome 149
              </p>
            </div>
          </div>
          <span className="hidden md:inline-flex px-2.5 h-7 items-center rounded-md text-[11px] text-ink-4 bg-white/[0.04]">Priority · Medium</span>
        </div>
        {/* thread (scrolled to bottom) */}
        <div className="relative flex-1 min-h-0">
          <div aria-hidden className="absolute top-0 inset-x-0 h-8 bg-gradient-to-b from-[#0d0e12] to-transparent z-10" />
          <div className="absolute inset-0 flex flex-col justify-end overflow-hidden px-5 pb-3">
            <div className="flex justify-center my-3"><Mono className="text-ink-8">Today</Mono></div>
            {INBOX_THREAD.map((m, i) => (
              <div key={i} className={cn("flex flex-col mb-3", m.who === "v" ? "items-start" : "items-end")}>
                <div className={cn("flex items-baseline gap-2 mb-1", m.who === "v" ? "text-ink-5" : "text-brand-label")}>
                  <span className="text-[11.5px] font-semibold">{m.who === "v" ? "Marcus Bennett" : "Maven · AI"}</span>
                  <span className="text-[10.5px] text-ink-8">{m.t}</span>
                </div>
                <div className={cn("max-w-[78%] px-[14px] py-[9px] text-[13.5px] leading-[1.5]", m.who === "v" ? "bg-bubble-received text-ink-2 rounded-[18px_18px_18px_5px]" : "bg-bubble-sent text-white rounded-[18px_18px_5px_18px]")}>{m.body}</div>
                {m.src && <span className="mt-1 text-[10px] text-ink-7 flex items-center gap-1"><FileText className="w-2.5 h-2.5" /> Source · {m.src}</span>}
              </div>
            ))}
          </div>
        </div>
        {/* composer */}
        <div className="px-3 pb-3 pt-1">
          <div className="rounded-[14px] border border-hairline-strong bg-white/[0.03] px-3 py-2.5">
            <p className="text-[12.5px] text-ink-7">Reply…</p>
            <div className="flex items-center justify-between mt-2">
              <Paperclip className="w-4 h-4 text-ink-6" />
              <div className="flex items-center gap-2.5 text-[11px] text-ink-6">
                <span className="flex items-center gap-1"><Wand2 className="w-3 h-3" /> Rewrite <span className="keycap text-ink-7">R</span></span>
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Resolve <span className="keycap text-ink-7">E</span></span>
                <span className="w-7 h-7 rounded-full bg-brand inline-flex items-center justify-center text-white"><CornerDownLeft className="w-3.5 h-3.5" /></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Window>
  );
}

// ─── Section mock: Focus mode ─────────────────────────────────────────────────

const FOCUS_THREAD: { who: "m" | "v"; body: string }[] = [
  { who: "v", body: "Hey — I just got charged $90 this month, but my plan is supposed to be $49. Can you check what happened?" },
  { who: "m", body: "Found it. You upgraded from Starter to Pro on Jun 18, so this invoice has a one-time prorated charge of $41, plus the $49 Pro base. Next month it’s a flat $49." },
  { who: "v", body: "Ah, that makes sense. Can I add a teammate to the plan too?" },
  { who: "m", body: "Absolutely — Pro includes 5 seats and you’re using 2. Share their email and I’ll send the invite now." },
];

function FocusMock() {
  return (
    <Window className="p-6 sm:p-9 flex items-center justify-center min-h-[400px] bg-[#0b0c10]">
      <div className="w-full max-w-[440px]">
        <div className="rounded-[16px] border border-hairline-strong bg-[#15161c] overflow-hidden shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between px-4 h-12 border-b border-hairline">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-full bg-brand/15 text-brand text-[11px] font-semibold inline-flex items-center justify-center">MB</span>
              <div>
                <p className="text-[13px] font-semibold text-ink-1">🇺🇸 Marcus Bennett</p>
                <p className="text-[10.5px] text-ink-7">Open · Pro plan · Priority medium</p>
              </div>
            </div>
            <Mono className="text-ink-7">2 / 18</Mono>
          </div>
          <div className="px-4 py-4 space-y-3">
            {FOCUS_THREAD.map((m, i) => (
              <div key={i} className={cn("max-w-[88%] px-[13px] py-[9px] text-[12.5px] leading-[1.5]", m.who === "v" ? "bg-bubble-received text-ink-2 rounded-[16px_16px_16px_5px]" : "ml-auto bg-bubble-sent text-white rounded-[16px_16px_5px_16px]")}>{m.body}</div>
            ))}
          </div>
          <div className="px-3 pb-3">
            <div className="rounded-[12px] border border-hairline-strong bg-white/[0.03] px-3 py-2.5 flex items-center justify-between">
              <span className="text-[12px] text-ink-7">Reply…</span>
              <div className="flex items-center gap-2.5 text-[10.5px] text-ink-6">
                <span>Rewrite <span className="keycap text-ink-7">R</span></span>
                <span>Resolve <span className="keycap text-ink-7">E</span></span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-4 mt-4 text-[10.5px] text-ink-7">
          <span><span className="keycap">J</span> <span className="keycap">K</span> next · prev</span>
          <span><span className="keycap">⌘K</span> commands</span>
          <span><span className="keycap">Esc</span> exit</span>
        </div>
      </div>
    </Window>
  );
}

// ─── Section mock: MCP / AI-native workflow ───────────────────────────────────

const MCP_TOOLS = [
  { name: "list_tickets", desc: "Open conversations, filtered" },
  { name: "get_subscription", desc: "Plan, seats & billing status" },
  { name: "resolve_ticket", desc: "Reply and close with a source" },
  { name: "search_kb", desc: "Grounded answer from your docs" },
  { name: "update_article", desc: "Edit a help article in place" },
];

function MCPMock() {
  return (
    <Window className="min-h-[360px] bg-[#0d0e12]">
      <div className="flex items-center gap-2 px-4 h-11 border-b border-hairline">
        <Plug className="w-3.5 h-3.5 text-brand" />
        <span className="text-[12.5px] font-semibold text-ink-2">replymaven · MCP server</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-ink-6">
          <span className="w-1.5 h-1.5 rounded-full bg-dot-green" /> Connected
        </span>
      </div>
      <div className="p-4 space-y-2">
        {MCP_TOOLS.map((t) => (
          <div key={t.name} className="flex items-center gap-3 rounded-[10px] border border-hairline bg-white/[0.02] px-3 py-2.5">
            <Command className="w-3.5 h-3.5 text-ink-6 shrink-0" />
            <code className="font-mono text-[12px] text-ink-2">{t.name}</code>
            <span className="text-[11.5px] text-ink-7 truncate">{t.desc}</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-ink-7 ml-auto shrink-0" />
          </div>
        ))}
      </div>
      <div className="px-4 pb-4">
        <div className="rounded-[12px] border border-hairline-strong bg-black/30 p-3 font-mono text-[11.5px] leading-relaxed">
          <p className="text-ink-6"><span className="text-brand">agent</span> → resolve_ticket(<span className="text-ink-3">#4821</span>)</p>
          <p className="text-dot-green mt-1">✓ replied with source · closed in 1.2s</p>
        </div>
      </div>
    </Window>
  );
}

// ─── Section mock: AI agent resolving a ticket ───────────────────────────────

const AGENT_STEPS = [
  "Looked up the subscription in Stripe",
  "Found a mid-cycle upgrade — prorated $41",
  "Cited the billing policy",
];

function AgentMock() {
  return (
    <Window className="p-5 sm:p-9 min-h-[400px] bg-[#0b0c10] flex items-center">
      <div className="w-full max-w-[580px] mx-auto">
        {/* Bubble 1 — visitor */}
        <div className="flex flex-col items-start mb-5">
          <span className="text-[11px] font-semibold text-ink-5 mb-1.5">Visitor</span>
          <div className="max-w-[85%] px-[14px] py-[10px] text-[13.5px] leading-[1.5] bg-bubble-received text-ink-2 rounded-[18px_18px_18px_5px]">
            I was charged $90 but my plan is $49/mo — can you check what happened?
          </div>
        </div>

        {/* Bubble 2 — Maven's reply, with a subtle trace of how it got there */}
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[11px] font-semibold text-brand-label">Maven · AI</span>
            <span className="text-[10.5px] text-ink-7">worked 6s</span>
          </div>
          {/* reasoning trace */}
          <div className="max-w-[88%] rounded-[12px] bg-white/[0.025] border border-hairline px-3.5 py-2.5 mb-2">
            <div className="text-[10.5px] font-medium text-ink-5 mb-2">
              Looked into it — 2 tools, 1 source
            </div>
            <div className="space-y-1.5">
              {AGENT_STEPS.map((s) => (
                <div key={s} className="flex items-start gap-2 text-[11.5px] text-ink-6">
                  <Check className="w-3 h-3 text-dot-green mt-[3px] shrink-0" />
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
          {/* the actual reply */}
          <div className="max-w-[88%] px-[14px] py-[10px] text-[13.5px] leading-[1.5] bg-bubble-sent text-white rounded-[18px_18px_5px_18px]">
            You upgraded from <strong>Starter</strong> to <strong>Pro</strong> on Jun 18, so this invoice has a one-time prorated charge of <strong>$41</strong> for the mid-cycle upgrade, plus the $49 Pro base. Next month it’ll be a flat $49.
          </div>
          <span className="mt-1.5 text-[10.5px] text-ink-7 flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Source · Billing policy
            <span className="text-ink-8">·</span>
            <CheckCircle2 className="w-3 h-3 text-brand" /> <span className="text-brand">Resolved</span>
          </span>
        </div>
      </div>
    </Window>
  );
}

// ─── Numbered value section ───────────────────────────────────────────────────

function ValueSection({
  num,
  title,
  body,
  index,
  children,
}: {
  num: string;
  title: React.ReactNode;
  body: string;
  index: { n: string; label: string }[];
  children: React.ReactNode;
}) {
  return (
    <section className="py-16 md:py-24 border-t border-hairline">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start mb-12">
          <h2 className="font-heading text-[2rem] sm:text-[2.6rem] font-medium tracking-[-0.02em] leading-[1.05] text-ink-1">
            {title}
          </h2>
          <div className="lg:pt-1.5">
            <p className="text-[1.05rem] text-ink-5 leading-relaxed max-w-lg">{body}</p>
            <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-2.5 max-w-md">
              {index.map((s) => (
                <div key={s.label} className="flex items-baseline gap-2.5">
                  <Mono className="text-brand/80">{s.n}</Mono>
                  <span className="text-[13px] text-ink-3">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <Mono className="text-ink-7">{num}</Mono>
            </div>
          </div>
        </div>
        <div className="relative">{children}</div>
      </div>
    </section>
  );
}

// ─── FAQ Accordion Item ───────────────────────────────────────────────────────

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-left cursor-pointer group"
      >
        <span className="font-medium text-ink-2 text-[15px] pr-4 group-hover:text-ink-1 transition-colors">
          {question}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-ink-6 shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <div className={cn("grid transition-all duration-200 ease-in-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden">
          <p className="pb-5 text-[14px] text-ink-5 leading-relaxed max-w-2xl">{answer}</p>
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
      <div className="flex items-center gap-1 p-1 rounded-full bg-white/[0.04] border border-hairline w-fit mx-auto">
        <button
          type="button"
          onClick={() => setInterval("monthly")}
          className={cn(
            "px-5 py-2 rounded-full text-sm font-medium transition-all",
            interval === "monthly" ? "bg-foreground text-background" : "text-ink-5 hover:text-ink-2",
          )}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setInterval("annual")}
          className={cn(
            "px-5 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2",
            interval === "annual" ? "bg-foreground text-background" : "text-ink-5 hover:text-ink-2",
          )}
        >
          Annual
          <span className="text-[11px] font-medium text-brand">2 months free</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {pricingPlans.map((plan) => {
          const price = interval === "monthly" ? plan.monthlyPrice : Math.floor(plan.annualPrice / 12);
          const ctaLabel = getLandingCtaLabel(plan.id, interval, currentPlan, currentInterval);
          const isCurrent = plan.id === currentPlan && interval === currentInterval;

          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-[18px] p-6 bg-[#101116]",
                plan.highlighted ? "border border-brand/40" : "border border-hairline",
                isCurrent && "ring-1 ring-brand",
              )}
            >
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="text-[11px] bg-brand text-white px-3 py-1 rounded-full font-medium">Current Plan</span>
                </div>
              )}

              <div className="space-y-4 pb-6">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm text-ink-5">{plan.name}</h3>
                  {plan.highlighted && plan.badge && (
                    <span className="text-[11px] bg-brand/15 text-brand px-2 py-0.5 rounded-full font-medium">{plan.badge}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-medium text-ink-1 tracking-tight">${price}</span>
                  <span className="text-ink-6 text-sm">
                    /mo
                    {interval === "annual" && <span className="ml-1 text-xs text-ink-7">(${plan.annualPrice}/yr)</span>}
                  </span>
                </div>
                <p className="text-sm text-ink-5">{plan.description}</p>
              </div>

              <ul className="space-y-3 flex-1 pb-7">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm">
                    <Check className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                    <span className="text-ink-4">{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => {
                  if (ctaLabel === "Manage Plan" && onManagePlan) onManagePlan();
                  else onCtaClick(plan.id, interval);
                }}
                className={cn(
                  "w-full rounded-full h-11 text-sm font-medium transition-all cursor-pointer",
                  plan.highlighted
                    ? "glow-surface text-card-foreground"
                    : "border border-hairline-strong text-ink-2 hover:bg-white/[0.05]",
                )}
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
  const [selectedPlan, setSelectedPlan] = useState<{ plan: string; interval: string } | null>(null);

  const { data: session } = useSession();
  const { data: subData } = useSubscription();
  const isLoggedIn = !!session?.user;
  const currentPlan = isLoggedIn
    ? (subData?.subscription?.plan as PlanId | undefined) ?? null
    : null;
  const currentInterval = isLoggedIn
    ? (subData?.subscription?.interval as Interval | undefined) ?? null
    : null;

  function handlePricingCta(planId: PlanId, interval: Interval) {
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
    <div className="dark font-sans min-h-screen bg-background text-foreground scroll-smooth overflow-x-hidden antialiased">
      {/* ── Navigation ─────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/70 backdrop-blur-xl border-b border-hairline">
        <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <LogoIcon className="h-5 w-auto text-foreground" />
            <span className="font-medium tracking-tight text-[15px] text-ink-1">ReplyMaven</span>
          </Link>

          <div className="hidden md:flex items-center gap-0.5 text-[13px]">
            <a href="#platform" className="px-3 py-1.5 text-ink-5 hover:text-ink-1 rounded-md transition-colors">Platform</a>
            <a href="#pricing" className="px-3 py-1.5 text-ink-5 hover:text-ink-1 rounded-md transition-colors">Pricing</a>
            <Link to="/docs" className="px-3 py-1.5 text-ink-5 hover:text-ink-1 rounded-md transition-colors">Docs</Link>
            <a href="#faq" className="px-3 py-1.5 text-ink-5 hover:text-ink-1 rounded-md transition-colors">FAQ</a>
          </div>

          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <Cta variant="ghost" size="sm" onClick={() => navigate("/app")}>Dashboard</Cta>
            ) : (
              <Cta variant="ghost" size="sm" onClick={handleGenericCta}>Log in</Cta>
            )}
            <Cta variant="primary" size="sm" onClick={handleGenericCta}>Get Started</Cta>
          </div>
        </nav>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative pt-36 pb-12 overflow-hidden">
        {/* ambient blue glow */}
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[1100px] h-[700px] rounded-full opacity-[0.18] blur-[120px]" style={{ background: "radial-gradient(closest-side, #2563eb, transparent)" }} />
        <div className="relative max-w-6xl mx-auto px-6">
          <a href="#platform" className="inline-flex items-center gap-2 rounded-full border border-hairline-strong bg-white/[0.03] pl-1.5 pr-3 py-1 text-[12px] text-ink-4 hover:text-ink-1 transition-colors mb-7 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <span className="px-2 py-0.5 rounded-full bg-brand/15 text-brand font-medium text-[11px]">New</span>
            Pull conversations & update docs over MCP
            <ChevronRight className="w-3.5 h-3.5" />
          </a>
          <h1 className="font-heading text-[2.75rem] sm:text-[4rem] lg:text-[4.5rem] font-medium text-ink-1 tracking-[-0.03em] leading-[1.0] max-w-4xl animate-in fade-in slide-in-from-bottom-3 duration-700">
            The support platform for teams who see support as a growth channel
          </h1>
          <p className="mt-6 text-[1.15rem] text-ink-5 leading-relaxed max-w-2xl animate-in fade-in slide-in-from-bottom-3 duration-700 delay-100 fill-mode-both">
            Delightful software for the humans on support, and an AI agent that actually resolves tickets — trained on your docs, FAQs, and SOPs, fitted with actions.
          </p>
          <div className="mt-9 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-200 fill-mode-both">
            <Cta variant="primary" size="lg" onClick={handleGenericCta}>
              Start free trial
              <ArrowRight className="w-4 h-4" />
            </Cta>
            <Cta variant="outline" size="lg" asChild>
              <Link to="/docs">Read the docs</Link>
            </Cta>
          </div>
        </div>

        {/* Hero mock */}
        <div className="relative max-w-6xl mx-auto px-6 mt-16 sm:mt-20 pb-10 animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-300 fill-mode-both">
          {/* Desktop: real product screenshot. Small screens: the responsive
              in-code mock (a desktop screenshot would be unreadable on mobile). */}
          <div
            className="hidden lg:block rounded-t-[18px] overflow-hidden"
            style={{
              // Dissolve the bottom of the mock into the page background — fade
              // starts low so the composer stays faintly visible.
              maskImage: "linear-gradient(to bottom, #000 0%, #000 74%, transparent 100%)",
              WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 74%, transparent 100%)",
            }}
          >
            <img
              src="/mock-inbox.webp"
              alt="ReplyMaven support inbox — Maven resolving a billing question and inviting a teammate"
              width={1627}
              height={906}
              className="block w-full h-auto"
            />
          </div>
          <div className="lg:hidden">
            <InboxMock />
          </div>
        </div>
      </section>

      {/* ── Two-tone statement ─────────────────────────────────────────── */}
      <section className="py-20 md:py-28 px-6 border-t border-hairline">
        <div className="max-w-5xl mx-auto">
          <p className="font-heading text-[1.9rem] sm:text-[2.6rem] font-medium tracking-[-0.02em] leading-[1.12]">
            <span className="text-ink-1">Support is a growth channel.</span>{" "}
            <span className="text-ink-6">
              ReplyMaven helps founding teams answer fast, resolve completely, and take care of customers so well they tell other people — with an AI agent doing the heavy lifting.
            </span>
          </p>
        </div>
      </section>

      {/* ── Platform: numbered value sections ──────────────────────────── */}
      <div id="platform">
        <ValueSection
          num="1.0 — Human support"
          title={<>Clear your queue in<br className="hidden sm:block" /> ten minutes a day</>}
          body="A keyboard-first inbox with a focus mode built for flow. Hit Shift+Tab and Maven drafts the reply from your own docs — review, make it yours, send. Every customer gets a fast, personal answer; you get your morning back."
          index={[
            { n: "1.1", label: "Unified inbox" },
            { n: "1.2", label: "Focus mode" },
            { n: "1.3", label: "Shift+Tab AI drafts" },
            { n: "1.4", label: "Snooze & priority" },
          ]}
        >
          <div className="hidden lg:block rounded-[18px] border border-hairline-strong overflow-hidden shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
            <img
              src="/mock-focus.webp"
              alt="ReplyMaven focus mode — distraction-free triage of a billing conversation"
              width={1234}
              height={892}
              className="block w-full h-auto"
            />
          </div>
          <div className="lg:hidden">
            <FocusMock />
          </div>
        </ValueSection>

        <ValueSection
          num="2.0 — AI agent"
          title="Your first CS hire"
          body="Maven learns from your docs, FAQs, and SOPs. It answers with cited sources, triages the queue, looks up orders and subscriptions, and takes real actions — then hands off to a human the moment it's unsure."
          index={[
            { n: "2.1", label: "Learns docs, FAQs & SOPs" },
            { n: "2.2", label: "Cites every source" },
            { n: "2.3", label: "Takes real actions" },
            { n: "2.4", label: "Confidence handoff" },
          ]}
        >
          <AgentMock />
        </ValueSection>

        <ValueSection
          num="3.0 — AI-native"
          title={<>Run your help desk<br className="hidden sm:block" /> from any AI agent</>}
          body="A native MCP server exposes your support stack to any agent. Pull open conversations into Claude or Cursor, look up orders, resolve tickets, and update your docs — with scoped, secure access."
          index={[
            { n: "3.1", label: "Native MCP server" },
            { n: "3.2", label: "Pull conversations" },
            { n: "3.3", label: "Update docs" },
            { n: "3.4", label: "Scoped access" },
          ]}
        >
          <MCPMock />
        </ValueSection>
      </div>

      {/* ── Pricing ───────────────────────────────────────────────────── */}
      <section id="pricing" className="py-20 md:py-28 px-6 border-t border-hairline">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl mb-14">
            <Mono className="text-ink-7">Pricing</Mono>
            <h2 className="font-heading text-[2.2rem] sm:text-[3rem] font-medium tracking-[-0.02em] leading-[1.04] text-ink-1 mt-3">
              A fraction of your first support hire
            </h2>
            <p className="mt-4 text-[1.05rem] text-ink-5 leading-relaxed">
              Start free for 7 days. From $19/mo — scale as your ticket volume grows.
            </p>
          </div>
          <LandingPricing
            onCtaClick={handlePricingCta}
            currentPlan={currentPlan}
            currentInterval={currentInterval}
            onManagePlan={handleManagePlan}
          />

          <div className="mt-6 rounded-[18px] border border-hairline bg-[#101116] p-7">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="space-y-2 md:max-w-xs shrink-0">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-medium text-ink-1">Enterprise</h3>
                  <span className="text-[11px] bg-brand/15 text-brand px-2.5 py-1 rounded-full font-medium">Custom</span>
                </div>
                <p className="text-sm text-ink-5">Unlimited everything, SSO, and a dedicated MCP deployment with priority support.</p>
              </div>
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {[
                  "Unlimited projects & messages",
                  "SLA & uptime guarantee",
                  "Dedicated MCP deployment",
                  "SSO & advanced security",
                ].map((feature) => (
                  <span key={feature} className="flex items-center gap-2 text-sm text-ink-3">
                    <Check className="w-4 h-4 text-brand shrink-0" />
                    {feature}
                  </span>
                ))}
              </div>
              <Cta variant="secondary" size="lg" onClick={handleGenericCta} className="shrink-0">
                Contact sales
                <ArrowRight className="w-4 h-4" />
              </Cta>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section id="faq" className="py-20 md:py-28 px-6 border-t border-hairline">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-heading text-[2rem] sm:text-[2.6rem] font-medium tracking-[-0.02em] leading-[1.05] text-ink-1 mb-10">
            Frequently asked questions
          </h2>
          <div>
            {faqItems.map((item) => (
              <FaqItem key={item.question} question={item.question} answer={item.answer} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <section className="py-24 md:py-36 px-6 border-t border-hairline relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full opacity-[0.16] blur-[120px]" style={{ background: "radial-gradient(closest-side, #2563eb, transparent)" }} />
        <div className="relative max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-[2.4rem] sm:text-[3.4rem] font-medium tracking-[-0.025em] leading-[1.04] text-ink-1">
            Support worth<br />talking about.
          </h2>
          <div className="mt-9 flex items-center justify-center gap-3">
            <Cta variant="primary" size="lg" onClick={handleGenericCta}>
              Start free trial
              <ArrowRight className="w-4 h-4" />
            </Cta>
            <Cta variant="outline" size="lg" asChild>
              <Link to="/docs"><BookOpen className="w-4 h-4" /> Read the docs</Link>
            </Cta>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className="border-t border-hairline px-6 pt-16 pb-10">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-14">
            <div className="col-span-2 md:col-span-2 space-y-3">
              <div className="flex items-center gap-2">
                <LogoIcon className="h-5 w-auto text-foreground shrink-0" />
                <span className="font-medium tracking-tight text-[15px] text-ink-1">ReplyMaven</span>
              </div>
              <p className="text-sm text-ink-6 leading-relaxed max-w-xs">The support platform for teams who see support as a growth channel.</p>
            </div>
            {[
              { h: "Platform", links: [{ label: "Human support", href: "#platform" }, { label: "AI agent", href: "#platform" }, { label: "MCP", href: "#platform" }, { label: "Pricing", href: "#pricing" }] },
              { h: "Resources", links: [{ label: "Documentation", href: "/docs" }, { label: "Getting started", href: "/docs" }, { label: "FAQ", href: "#faq" }] },
              { h: "Legal", links: [{ label: "Privacy", href: "#" }, { label: "Terms", href: "#" }] },
            ].map((col) => (
              <div key={col.h} className="space-y-3">
                <Mono className="text-ink-7">{col.h}</Mono>
                <ul className="space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.href.startsWith("/") ? (
                        <Link to={l.href} className="text-sm text-ink-5 hover:text-ink-1 transition-colors">{l.label}</Link>
                      ) : (
                        <a href={l.href} className="text-sm text-ink-5 hover:text-ink-1 transition-colors">{l.label}</a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="pt-6 border-t border-hairline flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-ink-7">&copy; 2026 ReplyMaven. All rights reserved.</p>
            <a href="https://launchfast.shop/" target="_blank" className="text-sm text-ink-7 flex items-center gap-2 hover:text-ink-4 transition-colors">
              <Heart className="w-4 h-4" /> LaunchFast.shop product
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
