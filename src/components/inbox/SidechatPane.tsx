import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { X } from "lucide-react";
import type { Conversation, Message } from "@/lib/inbox/types";
import type { SafeSidechatDataPart } from "@/lib/inbox/sidechat-message-adapter";
import {
  deriveConversationInteractionState,
  deriveSidechatStartupWorkingPhase,
  deriveSidechatWorkingTail,
  isSidechatToolRunning,
  readLastCompletedSidechatToolKind,
  readLastSidechatBotMessageId,
  readLastSidechatHumanMessageId,
  SIDECHAT_STARTUP_PLANNING_AFTER_MS,
  type SidechatPresentationStatus,
  type SidechatStartupWorkingPhase,
} from "@/lib/inbox/sidechat";
import { cn } from "@/lib/utils";
import ChatThread from "./ChatThread";
import Composer from "./Composer";
import SidechatEmptySuggestions from "./SidechatEmptySuggestions";
import SidechatStatusDot from "./SidechatStatusDot";

interface SidechatPaneProps {
  open: boolean;
  conversation: Conversation;
  customerFirstName: string | null;
  messages: Message[];
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onAddToReply: (draft: string) => void;
  onSendAsMaven: (sourceMessageId: string) => void;
  sendingMavenDraftMessageId?: string | null;
  mavenDraftSendPending?: boolean;
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
    mode: "always" | "once" | "deny",
  ) => void;
  composerDisabled?: boolean;
  loading?: boolean;
}

export default function SidechatPane({
  open,
  conversation,
  messages,
  draft,
  setDraft,
  onAddToReply,
  onSendAsMaven,
  sendingMavenDraftMessageId = null,
  mavenDraftSendPending = false,
  onClose,
  status,
  presentationStatus = "idle",
  error,
  onSend,
  onStop,
  onRetry,
  onApproval,
  composerDisabled = false,
  loading = false,
}: SidechatPaneProps) {
  const interaction = deriveConversationInteractionState(conversation.archivedAt);
  const busy = status === "submitted" || status === "streaming";
  const latestMessage = messages.at(-1);
  const latestTrace = latestMessage?.sidechatTrace;
  const lastCompletedToolKind = readLastCompletedSidechatToolKind(latestTrace);
  const startupWorkingKey = busy && lastCompletedToolKind === null
    ? readLastSidechatHumanMessageId(messages) ?? "pending"
    : null;
  const [startupWorking, setStartupWorking] = useState<{
    key: string | null;
    phase: SidechatStartupWorkingPhase;
  }>({ key: startupWorkingKey, phase: "thinking" });
  if (startupWorking.key !== startupWorkingKey) {
    setStartupWorking({ key: startupWorkingKey, phase: "thinking" });
  }

  useEffect(() => {
    if (startupWorkingKey === null) return;
    const timer = window.setTimeout(() => {
      setStartupWorking((current) => {
        if (current.key !== startupWorkingKey) return current;
        return {
          key: startupWorkingKey,
          phase: deriveSidechatStartupWorkingPhase(
            SIDECHAT_STARTUP_PLANNING_AFTER_MS,
          ),
        };
      });
    }, SIDECHAT_STARTUP_PLANNING_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [startupWorkingKey]);

  const hasRunningTool = latestTrace?.some(
    (item) => item.type === "tool" && isSidechatToolRunning(item.state),
  ) === true;
  const hasStreamingReasoning = latestTrace?.some(
    (item) => item.type === "reasoning" && item.state === "streaming",
  ) === true;
  const hasVisibleAnswer = Boolean(
    latestMessage?.replyDraft ||
    (latestMessage?.knowledgeChanges?.length ?? 0) > 0 ||
    latestMessage?.content.trim(),
  ) && latestMessage?.role === "bot";
  const tail = deriveSidechatWorkingTail({
    busy,
    status,
    hasError: Boolean(error),
    hasRunningTool,
    hasStreamingReasoning,
    hasVisibleAnswer,
    lastCompletedToolKind,
    startupPhase: startupWorking.phase,
  });

  function handleApprovalAction(
    approvalId: string,
    toolCallId: string,
    mode: "always" | "once" | "deny",
  ): void {
    onApproval(approvalId, toolCallId, mode);
  }

  const isEmpty = !loading && messages.length === 0;
  const suggestionsDisabled = composerDisabled || busy || !interaction.showComposer;

  function handleSuggestion(prompt: string): void {
    if (suggestionsDisabled) return;
    setDraft("");
    onSend(prompt);
  }

  const composer = interaction.showComposer
    ? (
      <Composer
        draft={draft}
        setDraft={setDraft}
        convId={conversation.id}
        placement={isEmpty ? "centered" : "docked"}
        mode={{
          kind: "sidechat",
          disabled: composerDisabled,
          busy,
          onSend,
          onStop,
        }}
      />
    )
    : null;

  return (
    <aside
      data-sidechat-pane
      aria-label="Private Sidechat"
      aria-hidden={!open}
      inert={open ? undefined : true}
      className={cn(
        "glass-reading flex min-w-0 shrink-0 transform-gpu flex-col overflow-hidden transition-[width,opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        open
          ? "m-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)] translate-x-0 rounded-2xl border border-hairline opacity-100 md:w-[min(460px,48vw)] 2xl:w-[480px]"
          : "pointer-events-none h-full w-0 translate-x-3 opacity-0",
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
            Private chat between you and Maven
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
          className="glass-button hidden min-h-8 min-w-8 shrink-0 items-center justify-center rounded-full text-ink-5 hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-safe:transition-[color,background-color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96] md:flex"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" strokeWidth={2} />
        </button>
      </header>

      <div
        className={cn(
          "min-h-0 flex-1",
          isEmpty ? "flex flex-col justify-center overflow-y-auto" : "overflow-y-auto",
        )}
      >
        {!isEmpty && (
          <ChatThread
            perspective="sidechat"
            messages={messages}
            conversation={conversation}
            loading={loading}
            readOnly={!interaction.showMessageActions}
            onAddToReply={onAddToReply}
            onSendAsMaven={onSendAsMaven}
            sendingMavenDraftMessageId={sendingMavenDraftMessageId}
            mavenDraftSendPending={mavenDraftSendPending}
            onApprovalAction={handleApprovalAction}
            inFlightBotMessageId={
              busy ? readLastSidechatBotMessageId(messages) : null
            }
            contentClassName="!px-4 !pt-3 !pb-3"
            tail={!loading && (
              <div className="my-3 min-h-10 text-pretty text-[12px] leading-normal text-ink-6">
                {tail.showWorking && (
                  <div
                    data-sidechat-working
                    aria-label={tail.workingLabel}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <span className="rm-text-sweep">{tail.workingLabel}</span>
                  </div>
                )}
                {tail.showError && (
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
        )}
        {isEmpty && (
          <>
            <SidechatEmptySuggestions
              disabled={suggestionsDisabled}
              onSelect={handleSuggestion}
            />
            {composer}
          </>
        )}
      </div>
      {!isEmpty && composer}
    </aside>
  );
}
