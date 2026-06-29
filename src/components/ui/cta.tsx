import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

// Marketing button primitive (landing + docs). One primitive, four roles —
// applied by intent, never ad-hoc:
//   primary   → glow (the main conversion CTA)
//   secondary → white pill
//   outline   → hairline border, transparent fill
//   ghost     → subtle fill, no border (lowest emphasis)
const CTA_VARIANTS = {
  primary: "glow-surface text-card-foreground",
  secondary: "bg-foreground text-background hover:opacity-90",
  outline: "border border-hairline-strong text-ink-2 hover:bg-white/[0.05]",
  ghost: "bg-white/[0.05] text-ink-2 hover:bg-white/[0.09]",
} as const;

const CTA_SIZES = {
  sm: "h-8 px-4 text-[13px]",
  md: "px-5 py-2.5 text-[13.5px]",
  lg: "px-6 py-3 text-[14px]",
} as const;

export interface CtaProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof CTA_VARIANTS;
  size?: keyof typeof CTA_SIZES;
  /** Render the child element instead of a <button> (e.g. a react-router <Link>). */
  asChild?: boolean;
}

export function Cta({
  variant = "primary",
  size = "lg",
  className,
  asChild,
  ...props
}: CtaProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-all cursor-pointer disabled:opacity-50",
        CTA_VARIANTS[variant],
        CTA_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
