import {
  destinationHref,
  destinationLabel,
  type DashboardNavDestinationId,
} from "../dashboard/nav";
import type { InboxFilter } from "../inbox/filters";

export const PREFIX_TIMEOUT_MS = 1000;

export const COMMAND_REASONS = {
  blockOneAtATime: "Block is available one conversation at a time",
  needsOneConversation: "This command needs one conversation",
  noBulkReopen: "Bulk reopen is not available",
  noBulkUnflag: "Bulk unflag is not available",
} as const;

export const DASHBOARD_COMMAND_IDS = [
  "toggle-command-menu",
  "navigate-dashboard",
  "navigate-needs-you",
  "navigate-inbox",
  "navigate-snoozed",
  "navigate-resolved",
  "navigate-archived",
  "navigate-flagged",
  "navigate-sources",
  "navigate-help-center",
  "navigate-sops",
  "navigate-company-info",
  "navigate-chat-widget",
  "navigate-greetings",
  "navigate-tools",
  "navigate-customers",
  "navigate-mcp-connections",
  "navigate-settings",
  "toggle-focus",
  "open-conversation-search",
  "open-sidechat",
  "resolve-conversation",
  "snooze-conversation",
  "flag-spam",
  "block-visitor",
  "archive-conversation",
  "move-next",
  "move-previous",
  "extend-next",
  "extend-previous",
  "escape-inbox",
] as const;

export type DashboardCommandId = (typeof DASHBOARD_COMMAND_IDS)[number];

export type CommandPlatform = "macos" | "other";

export type CommandGroup = "global" | "navigation" | "inbox" | "selection";

export type RepeatPolicy = "ignore" | "allow";

export type CommandTone = "default" | "destructive";

export interface NormalizedKeyStroke {
  key: string;
  primary: boolean;
  shift: boolean;
  alt: boolean;
  repeat: boolean;
  platform: CommandPlatform;
  extra: boolean;
}

export interface CommandChordStroke {
  key: string;
  primary: boolean;
  shift: boolean;
  alt: boolean;
}

export interface CommandKeycap {
  keys: string[];
}

export type CommandShortcut =
  | { kind: "chord"; stroke: CommandChordStroke; keycap: CommandKeycap }
  | {
      kind: "sequence";
      strokes: CommandChordStroke[];
      timeoutMs: number;
      keycap: CommandKeycap;
    };

export type ActivationSurface =
  | "blocking-overlay"
  | "command-menu"
  | "public-composer"
  | "sidechat-composer"
  | "sidechat-pane"
  | "editable"
  | "interactive"
  | "page";

export interface ConversationCommandTarget {
  id: string;
  status: string;
  closeReason: string | null;
  snoozedUntil: string | null;
  archivedAt: string | null;
  visitorBlocked: boolean;
}

export type ConversationSelection =
  | { kind: "none" }
  | { kind: "single"; target: ConversationCommandTarget }
  | {
      kind: "multiple";
      active: ConversationCommandTarget;
      selected: ConversationCommandTarget[];
    };

export type SidechatVisibility = "open" | "closed";

export type InboxView =
  | { kind: "split"; sidechat: SidechatVisibility }
  | { kind: "focus"; sidechat: SidechatVisibility };

export interface InboxCommandCapabilities {
  resolve: boolean;
  snooze: boolean;
  flagSpam: boolean;
  archive: boolean;
  block: boolean;
  bulkResolve: boolean;
  bulkSnooze: boolean;
  bulkFlagSpam: boolean;
  bulkArchive: boolean;
  move: boolean;
  extendRange: boolean;
  search: boolean;
  sidechat: boolean;
  focus: boolean;
}

export const ALL_INBOX_CAPABILITIES: InboxCommandCapabilities = {
  resolve: true,
  snooze: true,
  flagSpam: true,
  archive: true,
  block: true,
  bulkResolve: true,
  bulkSnooze: true,
  bulkFlagSpam: true,
  bulkArchive: true,
  move: true,
  extendRange: true,
  search: true,
  sidechat: true,
  focus: true,
};

export interface ProjectCommandScope {
  kind: "dashboard";
  projectId: string;
}

export interface InboxCommandScope {
  kind: "inbox";
  projectId: string;
  filter: InboxFilter;
  selection: ConversationSelection;
  view: InboxView;
  viewport: "desktop" | "mobile";
  operations: InboxCommandCapabilities;
}

