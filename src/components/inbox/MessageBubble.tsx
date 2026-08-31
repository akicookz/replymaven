import { Mail, Plug, Trash2 } from "lucide-react";
import {
  deriveEmailAction,
  deriveMessageStatus,
} from "@/lib/inbox/message-status";
import {
  deriveMessageActions,
  deriveMessagePresentation,
  isSidechatToolRunning,
  type ChatPerspective,
} from "@/lib/inbox/sidechat";
import type { Conversation, Message } from "@/lib/inbox/types";
import { cn, renderMarkdown } from "@/lib/utils";
import {
  parseMessageImageUrls,
  shouldShowMessageContent,
} from "../../../shared/message-images";
import MessageImages from "./MessageImages";
import SidechatReplyDraftCard from "./SidechatReplyDraftCard";
import SidechatExecutionTrace from "./SidechatExecutionTrace";

interface MessageBubbleProps {
  message: Message;
  conversation: Conversation;
  onDelete?: (messageId: string) => void;
  onSendEmail?: (messageId: string) => void;
  readOnly?: boolean;
  /** This message matches the active in-conversation search query. */
  isMatch?: boolean;
  /** This message is the currently-focused search match. */
  isActiveMatch?: boolean;
  /** Tightens spacing when this follows the same sender in one message group. */
  groupedWithPrev?: boolean;
  /** Renders sender, time, and delivery metadata under the group's last bubble. */
  showMetadata?: boolean;
  perspective?: ChatPerspective;
  onAddToReply?: (draft: string) => void;
  onSendAsMaven?: (sourceMessageId: string) => void;
  sendingAsMaven?: boolean;
  disableSendAsMaven?: boolean;
  onApprovalAction?: (
    approvalId: string,
    toolCallId: string,
    mode: "always" | "once",
  ) => void;
}

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessageBubble({
  message,
  conversation,
  onDelete,
  onSendEmail,
  readOnly = false,
  isMatch,
  isActiveMatch,
  groupedWithPrev = false,
  showMetadata = true,
  perspective = "public",
  onAddToReply,
  onSendAsMaven,
  sendingAsMaven = false,
  disableSendAsMaven = false,
  onApprovalAction,
}: MessageBubbleProps) {
  const presentation = deriveMessagePresentation(
    perspective,
    message.role,
    message.senderName ?? null,
    conversation.visitorName,
  );
  const { isReceived, senderLabel } = presentation;
  const isBot = message.role === "bot";
  const isAgent = message.role === "agent";

  // Search highlight: ring the matching bubble, brighter for the active match.
  const matchClass = isActiveMatch
    ? "ring-2 ring-amber-400/80"
    : isMatch
      ? "ring-1 ring-amber-400/40"
      : "";

  const html = renderMarkdown(message.content);
  const imageCount = parseMessageImageUrls(message.imageUrl).length;
  const showContent = shouldShowMessageContent(message.content);
  const showSidechatTrace =
    perspective === "sidechat" && Boolean(message.sidechatTrace?.length);
  // While a tool runs, waits for approval, or the turn is still open,
  // sender and time under a message still in flight are noise.
  const sidechatToolPending =
    perspective === "sidechat" &&
    message.sidechatTrace?.some(
      (item) =>
        item.type === "tool" &&
        (isSidechatToolRunning(item.state) ||
          item.state === "approval-requested"),
    ) === true;
  const approvalTool = message.presentationAction?.type === "approval"
    ? message.presentationAction.tool
    : undefined;
  const showBubble =
    showContent ||
    imageCount > 0 ||
    Boolean(message.presentationAction);

  // Grouped messages tuck up under the previous bubble (net ~4px gap).
  const rootSpacing = groupedWithPrev ? "-mt-2 mb-3" : "mb-3";
  const actions = deriveMessageActions(
    perspective,
    message.presentationAction,
    readOnly,
  );
  const status = !isReceived && perspective === "public"
    ? deriveMessageStatus(message)
    : null;
  const emailAction = !isReceived && perspective === "public"
    ? deriveEmailAction({
        role: message.role,
        emailedAt: message.emailedAt,
        visitorEmail: conversation.visitorEmail,
        readOnly,
        optimistic: "_optimistic" in message && message._optimistic === true,
      })
    : "hidden";
  const showSendEmail = emailAction === "send" && Boolean(onSendEmail);
  const statusTooltip = [
    message.deliveredAt ? `Delivered ${formatTime(message.deliveredAt)}` : null,
    message.readAt ? `Seen ${formatTime(message.readAt)}` : null,
    message.emailedAt ? `Emailed ${formatTime(message.emailedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function renderStatus() {
    if (!status) return null;
    return (
      <span
        className="flex items-baseline gap-1"
        title={statusTooltip || undefined}
      >
        <span aria-hidden="true">·</span>
        <span>{status.label}</span>
        {emailAction === "sent" && (
          <>
            <span aria-hidden="true">·</span>
            <Mail size={11} className="self-center" />
            <span>Emailed</span>
          </>
        )}
        {showSendEmail && onSendEmail && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className="text-[11px] leading-normal text-ink-7 hover:text-ink-3 motion-safe:transition-colors motion-safe:duration-150"
              onClick={() => onSendEmail(message.id)}
            >
              Send as email
            </button>
          </>
        )}
      </span>
    );
  }

  function renderMetadata() {
    if (!showMetadata || sidechatToolPending) return null;
    return (
      <div
        className={cn(
          "mt-1 flex max-w-full flex-wrap items-center gap-1 text-[11px] leading-normal text-ink-7 tabular-nums",
          isReceived ? "justify-start text-left" : "justify-end text-right",
        )}
      >
        <span>{senderLabel}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        {renderStatus()}
      </div>
    );
  }

  function renderMessageActions() {
    if (actions.approveOnce && onApprovalAction) {
      return (
        <div className="mt-1 flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1">
          {actions.approveAlways && (
            <button
              type="button"
              className="group flex min-h-10 shrink-0 items-center whitespace-nowrap text-[12px] font-medium motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.97]"
              onClick={() => {
                if (message.presentationAction?.type !== "approval") return;
                onApprovalAction(
                  message.presentationAction.approvalId,
                  message.presentationAction.toolCallId,
                  "always",
                );
              }}
            >
              <span className="rounded-full bg-ink-1/5 px-3 py-1 text-ink-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] group-hover:text-ink-2 motion-safe:transition-colors motion-safe:duration-150">
                Always allow
              </span>
            </button>
          )}
          <button
            type="button"
            className="group flex min-h-10 shrink-0 items-center whitespace-nowrap text-[12px] font-medium motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.97]"
            onClick={() => {
              if (message.presentationAction?.type !== "approval") return;
              onApprovalAction(
                message.presentationAction.approvalId,
                message.presentationAction.toolCallId,
                "once",
              );
            }}
          >
            <span className="rounded-full bg-brand/15 px-3 py-1 text-brand-label ring-1 ring-inset ring-brand/25 group-hover:bg-brand/25 motion-safe:transition-colors motion-safe:duration-150">
              Allow once
            </span>
          </button>
        </div>
      );
    }
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col",
        isReceived ? "items-start" : "items-end",
        rootSpacing,
      )}
    >
      {showSidechatTrace && message.sidechatTrace && (
        <SidechatExecutionTrace
          items={message.sidechatTrace}
          onApproval={onApprovalAction}
        />
      )}
      {showBubble && (
        <div
          className={cn(
            "relative group",
            perspective === "sidechat"
              ? "max-w-[88%]"
              : "max-w-9/10 sm:max-w-3/4",
          )}
        >
          <div
            className={cn(
              "text-[14.5px] leading-normal",
              perspective === "sidechat" && isBot
                ? "text-ink-2"
                : perspective === "sidechat"
                  ? "rounded-bubble rounded-br-[6px] bg-bubble-received px-3.5 py-2.5 text-ink-2"
                  : isReceived
                    ? "rounded-bubble rounded-bl-[6px] bg-bubble-received px-3.5 py-2.5 text-ink-2"
                    : "rounded-bubble rounded-br-[6px] bg-bubble-sent px-3.5 py-2.5 text-white",
              matchClass,
            )}
          >
            <MessageImages imageUrl={message.imageUrl} />
            {approvalTool && (
              <div
                className="mb-2 flex min-w-0 items-center gap-2"
                aria-label={`${approvalTool.source.name}: ${approvalTool.displayName}`}
              >
                <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-ink-1/5">
                  {approvalTool.source.icon ? (
                    <img
                      src={approvalTool.source.icon}
                      alt=""
                      aria-hidden="true"
                      className="size-full object-contain p-1"
                    />
                  ) : (
                    <Plug aria-hidden="true" className="size-3.5 text-ink-5" />
                  )}
                </span>
                <p className="min-w-0 text-pretty text-[12.5px] leading-snug text-ink-5">
                  <span>{approvalTool.source.name}</span>
                  <span aria-hidden="true"> · </span>
                  <strong className="font-semibold text-ink-2">
                    {approvalTool.displayName}
                  </strong>
                </p>
              </div>
            )}
            {showContent && (
              <div
                className={`prose-chat${imageCount ? " mt-1.5" : ""}`}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
            {renderMessageActions()}
          </div>
          {!isReceived &&
            perspective === "public" &&
            isAgent &&
            !readOnly &&
            onDelete && (
            <button
              onClick={() => onDelete(message.id)}
              className="absolute -left-10 top-1/2 flex size-10 shrink-0 -translate-y-1/2 items-center justify-center rounded opacity-0 text-ink-7 group-hover:opacity-100 hover:text-red-400 focus-visible:opacity-100 motion-safe:transition-[opacity,color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96]"
              aria-label="Delete message"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
      {perspective === "sidechat" && message.replyDraft && (
        <div className={cn("w-full max-w-[94%]", showBubble && "mt-3")}>
          <SidechatReplyDraftCard
            draft={message.replyDraft}
            readOnly={readOnly}
            sending={sendingAsMaven}
            sendDisabled={disableSendAsMaven}
            onAddToReply={onAddToReply}
            onSendAsMaven={onSendAsMaven}
          />
        </div>
      )}
      {renderMetadata()}
    </div>
  );
}
