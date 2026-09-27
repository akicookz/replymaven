import { type ReactNode } from "react";
import { Webhook } from "lucide-react";
import { LogoIcon } from "@/components/Logo";
import { cn } from "@/lib/utils";

// Landing diagram: channels in → Maven → where the team gets pinged.
// Desktop draws fixed-geometry cards with SVG connectors; smaller screens stack.

const CARD =
  "bg-white/[0.04] backdrop-blur-[40px] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.04)]";
const TILE =
  "bg-[#1c1d22] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.04)]";

const W = 1104;
const CW = 300;
const CARD_H = 96;
const GAP = 24;
const TOP = 56;
const CENTER_X0 = (W - CW) / 2;
const CENTER_X1 = (W + CW) / 2;
const ROWS = [0, 1, 2].map((i) => TOP + i * (CARD_H + GAP));
const MIDS = ROWS.map((y) => y + CARD_H / 2);
const CENTER_TOP = TOP + 64;
const CENTER_H = 200;
const PORTS = [CENTER_TOP + 60, CENTER_TOP + 100, CENTER_TOP + 140];
const HEIGHT = ROWS[2] + CARD_H;

interface Channel {
  icon: ReactNode;
  title: string;
  sub: string;
}

function Tile({ children }: { children: ReactNode }) {
  return (
    <span className={cn(TILE, "inline-flex size-11 shrink-0 items-center justify-center rounded-[12px]")}>
      {children}
    </span>
  );
}

const INBOUND: Channel[] = [
  {
    icon: (
      <Tile>
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand shadow-[0_6px_16px_-6px_rgba(37,99,235,0.8)]">
          <LogoIcon className="h-4 w-auto text-white" />
        </span>
      </Tile>
    ),
    title: "Website widget",
    sub: "Customer chats",
  },
  {
    icon: (
      <Tile>
        <img src="/integrations/gmail.svg" alt="" className="size-5" />
      </Tile>
    ),
    title: "Gmail",
    sub: "support@northwind.com",
  },
  {
    icon: (
      <Tile>
        <Webhook className="size-5 text-ink-2" />
      </Tile>
    ),
    title: "Webhook",
    sub: "Your app's events",
  },
];

const ROUTING: Channel[] = [
  {
    icon: (
      <span className="flex shrink-0 -space-x-2">
        <Tile>
          <img src="/integrations/slack.svg" alt="" className="size-5" />
        </Tile>
        <span className="rounded-[12px] shadow-[0_0_0_2px_#141417]">
          <Tile>
            <img src="/integrations/telegram.svg" alt="" className="size-5" />
          </Tile>
        </span>
      </span>
    ),
    title: "Slack or Telegram",
    sub: "Reply in the thread",
  },
  {
    icon: (
      <Tile>
        <span className="relative inline-flex">
          <LogoIcon className="h-5 w-auto text-ink-1" />
          <span className="absolute -right-3 -top-2 h-4 min-w-4 rounded-full bg-ink-2 px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-background">
            3
          </span>
        </span>
      </Tile>
    ),
    title: "ReplyMaven inbox",
    sub: "Your team, in the dashboard",
  },
  {
    icon: (
      <Tile>
        <img src="/integrations/gmail.svg" alt="" className="size-5" />
      </Tile>
    ),
    title: "Gmail",
    sub: "amanda@northwind.com",
  },
];

function ChannelCard({ channel, className, style }: { channel: Channel; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn(CARD, "flex items-center gap-3.5 rounded-[16px] px-4", className)} style={style}>
      {channel.icon}
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-ink-1">{channel.title}</p>
        <p className="mt-0.5 truncate text-[13px] text-ink-5">{channel.sub}</p>
      </div>
    </div>
  );
}

function MavenCard({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn(CARD, "flex flex-col items-center justify-center rounded-[22px] px-8 text-center", className)}
      style={style}
    >
      <span className="relative inline-block">
        {/* Same Maven avatar the inbox uses (AssigneeMenu.tsx). */}
        <span className="inline-flex size-16 items-center justify-center rounded-full bg-glass-raised shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)]">
          <LogoIcon className="h-[42%] w-auto text-ink-2" />
        </span>
        <span className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full bg-dot-green shadow-[0_0_0_3px_#17181c]" />
      </span>
      <p className="mt-4 text-[17px] font-medium text-ink-1">Maven</p>
      <p className="mt-1.5 text-balance text-[13px] leading-relaxed text-ink-5">
        Your 24/7 support agent, trained on your docs
      </p>
    </div>
  );
}

