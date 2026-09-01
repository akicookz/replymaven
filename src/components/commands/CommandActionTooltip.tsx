import type { ReactElement } from "react";
import { CommandKeycap } from "@/components/commands/CommandKeycap";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CommandAvailability } from "@/lib/commands/dashboard-command-domain";

function elementIsDisabled(element: ReactElement): boolean {
  const props = element.props;
  return (
    typeof props === "object" &&
    props !== null &&
    "disabled" in props &&
    props.disabled === true
  );
}

export function CommandActionTooltip({
  availability,
  reason,
  children,
}: {
  availability: CommandAvailability;
  reason?: string;
  children: ReactElement;
}) {
  if (availability.status === "hidden") return children;
  const disabledReason =
    reason ??
    (availability.status === "disabled" ? availability.reason : null);
  const disabled = elementIsDisabled(children);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {disabled ? <span className="inline-flex">{children}</span> : children}
        </TooltipTrigger>
        <TooltipContent
          sideOffset={6}
          className="flex items-center gap-2 bg-popover fill-popover text-popover-foreground"
        >
          <span>{disabledReason ?? availability.presentation.description}</span>
          <CommandKeycap keycap={availability.presentation.keycap} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
