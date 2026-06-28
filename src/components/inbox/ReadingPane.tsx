import type { Dispatch, SetStateAction } from "react";
import type { Conversation, Message } from "@/lib/inbox/types";
import ReadingHeader from "./ReadingHeader";
import ChatThread from "./ChatThread";
import Composer from "./Composer";

// Props contract — orchestrator (Conversations.tsx) passes these; all props
// are additive from the Task-7 stub. Tasks 10/11 receive the subset they need.
interface ReadingPaneProps {
  conversation: Conversation;
  messages: Message[];
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onSend: (content?: string) => void;
  onResolve: (convId: string) => void;
  onSnooze: (convId: string, until: number | null) => void;
  onFlagSpam: (convId: string) => void;
  onPriority: (convId: string, priority: "low" | "medium" | "high") => void;
  onRewrite: () => void;
  onFocus: () => void;
  /** Block the visitor associated with this conversation. */
  onBlock: (convId: string) => void;
}

export default function ReadingPane({
  conversation,
  messages,
  draft,
  setDraft,
  onSend,
  onResolve,
  onSnooze,
  onFlagSpam,
  onPriority,
  onRewrite,
  onFocus,
  onBlock,
}: ReadingPaneProps) {
  return (
    <div className="glass-reading flex-1 min-w-0 overflow-y-auto relative flex flex-col">
      {/* Sticky header: toolbar row + user bar */}
      <ReadingHeader
        conversation={conversation}
        onResolve={onResolve}
        onSnooze={onSnooze}
        onFlagSpam={onFlagSpam}
        onPriority={onPriority}
        onBlock={onBlock}
        onFocus={onFocus}
      />

      {/* Chat thread — Task 10 replaces the stub */}
      <ChatThread messages={messages} conversation={conversation} />

      {/* Composer — Task 11 replaces the stub */}
      <Composer
        draft={draft}
        setDraft={setDraft}
        onSend={onSend}
        onResolve={onResolve}
        onRewrite={onRewrite}
      />
    </div>
  );
}
