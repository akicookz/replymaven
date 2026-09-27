import {
  BookOpen,
  CreditCard,
  FileDown,
  FilePenLine,
  FilePlus,
  FolderPlus,
  Globe,
  Palette,
  Plug,
  RefreshCw,
  Rocket,
  Search,
} from "lucide-react";
import { BentoCard, StatusTag, TILE, TRAY, type Sky } from "@/components/marketing/bento-card";
import { LogoIcon } from "@/components/Logo";
import { cn } from "@/lib/utils";

// Help center section as a bento: a help center home mock, then four supporting cards.

const SKY: Record<string, Sky> = {
  home: { seed: 61, clouds: [[0.08, 0.3, 0.4], [0.95, 0.62, 0.36]] },
  updates: { seed: 67, clouds: [[0.88, 0.8, 1.0]] },
  sync: { seed: 71, clouds: [[0.1, 0.78, 0.9]] },
  mcp: { seed: 73, clouds: [[0.9, 0.3, 0.8]] },
  seo: { seed: 79, clouds: [[0.2, 0.82, 1.0]] },
};

const CATEGORIES = [
  { icon: Rocket, name: "Getting started", count: "8 articles" },
  { icon: CreditCard, name: "Billing", count: "12 articles" },
  { icon: Plug, name: "Integrations", count: "9 articles" },
  { icon: BookOpen, name: "Guides", count: "14 articles" },
];

