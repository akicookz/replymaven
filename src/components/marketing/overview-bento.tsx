import {
  ArrowRight,
  FilePenLine,
  List,
  MessageCircle,
  MessageSquareText,
  Webhook,
} from "lucide-react";
import { BentoCard, StatusTag, TILE, TRAY, type Sky } from "@/components/marketing/bento-card";
import { cn } from "@/lib/utils";

// Four-card product overview under the landing hero. Each card links to the
// section that expands it.

const SKY: Record<string, Sky> = {
  inbox: { seed: 11, clouds: [[0.14, 0.7, 0.62], [0.93, 0.34, 0.3]] },
  docs: { seed: 23, clouds: [[0.9, 0.78, 1.0]] },
  notify: { seed: 37, clouds: [[0.12, 0.8, 1.05]] },
  mcp: { seed: 51, clouds: [[0.9, 0.7, 0.5], [0.06, 0.32, 0.26]] },
};

function InboxTray() {
  const channels = [
    { icon: <MessageCircle className="size-3.5 text-ink-5" />, label: "Widget" },
    { icon: <img src="/integrations/gmail.svg" alt="" className="size-3.5" />, label: "Gmail" },
    { icon: <Webhook className="size-3.5 text-ink-5" />, label: "Webhook" },
  ];
  const rows = [
    { name: "Marcus Bennett", msg: "Charged $90, but my plan is $49", tag: "Maven replied", tone: "maven" as const },
    { name: "Lukas Weber", msg: "Refund request for order #4821", tag: "Needs you", tone: "you" as const },
  ];
  return (
    <div className={cn(TRAY, "flex w-full max-w-[520px] flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3")}>
      <div className="flex gap-1.5 sm:flex-col">
        {channels.map((c) => (
          <span key={c.label} className={cn(TILE, "flex h-8 items-center gap-2 rounded-[10px] px-2.5 text-[12px] text-ink-3")}>
            {c.icon}
            {c.label}
          </span>
        ))}
      </div>
      <ArrowRight className="hidden size-4 text-ink-4 sm:block" />
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.name} className={cn(TILE, "flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 sm:w-[300px]")}>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-ink-1">{r.name}</p>
              <p className="truncate text-[11.5px] text-ink-5">{r.msg}</p>
            </div>
            <StatusTag tone={r.tone}>{r.tag}</StatusTag>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocsTray() {
  return (
    <div className={cn(TRAY, "w-full max-w-[300px] space-y-1.5 p-2")}>
      <div className="flex items-center justify-between px-1.5">
        <p className="text-[11.5px] font-medium text-ink-3">Missing answers</p>
        <span className="text-[11px] text-ink-5">3 new</span>
      </div>
      <div className={cn(TILE, "rounded-[11px] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.45)]")}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12.5px] font-medium text-ink-1">How do I connect Stripe?</p>
          <span className="shrink-0 text-[11px] text-ink-5">24 chats</span>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-snug text-ink-4">
          <span className="text-brand-soft">Draft ·</span> Open Settings → Integrations, choose Stripe, and sign in.
        </p>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-[#ffb340]">No article yet</span>
          <span className="glow-surface inline-flex h-6 items-center rounded-[7px] px-2.5 text-[11.5px] font-medium">
            Publish
          </span>
        </div>
      </div>
      <div className={cn(TILE, "flex items-center justify-between gap-3 rounded-[11px] px-3 py-2")}>
        <p className="truncate text-[12px] text-ink-2">How long do refunds take?</p>
        <span className="shrink-0 text-[11px] text-ink-5">15 chats</span>
      </div>
    </div>
  );
}

function NotifyTray() {
  return (
    <div className={cn(TRAY, "w-full max-w-[280px]")}>
      <div className="flex gap-1.5">
        <span className={cn(TILE, "inline-flex size-8 items-center justify-center rounded-[10px]")}>
          <img src="/integrations/telegram.svg" alt="" className="size-4" />
        </span>
        <span className={cn(TILE, "inline-flex size-8 items-center justify-center rounded-[10px]")}>
          <img src="/integrations/slack.svg" alt="" className="size-4" />
        </span>
        <span className={cn(TILE, "inline-flex size-8 items-center justify-center rounded-[10px]")}>
          <img src="/integrations/gmail.svg" alt="" className="size-4" />
        </span>
      </div>
      <div className={cn(TILE, "mt-2 rounded-[12px_12px_12px_4px] p-3")}>
        <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-1">
          <span className="size-1.5 rounded-full bg-dot-orange" />
          Marcus Bennett needs you
        </p>
        <p className="mt-1 text-[11.5px] text-ink-4">Wants the $41 upgrade charge refunded.</p>
      </div>
    </div>
  );
}

function McpTray() {
  const clients = ["claude", "openai", "cursor", "conductor"];
  const calls = [
    { icon: List, name: "list_conversations", tag: "done", tone: "done" as const },
    { icon: MessageSquareText, name: "get_conversation", tag: "done", tone: "done" as const },
    { icon: FilePenLine, name: "update_faq_resource", tag: "running", tone: "maven" as const },
  ];
  return (
    <div className={cn(TRAY, "w-full max-w-[440px]")}>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {clients.map((c) => (
            <span key={c} className={cn(TILE, "inline-flex size-8 items-center justify-center rounded-[10px] bg-[#18181b]")}>
              <img src={`/integrations/${c}.svg`} alt="" className="size-4" />
            </span>
          ))}
        </div>
        <code className="hidden font-mono text-[11px] text-ink-4 sm:block">replymaven.com/api/mcp</code>
      </div>
      <div className="mt-2 space-y-1.5">
        {calls.map((c) => (
          <div key={c.name} className={cn(TILE, "flex h-9 items-center gap-2.5 rounded-[10px] px-3")}>
            <c.icon className="size-3.5 text-ink-5" />
            <span className="flex-1 font-mono text-[11.5px] text-ink-2">{c.name}</span>
            <StatusTag tone={c.tone}>{c.tag}</StatusTag>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewBento() {
  return (
    <section id="overview" className="py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-balance font-heading text-[1.7rem] font-medium leading-[1.08] tracking-[-0.025em] text-ink-1 sm:text-[2.8rem]">
          Customer success platform for humans and agents
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <BentoCard
            wide
            sky={SKY.inbox}
            href="#inbox"
            title="Omni-channel shared inbox"
            body="Widget, email, and webhook messages in one place. Maven knows your product and each customer, and it can use your tools."
          >
            <InboxTray />
          </BentoCard>
          <BentoCard
            sky={SKY.docs}
            href="#help-center"
            title="Always-current help center"
            body="Maven finds questions your docs don't answer and drafts the article. You publish."
          >
            <DocsTray />
          </BentoCard>
          <BentoCard
            sky={SKY.notify}
            href="/docs/integrations/telegram"
            title="Alerts where you are"
            body="Telegram, Slack, or email, with a summary. Reply from there."
          >
            <NotifyTray />
          </BentoCard>
          <BentoCard
            wide
            sky={SKY.mcp}
            href="#mcp"
            title="Agent native via MCP"
            body="Work the inbox and update docs from Claude, ChatGPT, Cursor, or Conductor."
          >
            <McpTray />
          </BentoCard>
        </div>
      </div>
    </section>
  );
}
