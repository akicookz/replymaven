import type { CommandKeycap as CommandKeycapModel } from "@/lib/commands/dashboard-command-domain";
import { cn } from "@/lib/utils";

export function CommandKeycap({
  keycap,
  className,
}: {
  keycap: CommandKeycapModel;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keycap.keys.map((key, index) => (
        <span key={`${key}-${index}`} className="keycap">
          {key}
        </span>
      ))}
    </span>
  );
}
