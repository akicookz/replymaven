import { type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { HalftoneSky } from "@/components/marketing/halftone-sky";
import { cn } from "@/lib/utils";

// Landing bento primitives: a card with a halftone art panel on top and text below.
// Usage: <BentoCard sky={{ seed: 11, clouds: [[0.2, 0.7, 0.6]] }} title="…" body="…"><Tray /></BentoCard>

export type Sky = { seed: number; clouds: [number, number, number][] };

export const TRAY =
  "rounded-[16px] bg-[rgba(11,12,15,0.45)] p-2.5 backdrop-blur-[16px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_30px_70px_-28px_rgba(0,0,0,0.8)]";
export const TILE =
  "bg-[#1c1d22] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.04)]";

type Tone = "maven" | "you" | "done";

export function StatusTag({ tone, children }: { tone: Tone; children: ReactNode }) {
  const toneClass = {
    maven: "bg-brand/20 text-brand-soft",
    you: "bg-dot-orange/15 text-[#ffb340]",
    done: "bg-emerald-400/15 text-emerald-300",
  }[tone];
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px]", toneClass)}>
      {children}
    </span>
  );
}

export function BentoCard({
  wide,
  sky,
  href,
  title,
  body,
  artClassName,
  stageClassName,
  className,
  tall,
  children,
}: {
  wide?: boolean;
  sky: Sky;
  href?: string;
  title: string;
  body: string;
  artClassName?: string;
  stageClassName?: string;
  className?: string;
  /** Art panel grows to fill a row-spanning card; the text keeps its natural height. */
  tall?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-[22px] bg-[#0f1014]",
        "after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] after:content-['']",
        wide && "lg:col-span-2",
        className,
      )}
    >
      <div className={cn("relative h-[250px] shrink-0 overflow-hidden", tall && "h-[580px] lg:h-auto lg:flex-1", artClassName)}>
        <HalftoneSky seed={sky.seed} clouds={sky.clouds} />
        <div className={cn("absolute inset-0 z-10 flex items-center justify-center p-4 sm:p-6", stageClassName)}>{children}</div>
      </div>
      <div className={cn("flex flex-col p-6 sm:p-7", tall ? "flex-none" : "flex-1")}>
        <h3 className="font-heading text-[1.2rem] sm:text-[1.35rem] font-medium leading-[1.2] tracking-[-0.015em] text-ink-1">
          {title}
        </h3>
        <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-ink-5">{body}</p>
        {href && (
          <a
            href={href}
            className="mt-auto inline-flex items-center gap-1 pt-5 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink-1"
          >
            See how
            <ChevronRight className="size-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
