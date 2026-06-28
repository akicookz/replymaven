import type { InboxFilter } from "@/lib/inbox/filters";
import type { Conversation, InboxCounts } from "@/lib/inbox/types";

// Stub for Task 7 orchestrator wiring. Task 8 replaces this with the real
// 372px conversation-list column + ConversationRow. Props here are the
// contract the orchestrator passes; Task 8 must keep these signatures.
interface MessageListProps {
  filter: InboxFilter;
  conversations: Conversation[];
  counts: InboxCounts;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onResolve: (convId: string) => void;
  onSnooze: (convId: string, until: number | null) => void;
}

export default function MessageList(props: MessageListProps) {
  return (
    <div className="glass-list border-r border-hairline w-[372px] shrink-0 flex flex-col p-4 text-ink-7 text-sm">
      {props.conversations.length} conversations
    </div>
  );
}
