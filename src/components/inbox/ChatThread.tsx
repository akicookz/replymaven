// Stub — Task 10 replaces this with the real chat bubble thread.
// Props here are the contract Task 10 must match exactly.
import type { Conversation, Message } from "@/lib/inbox/types";

interface ChatThreadProps {
  messages: Message[];
  conversation: Conversation;
}

export default function ChatThread({ messages, conversation }: ChatThreadProps) {
  return (
    <div
      className="flex-1 px-[30px] py-6 text-ink-7 text-sm"
      data-conv={conversation.id}
      data-count={messages.length}
    >
      {/* Task 10: render chat bubbles here */}
    </div>
  );
}
