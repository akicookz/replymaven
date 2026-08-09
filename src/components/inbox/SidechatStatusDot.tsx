import { deriveSidechatStatusDot } from "@/lib/inbox/sidechat";
import { cn } from "@/lib/utils";
import type { SidechatStatus } from "../../../shared/ws-events";

interface SidechatStatusDotProps {
  status: SidechatStatus;
  className?: string;
}

export default function SidechatStatusDot({
  status,
  className,
}: SidechatStatusDotProps) {
  const dot = deriveSidechatStatusDot(status);
  if (!dot) return null;

  return (
    <span
      role="img"
      aria-label={dot.title}
      title={dot.title}
      className={cn(
        "inline-block shrink-0 rounded-full",
        dot.sizeClass,
        dot.colorClass,
        dot.motionClass,
        className,
      )}
    />
  );
}
