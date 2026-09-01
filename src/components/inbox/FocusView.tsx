import { useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CommandActionTooltip } from "@/components/commands/CommandActionTooltip";
import { CommandKeycap } from "@/components/commands/CommandKeycap";
import Composer from "@/components/inbox/Composer";
import ChatThread, { ChatThreadSkeleton } from "@/components/inbox/ChatThread";
import FocusAllDone from "@/components/inbox/FocusAllDone";
import {
  commandKeycap,
  commandLabel,
  inboxCommandContext,
  resolveInboxCommand,
  toConversationCommandTarget,
} from "@/lib/commands/inbox-command-lookup";
import { countryFlag } from "@/lib/inbox/country-flag";
import type {
  FocusCardSnapshot,
  FocusViewModel,
} from "@/lib/inbox/focus-queue";
import {
  deriveConversationInteractionState,
  type SidechatPresentationStatus,
} from "@/lib/inbox/sidechat";
import type { Conversation, Message } from "@/lib/inbox/types";
import { cn } from "@/lib/utils";

interface FocusViewProps {
  viewModel: FocusViewModel;
  conversation: Conversation | null;
  messages: Message[];
  messagesLoading?: boolean;
  reducedMotion: boolean;
  onExit: () => void;
  onContinue: () => void;
  onMotionFinished: () => void;
  onRollbackMotionFinished: () => void;
  onSend: (
    content?: string,
    opts?: { imageUrls?: string[] },
  ) => void;
  onResolve: (convId: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onSendEmail?: (messageId: string) => void;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onStartSidechat: () => void;
  sidechatOpen: boolean;
  sidechatExists: boolean;
  sidechatStatus: SidechatPresentationStatus;
  publicComposerFocusRequest: number;
  searchQuery?: string;
  activeMatchId?: string | null;
  embedded?: boolean;
}

interface FocusRearCardsProps {
  depth: 0 | 1 | 2;
  hasFullNextCard: boolean;
}

interface FocusCardPreviewProps {
  card: FocusCardSnapshot;
}

const FOCUS_MOTION_MS = 180;

function initials(name: string | null): string {
  if (!name) return "V";
  const parts = name.split(" ").filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase() || "V"
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function countryFromMetadata(metadata: string | null): string | null {
  try {
    const parsed: unknown = JSON.parse(metadata ?? "{}");
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "country" in parsed &&
      typeof parsed.country === "string"
    ) {
      return parsed.country;
    }
  } catch {
    return null;
  }
  return null;
}

function FocusRearCards({
  depth,
  hasFullNextCard,
}: FocusRearCardsProps) {
  const peekCount = Math.max(0, depth - (hasFullNextCard ? 1 : 0));
  return (
    <>
      {peekCount >= 2 && (
        <div className="absolute inset-x-[24px] top-[-9px] h-5 rounded-t-[18px] bg-glass-peek-2" />
      )}
      {peekCount >= 1 && (
        <div className="absolute inset-x-[13px] top-[-4px] h-5 rounded-t-[18px] bg-glass-peek-1" />
      )}
    </>
  );
}

function FocusCardPreview({ card }: FocusCardPreviewProps) {
  const country = countryFromMetadata(card.metadata);
  const flag = countryFlag(country);
  const priority = card.priority ?? "medium";
  return (
    <div className="glass-focus absolute inset-0 z-[1] flex h-[82vh] flex-col overflow-hidden rounded-[18px]">
      <div className="glass-bar px-[28px] pb-3 pt-[20px]">
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-glass-raised text-[15px] font-semibold text-ink-2">
            {initials(card.visitorName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {flag && <span className="shrink-0 text-[17px]">{flag}</span>}
              <span className="truncate text-[19px] font-semibold text-ink-1">
                {card.visitorName ?? "Visitor"}
              </span>
            </div>
            {card.visitorEmail && (
              <div className="mt-0.5 truncate text-[13px] text-ink-7">
                {card.visitorEmail}
              </div>
            )}
          </div>
          <div className="glass-button flex h-[28px] shrink-0 items-center rounded-full px-3 text-[12px] font-medium text-ink-3">
            {capitalize(priority)}
          </div>
        </div>
      </div>
    </div>
  );
}

interface FocusViewSkeletonProps {
  embedded?: boolean;
  onRetry?: () => void;
}

export function FocusViewSkeleton({
  embedded = false,
  onRetry,
}: FocusViewSkeletonProps) {
  return (
    <div
      className={cn(
        "overflow-hidden",
        embedded ? "h-full" : "-m-4 h-screen md:-m-8",
      )}
    >
      <div className="flex h-full items-center justify-center px-6 py-12">
        <div className="w-full max-w-[780px]">
          <div className="relative">
            <div className="absolute inset-x-[24px] top-[-9px] h-5 rounded-t-[18px] bg-glass-peek-2" />
            <div className="absolute inset-x-[13px] top-[-4px] h-5 rounded-t-[18px] bg-glass-peek-1" />
            <div className="glass-focus relative z-[1] flex h-[82vh] flex-col overflow-hidden rounded-[18px]">
              <div className="glass-bar px-[28px] pb-3 pt-[20px]">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-12 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-44 rounded" />
                    <Skeleton className="h-3 w-60 rounded" />
                  </div>
                  <Skeleton className="h-[28px] w-28 shrink-0 rounded-full" />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden px-[28px] pt-3">
                <ChatThreadSkeleton />
              </div>
              <div className="px-4 pb-4 pt-3">
                {onRetry ? (
                  <div className="flex h-[104px] items-center justify-center rounded-[16px] bg-glass-raised">
                    <button
                      type="button"
                      className="glass-button min-h-10 rounded-[10px] px-5 text-sm font-medium text-ink-2"
                      onClick={onRetry}
                    >
                      Retry loading
                    </button>
                  </div>
                ) : (
                  <Skeleton className="h-[104px] w-full rounded-[16px]" />
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 h-5" />
        </div>
      </div>
    </div>
  );
}

export default function FocusView({
  viewModel,
  conversation,
  messages,
  messagesLoading,
  reducedMotion,
  onExit,
  onContinue,
  onMotionFinished,
  onRollbackMotionFinished,
  onSend,
  onResolve,
  onDeleteMessage,
  onSendEmail,
  draft,
  setDraft,
  onStartSidechat,
  sidechatOpen,
  sidechatExists,
  sidechatStatus,
  publicComposerFocusRequest,
  searchQuery = "",
  activeMatchId = null,
  embedded = false,
}: FocusViewProps) {
  const [travelLeft, setTravelLeft] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const motionFinishedRef = useRef(onMotionFinished);
  const rollbackMotionFinishedRef = useRef(onRollbackMotionFinished);
  motionFinishedRef.current = onMotionFinished;
  rollbackMotionFinishedRef.current = onRollbackMotionFinished;
  const currentCard = viewModel.currentCard;
  const currentCardId = currentCard?.id ?? null;
  const commandContext = inboxCommandContext({
    selection: conversation
      ? { kind: "single", target: toConversationCommandTarget(conversation) }
      : { kind: "none" },
    view: { kind: "focus", sidechat: sidechatOpen ? "open" : "closed" },
  });
  const escapeCommand = resolveInboxCommand("escape-inbox", commandContext);

  useEffect(() => {
    if (viewModel.motion === "slide-left") {
      setTravelLeft(true);
      const timer = window.setTimeout(
        () => motionFinishedRef.current(),
        FOCUS_MOTION_MS,
      );
      return () => window.clearTimeout(timer);
    }
    if (viewModel.motion === "slide-back") {
      setTravelLeft(false);
      const timer = window.setTimeout(
        () => rollbackMotionFinishedRef.current(),
        FOCUS_MOTION_MS,
      );
      return () => window.clearTimeout(timer);
    }
    setTravelLeft(false);
  }, [
    currentCardId,
    viewModel.motion,
  ]);

  const visibleMessages = messages.filter((message) => message.role !== "system");
  useEffect(() => {
    if (searchQuery) return;
    const element = threadRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [currentCardId, searchQuery, visibleMessages.length]);

  useEffect(() => {
    if (!activeMatchId) return;
    const element = threadRef.current?.querySelector(
      `[data-msg-id="${activeMatchId}"]`,
    );
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchId]);

  const containerClassName = cn(
    "relative overflow-hidden",
    embedded ? "h-full" : "-m-4 h-screen md:-m-8",
  );

  return (
    <div className={containerClassName}>
      <CommandActionTooltip availability={escapeCommand}>
        <button
          type="button"
          className="glass-button absolute right-[30px] top-[18px] z-20 flex h-[34px] shrink-0 items-center gap-[7px] rounded-[9px] px-[12px] text-[13px] font-medium text-ink-2 after:absolute after:left-1/2 after:top-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.96]"
          onClick={onExit}
        >
          {commandLabel(escapeCommand, "Exit Focus")}
          <CommandKeycap
            keycap={commandKeycap(escapeCommand, { keys: ["Esc"] })}
          />
        </button>
      </CommandActionTooltip>

      <div className="flex h-full items-center justify-center px-6 py-12">
        <div className="w-full max-w-[780px]">
          {viewModel.phase === "all-done" && (
            <FocusAllDone
              newArrivalCount={viewModel.newArrivalCount}
              reducedMotion={reducedMotion}
              onContinue={onContinue}
            />
          )}

          {viewModel.phase !== "all-done" &&
            currentCard &&
            conversation &&
            conversation.id === currentCard.id && (
              <>
                <div className="relative">
                  <FocusRearCards
                    depth={viewModel.stackDepth}
                    hasFullNextCard={
                      (viewModel.phase === "departing" ||
                        viewModel.phase === "rolling-back") &&
                      viewModel.nextCard !== null
                    }
                  />
                  {(viewModel.phase === "departing" ||
                    viewModel.phase === "rolling-back") &&
                    viewModel.nextCard && (
                      <FocusCardPreview card={viewModel.nextCard} />
                    )}
                  <div
                    className={cn(
                      "glass-focus relative z-[2] flex h-[82vh] flex-col overflow-hidden rounded-[18px] transition-[transform,opacity] ease-out",
                      reducedMotion ? "duration-0" : "duration-[180ms]",
                      viewModel.phase !== "reviewing" &&
                        "pointer-events-none",
                      viewModel.motion === "slide-left" &&
                        travelLeft &&
                        "-translate-x-[calc(100%+3rem)] opacity-0",
                    )}
                  >
                    <FocusConversationCard
                      card={currentCard}
                      conversation={conversation}
                      messages={visibleMessages}
                      messagesLoading={messagesLoading}
                      threadRef={threadRef}
                      onSend={onSend}
                      onResolve={onResolve}
                      onDeleteMessage={onDeleteMessage}
                      onSendEmail={onSendEmail}
                      draft={draft}
                      setDraft={setDraft}
                      onStartSidechat={onStartSidechat}
                      sidechatOpen={sidechatOpen}
                      sidechatExists={sidechatExists}
                      sidechatStatus={sidechatStatus}
                      publicComposerFocusRequest={publicComposerFocusRequest}
                      searchQuery={searchQuery}
                      activeMatchId={activeMatchId}
                    />
                  </div>
                </div>
                <FocusFooter
                  progress={viewModel.progress}
                  commandContext={commandContext}
                />
              </>
            )}
        </div>
      </div>
    </div>
  );
}

interface FocusConversationCardProps {
  card: FocusCardSnapshot;
  conversation: Conversation;
  messages: Message[];
  messagesLoading?: boolean;
  threadRef: RefObject<HTMLDivElement | null>;
  onSend: (
    content?: string,
    opts?: { imageUrls?: string[] },
  ) => void;
  onResolve: (convId: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onSendEmail?: (messageId: string) => void;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onStartSidechat: () => void;
  sidechatOpen: boolean;
  sidechatExists: boolean;
  sidechatStatus: SidechatPresentationStatus;
  publicComposerFocusRequest: number;
  searchQuery: string;
  activeMatchId: string | null;
}

function FocusConversationCard({
  card,
  conversation,
  messages,
  messagesLoading,
  threadRef,
  onSend,
  onResolve,
  onDeleteMessage,
  onSendEmail,
  draft,
  setDraft,
  onStartSidechat,
  sidechatOpen,
  sidechatExists,
  sidechatStatus,
  publicComposerFocusRequest,
  searchQuery,
  activeMatchId,
}: FocusConversationCardProps) {
  const interaction = deriveConversationInteractionState(card.archivedAt);
  const flag = countryFlag(countryFromMetadata(card.metadata));
  const priority = card.priority ?? "medium";
  return (
    <div ref={threadRef} className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col">
        <div className="glass-bar sticky top-0 z-[5] px-[28px] pb-3 pt-[20px]">
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 select-none items-center justify-center rounded-full bg-glass-raised text-[15px] font-semibold text-ink-2">
              {initials(card.visitorName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {flag && <span className="shrink-0 text-[17px]">{flag}</span>}
                <span className="truncate text-[19px] font-semibold text-ink-1">
                  {card.visitorName ?? "Visitor"}
                </span>
              </div>
              {card.visitorEmail && (
                <div className="mt-0.5 truncate text-[13px] text-ink-7">
                  {card.visitorEmail}
                </div>
              )}
            </div>
            <div className="glass-button flex h-[28px] shrink-0 items-center gap-[6px] rounded-full px-3 text-[12px] font-medium text-ink-3">
              {!interaction.readOnly && (
                <span className="size-[7px] shrink-0 rounded-full bg-dot-green" />
              )}
              {interaction.readOnly ? "Archived" : "Open"} ·{" "}
              {capitalize(priority)}
            </div>
          </div>
        </div>
        <ChatThread
          messages={messages}
          conversation={conversation}
          loading={messagesLoading}
          onDeleteMessage={onDeleteMessage}
          onSendEmail={onSendEmail}
          readOnly={!interaction.showMessageActions}
          searchQuery={searchQuery}
          activeMatchId={activeMatchId}
          contentClassName="!px-[28px] !pb-3 !pt-3"
        />
        <div className="flex-1" />
        {interaction.showComposer && (
          <Composer
            draft={draft}
            setDraft={setDraft}
            onSend={onSend}
            onResolve={onResolve}
            convId={card.id}
            conversation={conversation}
            focusRequest={publicComposerFocusRequest}
            mode={{
              kind: "public",
              onStartSidechat,
              sidechatOpen,
              sidechatExists,
              sidechatStatus,
            }}
          />
        )}
      </div>
    </div>
  );
}

interface FocusFooterProps {
  progress: FocusViewModel["progress"];
  commandContext: ReturnType<typeof inboxCommandContext>;
}

function FocusFooter({ progress, commandContext }: FocusFooterProps) {
  const moveNext = resolveInboxCommand("move-next", commandContext);
  const movePrevious = resolveInboxCommand("move-previous", commandContext);
  const snooze = resolveInboxCommand("snooze-conversation", commandContext);
  const menu = resolveInboxCommand("toggle-command-menu", commandContext);
  return (
    <div className="mt-4 flex h-5 items-center justify-between px-1">
      {progress ? (
        <span className="text-[13px] font-medium text-brand">
          {progress.position} of {progress.total}
        </span>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-1.5 text-[12px] text-ink-6">
        <CommandKeycap keycap={commandKeycap(moveNext, { keys: ["J"] })} />
        <CommandKeycap keycap={commandKeycap(movePrevious, { keys: ["K"] })} />
        <span className="mx-1">next · prev</span>
        <CommandKeycap keycap={commandKeycap(snooze, { keys: ["S"] })} />
        <span className="mx-1">snooze</span>
        <CommandKeycap keycap={commandKeycap(menu, { keys: ["⌘", "K"] })} />
        <span className="ml-0.5">commands</span>
      </div>
    </div>
  );
}
