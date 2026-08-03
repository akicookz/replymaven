import { type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  CircleAlert,
  Database,
  FileText,
  Github,
  MessageSquareText,
  RefreshCw,
  Search,
  Sparkles,
  TicketCheck,
  UserRoundCheck,
  Wrench,
} from "lucide-react";
import { LogoIcon } from "@/components/Logo";
import { cn } from "@/lib/utils";

function ProductFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[26px] bg-[#111218] p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.09),0_40px_100px_-48px_rgba(0,0,0,0.95)]",
        className,
      )}
    >
      <div className="overflow-hidden rounded-[18px] bg-[#0d0e13]">
        {children}
      </div>
    </div>
  );
}

export function HeroInboxVisual() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-20 -top-8 h-32 rounded-full bg-brand/25 blur-[80px]"
      />
      <img
        src="/mock-inbox.webp"
        alt="ReplyMaven inbox with Maven resolving a customer billing question"
        width={1627}
        height={906}
        className="relative block w-full rounded-[22px] outline outline-1 -outline-offset-1 outline-white/10 shadow-[0_50px_120px_-52px_rgba(0,0,0,0.98)]"
      />
    </div>
  );
}

export function InboxVisual() {
  return (
    <img
      src="/mock-focus.webp"
      alt="ReplyMaven Focus View showing a single customer conversation"
      width={1234}
      height={892}
      className="block w-full rounded-[22px] outline outline-1 -outline-offset-1 outline-white/10 shadow-[0_40px_100px_-48px_rgba(0,0,0,0.98)]"
    />
  );
}

