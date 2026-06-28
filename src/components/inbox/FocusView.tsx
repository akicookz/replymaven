import type { Dispatch, SetStateAction } from "react";
import type { Conversation, Message } from "@/lib/inbox/types";

// Stub for Task 7 orchestrator wiring. Task 13 replaces this with the
// stacked-card focus mode. Props here are the contract the orchestrator
// passes; Task 13 must keep these signatures.
interface FocusViewProps {
  conversation: Conversation;
  messages: Message[];
  index: number;
  total: number;
  onExit: () => void;
  onSend: (content?: string) => void;
  onResolve: (convId: string) => void;
  onRewrite: () => void;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
}

export default function FocusView(props: FocusViewProps) {
  return (
    <div className="glass-focus flex-1 grid place-items-center text-ink-7 text-sm">
      Focus · {props.index + 1} of {props.total}
    </div>
  );
}