function HelpCenterHome() {
  return (
    <div
      className="w-full max-w-[640px] self-start overflow-hidden rounded-t-[14px] bg-[#08080a] text-[#f0f0f5] shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_40px_100px_-40px_rgba(0,0,0,0.9)]"
      style={{
        maskImage: "linear-gradient(to bottom, #000 85%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, #000 85%, transparent 100%)",
      }}
    >
      <div className="flex h-12 items-center gap-2.5 px-5">
        <span className="inline-flex size-6 items-center justify-center rounded-md bg-white/[0.08]">
          <LogoIcon className="h-3 w-auto" />
        </span>
        <span className="text-[13px] font-semibold">Northwind</span>
        <span className="ml-3 rounded-[6px] bg-white/[0.07] px-2 py-0.5 text-[12px]">Guides</span>
        <span className="hidden text-[12px] text-[#f4f4f7]/50 sm:inline">API</span>
        <span className="hidden text-[12px] text-[#f4f4f7]/50 sm:inline">Changelog</span>
        <span className="ml-auto hidden h-7 w-36 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-[#f4f4f7]/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] sm:flex">
          <Search className="size-3" />
          Search
          <span className="ml-auto rounded bg-white/[0.08] px-1 text-[10px]">⌘K</span>
        </span>
        <span className="glow-surface inline-flex h-7 items-center whitespace-nowrap rounded-[8px] px-2.5 text-[11.5px] font-medium">
          Ask Maven
        </span>
      </div>
      <div className="px-5 pb-6 pt-5">
        <p className="text-[24px] font-semibold tracking-[-0.02em]">How can we help?</p>
        <div className="mt-3 flex h-9 items-center gap-2 rounded-lg px-3 text-[12.5px] text-[#f4f4f7]/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
          <Search className="size-3.5" />
          Search help center
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CATEGORIES.map((c) => (
            <div key={c.name} className="rounded-lg p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              <c.icon className="size-4 text-[#f4f4f7]/55" />
              <p className="mt-2 text-[12.5px] font-semibold">{c.name}</p>
              <p className="mt-0.5 text-[11px] text-[#f4f4f7]/50">{c.count}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UpdatesTray() {
  const steps = [
    { ask: "Create changelog for PR #1231, #1235 and #1236", tool: "create_help_article", tag: "Published", tone: "done" as const, icon: FilePlus },
    { ask: "Now, update SSO instructions for Azure with the new update", tool: "update_help_article", tag: "running", tone: "maven" as const, icon: FilePenLine },
  ];
  return (
    <div className={cn(TRAY, "w-full max-w-[300px] space-y-1.5")}>
      {steps.map((step) => (
        <div key={step.tool} className="space-y-1.5">
          <div className={cn(TILE, "ml-auto max-w-[92%] rounded-[12px_12px_4px_12px] px-3 py-2 text-[12px] leading-snug text-ink-2")}>
            {step.ask}
          </div>
          <div className={cn(TILE, "flex h-9 items-center gap-2.5 rounded-[10px] px-3")}>
            <step.icon className="size-3.5 text-ink-5" />
            <span className="flex-1 truncate font-mono text-[11.5px] text-ink-2">{step.tool}</span>
            <StatusTag tone={step.tone}>{step.tag}</StatusTag>
          </div>
        </div>
      ))}
    </div>
  );
}

function SyncTray() {
  const rows = [
    { icon: Globe, name: "northwind.com/docs", meta: "48 pages" },
    { icon: FileDown, name: "billing-policy.pdf", meta: "Indexed" },
  ];
  return (
    <div className={cn(TRAY, "w-full max-w-[290px] space-y-1.5")}>
      {rows.map((r) => (
        <div key={r.name} className={cn(TILE, "flex h-9 items-center gap-2.5 rounded-[10px] px-3")}>
          <r.icon className="size-3.5 text-ink-5" />
          <span className="flex-1 truncate text-[12px] text-ink-2">{r.name}</span>
          <span className="shrink-0 text-[11px] text-ink-5">{r.meta}</span>
        </div>
      ))}
      <div className="flex items-center justify-between px-1 pt-0.5">
        <span className="text-[11px] text-ink-5">Synced 2h ago</span>
        <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3">
          <RefreshCw className="size-3" />
          Reindex
        </span>
      </div>
    </div>
  );
}

function McpTray() {
  const calls = [
    { icon: FolderPlus, name: "create_help_category", tag: "done", tone: "done" as const },
    { icon: FilePlus, name: "create_help_article", tag: "done", tone: "done" as const },
    { icon: Palette, name: "update_help_style", tag: "running", tone: "maven" as const },
  ];
  return (
    <div className={cn(TRAY, "w-full max-w-[300px] space-y-1.5")}>
      <div className="flex gap-1.5 px-0.5 pb-0.5">
        {["claude", "openai", "cursor", "conductor"].map((c) => (
          <span key={c} className={cn(TILE, "inline-flex size-8 items-center justify-center rounded-[10px] bg-[#18181b]")}>
            <img src={`/integrations/${c}.svg`} alt="" className="size-4" />
          </span>
        ))}
      </div>
      {calls.map((call) => (
        <div key={call.name} className={cn(TILE, "flex h-9 items-center gap-2.5 rounded-[10px] px-3")}>
          <call.icon className="size-3.5 text-ink-5" />
          <span className="flex-1 truncate font-mono text-[11.5px] text-ink-2">{call.name}</span>
          <StatusTag tone={call.tone}>{call.tag}</StatusTag>
        </div>
      ))}
    </div>
  );
}

function SeoTray() {
  return (
    <div className={cn(TRAY, "w-full max-w-[290px]")}>
      <div className={cn(TILE, "rounded-[12px] px-3.5 py-3")}>
        <p className="truncate text-[11px] text-ink-5">help.northwind.com › billing</p>
        <p className="mt-1 text-[13px] font-medium text-brand-soft">Upgrading your plan · Northwind Help</p>
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ink-4">
          Upgrades charge a prorated amount right away. Your next invoice is the plan price.
        </p>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5 px-0.5">
        {["Markdown native", "SEO settings", "Sitemap"].map((chip) => (
          <span key={chip} className={cn(TILE, "rounded-[6px] px-2 py-1 text-[11px] text-ink-4")}>
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

export function HelpCenterBento() {
  return (
    <section id="help-center" className="py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-16">
          <h2 className="text-balance font-heading text-[1.7rem] font-medium leading-[1.08] tracking-[-0.025em] text-ink-1 sm:text-[2.6rem]">
            Self-updating help center
          </h2>
          <p className="max-w-lg text-[1.05rem] leading-relaxed text-ink-5 lg:pt-1.5">
            Publish once. Customers read it, Google ranks it, and Maven answers from it.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <BentoCard
            wide
            sky={SKY.home}
            artClassName="h-[250px] lg:h-[330px]"
            stageClassName="items-end px-6 pb-0 pt-8 sm:px-10"
            title="On-brand help center for humans and agents"
            body="Have your AI agents build and maintain a help center that blends in."
          >
            <HelpCenterHome />
          </BentoCard>
          <BentoCard
            sky={SKY.updates}
            artClassName="lg:h-[330px]"
            title="Delegate maintenance"
            body="Tell Maven what shipped. It writes the changelog and updates the guides."
          >
            <UpdatesTray />
          </BentoCard>
          <BentoCard sky={SKY.sync} title="Syncs with your sources" body="Import pages from your site and docs. Reindex any time.">
            <SyncTray />
          </BentoCard>
          <BentoCard sky={SKY.mcp} title="Automate it over MCP" body="Build and restyle your help center from Claude, ChatGPT, Cursor, or Conductor.">
            <McpTray />
          </BentoCard>
          <BentoCard sky={SKY.seo} title="SEO and AI friendly" body="Your own domain, sitemap, and structured data, out of the box.">
            <SeoTray />
          </BentoCard>
        </div>
      </div>
    </section>
  );
}