export type DashboardCommandScope = ProjectCommandScope | InboxCommandScope;

export interface CommandPresentation {
  label: string;
  description: string;
  keycap: CommandKeycap;
  pressed: boolean;
  tone: CommandTone;
}

export type ConversationCommandAction =
  | { type: "resolve" }
  | { type: "reopen" }
  | { type: "snooze"; until: "tomorrow" }
  | { type: "unsnooze" }
  | { type: "flag-spam" }
  | { type: "unflag" }
  | { type: "block-visitor" }
  | { type: "unblock-visitor" }
  | { type: "archive" }
  | { type: "unarchive" };

export type InboxBulkCommandAction =
  | { type: "resolve" }
  | { type: "snooze"; until: "tomorrow" | null }
  | { type: "flag-spam" }
  | { type: "archive" }
  | { type: "unarchive" };

export type DashboardCommandIntent =
  | { type: "toggle-command-menu" }
  | { type: "navigate"; href: string }
  | { type: "open-conversation-search" }
  | { type: "set-focus"; focus: boolean }
  | { type: "open-sidechat" }
  | {
      type: "conversation-action";
      conversationId: string;
      action: ConversationCommandAction;
    }
  | {
      type: "bulk-action";
      conversationIds: string[];
      action: InboxBulkCommandAction;
    }
  | { type: "move-ticket"; direction: "next" | "previous" }
  | { type: "extend-range"; direction: "next" | "previous" }
  | { type: "clear-selection" }
  | { type: "exit-focus" };

export type CommandAvailability =
  | { status: "hidden" }
  | { status: "disabled"; presentation: CommandPresentation; reason: string }
  | { status: "enabled"; presentation: CommandPresentation; intent: DashboardCommandIntent };

export interface DashboardCommandDefinition {
  id: DashboardCommandId;
  group: CommandGroup;
  shortcuts: CommandShortcut[];
  repeat: RepeatPolicy;
  resolve: (context: DashboardCommandContext) => CommandAvailability;
}

export type PendingKeySequence =
  | { status: "idle" }
  | {
      status: "waiting";
      prefix: string;
      expiresAt: number;
      nextKeys: Readonly<Record<string, DashboardCommandId>>;
    };

export const IDLE_PENDING: PendingKeySequence = { status: "idle" };

export interface DashboardCommandContext {
  scope: DashboardCommandScope;
  platform: CommandPlatform;
  menuOpen: boolean;
  pending: PendingKeySequence;
  nowMs: number;
}

export interface KeyEventInput {
  key: string;
  keyCode?: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  platform: CommandPlatform;
}

export interface ActivationTargetDescriptor {
  tagName: string;
  contentEditable: string | null;
  isContentEditable: boolean;
  role: string | null;
  tabIndex: number | null;
  commandLayer: "blocking" | "command-menu" | null;
  composer: "public" | "sidechat" | null;
  inSidechatPane: boolean;
}

export type ActivationDecision =
  | { kind: "ignore"; pending: PendingKeySequence }
  | { kind: "leave-browser"; pending: PendingKeySequence }
  | { kind: "start-prefix"; pending: PendingKeySequence }
  | { kind: "cancel-prefix"; pending: PendingKeySequence }
  | { kind: "consume-prefix"; pending: PendingKeySequence }
  | {
      kind: "dispatch";
      commandId: DashboardCommandId;
      intent: DashboardCommandIntent;
      pending: PendingKeySequence;
    };

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "slider",
  "spinbutton",
  "treeitem",
]);

const MODIFIER_KEYS = new Set(["meta", "control", "alt", "shift"]);

const NAV_DESTINATIONS: Record<
  Extract<DashboardCommandId, `navigate-${string}`>,
  { destination: DashboardNavDestinationId; secondKey: string }
