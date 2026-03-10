import { cn } from "@/lib/utils";

// ─── Logo Icon SVG ────────────────────────────────────────────────────────────
function LogoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 68 90"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M64.5991 34.4292C64.5991 30.8374 63.7372 27.3928 62.2031 24.8531C60.669 22.3133 58.5882 20.8865 56.4186 20.8865H27.0835C24.9141 20.8857 22.8337 19.4584 21.3 16.9185L12.2933 2.00792C11.8872 1.33568 11.3697 0.877895 10.8064 0.692442C10.2432 0.506988 9.65931 0.602195 9.12871 0.966024C8.59811 1.32985 8.14459 1.94597 7.82548 2.73647C7.50637 3.52697 7.33601 4.45637 7.33594 5.40715V75.0574C7.33594 78.6491 8.1978 82.0938 9.73194 84.6335C11.2661 87.1733 13.3468 88.6001 15.5164 88.6001H56.4186C58.5882 88.6001 60.669 87.1733 62.2031 84.6335C63.7372 82.0938 64.5991 78.6491 64.5991 75.0574V34.4292Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M0.599609 65.6436H14.354" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M0.599609 52.2524H14.354" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M0.599609 40.7739H14.354" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M22.4941 59.9043C31.7573 69.4695 41.0205 69.4695 50.2836 59.9043"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
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
