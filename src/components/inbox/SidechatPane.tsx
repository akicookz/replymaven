import type { Dispatch, SetStateAction } from "react";
import { Plug, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Conversation, Message } from "@/lib/inbox/types";
import type { SafeSidechatDataPart } from "@/lib/inbox/sidechat-message-adapter";
import {
  deriveConversationInteractionState,
  type SidechatPresentationStatus,
} from "@/lib/inbox/sidechat";
import { cn } from "@/lib/utils";
import ChatThread from "./ChatThread";
import Composer from "./Composer";
import SidechatStatusDot from "./SidechatStatusDot";

interface SidechatPaneProps {
  open: boolean;
  conversation: Conversation;
  customerFirstName: string | null;
  messages: Message[];
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onAddToReply: (draft: string) => void;
  onClose: () => void;
  status: "submitted" | "streaming" | "ready" | "error";
  presentationStatus?: SidechatPresentationStatus;
  error: Error | undefined;
  safeActivity: Extract<
    SafeSidechatDataPart,
    { type: "safe-activity" }
  > | string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onApproval: (
    approvalId: string,
    toolCallId: string,
    mode: "always" | "once",
  ) => void;
  composerDisabled?: boolean;
  loading?: boolean;
}

export default function SidechatPane({
  open,
  conversation,
  customerFirstName,
  messages,
  draft,
  setDraft,
  onAddToReply,
  onClose,
  status,
  presentationStatus = "idle",
  error,
  safeActivity,
  onSend,
  onStop,
  onRetry,
  onApproval,
  composerDisabled = false,
  loading = false,
}: SidechatPaneProps) {
  const interaction = deriveConversationInteractionState(conversation.archivedAt);
  const contextSubject = customerFirstName
    ? `${customerFirstName}'s`
    : "this conversation's";
  const busy = status === "submitted" || status === "streaming";
  const safeActivityTool = safeActivity && typeof safeActivity === "object"
    ? safeActivity.tool
    : undefined;
  const safeActivityLabel = typeof safeActivity === "string"
    ? safeActivity
    : safeActivity?.label;
  const latestTrace = messages.at(-1)?.sidechatTrace;
  const hasLatestTrace = Boolean(latestTrace?.length);

  function handleApprovalAction(
    approvalId: string,
    toolCallId: string,
    mode: "always" | "once",
  ): void {
    onApproval(approvalId, toolCallId, mode);
  }

  return (
    <aside
      data-sidechat-pane
      aria-label="Private Sidechat"
      aria-hidden={!open}
      inert={open ? undefined : true}
      className={cn(
        "glass-reading flex h-full min-w-0 shrink-0 transform-gpu flex-col overflow-hidden transition-[width,opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        open
          ? "w-full translate-x-0 opacity-100 md:w-[min(460px,48vw)] 2xl:w-[480px]"
          : "pointer-events-none w-0 translate-x-3 opacity-0",
      )}
    >
      <header className="glass-bar flex min-h-[64px] items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-balance text-[15px] font-semibold leading-tight text-ink-1">
              Sidechat
            </h2>
            <SidechatStatusDot status={presentationStatus} />
          </div>
          <p className="mt-0.5 break-words text-pretty text-[12px] leading-snug text-ink-6">
            Private · Maven has {contextSubject} context
          </p>
        </div>
        <button
          data-sidechat-dismiss
          type="button"
          className="flex min-h-10 min-w-10 shrink-0 items-center justify-center px-1 text-[13px] font-medium text-ink-5 hover:text-ink-2 motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96] md:hidden"
          onClick={onClose}
        >
          Back
        </button>
        <button
          data-sidechat-dismiss
          type="button"
          aria-label="Close sidechat"
          title="Close sidechat"
          className="glass-button hidden min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full text-ink-5 hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-safe:transition-[color,background-color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96] md:flex"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" strokeWidth={2} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ChatThread
          perspective="sidechat"
          messages={messages}
          conversation={conversation}
          loading={loading}
          readOnly={!interaction.showMessageActions}
          onAddToReply={onAddToReply}
          onApprovalAction={handleApprovalAction}
          contentClassName="!px-4 !pt-3 !pb-3"
          tail={!loading && (
            <div className="my-3 min-h-10 text-pretty text-[12px] leading-normal text-ink-6">
              {safeActivity && !hasLatestTrace && (
                <div
                  data-sidechat-safe-activity
                  className="flex min-w-0 items-center gap-2"
                >
                  {safeActivityTool && (
                    <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-ink-1/5">
                      {safeActivityTool.source.icon ? (
                        <img
                          src={safeActivityTool.source.icon}
                          alt=""
                          aria-hidden="true"
                          className="size-full object-contain p-1"
                        />
                      ) : (
                        <Plug
                          aria-hidden="true"
                          className="size-3.5 text-ink-5"
                        />
                      )}
                    </span>
                  )}
                  <p className="min-w-0 text-pretty">
                    {safeActivityTool ? (
                      <>
                        <span>{safeActivityTool.source.name}</span>
                        <span aria-hidden="true"> · </span>
                        <strong className="font-semibold text-ink-3">
                          {safeActivityTool.displayName}
                        </strong>
                      </>
                    ) : safeActivityLabel}
                  </p>
                </div>
              )}
              {!safeActivity && busy && !hasLatestTrace && (
                <div
                  data-sidechat-working
                  aria-label="Maven is working"
                  className="space-y-2"
                >
                  <Skeleton className="h-3 w-[72%] rounded" />
                  <Skeleton className="h-3 w-[56%] rounded" />
                </div>
              )}
              {status === "error" && error && (
                <div className="flex min-h-10 items-center gap-3">
                  <span>Sidechat could not finish.</span>
                  <button
                    type="button"
                    className="min-h-10 shrink-0 font-semibold text-ink-3 underline-offset-4 hover:underline motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.96]"
                    onClick={onRetry}
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
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
            disabled: composerDisabled,
            busy,
            onSend,
            onStop,
          }}
        />
      )}
    </aside>
  );
}
