import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Eye, Settings2 } from "lucide-react";
import HelpArticleEditor from "@/components/help-article-editor";
import FocusView from "@/components/inbox/FocusView";
import MessageList from "@/components/inbox/MessageList";
import ReadingPane from "@/components/inbox/ReadingPane";
import SidechatPane from "@/components/inbox/SidechatPane";
import { Button } from "@/components/ui/button";
import type { InboxSort } from "@/lib/inbox/filters";
import type { Conversation, Message } from "@/lib/inbox/types";
import {
  ANNA,
  CAMILLE,
  COMMAND_THREAD,
  HELP_ARTICLE_STALE,
  HELP_ARTICLE_UPDATED,
  LANDING_INBOX_COUNTS,
  LANDING_INBOX_ROWS,
  DAAN,
  LUKAS,
  MARCUS,
  OWEN,
  MCP_REPLY_DRAFT,
  MCP_REPLY_THREAD,
  PRIYA,
  PUBLIC_SIDECHAT_THREAD,
  SIDECHAT_ANSWER,
  SIDECHAT_ASK,
  SUMMON_THREAD,
  THREADS_BY_ID,
  isLandingUnread,
} from "@/lib/marketing/landing-mock-data";
import { cn } from "@/lib/utils";

function useLoop(periodMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), periodMs);
    return () => window.clearInterval(id);
  }, [periodMs]);
  return tick;
}

function useReveal(count: number, gapMs: number, periodMs: number): number {
  const tick = useLoop(periodMs);
  const [shown, setShown] = useState(1);
  useEffect(() => {
    setShown(1);
    const timers: number[] = [];
    for (let i = 1; i < count; i += 1) {
      timers.push(window.setTimeout(() => setShown(i + 1), gapMs * i));
    }
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [tick, count, gapMs]);
  return shown;
}

function noop(): void {}

const EMPTY_SELECTED = new Set<string>();

function InboxFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-[640px] min-w-0 overflow-hidden bg-background",
        className,
      )}
    >
      {children}
    </div>
  );
}