> = {
  "navigate-dashboard": { destination: "dashboard", secondKey: "d" },
  "navigate-needs-you": { destination: "needs-you", secondKey: "y" },
  "navigate-inbox": { destination: "inbox", secondKey: "i" },
  "navigate-snoozed": { destination: "snoozed", secondKey: "z" },
  "navigate-resolved": { destination: "resolved", secondKey: "r" },
  "navigate-archived": { destination: "archived", secondKey: "a" },
  "navigate-flagged": { destination: "flagged", secondKey: "f" },
  "navigate-sources": { destination: "sources", secondKey: "s" },
  "navigate-help-center": { destination: "help-center", secondKey: "h" },
  "navigate-sops": { destination: "sops", secondKey: "o" },
  "navigate-company-info": { destination: "company-info", secondKey: "c" },
  "navigate-chat-widget": { destination: "chat-widget", secondKey: "w" },
  "navigate-greetings": { destination: "greetings", secondKey: "g" },
  "navigate-tools": { destination: "tools", secondKey: "t" },
  "navigate-customers": { destination: "customers", secondKey: "u" },
  "navigate-mcp-connections": { destination: "mcp-connections", secondKey: "m" },
  "navigate-settings": { destination: "settings", secondKey: "p" },
};

function normalizeKey(key: string): string {
  if (key === " ") return "space";
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

export function normalizeKeyStroke(event: KeyEventInput): NormalizedKeyStroke {
  const primary = event.platform === "macos" ? event.metaKey : event.ctrlKey;
  const extra = event.platform === "macos" ? event.ctrlKey : event.metaKey;
  return {
    key: normalizeKey(event.key),
    primary,
    shift: event.shiftKey,
    alt: event.altKey,
    repeat: event.repeat,
    platform: event.platform,
    extra,
  };
}

function chordMatches(
  stroke: NormalizedKeyStroke,
  spec: CommandChordStroke,
): boolean {
  return (
    stroke.key === spec.key &&
    stroke.primary === spec.primary &&
    stroke.shift === spec.shift &&
    stroke.alt === spec.alt &&
    !stroke.extra
  );
}

function isImeKey(event: KeyEventInput): boolean {
  return event.key === "229" || event.key === "Process" || event.keyCode === 229;
}

function isEditableTarget(target: ActivationTargetDescriptor): boolean {
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.contentEditable === "plaintext-only") return true;
  if (target.contentEditable === "true" || target.contentEditable === "") {
    return true;
  }
  return target.isContentEditable;
}

function isInteractiveTarget(target: ActivationTargetDescriptor): boolean {
  const tag = target.tagName.toLowerCase();
  if (tag === "button" || tag === "a" || tag === "summary") return true;
  if (target.role != null && INTERACTIVE_ROLES.has(target.role)) return true;
  return target.tabIndex != null && target.tabIndex >= 0;
}

export function classifyActivationSurface(
  target: ActivationTargetDescriptor,
): ActivationSurface {
  if (target.commandLayer === "blocking") return "blocking-overlay";
  if (target.commandLayer === "command-menu") return "command-menu";
  if (target.composer === "public") return "public-composer";
  if (target.composer === "sidechat") return "sidechat-composer";
  if (target.inSidechatPane) return "sidechat-pane";
  if (isEditableTarget(target)) return "editable";
  if (isInteractiveTarget(target)) return "interactive";
  return "page";
}

function hidden(): CommandAvailability {
  return { status: "hidden" };
}

function presentation(
  label: string,
  description: string,
  keycap: CommandKeycap,
  tone: CommandTone = "default",
  pressed = false,
): CommandPresentation {
  return { label, description, keycap, pressed, tone };
}

function enabled(
  item: CommandPresentation,
  intent: DashboardCommandIntent,
): CommandAvailability {
  return { status: "enabled", presentation: item, intent };
}

function disabled(
  item: CommandPresentation,
  reason: string,
): CommandAvailability {
  return { status: "disabled", presentation: item, reason };
}

function menuKeycap(platform: CommandPlatform): CommandKeycap {
  return platform === "macos" ? { keys: ["⌘", "K"] } : { keys: ["Ctrl", "K"] };
}

function chord(
  key: string,
  keycap: CommandKeycap,
  mods?: { primary?: boolean; shift?: boolean; alt?: boolean },
): CommandShortcut {
  return {
    kind: "chord",
    stroke: {
      key,
      primary: mods?.primary ?? false,
      shift: mods?.shift ?? false,
      alt: mods?.alt ?? false,
    },
    keycap,
  };
}