const STEPS = [
  { n: "1.1", title: "Omnichannel inbound" },
  { n: "1.2", title: "Frontline customer support agent" },
  { n: "1.3", title: "Smart escalation routing" },
];

function StepHeading({ step, className, style }: { step: (typeof STEPS)[number]; className?: string; style?: React.CSSProperties }) {
  return (
    <p className={cn("text-[15px] font-medium text-ink-2", className)} style={style}>
      <span className="mr-2 font-mono text-[11px] tabular-nums text-brand/80">{step.n}</span>
      {step.title}
    </p>
  );
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  return `M${x1} ${y1} C${x1 + 55} ${y1}, ${x2 - 55} ${y2}, ${x2} ${y2}`;
}

function FlowDiagram() {
  const headings = [
    { x: 0, step: STEPS[0], align: "left" as const },
    { x: CENTER_X0, step: STEPS[1], align: "center" as const },
    { x: W - CW, step: STEPS[2], align: "left" as const },
  ];
  return (
    <div className="relative mx-auto" style={{ width: W, height: HEIGHT }}>
      {headings.map((h) => (
        <StepHeading
          key={h.step.n}
          step={h.step}
          className="absolute top-0"
          style={{ left: h.x, width: CW, textAlign: h.align }}
        />
      ))}
      <svg aria-hidden className="absolute inset-0" width={W} height={HEIGHT} viewBox={`0 0 ${W} ${HEIGHT}`}>
        {MIDS.map((my, i) => (
          <g key={my}>
            <path className="rm-flow-line" d={curve(CW, my, CENTER_X0, PORTS[i])} />
            <path className="rm-flow-line" d={curve(CENTER_X1, PORTS[i], W - CW, my)} />
            {[
              [CW, my],
              [CENTER_X0, PORTS[i]],
              [CENTER_X1, PORTS[i]],
              [W - CW, my],
            ].map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3} fill="#60a5fa" />
            ))}
          </g>
        ))}
      </svg>
      {INBOUND.map((c, i) => (
        <ChannelCard key={c.title + c.sub} channel={c} className="absolute" style={{ left: 0, top: ROWS[i], width: CW, height: CARD_H }} />
      ))}
      {ROUTING.map((c, i) => (
        <ChannelCard key={c.title + c.sub} channel={c} className="absolute" style={{ left: W - CW, top: ROWS[i], width: CW, height: CARD_H }} />
      ))}
      <MavenCard className="absolute" style={{ left: CENTER_X0, top: CENTER_TOP, width: CW, height: CENTER_H }} />
    </div>
  );
}

function StackedFlow() {
  return (
    <div className="space-y-8">
      <div>
        <StepHeading step={STEPS[0]} className="mb-3" />
        <div className="space-y-3">
          {INBOUND.map((c) => (
            <ChannelCard key={c.title + c.sub} channel={c} className="h-[84px]" />
          ))}
        </div>
      </div>
      <div>
        <StepHeading step={STEPS[1]} className="mb-3" />
        <MavenCard className="py-8" />
      </div>
      <div>
        <StepHeading step={STEPS[2]} className="mb-3" />
        <div className="space-y-3">
          {ROUTING.map((c) => (
            <ChannelCard key={c.title + c.sub} channel={c} className="h-[84px]" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChannelFlowSection() {
  return (
    <section id="inbox" className="py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-16">
          <h2 className="text-balance font-heading text-[1.7rem] font-medium leading-[1.08] tracking-[-0.025em] text-ink-1 sm:text-[2.6rem]">
            Omni-channel shared inbox
          </h2>
          <div className="lg:pt-1.5">
            <p className="max-w-lg text-[1.05rem] leading-relaxed text-ink-5">
              Widget, email, and webhook messages land in one inbox. Maven answers first and pings your team in
              Slack, Telegram, or email when it needs you.
            </p>
            <div className="mt-6 space-y-2.5">
              {STEPS.map((step) => (
                <div key={step.n} className="flex items-baseline gap-2.5">
                  <span className="font-mono text-[11px] tabular-nums text-brand/80">{step.n}</span>
                  <span className="text-[13px] text-ink-3">{step.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-20 hidden xl:block">
          <FlowDiagram />
        </div>
        <div className="mt-14 xl:hidden">
          <StackedFlow />
        </div>
      </div>
    </section>
  );
}
