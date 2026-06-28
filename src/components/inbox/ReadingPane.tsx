import type { Dispatch, SetStateAction } from "react";
import type { Conversation, Message } from "@/lib/inbox/types";

// Stub for Task 7 orchestrator wiring. Task 9 (shell/header) + Tasks 10/11
// (thread/composer) replace this. Props here are the contract the orchestrator
// passes; downstream tasks must keep these signatures.
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
}

export default function ReadingPane(props: ReadingPaneProps) {
  return (
    <div className="glass-reading flex-1 min-w-0 grid place-items-center text-ink-7 text-sm">
      {props.conversation.visitorName ?? props.conversation.visitorId}
    </div>
  );
}
