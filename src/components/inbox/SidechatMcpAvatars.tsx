import { Plug } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SidechatMcpAvatar } from "@/lib/inbox/sidechat-mcp-avatars";

interface SidechatMcpAvatarsProps {
  connections: SidechatMcpAvatar[];
}

export default function SidechatMcpAvatars({
  connections,
}: SidechatMcpAvatarsProps) {
  if (connections.length === 0) return null;

  return (
    <div
      role="group"
      aria-labelledby="connected-tools-label"
      className="flex items-center justify-start gap-2 pt-1 pl-2"
    >
      <Label
        id="connected-tools-label"
        className="text-xs font-medium text-ink-6"
      >
        Connected tools
      </Label>
      <TooltipProvider delayDuration={200}>
        <AvatarGroup className="*:data-[slot=avatar]:ring-glass-reading">
          {connections.map((connection) => (
            <Tooltip key={connection.id}>
              <TooltipTrigger asChild>
                <Avatar
                  size="sm"
                  aria-label={connection.name}
                  className="glass-button bg-glass-raised"
                >
                  {connection.icon ? (
                    <AvatarImage
                      src={connection.icon}
                      alt=""
                      className="object-contain p-1"
                    />
                  ) : null}
                  <AvatarFallback>
                    <Plug aria-hidden="true" className="size-3 text-ink-5" />
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={6}
                className="px-2 py-1 text-[11px]"
              >
                {connection.name}
              </TooltipContent>
            </Tooltip>
          ))}
        </AvatarGroup>
      </TooltipProvider>
    </div>
  );
}
