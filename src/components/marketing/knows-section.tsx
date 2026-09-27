import { type ComponentType } from "react";
import { Contact, FileText, Globe, ListChecks, MessagesSquare, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";

// Landing section: what Maven reads, in priority order, and what it knows about the customer.

const CARD =
  "bg-white/[0.04] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.04)]";

const FACTS: { icon: ComponentType<{ className?: string }>; title: string; body: string }[] = [
  {
    icon: ListChecks,
    title: "Follows your playbook",
    body: "Tell Maven how you onboard new teams, handle upgrades, and deal with edge cases. It does it your way, every time.",
  },
  {
    icon: ScanSearch,
    title: "Maven can investigate",
    body: "Connect Maven to your tools and explain your workflow. Maven can take it from there.",
  },
  {
    icon: Contact,
    title: "Maven remembers",
    body: "Maven remembers past cases, how they were handled, and can mirror the process.",
  },
];

const PAST_CASES = [
  { date: "Jun 18", question: "How do I connect Stripe?", resolvedBy: "Maven" },
  { date: "Jun 12", question: "Can I import customers from a CSV?", resolvedBy: "Maven" },
];

const TILE =
  "bg-[#1c1d22] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.04)]";

function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn(TILE, "inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] text-ink-3")}>
      {children}
    </span>
  );
}

const SOURCES: { title: string; detail: string; icon: React.ReactNode }[] = [
  { title: "SOPs", detail: "Offer a setup call to teams of 10+.", icon: <ListChecks className="size-4" /> },
  { title: "FAQs", detail: "24 question and answer pairs", icon: <MessagesSquare className="size-4" /> },
  { title: "Website", detail: "northwind.com/docs", icon: <Globe className="size-4" /> },
  { title: "PDFs", detail: "billing-policy.pdf", icon: <FileText className="size-4" /> },
  { title: "MCP", detail: "Tools from your MCP servers", icon: <img src="/integrations/mcp.svg" alt="" className="size-4" /> },
];

function ConnectorsTile() {
  return (
    <div className={cn(CARD, "rounded-[14px] p-4")}>
      <div className="flex -space-x-1.5">
        {["posthog", "stripe", "sentry"].map((name) => (
          <span
            key={name}
            className={cn(TILE, "inline-flex size-8 items-center justify-center rounded-full shadow-[0_0_0_2px_#141417]")}
          >
            <img src={`/integrations/${name}.svg`} alt="" className={cn("size-4", name === "sentry" && "brightness-0 invert")} />
          </span>
        ))}
      </div>
      <p className="mt-3 text-[13px] font-semibold text-ink-2">Connectors</p>
      <p className="mt-0.5 text-[12px] leading-snug text-ink-5">Checks errors, events, and payments</p>
    </div>
  );
}

function SourcesCard() {
  return (
    <div className={cn(CARD, "min-w-0 rounded-[22px] p-4 sm:p-6")}>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SOURCES.map((source) => (
          <div key={source.title} className={cn(CARD, "rounded-[14px] p-4")}>
            <IconTile>{source.icon}</IconTile>
            <p className="mt-3 text-[13px] font-semibold text-ink-2">{source.title}</p>
            <p className="mt-0.5 truncate text-[12px] leading-snug text-ink-5">{source.detail}</p>
          </div>
        ))}
        <ConnectorsTile />
      </div>
      <p className="mt-6 text-[13px] font-medium text-ink-3">Marcus Bennett's past cases</p>
      <div className="mt-3 space-y-1.5">
        {PAST_CASES.map((c) => (
          <div key={c.date} className="flex items-center gap-3 rounded-[12px] bg-black/20 px-3.5 py-2.5">
            <span className="w-12 shrink-0 text-[12px] tabular-nums text-ink-7">{c.date}</span>
            <p className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{c.question}</p>
            <span className="shrink-0 text-[11.5px] text-ink-6">
              Resolved by <span className="text-ink-3">{c.resolvedBy}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KnowsSection() {
  return (
    <section id="knows" className="py-16 md:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <div className="min-w-0">
          <h2 className="text-balance font-heading text-[1.7rem] font-medium leading-[1.08] tracking-[-0.025em] text-ink-1 sm:text-[2.6rem]">
            Maven knows your business and takes action
          </h2>
          <p className="mt-4 text-[1.05rem] leading-relaxed text-ink-5">
            Train Maven on your SOPs, documentation, PDFs, and FAQs.
          </p>
          <div className="mt-9 space-y-6">
            {FACTS.map((fact) => (
              <div key={fact.title} className="flex gap-4">
                <span className={cn(CARD, "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px]")}>
                  <fact.icon className="size-4 text-brand-soft" />
                </span>
                <div>
                  <p className="text-[14.5px] font-medium text-ink-2">{fact.title}</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-6">{fact.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <SourcesCard />
      </div>
    </section>
  );
}