function sequenceShortcut(secondKey: string): CommandShortcut {
  return {
    kind: "sequence",
    strokes: [
      { key: "g", primary: false, shift: false, alt: false },
      { key: secondKey, primary: false, shift: false, alt: false },
    ],
    timeoutMs: PREFIX_TIMEOUT_MS,
    keycap: { keys: ["G", secondKey.toUpperCase()] },
  };
}

function inboxOf(
  context: DashboardCommandContext,
): InboxCommandScope | null {
  if (context.scope.kind !== "inbox") return null;
  return context.scope;
}

function isSnoozed(target: ConversationCommandTarget, nowMs: number): boolean {
  if (target.snoozedUntil == null) return false;
  const ms = new Date(target.snoozedUntil).getTime();
  return Number.isFinite(ms) && ms > nowMs;
}

function isResolved(target: ConversationCommandTarget): boolean {
  return target.status === "closed" && target.closeReason !== "spam";
}

function isSpam(target: ConversationCommandTarget): boolean {
  return target.closeReason === "spam";
}

function isArchived(target: ConversationCommandTarget): boolean {
  return target.archivedAt != null;
}

function selectedIds(selection: ConversationSelection): string[] {
  if (selection.kind !== "multiple") return [];
  return selection.selected.map((target) => target.id);
}

function resolveToggleMenu(
  context: DashboardCommandContext,
): CommandAvailability {
  return enabled(
    presentation(
      "Command menu",
      "Open or close the command menu",
      menuKeycap(context.platform),
      "default",
      context.menuOpen,
    ),
    { type: "toggle-command-menu" },
  );
}

function resolveNavigate(
  commandId: Extract<DashboardCommandId, `navigate-${string}`>,
  context: DashboardCommandContext,
): CommandAvailability {
  const { destination, secondKey } = NAV_DESTINATIONS[commandId];
  const label = destinationLabel(destination);
  return enabled(
    presentation(
      label,
      `Go to ${label}`,
      { keys: ["G", secondKey.toUpperCase()] },
    ),
    { type: "navigate", href: destinationHref(context.scope.projectId, destination) },
  );
}

function resolveToggleFocus(
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  const item = presentation("Focus", "Toggle Focus", { keys: ["F"] });
  if (!inbox || !inbox.operations.focus) return hidden();
  if (inbox.viewport === "mobile") return hidden();
  if (inbox.selection.kind !== "single") {
    return disabled(item, COMMAND_REASONS.needsOneConversation);
  }
  if (isArchived(inbox.selection.target)) return hidden();
  if (inbox.view.kind === "focus") {
    return enabled(
      presentation("Exit Focus", "Leave Focus", { keys: ["F"] }, "default", true),
      { type: "set-focus", focus: false },
    );
  }
  return enabled(item, { type: "set-focus", focus: true });
}

function resolveOpenSearch(
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  const item = presentation(
    "Search conversation",
    "Search the current conversation",
    { keys: ["⇧", "F"] },
  );
  if (!inbox || !inbox.operations.search) return hidden();
  if (inbox.selection.kind !== "single") {
    return disabled(item, COMMAND_REASONS.needsOneConversation);
  }
  return enabled(item, { type: "open-conversation-search" });
}

function resolveOpenSidechat(
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  const item = presentation(
    "Open Sidechat",
    "Open Sidechat for this conversation",
    { keys: ["⇧", "Tab"] },
    "default",
    inbox?.view.sidechat === "open",
  );
  if (!inbox || !inbox.operations.sidechat) return hidden();
  if (inbox.selection.kind !== "single") {
    return disabled(item, COMMAND_REASONS.needsOneConversation);
  }
  return enabled(item, { type: "open-sidechat" });
}

function resolveResolveConversation(
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  if (!inbox) return hidden();
  if (inbox.selection.kind === "none") return hidden();
  if (inbox.selection.kind === "multiple") {
    const item = presentation(
      "Resolve selected",
      "Resolve the selected conversations",
      { keys: ["E"] },
    );
    if (!inbox.operations.bulkResolve) return hidden();
    if (inbox.filter === "archived") return hidden();
    if (inbox.filter === "resolved") {
      return disabled(item, COMMAND_REASONS.noBulkReopen);
    }
    return enabled(item, {
      type: "bulk-action",
      conversationIds: selectedIds(inbox.selection),
      action: { type: "resolve" },
    });
  }
  if (!inbox.operations.resolve) return hidden();
  if (isArchived(inbox.selection.target)) return hidden();
  if (isResolved(inbox.selection.target)) {
    return enabled(
      presentation(
        "Reopen",
        "Reopen this conversation",
        { keys: ["E"] },
        "default",
        true,
      ),
      {
        type: "conversation-action",
        conversationId: inbox.selection.target.id,
        action: { type: "reopen" },
      },
    );
  }
  return enabled(
    presentation("Resolve", "Resolve this conversation", { keys: ["E"] }),
    {
      type: "conversation-action",
      conversationId: inbox.selection.target.id,
      action: { type: "resolve" },
    },
  );
}

