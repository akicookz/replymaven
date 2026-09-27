import { BookOpen, Send } from "lucide-react";
import { BentoCard, StatusTag, TILE, TRAY, type Sky } from "@/components/marketing/bento-card";
import { cn } from "@/lib/utils";

// Landing bento for the human side of the inbox: Sidechat (tall), Focus mode, and shortcuts.

const SKY: Record<string, Sky> = {
  sidechat: { seed: 83, clouds: [[0.1, 0.22, 0.5], [0.92, 0.84, 0.7]] },
  focus: { seed: 89, clouds: [[0.9, 0.78, 0.9]] },
  keys: { seed: 97, clouds: [[0.12, 0.82, 0.9]] },
};

function Keycap({ children }: { children: string }) {
  return (
    <span className={cn(TILE, "inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] px-1.5 text-[11px] font-semibold text-ink-3")}>
      {children}
    </span>
  );
}

function SidechatTray() {
  const steps = [
    { icon: <img src="/integrations/sentry.svg" alt="" className="size-3.5 brightness-0 invert" />, text: "Sentry · 14 AADSTS50011 errors, all EU" },
    { icon: <BookOpen className="size-3.5 text-ink-5" />, text: "Docs · SSO guide lists only the US URL" },
  ];
  return (
    <div className={cn(TRAY, "w-full max-w-[420px] space-y-3 p-3 sm:space-y-3.5 sm:p-4")}>
      <div className="flex items-center justify-between px-1">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-1">
          Sidechat
          <span className="size-1.5 rounded-full bg-dot-green" />
        </p>
        <span className="text-[11px] text-ink-6">You &amp; Maven</span>
      </div>
      <div className={cn(TILE, "ml-auto max-w-[88%] rounded-[12px_12px_4px_12px] px-3 py-2 text-[12.5px] leading-snug text-ink-2")}>
        Marcus at BrightLabs says every Azure SSO login fails with AADSTS50011. He followed our guide exactly. Can you find out why?
      </div>
      <div className="space-y-1.5 px-1">
        {steps.map((s) => (
          <p key={s.text} className="flex items-center gap-2 text-[11.5px] text-ink-5">
            {s.icon}
            {s.text}
          </p>
        ))}
      </div>
      <p className="px-1 text-[12.5px] leading-relaxed text-ink-3">
        EU workspaces sign in on eu.app.northwind.com, and the guide only has the US callback URL. Three customers hit
        this since Monday.
      </p>
      <div className={cn(TILE, "flex h-9 items-center gap-2.5 rounded-[10px] px-3")}>
        <img src="/integrations/linear.svg" alt="" className="size-3.5" />
        <span className="flex-1 truncate text-[12px] text-ink-2">Created Linear issue ENG-412</span>
        <StatusTag tone="done">Approved</StatusTag>
      </div>
      <div className={cn(TILE, "rounded-[12px] p-3.5")}>
        <p className="text-[11.5px] font-semibold text-ink-3">Reply draft</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          Use eu.app.northwind.com/sso/callback and you're set. We're fixing the guide now.
        </p>
        <div className="mt-3 flex items-center justify-end gap-2.5">
          <span className="text-[11.5px] text-ink-5">Add to reply</span>
          <span className="glow-surface inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-medium">
            <Send className="size-3" />
            Send as Maven
          </span>
        </div>
      </div>
    </div>
  );
}

function FocusTray() {
  return (
    <div className="relative w-full max-w-[300px] pt-4">
      <div className={cn(TILE, "absolute inset-x-6 top-0 h-10 rounded-[12px] opacity-50")} />
      <div className={cn(TILE, "absolute inset-x-3 top-2 h-10 rounded-[12px] opacity-75")} />
      <div className={cn(TRAY, "relative")}>
        <div className="flex items-center justify-between px-1">
          <p className="text-[12.5px] font-semibold text-ink-1">Marcus Bennett</p>
          <span className="text-[11px] tabular-nums text-ink-6">2 of 18</span>
        </div>
        <div className={cn(TILE, "mt-2 max-w-[92%] rounded-[12px_12px_12px_4px] px-3 py-2 text-[12px] leading-snug text-ink-2")}>
          Every Azure login fails with AADSTS50011.
        </div>
        <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-ink-5">
          Resolve <Keycap>E</Keycap>
        </div>
      </div>
    </div>
  );
}

function KeysTray() {
  const keys: { keys: string[]; label: string }[] = [
    { keys: ["J", "K"], label: "Next · previous" },
    { keys: ["E"], label: "Resolve" },
    { keys: ["S"], label: "Snooze" },
    { keys: ["⇧", "Tab"], label: "Ask Maven" },
  ];
  return (
    <div className={cn(TRAY, "grid w-full max-w-[300px] grid-cols-2 gap-1.5")}>
      {keys.map((k) => (
        <div key={k.label} className={cn(TILE, "flex flex-col gap-2 rounded-[10px] p-2.5")}>
          <span className="flex gap-1">
            {k.keys.map((key) => (
              <Keycap key={key}>{key}</Keycap>
            ))}
          </span>
          <span className="text-[11.5px] text-ink-4">{k.label}</span>
        </div>
      ))}
    </div>
  );
}

export function HumanInboxBento() {
  return (
    <section id="inbox-tools" className="py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-16">
          <h2 className="text-balance font-heading text-[1.7rem] font-medium leading-[1.08] tracking-[-0.025em] text-ink-1 sm:text-[2.6rem]">
            Clear your inbox in minutes
          </h2>
          <p className="max-w-lg text-[1.05rem] leading-relaxed text-ink-5 lg:pt-1.5">
            Built for the humans on your team. Collaborate with Maven to go through your inbox in minutes.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BentoCard
            className="lg:row-span-2"
            tall
            sky={SKY.sidechat}
            title="Investigate with Maven in Sidechat"
            body="A private chat with Maven beside every conversation. It digs through your tools, files the issue, and drafts the reply."
          >
            <SidechatTray />
          </BentoCard>
          <BentoCard
            sky={SKY.focus}
            title="Focus mode"
            body="One conversation at a time, so you clear the inbox instead of scrolling it."
          >
            <FocusTray />
          </BentoCard>
          <BentoCard
            sky={SKY.keys}
            title="Keyboard first"
            body="Reply, resolve, snooze, and ask Maven without touching the mouse."
          >
            <KeysTray />
          </BentoCard>
        </div>
      </div>
    </section>
  );
}
