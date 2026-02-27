import { cn } from "@/lib/utils";

// ─── Size Presets ─────────────────────────────────────────────────────────────
const sizeConfig = {
  sm: {
    container: "w-7 h-7 rounded-lg",
    icon: "w-[18px] h-[18px]",
    text: "text-[15px]",
  },
  md: {
    container: "w-8 h-8 rounded-xl",
    icon: "w-5 h-5",
    text: "text-[15px]",
  },
  lg: {
    container: "w-12 h-12 rounded-2xl",
    icon: "w-7 h-7",
    text: "text-xl",
  },
  xl: {
    container: "w-16 h-16 rounded-2xl",
    icon: "w-9 h-9",
    text: "text-2xl",
  },
} as const;

type LogoSize = keyof typeof sizeConfig;

// ─── Variant Color Presets ────────────────────────────────────────────────────
const variantConfig = {
  default: {
    bg: "bg-primary",
    iconFill: "text-primary-foreground",
    text: "text-foreground",
  },
  muted: {
    bg: "bg-primary/10",
    iconFill: "text-primary",
    text: "text-foreground",
  },
  dark: {
    bg: "bg-[#4ade80]/15",
    iconFill: "text-[#4ade80]",
    text: "text-[#e8f0ea]",
  },
} as const;

type LogoVariant = keyof typeof variantConfig;

// ─── Brand Mark SVG ───────────────────────────────────────────────────────────
interface BrandMarkProps {
  className?: string;
}

function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      {/* Chat bubble */}
      <path d="M3 2C1.9 2 1 2.9 1 4L1 16C1 17.1 1.9 18 3 18L5 18L5 21.5C5 21.9 5.5 22.1 5.7 21.8L9.5 18L21 18C22.1 18 23 17.1 23 16L23 4C23 2.9 22.1 2 21 2Z" />
      {/* Raven silhouette (head + beak + shoulder) */}
      <path
        d="M5 16L5 9C5 6.5 6.5 4.5 9 3.8C10 3.5 11 3.8 11.5 4.5L11.8 4.2C12 4 12.5 3.8 13.5 4L19 5.8C19.8 6 19.8 7 19 7.2L13.5 8.8C12.5 9.1 11.8 8.5 11.5 8L11 7.2C10 6 9 5.5 8 5.8C7 6.2 6.5 7.5 6.5 9L6.5 16Z"
        fill="rgba(255,255,255,0.92)"
      />
      {/* Eye */}
      <circle cx="9.5" cy="6" r="0.6" fill="rgba(255,255,255,0.92)" />
    </svg>
  );
}

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
          v.bg,
          "flex items-center justify-center shrink-0",
        )}
      >
        <BrandMark className={cn(s.icon, v.iconFill)} />
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

export { Logo, BrandMark };
export default Logo;