function resolveSnoozeConversation(
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  if (!inbox) return hidden();
  if (inbox.selection.kind === "none") return hidden();
  if (inbox.selection.kind === "multiple") {
    if (!inbox.operations.bulkSnooze) return hidden();
    if (inbox.filter === "archived") return hidden();
    if (inbox.filter === "snoozed") {
      return enabled(
        presentation(
          "Unsnooze selected",
          "Clear snooze on the selected conversations",
          { keys: ["S"] },
        ),
        {
          type: "bulk-action",
          conversationIds: selectedIds(inbox.selection),
          action: { type: "snooze", until: null },
        },
      );
    }
    return enabled(
      presentation(
        "Snooze selected until tomorrow",
        "Snooze the selected conversations until tomorrow",
        { keys: ["S"] },
      ),
      {
        type: "bulk-action",
        conversationIds: selectedIds(inbox.selection),
        action: { type: "snooze", until: "tomorrow" },
      },
    );
  }
  if (!inbox.operations.snooze) return hidden();
  if (isArchived(inbox.selection.target)) return hidden();
  if (isSnoozed(inbox.selection.target, context.nowMs)) {
    return enabled(
      presentation(
        "Unsnooze",
        "Clear this snooze",
        { keys: ["S"] },
        "default",
        true,
      ),
      {
        type: "conversation-action",
        conversationId: inbox.selection.target.id,
        action: { type: "unsnooze" },
      },
    );
  }
  return enabled(
    presentation(
      "Snooze until tomorrow",
      "Snooze this conversation until tomorrow",
      { keys: ["S"] },
    ),
    {
      type: "conversation-action",
      conversationId: inbox.selection.target.id,
      action: { type: "snooze", until: "tomorrow" },
    },
  );
}

function resolveFlagSpam(
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  if (!inbox) return hidden();
  if (inbox.selection.kind === "none") return hidden();
  if (inbox.selection.kind === "multiple") {
    const item = presentation(
      "Mark selected as spam",
      "Flag the selected conversations as spam",
      { keys: ["⇧", "S"] },
      "destructive",
    );
    if (!inbox.operations.bulkFlagSpam) return hidden();
    if (inbox.filter === "archived") return hidden();
    if (inbox.filter === "flagged") {
      return disabled(item, COMMAND_REASONS.noBulkUnflag);
    }
    return enabled(item, {
      type: "bulk-action",
      conversationIds: selectedIds(inbox.selection),
      action: { type: "flag-spam" },
    });
  }
  if (!inbox.operations.flagSpam) return hidden();
  if (isArchived(inbox.selection.target)) return hidden();
  if (isSpam(inbox.selection.target)) {
    return enabled(
      presentation(
        "Unflag",
        "Remove the spam flag",
        { keys: ["⇧", "S"] },
        "default",
        true,
      ),
      {
        type: "conversation-action",
        conversationId: inbox.selection.target.id,
        action: { type: "unflag" },
      },
    );
  }
  return enabled(
    presentation(
      "Mark as spam",
      "Flag this conversation as spam",
      { keys: ["⇧", "S"] },
      "destructive",
    ),
    {
      type: "conversation-action",
      conversationId: inbox.selection.target.id,
      action: { type: "flag-spam" },
    },
  );
}

function resolveBlockVisitor(
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  if (!inbox) return hidden();
  const blockItem = presentation(
    "Block visitor",
    "Block this visitor",
    { keys: ["B"] },
    "destructive",
  );
  if (inbox.selection.kind === "none") return hidden();
  if (inbox.selection.kind === "multiple") {
    return disabled(blockItem, COMMAND_REASONS.blockOneAtATime);
  }
  if (!inbox.operations.block) return hidden();
  if (inbox.selection.target.visitorBlocked) {
    return enabled(
      presentation(
        "Unblock visitor",
        "Unblock this visitor",
        { keys: ["B"] },
        "default",
        true,
      ),
      {
        type: "conversation-action",
        conversationId: inbox.selection.target.id,
        action: { type: "unblock-visitor" },
      },
    );
  }
  return enabled(blockItem, {
    type: "conversation-action",
    conversationId: inbox.selection.target.id,
    action: { type: "block-visitor" },
  });
}

