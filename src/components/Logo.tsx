import { useId } from "react";
import { cn } from "@/lib/utils";

// ─── Logo Icon SVG ────────────────────────────────────────────────────────────
function LogoIcon({ className }: { className?: string }) {
  const maskId = useId();
  return (
    <svg
      viewBox="0 0 28 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <mask id={maskId}>
        <rect width="28" height="32" fill="white" />
        <path
          d="M6 14C11.3333 19.3333 16.6667 19.3333 22 14"
          stroke="black"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <path
        mask={`url(#${maskId})`}
        d="M24 32H6C2.6875 32 0 29.3125 0 26V6C0 2.6875 2.6875 0 6 0H25C26.6562 0 28 1.34375 28 3V21C28 22.3062 27.1625 23.4187 26 23.8312V28C27.1063 28 28 28.8937 28 30C28 31.1063 27.1063 32 26 32H24ZM6 24C4.89375 24 4 24.8937 4 26C4 27.1063 4.89375 28 6 28H22V24H6Z"
        fill="currentColor"
      />
    </svg>
  );
}

// ─── Size Presets ─────────────────────────────────────────────────────────────
// Bare-mark sizes (no tile) — the book reads as the logo itself, so it carries
// roughly the footprint the old tile had.
const sizeConfig = {
  sm: { icon: "h-[18px] w-auto", text: "text-[15px]" },
  md: { icon: "h-5 w-auto", text: "text-[15px]" },
  lg: { icon: "h-7 w-auto", text: "text-xl" },
  xl: { icon: "h-10 w-auto", text: "text-2xl" },
} as const;

type LogoSize = keyof typeof sizeConfig;

// Variant kept for API compatibility only — the logo is monochrome on every
// surface now (bare mark in the foreground colour), so it has no visual effect.
type LogoVariant = "default" | "subtle";

// ─── Logo Component ───────────────────────────────────────────────────────────
interface LogoProps {
  size?: LogoSize;
  variant?: LogoVariant;
  iconOnly?: boolean;
  showText?: boolean;
  className?: string;
  textClassName?: string;
}

function Logo({
  size = "sm",
  iconOnly = false,
  showText = true,
  className,
  textClassName,
}: LogoProps) {
  const s = sizeConfig[size];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Bare mark, no tile — the foreground colour inverts with the surface
          (dark book on light, light book on dark). */}
      <LogoIcon className={cn(s.icon, "text-foreground shrink-0")} />
      {!iconOnly && showText && (
        <span
          className={cn(
            "font-semibold tracking-tight text-foreground",
            s.text,
            textClassName,
          )}
        >
          ReplyMaven
        </span>
      )}
    </div>
  );
}

export { Logo, LogoIcon };
export default Logo;
