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
const sizeConfig = {
  sm: {
    container: "w-7 h-7 rounded-lg",
    icon: "h-[18px] w-auto",
    text: "text-[15px]",
  },
  md: {
    container: "w-8 h-8 rounded-xl",
    icon: "h-5 w-auto",
    text: "text-[15px]",
  },
  lg: {
    container: "w-11 h-11 rounded-2xl",
    icon: "h-7 w-auto",
    text: "text-xl",
  },
  xl: {
    container: "w-16 h-16 rounded-2xl",
    icon: "h-10 w-auto",
    text: "text-2xl",
  },
} as const;

type LogoSize = keyof typeof sizeConfig;

// ─── Variant Presets ──────────────────────────────────────────────────────────
const variantConfig = {
  default: {
    surface: "glow-surface",
    icon: "text-brand",
    text: "text-card-foreground",
  },
  subtle: {
    surface: "glow-surface-subtle",
    icon: "text-brand",
    text: "text-card-foreground",
  },
} as const;

type LogoVariant = keyof typeof variantConfig;

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
  variant = "default",
  iconOnly = false,
  showText = true,
  className,
  textClassName,
}: LogoProps) {
  const s = sizeConfig[size];
  const v = variantConfig[variant];

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        className={cn(
          s.container,
          v.surface,
          "flex items-center justify-center shrink-0",
        )}
      >
        <LogoIcon className={cn(s.icon, v.icon)} />
      </div>
      {!iconOnly && showText && (
        <span
          className={cn(
            "font-semibold tracking-tight",
            s.text,
            v.text,
            textClassName,
          )}
        >
          ReplyMaven
        </span>
      )}
    </div>
  );
}

export { Logo };
export default Logo;