function resolveArchiveConversation(
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  if (!inbox) return hidden();
  if (inbox.selection.kind === "none") return hidden();
  if (inbox.selection.kind === "multiple") {
    if (!inbox.operations.bulkArchive) return hidden();
    if (inbox.filter === "archived") {
      return enabled(
        presentation(
          "Unarchive selected",
          "Restore the selected conversations",
          { keys: ["A"] },
        ),
        {
          type: "bulk-action",
          conversationIds: selectedIds(inbox.selection),
          action: { type: "unarchive" },
        },
      );
    }
    return enabled(
      presentation(
        "Archive selected",
        "Archive the selected conversations",
        { keys: ["A"] },
      ),
      {
        type: "bulk-action",
        conversationIds: selectedIds(inbox.selection),
        action: { type: "archive" },
      },
    );
  }
  if (!inbox.operations.archive) return hidden();
  if (isArchived(inbox.selection.target)) {
    return enabled(
      presentation("Unarchive", "Restore this conversation", { keys: ["A"] }),
      {
        type: "conversation-action",
        conversationId: inbox.selection.target.id,
        action: { type: "unarchive" },
      },
    );
  }
  return enabled(
    presentation("Archive", "Archive this conversation", { keys: ["A"] }),
    {
      type: "conversation-action",
      conversationId: inbox.selection.target.id,
      action: { type: "archive" },
    },
  );
}

function resolveMove(
  direction: "next" | "previous",
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  if (!inbox || !inbox.operations.move) return hidden();
  const label = direction === "next" ? "Next conversation" : "Previous conversation";
  const keycap = { keys: [direction === "next" ? "J" : "K"] };
  return enabled(
    presentation(label, label, keycap),
    { type: "move-ticket", direction },
  );
}

function resolveExtend(
  direction: "next" | "previous",
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  if (!inbox || !inbox.operations.extendRange) return hidden();
  const label = direction === "next"
    ? "Extend selection down"
    : "Extend selection up";
  const keycap = { keys: ["⇧", direction === "next" ? "↓" : "↑"] };
  return enabled(
    presentation(label, label, keycap),
    { type: "extend-range", direction },
  );
}

function resolveEscapeInbox(
  context: DashboardCommandContext,
): CommandAvailability {
  const inbox = inboxOf(context);
  if (!inbox) return hidden();
  if (inbox.selection.kind === "multiple") {
    return enabled(
      presentation("Clear selection", "Clear the bulk selection", { keys: ["Esc"] }),
      { type: "clear-selection" },
    );
  }
  if (inbox.view.kind === "focus") {
    return enabled(
      presentation("Exit Focus", "Leave Focus", { keys: ["Esc"] }),
      { type: "exit-focus" },
    );
  }
  return hidden();
}

function navigateDefinition(
  id: Extract<DashboardCommandId, `navigate-${string}`>,
): DashboardCommandDefinition {
  const { secondKey } = NAV_DESTINATIONS[id];
  return {
    id,
    group: "navigation",
    shortcuts: [sequenceShortcut(secondKey)],
    repeat: "ignore",
    resolve: (context) => resolveNavigate(id, context),
  };
}