function InboxList(props: {
  conversations: Conversation[];
  selectedId: string;
  onSelect: (id: string) => void;
  sidechatStatuses?: Record<string, "idle" | "working" | "ready">;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<InboxSort>("newest");
  const [unreadOnly, setUnreadOnly] = useState(false);
  return (
    <MessageList
      filter="inbox"
      conversations={props.conversations}
      counts={LANDING_INBOX_COUNTS}
      selectedId={props.selectedId}
      selectedIds={EMPTY_SELECTED}
      onSelect={(id) => props.onSelect(id)}
      onStartSelection={noop}
      onClearSelection={noop}
      onSelectAllLoaded={noop}
      onBulkAction={noop}
      onMarkSelectedRead={noop}
      bulkPending={false}
      search={search}
      onSearchChange={setSearch}
      hasMore={false}
      onLoadMore={noop}
      isLoading={false}
      isUnread={isLandingUnread}
      sort={sort}
      onSortChange={setSort}
      unreadOnly={unreadOnly}
      onUnreadOnlyChange={setUnreadOnly}
      onMarkAllRead={noop}
      onRefresh={noop}
      sidechatStatuses={props.sidechatStatuses}
      className="!border-r-0 hidden md:flex"
    />
  );
}

function InboxReading(props: {
  conversation: Conversation;
  messages: Message[];
  draft?: string;
  sidechatStatus?: "idle" | "working" | "ready";
}) {
  const [draft, setDraft] = useState(props.draft ?? "");
  useEffect(() => {
    setDraft(props.draft ?? "");
  }, [props.draft]);
  return (
    <ReadingPane
      conversation={props.conversation}
      customer={null}
      messages={props.messages}
      draft={draft}
      setDraft={setDraft}
      onSend={noop}
      onResolve={noop}
      onSnooze={noop}
      onFlagSpam={noop}
      onPriority={noop}
      onFocus={noop}
      onBlock={noop}
      onAssign={noop}
      onArchive={noop}
      onCreateCustomer={noop}
      onLinkCustomer={noop}
      onDeleteMessage={noop}
      onStartSidechat={noop}
      sidechatOpen={false}
      sidechatExists={false}
      sidechatStatus={props.sidechatStatus ?? "idle"}
      publicComposerFocusRequest={0}
    />
  );
}

function conversationById(id: string): Conversation {
  if (id === "priya") return PRIYA;
  if (id === "lukas") return LUKAS;
  if (id === "anna") return ANNA;
  if (id === "camille") return CAMILLE;
  if (id === "owen") return OWEN;
  if (id === "daan") return DAAN;
  return MARCUS;
}

export function SharedInboxMock() {
  const [selectedId, setSelectedId] = useState("marcus");
  const conversation = conversationById(selectedId);
  return (
    <InboxFrame>
      <InboxList
        conversations={LANDING_INBOX_ROWS}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <InboxReading
        conversation={conversation}
        messages={THREADS_BY_ID[selectedId] ?? SUMMON_THREAD}
      />
    </InboxFrame>
  );
}

export function SummonMock() {
  const shown = useReveal(SUMMON_THREAD.length, 1400, 9000);
  const messages = SUMMON_THREAD.slice(0, shown);
  return (
    <InboxFrame>
      <InboxList
        conversations={LANDING_INBOX_ROWS}
        selectedId="marcus"
        onSelect={noop}
      />
      <InboxReading conversation={MARCUS} messages={messages} />
    </InboxFrame>
  );
}

export function TelegramCommandMock() {
  const shown = useReveal(COMMAND_THREAD.length, 1400, 10000);
  const messages = COMMAND_THREAD.slice(0, shown);
  const conversation = useMemo(
    () => ({
      ...MARCUS,
      status: shown >= COMMAND_THREAD.length ? "active" : "waiting_agent",
    }),
    [shown],
  );
  return (
    <InboxFrame>
      <InboxList
        conversations={LANDING_INBOX_ROWS}
        selectedId="marcus"
        onSelect={noop}
      />
      <InboxReading conversation={conversation} messages={messages} />
    </InboxFrame>
  );
}

export function SidechatMock() {
  const shown = useReveal(2, 1800, 9000);
  const [draft, setDraft] = useState("");
  const [sideDraft, setSideDraft] = useState("");
  const sideMessages =
    shown === 1 ? [SIDECHAT_ASK] : [SIDECHAT_ASK, SIDECHAT_ANSWER];
  const status = shown === 1 ? "streaming" : "ready";
  return (
    <InboxFrame className="h-[720px]">
      <div className="h-full min-w-0 flex-1">
        <FocusView
          conversation={MARCUS}
          messages={PUBLIC_SIDECHAT_THREAD}
          index={1}
          total={12}
          onExit={noop}
          onSend={noop}
          onResolve={noop}
          onDeleteMessage={noop}
          draft={draft}
          setDraft={setDraft}
          onStartSidechat={noop}
          sidechatOpen
          sidechatExists
          sidechatStatus={shown === 1 ? "working" : "ready"}
          publicComposerFocusRequest={0}
          embedded
        />
      </div>
      <SidechatPane
        open
        conversation={MARCUS}
        customerFirstName="Marcus"
        messages={sideMessages}
        draft={sideDraft}
        setDraft={setSideDraft}
        onAddToReply={(next) => setDraft(next)}
        onClose={noop}
        status={status}
        presentationStatus={shown === 1 ? "working" : "ready"}
        error={undefined}
        safeActivity={null}
        onSend={noop}
        onStop={noop}
        onRetry={noop}
        onApproval={noop}
      />
    </InboxFrame>
  );
}

export function McpReplyMock() {
  const shown = useReveal(2, 2400, 8000);
  const draft = shown >= 2 ? MCP_REPLY_DRAFT : "";
  return (
    <InboxFrame>
      <InboxList
        conversations={LANDING_INBOX_ROWS}
        selectedId="marcus"
        onSelect={noop}
      />
      <InboxReading
        conversation={MARCUS}
        messages={MCP_REPLY_THREAD}
        draft={draft}
      />
    </InboxFrame>
  );
}

function DocsEditorMock({
  published,
  content,
}: {
  published: boolean;
  content: string;
}) {
  const [value, setValue] = useState(content);
  useEffect(() => {
    setValue(content);
  }, [content]);
  return (
    <div className="help-editor-page-shell !m-0 !min-h-0 h-full overflow-hidden bg-background">
      <header className="help-editor-page-bar">
        <div className="flex items-center gap-2 min-w-0">
          <Button type="button" variant="ghost" size="sm" className="-ml-1">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Articles</span>
          </Button>
          <span className="text-muted-foreground hidden md:inline">/</span>
          <span className="text-sm text-muted-foreground truncate hidden md:inline">
            Invite a teammate
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          <span
            className={cn(
              "text-xs font-medium px-2 py-1 rounded-full",
              published
                ? "bg-green-500/15 text-green-700 dark:text-green-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {published ? "Published" : "Draft"}
          </span>
          <Button type="button" variant="outline" size="sm">
            <Eye className="w-4 h-4" />
            <span className="hidden sm:inline">Preview</span>
          </Button>
          <Button type="button" variant="outline" size="sm">
            <Settings2 className="w-4 h-4" />
            <span className="hidden sm:inline">Publish settings</span>
          </Button>
          <Button type="button" variant="outline" size="sm" disabled>
            {published ? "Unpublish" : "Publish"}
          </Button>
          <Button type="button" size="sm" disabled={published}>
            Save
          </Button>
        </div>
      </header>
      <main className="help-editor-page-main !pb-8 overflow-y-auto">
        <HelpArticleEditor
          value={value}
          onChange={setValue}
          variant="page"
        />
      </main>
    </div>
  );
}

export function McpDocsMock() {
  const shown = useReveal(2, 2800, 9000);
  return (
    <InboxFrame className="h-[720px] block">
      <DocsEditorMock
        published={shown >= 2}
        content={shown >= 2 ? HELP_ARTICLE_UPDATED : HELP_ARTICLE_STALE}
      />
    </InboxFrame>
  );
}

export function SelfUpdatingDocsMock() {
  return <McpDocsMock />;
}
