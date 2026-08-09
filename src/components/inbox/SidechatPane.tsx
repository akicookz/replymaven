import { useEffect, useMemo, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SidechatStatus } from "../../../shared/ws-events";
import type { Conversation, Message } from "@/lib/inbox/types";
import { deriveConversationInteractionState } from "@/lib/inbox/sidechat";
import ChatThread from "./ChatThread";
import Composer from "./Composer";

interface SidechatContinuation {
  delta: string;
  activity: {
    label: string;
    phase: "start" | "finish";
  } | null;
}

interface SidechatPaneProps {
  conversation: Conversation;
  customerFirstName: string | null;
  messages: Message[];
  loading: boolean;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  status: SidechatStatus;
  runId: string | null;
  continuation: SidechatContinuation | null;
  hasMore: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  onSendPrivate: () => void;
  onRetry: () => void;
  onAddToReply: (draft: string) => void;
  onClose: () => void;
}

export default function SidechatPane({
  conversation,
  customerFirstName,
  messages,
  loading,
  draft,
  setDraft,
  status,
  runId,
  continuation,
  hasMore,
  loadingEarlier,
  onLoadEarlier,
  onSendPrivate,
  onRetry,
  onAddToReply,
  onClose,
}: SidechatPaneProps) {
  const interaction = deriveConversationInteractionState(conversation.archivedAt);
  const scrollRef = useRef<HTMLDivElement>(null);
  const continuationMessage = useMemo<Message | null>(() => {
    if (
      status !== "working" ||
      !runId ||
      !continuation?.delta.trim()
    ) {
      return null;
    }
    return {
      id: `sidechat-stream-${runId}`,
      role: "bot",
      channel: "sidechat",
      kind: "text",
      content: continuation.delta,
      senderName: "Maven",
      createdAt: messages.at(-1)?.createdAt ?? conversation.updatedAt,
    };
  }, [continuation?.delta, conversation.updatedAt, messages, runId, status]);
  const visibleMessages = continuationMessage
    ? [...messages, continuationMessage]
    : messages;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 200;
    if (nearBottom) element.scrollTop = element.scrollHeight;
  }, [visibleMessages.length, continuation?.delta, continuation?.activity]);

  const contextSubject = customerFirstName
    ? `${customerFirstName}'s`
    : "this conversation's";
  const activity = status === "working" && runId
    ? continuation?.activity ?? null
    : null;
  const lastHumanMessage = [...messages]
    .reverse()
    .find((message) => message.role === "agent");

  return (
    <aside
      data-sidechat-pane
      aria-label="Private Sidechat"
      className="glass-reading flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden opacity-100 transform-gpu transition-[width,opacity,transform] duration-200 ease-out motion-reduce:transition-none md:w-[min(380px,42vw)] min-[1536px]:w-[400px]"
    >
      <header className="glass-bar flex min-h-[64px] items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-balance text-[15px] font-semibold leading-tight text-ink-1">
            Sidechat
          </h2>
          <p className="mt-0.5 break-words text-pretty text-[12px] leading-snug text-ink-6">
            Private · Maven has {contextSubject} context
          </p>
        </div>
        <button
          data-sidechat-dismiss
          type="button"
          className="flex min-h-10 shrink-0 items-center px-1 text-[13px] font-medium text-ink-5 hover:text-ink-2 motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96] md:hidden"
          onClick={onClose}
        >
          Back
        </button>
        <button
          data-sidechat-dismiss
          type="button"
          className="hidden min-h-10 shrink-0 items-center px-1 text-[13px] font-medium text-ink-5 hover:text-ink-2 motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96] md:flex"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <ChatThread
          perspective="sidechat"
          messages={visibleMessages}
          conversation={conversation}
          loading={loading}
          readOnly={!interaction.showMessageActions}
          onAddToReply={onAddToReply}
          contentClassName="!px-4 !pt-3 !pb-3"
          head={hasMore ? (
            <div className="flex justify-center pb-2">
              <button
                type="button"
                className="min-h-10 px-2 text-[12px] font-medium text-ink-6 hover:text-ink-3 disabled:opacity-50 motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96]"
                onClick={onLoadEarlier}
                disabled={loadingEarlier}
              >
                {loadingEarlier ? "Loading…" : "Load earlier"}
              </button>
            </div>
          ) : null}
          tail={(
            <>
              {activity && (
                <p
                  data-sidechat-activity
                  className="my-3 break-words text-pretty text-[12px] leading-normal text-ink-6"
                >
                  {activity.label}{activity.phase === "start" ? "…" : " complete"}
                </p>
              )}
              {status === "failed" &&
                interaction.showMessageActions &&
                lastHumanMessage && (
                <div className="flex justify-start py-2">
                  <button
                    type="button"
                    className="min-h-10 px-2 text-[12px] font-medium text-ink-5 hover:text-ink-2 motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96]"
                    onClick={onRetry}
                  >
                    Retry
                  </button>
                </div>
              )}
            </>
          )}
        />
      </div>

      {interaction.showComposer && (
        <Composer
          draft={draft}
          setDraft={setDraft}
          convId={conversation.id}
          mode={{
            kind: "sidechat",
            onSendPrivate,
            working: status === "working",
          }}
        />
      )}
    </aside>
  );
}
