import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Size Presets ─────────────────────────────────────────────────────────────
const sizeConfig = {
  sm: {
    container: "w-7 h-7 rounded-lg",
    icon: "w-3.5 h-3.5",
    text: "text-[15px]",
  },
  md: {
    container: "w-8 h-8 rounded-xl",
    icon: "w-4 h-4",
    text: "text-[15px]",
  },
  lg: {
    container: "w-12 h-12 rounded-2xl",
    icon: "w-6 h-6",
    text: "text-xl",
  },
  xl: {
    container: "w-16 h-16 rounded-2xl",
    icon: "w-9 h-9",
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
        <MessageSquare className={cn(s.icon, v.icon)} />
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
