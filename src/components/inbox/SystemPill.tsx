import type { Message } from "@/lib/inbox/types";
import { parseSystemKind, systemEventDot } from "@/lib/inbox/system-events";

interface SystemPillProps {
  message: Message;
}

export default function SystemPill({ message }: SystemPillProps) {
  const kind = parseSystemKind(message.sources);
  const dotClass = systemEventDot(kind);

  return (
    <div className="flex justify-center my-3">
      <span className="system-pill">
        <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${dotClass}`} />
        {message.content}
      </span>
    </div>
  );
}