export function HelpCenterVisual() {
  return (
    <ProductFrame>
      <div className="flex min-h-[410px] flex-col">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-brand/15 text-brand-soft">
              <BookOpen className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-1">Help center</p>
              <p className="text-[11px] text-ink-7">Published knowledge</p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-[11px] font-medium text-emerald-300">
            Suggestions ready
          </span>
        </div>

        <div className="grid flex-1 gap-3 p-4 pt-1 sm:grid-cols-[1fr_0.88fr]">
          <div className="rounded-2xl bg-white/[0.035] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 text-xs text-ink-7">
              <Search className="size-3.5" />
              Search articles
            </div>
            <div className="mt-4 space-y-2">
              {[
                ["Upgrade your workspace", "Refresh suggested", true],
                ["Managing billing details", "Current", false],
                ["Invite a teammate", "Current", false],
                ["Troubleshoot webhooks", "Addition suggested", true],
              ].map(([title, status, attention]) => (
                <div
                  key={title as string}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.025] px-3 py-3"
                >
                  <FileText className="size-4 shrink-0 text-ink-6" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink-2">
                      {title as string}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-[10px]",
                        attention ? "text-amber-300" : "text-ink-7",
                      )}
                    >
                      {status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-brand/[0.08] p-4 shadow-[0_0_0_1px_rgba(96,165,250,0.16)]">
            <div className="flex items-center gap-2 text-xs font-semibold text-brand-soft">
              <Sparkles className="size-4" />
              Maven suggestion
            </div>
            <p className="mt-5 text-sm font-semibold leading-5 text-ink-1">
              Refresh “Upgrade your workspace”
            </p>
            <p className="mt-2 text-pretty text-xs leading-5 text-ink-5">
              Customers now upgrade from Billing, not Workspace settings. I
              found recent conversations using the new flow.
            </p>
            <div className="mt-6 rounded-xl bg-black/20 p-3 text-[11px] leading-5 text-ink-4">
              <span className="text-rose-300 line-through">
                Open Workspace settings
              </span>
              <br />
              <span className="text-emerald-300">Open Billing settings</span>
            </div>
            <span
              className="mt-5 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand px-3 text-xs font-semibold text-white"
            >
              Review refresh
              <ArrowRight className="size-3.5" />
            </span>
          </div>
        </div>
      </div>
    </ProductFrame>
  );
}

const actionRows = [
  {
    icon: Database,
    title: "Customer data pulled",
    detail: "Business plan · 8 seats · renewal Sep 18",
  },
  {
    icon: RefreshCw,
    title: "Subscription updated",
    detail: "Added 2 seats and calculated proration",
  },
  {
    icon: TicketCheck,
    title: "Issue created in Linear",
    detail: "SUP-284 · Seat invite fails on Safari",
  },
] as const;

export function ActionsVisual() {
  return (
    <ProductFrame>
      <div className="min-h-[430px] p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LogoIcon className="h-4 w-auto text-ink-1" />
            <span className="text-xs font-semibold text-ink-2">Maven</span>
          </div>
          <span className="rounded-full bg-brand/12 px-3 py-1 text-[10px] font-medium text-brand-soft">
            3 actions completed
          </span>
        </div>

        <div className="mt-6 max-w-[88%] rounded-[18px_18px_18px_6px] bg-white/[0.07] px-4 py-3 text-sm leading-6 text-ink-2">
          We need two more seats, but invites fail for our Safari users. Can
          you upgrade us and report the bug?
        </div>

        <div className="mt-6 space-y-2.5">
          {actionRows.map((row, index) => (
            <div
              key={row.title}
              className="flex items-start gap-3 rounded-2xl bg-white/[0.035] p-3.5 shadow-[0_0_0_1px_rgba(255,255,255,0.055)]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand-soft">
                <row.icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-ink-2">
                    {row.title}
                  </p>
                  <Check className="size-4 shrink-0 text-emerald-300" />
                </div>
                <p className="mt-1 truncate text-[11px] text-ink-7">
                  {row.detail}
                </p>
              </div>
              <span className="sr-only">Action {index + 1}</span>
            </div>
          ))}
        </div>

        <div className="ml-auto mt-6 max-w-[92%] rounded-[18px_18px_6px_18px] bg-brand px-4 py-3 text-sm leading-6 text-white">
          Done. Your plan now has 10 seats, and I filed the Safari invite bug
          with the conversation details attached.
        </div>

        <div className="mt-5 flex flex-wrap gap-2" aria-label="Supported integrations">
          {["Linear", "GitHub", "Slack", "Discord", "Webhooks", "Custom HTTP"].map(
            (integration) => (
              <span
                key={integration}
                className="rounded-full bg-white/[0.04] px-3 py-1.5 text-[10px] font-medium text-ink-6 shadow-[0_0_0_1px_rgba(255,255,255,0.055)]"
              >
                {integration}
              </span>
            ),
          )}
        </div>
      </div>
    </ProductFrame>
  );
}

export function HandoffVisual() {
  return (
    <ProductFrame>
      <div className="min-h-[390px] p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-amber-300/10 text-amber-300">
            <CircleAlert className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-1">
              Needs human judgment
            </p>
            <p className="mt-0.5 text-[11px] text-ink-7">
              High-value refund request
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white/[0.035] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-7">
            Maven's brief
          </p>
          <p className="mt-3 text-pretty text-sm leading-6 text-ink-3">
            BrightLabs is requesting a $1,200 annual-plan refund after a failed
            migration. I confirmed the charge, checked the refund policy, and
            collected the migration error.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {[
              "Business plan since 2024",
              "$8,400 annual account",
              "Policy requires approval",
              "Error logs attached",
            ].map((item) => (
              <span
                key={item}
                className="flex items-center gap-2 rounded-xl bg-black/20 px-3 py-2 text-[11px] text-ink-5"
              >
                <CheckCircle2 className="size-3.5 shrink-0 text-brand-soft" />
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl bg-brand/[0.08] px-4 py-3 shadow-[0_0_0_1px_rgba(96,165,250,0.14)]">
          <div className="flex items-center gap-3">
            <UserRoundCheck className="size-5 text-brand-soft" />
            <div>
              <p className="text-xs font-semibold text-ink-2">
                Assigned to you
              </p>
              <p className="mt-0.5 text-[10px] text-ink-7">
                Draft reply ready
              </p>
            </div>
          </div>
          <ArrowRight className="size-4 text-ink-5" />
        </div>
      </div>
    </ProductFrame>
  );
}

export function McpVisual() {
  return (
    <ProductFrame>
      <div className="min-h-[430px] p-4 font-mono sm:p-6">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-ink-7">
          <span>Claude · ReplyMaven MCP</span>
          <span className="flex items-center gap-1.5 text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-300" />
            Connected
          </span>
        </div>

        <div className="mt-6 rounded-2xl bg-white/[0.035] p-4 text-xs leading-6 text-ink-3 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
          <span className="text-brand-soft">&gt;</span> Review support from the
          last 30 days. Find recurring problems blocking upgrades and turn the
          top issue into a product brief.
        </div>

        <div className="mt-5 space-y-2.5">
          {[
            [Search, "Read matching conversations", "Complete"],
            [MessageSquareText, "Grouped recurring upgrade blockers", "Complete"],
            [Github, "Created product brief RM-42", "Complete"],
            [FileText, "Drafted help article refresh", "Ready for review"],
          ].map(([Icon, title, status]) => {
            const ItemIcon = Icon as typeof Search;
            return (
              <div
                key={title as string}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs"
              >
                <ItemIcon className="size-4 shrink-0 text-ink-6" />
                <span className="min-w-0 flex-1 truncate text-ink-4">
                  {title as string}
                </span>
                <span className="shrink-0 text-[10px] text-emerald-300">
                  {status as string}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl bg-brand/[0.08] p-4 shadow-[0_0_0_1px_rgba(96,165,250,0.14)]">
          <p className="text-[10px] uppercase tracking-[0.12em] text-brand-soft">
            Product decision
          </p>
          <p className="mt-2 font-sans text-sm font-semibold text-ink-1">
            Make plan upgrades recoverable after payment failures
          </p>
          <p className="mt-2 font-sans text-xs leading-5 text-ink-5">
            Repeated payment failures are blocking plan upgrades for established customers.
          </p>
        </div>
      </div>
    </ProductFrame>
  );
}

export function AgentVisual() {
  return (
    <ProductFrame>
      <div className="min-h-[420px] p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand/15 text-brand-soft">
            <Bot className="size-4" />
          </span>
          <div>
            <p className="text-xs font-semibold text-ink-2">Maven</p>
            <p className="text-[10px] text-ink-7">Working on the request</p>
          </div>
        </div>

        <div className="mt-6 rounded-[18px_18px_18px_6px] bg-white/[0.07] px-4 py-3 text-sm leading-6 text-ink-2">
          I upgraded yesterday, but the new limits still have not appeared.
        </div>

        <div className="mt-5 grid gap-2.5">
          {[
            [BookOpen, "Read upgrade and proration policy"],
            [Database, "Checked plan and billing status"],
            [Wrench, "Refreshed account entitlements"],
          ].map(([Icon, label]) => {
            const ItemIcon = Icon as typeof BookOpen;
            return (
              <div
                key={label as string}
                className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-3"
              >
                <ItemIcon className="size-4 text-brand-soft" />
                <span className="flex-1 text-xs text-ink-4">
                  {label as string}
                </span>
                <Check className="size-4 text-emerald-300" />
              </div>
            );
          })}
        </div>

        <div className="ml-auto mt-6 max-w-[92%] rounded-[18px_18px_6px_18px] bg-brand px-4 py-3 text-sm leading-6 text-white">
          Your Business limits are active now. I refreshed the entitlements and
          confirmed the new allowance on your account.
        </div>
      </div>
    </ProductFrame>
  );
}
