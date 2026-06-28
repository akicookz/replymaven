import type { Dispatch, SetStateAction } from "react";
import type { Conversation, Message } from "@/lib/inbox/types";
import Composer from "@/components/inbox/Composer";
import { countryFlag } from "@/lib/inbox/country-flag";

// Stub for Task 7 orchestrator wiring. Task 13 replaces this with the
// stacked-card focus mode. Props here are the contract the orchestrator
// passes; Task 13 must keep these signatures.
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
  onRewrite: () => void;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
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

interface MiniBubbleProps {
  message: Message;
}

function MiniBubble({ message }: MiniBubbleProps) {
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

  if (isReceived) {
    return (
      <div className="flex flex-col items-start mb-[10px]">
        <span className={`text-[11px] font-semibold mb-[3px] ${labelClass}`}>
          {senderLabel}
        </span>
        <div className="max-w-[80%] px-[10px] py-[6px] text-[13px] leading-[1.45] bg-bubble-received text-ink-2 rounded-[16px_16px_16px_5px] line-clamp-3 break-words">
          {message.content}
        </div>
      </div>
    );
  }

  // Bot or agent (sent side)
  return (
    <div className="flex flex-col items-end mb-[10px]">
      <span className={`text-[11px] font-semibold mb-[3px] ${labelClass}`}>
        {senderLabel}
      </span>
      <div className="max-w-[80%] px-[10px] py-[6px] text-[13px] leading-[1.45] bg-bubble-sent text-white rounded-[16px_16px_5px_16px] line-clamp-3 break-words">
        {message.content}
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
  onRewrite,
  draft,
  setDraft,
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

  // Filter out system rows for the mini-thread
  const visible = messages.filter((m) => m.role !== "system");

  // Last-3 logic: first message + optional gap marker + last 2 messages.
  // If ≤ 3 visible messages, show them all in order without a gap marker.
  let showGap = false;
  let displayMessages: Message[];
  if (visible.length <= 3) {
    displayMessages = visible;
  } else {
    displayMessages = [
      visible[0],
      visible[visible.length - 2],
      visible[visible.length - 1],
    ];
    showGap = true;
  }

  return (
    // Escape the Layout's p-4/md:p-8 padding so FocusView fills the full pane.
    // `relative` anchors the absolute-positioned exit button.
    <div className="relative -m-4 md:-m-8">
      {/* Floating exit button — top-right of the content area */}
      <button
        type="button"
        className="glass-button absolute top-[18px] right-[30px] z-10 flex items-center gap-[7px] rounded-[9px] px-[12px] h-[34px] text-[13px] text-ink-2 font-medium"
        onClick={onExit}
      >
        Exit Focus
        <span className="keycap">Esc</span>
      </button>

      {/* Centered column */}
      <div className="max-w-[680px] mx-auto pt-24 pb-10 px-6">
        {/* Stacked-card wrapper — peek slivers render behind the main card */}
        <div className="relative">
          {/* Deeper peek (further back, more negative offset, wider inset) */}
          <div className="absolute top-[-9px] inset-x-[24px] h-5 rounded-t-[18px] bg-glass-peek-2" />
          {/* Middle peek (closer, narrower inset) */}
          <div className="absolute top-[-4px] inset-x-[13px] h-5 rounded-t-[18px] bg-glass-peek-1" />

          {/* Main frosted card */}
          <div className="glass-focus rounded-[18px] overflow-hidden relative z-[1]">
            {/* Padded card body: user bar + mini-thread */}
            <div className="pt-[22px] px-[24px] pb-4">
              {/* User bar */}
              <div className="flex items-center gap-3 mb-5">
                {/* 44px initials avatar */}
                <div className="w-11 h-11 rounded-full bg-glass-raised flex items-center justify-center flex-shrink-0 text-[14px] font-semibold text-ink-2 select-none">
                  {initials(name)}
                </div>

                {/* Name + email */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {flag && (
                      <span className="text-[16px] leading-none shrink-0">
                        {flag}
                      </span>
                    )}
                    <span className="text-[18px] font-semibold text-ink-1 truncate">
                      {name ?? "Visitor"}
                    </span>
                  </div>
                  {conversation.visitorEmail && (
                    <div className="text-[13px] text-ink-7 truncate mt-0.5">
                      {conversation.visitorEmail}
                    </div>
                  )}
                </div>

                {/* Status pill: "Open · {Priority}" with a green dot */}
                <div className="glass-button flex items-center gap-[6px] rounded-full px-3 h-[28px] text-[12px] text-ink-3 font-medium flex-shrink-0">
                  <span className="w-[7px] h-[7px] rounded-full bg-dot-green flex-shrink-0" />
                  Open · {capitalize(priority)}
                </div>
              </div>

              {/* Mini-thread: compact preview of the conversation */}
              {displayMessages.length > 0 && (
                <div>
                  {showGap ? (
                    <>
                      <MiniBubble message={displayMessages[0]} />
                      <div className="text-center text-ink-6 text-[13px] my-1.5 select-none tracking-widest">
                        ···
                      </div>
                      <MiniBubble message={displayMessages[1]} />
                      <MiniBubble message={displayMessages[2]} />
                    </>
                  ) : (
                    displayMessages.map((m) => (
                      <MiniBubble key={m.id} message={m} />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Composer — renders at card bottom, clipped by overflow-hidden + rounded corners */}
            <Composer
              draft={draft}
              setDraft={setDraft}
              onSend={onSend}
              onResolve={onResolve}
              onRewrite={onRewrite}
              convId={conversation.id}
              visitorEmail={conversation.visitorEmail}
            />
          </div>
        </div>

        {/* Below-card row: "{n} of {total}" left, keyboard legend right */}
        <div className="flex items-center justify-between mt-4 px-1">
          <span className="text-[13px] font-medium text-[--brand]">
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
  );
}
