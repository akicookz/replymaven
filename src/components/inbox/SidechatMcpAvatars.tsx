import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Favicon } from "@/components/ui/favicon";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { faviconDomainFromUrl } from "@/lib/favicon";
import type { SidechatMcpAvatar } from "@/lib/inbox/sidechat-mcp-avatars";

function ConnectionIcon({ icon, name }: { icon: string | null; name: string }) {
  const domain = faviconDomainFromUrl(icon);
  return (
    <Favicon
      name={name}
      src={domain ? null : icon}
      domain={domain}
      className="size-full rounded-full bg-glass-button"
      imageClassName="p-1"
      letterClassName="text-[9px]"
    />
  );
}

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
        Connections
      </Label>
      <TooltipProvider delayDuration={200}>
        <AvatarGroup className="*:data-[slot=avatar]:ring-glass-reading">
          {connections.map((connection) => (
            <Tooltip key={connection.id}>
              <TooltipTrigger asChild>
                <Avatar
                  size="xs"
                  aria-label={connection.name}
                  className="border border-hairline-100"
                >
                  <ConnectionIcon icon={connection.icon} name={connection.name} />
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