export const DASHBOARD_COMMANDS = {
  "toggle-command-menu": {
    id: "toggle-command-menu",
    group: "global",
    shortcuts: [chord("k", { keys: ["⌘", "K"] }, { primary: true })],
    repeat: "ignore",
    resolve: resolveToggleMenu,
  },
  "navigate-dashboard": navigateDefinition("navigate-dashboard"),
  "navigate-needs-you": navigateDefinition("navigate-needs-you"),
  "navigate-inbox": navigateDefinition("navigate-inbox"),
  "navigate-snoozed": navigateDefinition("navigate-snoozed"),
  "navigate-resolved": navigateDefinition("navigate-resolved"),
  "navigate-archived": navigateDefinition("navigate-archived"),
  "navigate-flagged": navigateDefinition("navigate-flagged"),
  "navigate-sources": navigateDefinition("navigate-sources"),
  "navigate-help-center": navigateDefinition("navigate-help-center"),
  "navigate-sops": navigateDefinition("navigate-sops"),
  "navigate-company-info": navigateDefinition("navigate-company-info"),
  "navigate-chat-widget": navigateDefinition("navigate-chat-widget"),
  "navigate-greetings": navigateDefinition("navigate-greetings"),
  "navigate-tools": navigateDefinition("navigate-tools"),
  "navigate-customers": navigateDefinition("navigate-customers"),
  "navigate-mcp-connections": navigateDefinition("navigate-mcp-connections"),
  "navigate-settings": navigateDefinition("navigate-settings"),
  "toggle-focus": {
    id: "toggle-focus",
    group: "inbox",
    shortcuts: [chord("f", { keys: ["F"] })],
    repeat: "ignore",
    resolve: resolveToggleFocus,
  },
  "open-conversation-search": {
    id: "open-conversation-search",
    group: "inbox",
    shortcuts: [chord("f", { keys: ["⇧", "F"] }, { shift: true })],
    repeat: "ignore",
    resolve: resolveOpenSearch,
  },
  "open-sidechat": {
    id: "open-sidechat",
    group: "inbox",
    shortcuts: [chord("tab", { keys: ["⇧", "Tab"] }, { shift: true })],
    repeat: "ignore",
    resolve: resolveOpenSidechat,
  },
  "resolve-conversation": {
    id: "resolve-conversation",
    group: "inbox",
    shortcuts: [chord("e", { keys: ["E"] })],
    repeat: "ignore",
    resolve: resolveResolveConversation,
  },
  "snooze-conversation": {
    id: "snooze-conversation",
    group: "inbox",
    shortcuts: [chord("s", { keys: ["S"] })],
    repeat: "ignore",
    resolve: resolveSnoozeConversation,
  },
  "flag-spam": {
    id: "flag-spam",
    group: "inbox",
    shortcuts: [chord("s", { keys: ["⇧", "S"] }, { shift: true })],
    repeat: "ignore",
    resolve: resolveFlagSpam,
  },
  "block-visitor": {
    id: "block-visitor",
    group: "inbox",
    shortcuts: [chord("b", { keys: ["B"] })],
    repeat: "ignore",
    resolve: resolveBlockVisitor,
  },
  "archive-conversation": {
    id: "archive-conversation",
    group: "inbox",
    shortcuts: [chord("a", { keys: ["A"] })],
    repeat: "ignore",
    resolve: resolveArchiveConversation,
  },
  "move-next": {
    id: "move-next",
    group: "selection",
    shortcuts: [chord("j", { keys: ["J"] })],
    repeat: "allow",
    resolve: (context) => resolveMove("next", context),
  },
  "move-previous": {
    id: "move-previous",
    group: "selection",
    shortcuts: [chord("k", { keys: ["K"] })],
    repeat: "allow",
    resolve: (context) => resolveMove("previous", context),
  },
  "extend-next": {
    id: "extend-next",
    group: "selection",
    shortcuts: [chord("arrowdown", { keys: ["⇧", "↓"] }, { shift: true })],
    repeat: "allow",
    resolve: (context) => resolveExtend("next", context),
  },
  "extend-previous": {
    id: "extend-previous",
    group: "selection",
    shortcuts: [chord("arrowup", { keys: ["⇧", "↑"] }, { shift: true })],
    repeat: "allow",
    resolve: (context) => resolveExtend("previous", context),
  },
  "escape-inbox": {
    id: "escape-inbox",
    group: "selection",
    shortcuts: [chord("escape", { keys: ["Esc"] })],
    repeat: "ignore",
    resolve: resolveEscapeInbox,
  },
} satisfies Record<DashboardCommandId, DashboardCommandDefinition>;

export function resolveCommand(
  id: DashboardCommandId,
  context: DashboardCommandContext,
): CommandAvailability {
  return DASHBOARD_COMMANDS[id].resolve(context);
}

