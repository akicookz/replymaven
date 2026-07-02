import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Conversation, Message } from "@/lib/inbox/types";
import Composer from "@/components/inbox/Composer";
import { countryFlag } from "@/lib/inbox/country-flag";
import { renderMarkdown } from "@/lib/utils";

interface FocusViewProps {
  conversation: Conversation;
  messages: Message[];
  index: number;
  total: number;
  onExit: () => void;
  onSend: (
    content?: string,
    opts?: { imageUrl?: string | null; asEmail?: boolean },
  ) => void;
  onResolve: (convId: string) => void;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onCompose: () => void;
  composing: boolean;
}

function initials(name: string | null): string {
  if (!name) return "V";
  const parts = name.split(" ").filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "V"
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A full chat bubble for the focus thread (markdown, no truncation). */
function FocusBubble({ message }: { message: Message }) {
  const isReceived = message.role === "visitor";
  const isBot = message.role === "bot";

  const labelClass = isReceived
    ? "text-ink-5"
    : isBot
      ? "text-brand-label"
      : "text-brand-label-human";

  const senderLabel = isReceived
    ? (message.senderName ?? "Visitor")
    : isBot
      ? "Maven · AI"
      : (message.senderName ?? "Agent");

  const html = renderMarkdown(message.content);

  return (
    <div className={`flex flex-col mb-3 ${isReceived ? "items-start" : "items-end"}`}>
      <span className={`text-[11px] font-semibold mb-[3px] ${labelClass}`}>
        {senderLabel}
      </span>
      <div
        className={`max-w-[78%] px-[14px] py-[9px] text-[14.5px] leading-[1.5] break-words ${
          isReceived
            ? "bg-bubble-received text-ink-2 rounded-[18px_18px_18px_6px]"
            : "bg-bubble-sent text-white rounded-[18px_18px_6px_18px]"
        }`}
      >
        {message.imageUrl && (
          <img
            src={message.imageUrl}
            alt="attachment"
            className="block max-w-full max-h-[280px] rounded-[12px] object-contain"
          />
        )}
        {message.content && (
          <div
            className={`prose-chat${message.imageUrl ? " mt-1.5" : ""}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}

export default function FocusView({
  conversation,
  messages,
  index,
  total,
  onExit,
  onSend,
  onResolve,
  draft,
  setDraft,
  onCompose,
  composing,
}: FocusViewProps) {
  // Parse country from metadata JSON (guarded against malformed data)
  let country: string | null = null;
  try {
    const meta = JSON.parse(conversation.metadata ?? "{}") as Record<
      string,
      unknown
    >;
    country = typeof meta.country === "string" ? meta.country : null;
  } catch {
    country = null;
  }

  const priority = conversation.priority ?? "medium";
  const flag = countryFlag(country);
  const name = conversation.visitorName;

  // Full thread (system rows excluded), scrollable inside the card.
  const visible = messages.filter((m) => m.role !== "system");

  // Keep the thread pinned to the latest message when it loads/changes.
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length, conversation.id]);

  return (
    // Fill the pane (escape Layout's p-4/md:p-8); `relative` anchors the exit btn.
    <div className="relative -m-4 md:-m-8 h-screen overflow-hidden">
      {/* Floating exit button — top-right */}
      <button
        type="button"
        className="glass-button absolute top-[18px] right-[30px] z-10 flex items-center gap-[7px] rounded-[9px] px-[12px] h-[34px] text-[13px] text-ink-2 font-medium"
        onClick={onExit}
      >
        Exit Focus
        <span className="keycap">Esc</span>
      </button>

      {/* Vertically + horizontally centered group */}
      <div className="h-full flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[780px]">
          {/* Stacked-card wrapper — peek slivers behind the card top */}
          <div className="relative">
            <div className="absolute top-[-9px] inset-x-[24px] h-5 rounded-t-[18px] bg-glass-peek-2" />
            <div className="absolute top-[-4px] inset-x-[13px] h-5 rounded-t-[18px] bg-glass-peek-1" />

            {/* Main frosted card — ONE scroll container, so the sticky header
                and floating composer read identically to the split reading
                pane: thread scrolls behind both frosted bars. */}
            <div className="glass-focus rounded-[18px] relative z-[1] max-h-[82vh] overflow-hidden flex flex-col">
              <div
                ref={threadRef}
                className="overflow-y-auto relative flex-1 min-h-0"
              >
                {/* Sticky user header — same frosted glass (bg + blur) as the
                    composer pill, so both read identically. */}
                <div className="sticky top-0 z-[5] glass-bar pt-[20px] px-[28px] pb-3">
                  <div className="flex items-center gap-3">
                    {/* 48px initials avatar */}
                    <div className="w-12 h-12 rounded-full bg-glass-raised flex items-center justify-center flex-shrink-0 text-[15px] font-semibold text-ink-2 select-none">
                      {initials(name)}
                    </div>

                    {/* Name + email */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {flag && (
                          <span className="text-[17px] leading-none shrink-0">
                            {flag}
                          </span>
                        )}
                        <span className="text-[19px] font-semibold text-ink-1 truncate">
                          {name ?? "Visitor"}
                        </span>
                      </div>
                      {conversation.visitorEmail && (
                        <div className="text-[13px] text-ink-7 truncate mt-0.5">
                          {conversation.visitorEmail}
                        </div>
                      )}
                    </div>

                    {/* Status pill */}
                    <div className="glass-button flex items-center gap-[6px] rounded-full px-3 h-[28px] text-[12px] text-ink-3 font-medium flex-shrink-0">
                      <span className="w-[7px] h-[7px] rounded-full bg-dot-green flex-shrink-0" />
                      Open · {capitalize(priority)}
                    </div>
                  </div>
                </div>

                {/* Thread */}
                <div className="px-[28px] py-3">
                  {visible.map((m) => (
                    <FocusBubble key={m.id} message={m} />
                  ))}
                </div>

                {/* Composer — sticky bottom, floats over the thread (bleed) */}
                <Composer
                  draft={draft}
                  setDraft={setDraft}
                  onSend={onSend}
                  onResolve={onResolve}
                  onCompose={onCompose}
                  composing={composing}
                  convId={conversation.id}
                />
              </div>
            </div>
          </div>

          {/* Below-card row: "{n} of {total}" + keyboard legend */}
          <div className="flex items-center justify-between mt-4 px-1">
            <span className="text-[13px] font-medium text-brand">
              {index + 1} of {total}
            </span>
            <div className="flex items-center gap-1.5 text-[12px] text-ink-6">
              <span className="keycap">J</span>
              <span className="keycap">K</span>
              <span className="mx-1">next · prev</span>
              <span className="keycap">S</span>
              <span className="mx-1">snooze</span>
              <span className="keycap">⌘K</span>
              <span className="ml-0.5">commands</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
