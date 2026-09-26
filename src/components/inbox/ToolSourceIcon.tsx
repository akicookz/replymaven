import { Favicon } from "@/components/ui/favicon";
import { faviconDomainFromUrl } from "@/lib/favicon";
import { cn } from "@/lib/utils";

// Tile for the connector a Sidechat tool belongs to.
// Usage: <ToolSourceIcon icon={tool.source.icon} name={tool.source.name} />
interface ToolSourceIconProps {
  icon: string | null;
  name: string;
  size?: "sm" | "md";
}

export default function ToolSourceIcon({
  icon,
  name,
  size = "sm",
}: ToolSourceIconProps) {
  const domain = faviconDomainFromUrl(icon);
  return (
    <Favicon
      name={name}
      src={domain ? null : icon}
      domain={domain}
      className={cn(
        "shrink-0 bg-ink-1/5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]",
        size === "sm" ? "size-5 rounded-[6px]" : "size-7 rounded-[8px]",
      )}
      imageClassName={size === "sm" ? "p-0.5" : "p-1"}
      letterClassName={size === "sm" ? "text-[10px]" : "text-[12px]"}
    />
  );
}