export function sequenceSecondKeys(): Readonly<Record<string, DashboardCommandId>> {
  const nextKeys: Record<string, DashboardCommandId> = {};
  for (const id of DASHBOARD_COMMAND_IDS) {
    const command = DASHBOARD_COMMANDS[id];
    for (const shortcut of command.shortcuts) {
      if (shortcut.kind !== "sequence") continue;
      const second = shortcut.strokes[1];
      if (second) nextKeys[second.key] = command.id;
    }
  }
  return nextKeys;
}

export function cancelPendingSequence(): PendingKeySequence {
  return IDLE_PENDING;
}

function expirePending(
  pending: PendingKeySequence,
  nowMs: number,
): PendingKeySequence {
  if (pending.status === "waiting" && nowMs >= pending.expiresAt) {
    return IDLE_PENDING;
  }
  return pending;
}

export function waitingPrefix(nowMs: number): PendingKeySequence {
  return {
    status: "waiting",
    prefix: "g",
    expiresAt: nowMs + PREFIX_TIMEOUT_MS,
    nextKeys: sequenceSecondKeys(),
  };
}

function isMenuChord(stroke: NormalizedKeyStroke): boolean {
  const shortcut = DASHBOARD_COMMANDS["toggle-command-menu"].shortcuts[0];
  return shortcut?.kind === "chord" && chordMatches(stroke, shortcut.stroke);
}

function isBareG(stroke: NormalizedKeyStroke): boolean {
  return (
    stroke.key === "g" &&
    !stroke.primary &&
    !stroke.shift &&
    !stroke.alt &&
    !stroke.extra
  );
}

function matchDirectCommand(
  stroke: NormalizedKeyStroke,
): DashboardCommandDefinition | null {
  for (const id of DASHBOARD_COMMAND_IDS) {
    const command = DASHBOARD_COMMANDS[id];
    for (const shortcut of command.shortcuts) {
      if (shortcut.kind !== "chord") continue;
      if (chordMatches(stroke, shortcut.stroke)) return command;
    }
  }
  return null;
}

function dispatchIfEnabled(
  commandId: DashboardCommandId,
  context: DashboardCommandContext,
  pending: PendingKeySequence,
): ActivationDecision {
  const availability = resolveCommand(commandId, context);
  if (availability.status !== "enabled") {
    return { kind: "leave-browser", pending };
  }
  return {
    kind: "dispatch",
    commandId,
    intent: availability.intent,
    pending,
  };
}

export function decideKeyActivation(
  event: KeyEventInput,
  surface: ActivationSurface,
  context: DashboardCommandContext,
): ActivationDecision {
  const pending = expirePending(context.pending, context.nowMs);

  if (event.defaultPrevented || event.isComposing || isImeKey(event)) {
    return { kind: "ignore", pending };
  }

  if (surface === "blocking-overlay" || surface === "command-menu") {
    return { kind: "ignore", pending };
  }

  const stroke = normalizeKeyStroke(event);

  if (isMenuChord(stroke)) {
    return dispatchIfEnabled("toggle-command-menu", context, IDLE_PENDING);
  }

  if (surface !== "page") {
    return { kind: "leave-browser", pending };
  }

  if (pending.status === "waiting") {
    if (stroke.key === "escape") {
      return { kind: "cancel-prefix", pending: IDLE_PENDING };
    }
    if (MODIFIER_KEYS.has(stroke.key) && !stroke.shift) {
      return { kind: "cancel-prefix", pending: IDLE_PENDING };
    }
    if (stroke.primary || stroke.alt || stroke.extra) {
      return { kind: "consume-prefix", pending: IDLE_PENDING };
    }
    if (stroke.repeat) {
      return { kind: "ignore", pending };
    }
    const commandId = pending.nextKeys[stroke.key];
    if (commandId && !stroke.shift) {
      return dispatchIfEnabled(commandId, context, IDLE_PENDING);
    }
    return { kind: "consume-prefix", pending: IDLE_PENDING };
  }

  if (isBareG(stroke)) {
    if (stroke.repeat) return { kind: "leave-browser", pending };
    return { kind: "start-prefix", pending: waitingPrefix(context.nowMs) };
  }

  const matched = matchDirectCommand(stroke);
  if (!matched) return { kind: "leave-browser", pending };
  if (stroke.repeat && matched.repeat === "ignore") {
    return { kind: "leave-browser", pending };
  }
  return dispatchIfEnabled(matched.id, context, pending);
}
