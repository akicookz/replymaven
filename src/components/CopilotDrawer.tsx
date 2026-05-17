import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Loader2,
  ClipboardCopy,
  X,
  Wrench,
  AlertCircle,
} from "lucide-react";
import {
  useCopilotSender,
  useCopilotThread,
  type CopilotMessage,
  type CopilotSourceRef,
} from "@/lib/use-copilot";
import { Button } from "@/components/ui/button";
import { cn, renderMarkdown } from "@/lib/utils";

interface CopilotDrawerProps {
  projectId: string;
  conversationId: string;
  onClose: () => void;
  onAddToComposer: (text: string) => void;
}

function parseSources(raw: string | null): CopilotSourceRef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return [];
}

export function CopilotDrawer({
  projectId,
  conversationId,
  onClose,
  onAddToComposer,
}: CopilotDrawerProps) {
  const thread = useCopilotThread(projectId, conversationId);
  const sender = useCopilotSender(projectId, conversationId);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSuggestFired = useRef<string | null>(null);

  // Auto-suggest on first open for a conversation that has no thread yet.
  useEffect(() => {
    if (thread.isLoading || thread.isError) return;
    const data = thread.data;
    if (!data) return;
    if (data.length > 0) return;
    if (autoSuggestFired.current === conversationId) return;
    if (sender.isStreaming) return;
    autoSuggestFired.current = conversationId;
    sender.send({ endpoint: "auto-suggest" });
  }, [thread.data, thread.isLoading, thread.isError, conversationId, sender]);

  // Reset auto-suggest guard when switching conversations.
  useEffect(() => {
    return () => {
      autoSuggestFired.current = null;
    };
  }, [conversationId]);

  // Auto-scroll to bottom when messages arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread.data?.length, sender.isStreaming]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sender.isStreaming) return;
    sender.send({ endpoint: "messages", content: trimmed });
    setInput("");
  }

  return (
    <aside
      className={cn(
        "flex flex-col bg-card/50 backdrop-blur-xl w-full md:w-[380px] md:shrink-0 h-full",
      )}
      aria-label="Copilot"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <h3 className="text-sm font-semibold text-foreground flex-1">
          Copilot
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Copilot"
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4"
      >
        {thread.isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading…
          </div>
        )}
        {thread.isError && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Couldn't load Copilot thread.</span>
          </div>
        )}
        {thread.data?.length === 0 && !sender.isStreaming && (
          <div className="text-xs text-muted-foreground py-8 text-center">
            Copilot will read this conversation and suggest a reply momentarily.
          </div>
        )}
        {thread.data?.map((msg) => (
          <CopilotMessageBubble
            key={msg.id}
            message={msg}
            onAddToComposer={onAddToComposer}
          />
        ))}
        {sender.error && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{sender.error}</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="px-3 py-3 bg-card"
      >
        <div className="flex items-end gap-2 rounded-xl bg-muted/40 px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Ask Copilot…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-h-[20px] max-h-32"
            disabled={sender.isStreaming}
          />
          <button
            type="submit"
            disabled={!input.trim() || sender.isStreaming}
            aria-label="Send"
            className="shrink-0 p-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90"
          >
            {sender.isStreaming ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </form>
    </aside>
  );
}

function CopilotMessageBubble({
  message,
  onAddToComposer,
}: {
  message: CopilotMessage;
  onAddToComposer: (text: string) => void;
}) {
  const isAgent = message.role === "agent";
  const sources = parseSources(message.sources);

  if (isAgent) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-tr-none bg-primary/[0.10] px-3 py-2 text-[13px] text-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-3 h-3 text-primary" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {message.autoSuggest ? "Suggested reply" : "Copilot"}
        </span>
        {message._streaming && (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Tool execution cards (above the message body, inline) */}
      {message._toolCalls && message._toolCalls.length > 0 && (
        <div className="space-y-1">
          {message._toolCalls.map((call, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/40 text-[11px] text-muted-foreground"
            >
              <Wrench className="w-3 h-3" />
              <span className="font-medium">{call.name}</span>
              <span className="opacity-60">
                {call.success === undefined
                  ? "running…"
                  : call.success
                    ? "ok"
                    : "failed"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg rounded-tl-none bg-muted/50 px-3 py-2 text-[13px] text-foreground">
        {message.content ? (
          <div
            className="prose-chat break-words [overflow-wrap:anywhere]"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        ) : (
          <span className="text-muted-foreground">Thinking…</span>
        )}

        {sources.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {sources.map((s, idx) => (
              <div
                key={idx}
                className="text-[11px] text-muted-foreground flex items-center gap-1"
              >
                <span className="opacity-60">·</span>
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground hover:underline truncate"
                  >
                    {s.title}
                  </a>
                ) : (
                  <span className="truncate">{s.title}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {message.content && !message._streaming && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => onAddToComposer(message.content)}
          >
            <ClipboardCopy className="w-3 h-3" />
            Add to composer
          </Button>
        </div>
      )}
    </div>
  );
}
