import type { InboxFilter } from "../inbox/filters";
import type { Conversation } from "../inbox/types";
import {
  ALL_INBOX_CAPABILITIES,
  IDLE_PENDING,
  resolveCommand,
  type CommandAvailability,
  type CommandKeycap,
  type CommandPlatform,
  type CommandPresentation,
  type ConversationCommandTarget,
  type ConversationSelection,
  type DashboardCommandContext,
  type DashboardCommandId,
  type InboxView,
} from "./dashboard-command-domain";

export function detectCommandPlatform(): CommandPlatform {
  if (typeof navigator === "undefined") return "other";
  return /mac/i.test(navigator.platform) ? "macos" : "other";
}

export function toConversationCommandTarget(
  conversation: Pick<
    Conversation,
    | "id"
    | "status"
    | "closeReason"
    | "snoozedUntil"
    | "archivedAt"
    | "visitorBlocked"
  >,
): ConversationCommandTarget {
  return {
    id: conversation.id,
    status: conversation.status,
    closeReason: conversation.closeReason,
    snoozedUntil: conversation.snoozedUntil ?? null,
    archivedAt: conversation.archivedAt ?? null,
    visitorBlocked: conversation.visitorBlocked ?? false,
  };
}

export function buildInboxSelection(
  selected: Conversation | null,
  selectedIds: ReadonlySet<string>,
  conversations: Conversation[],
): ConversationSelection {
  if (!selected) return { kind: "none" };
  if (selectedIds.size > 1) {
    const targets: ConversationCommandTarget[] = [];
    for (const id of selectedIds) {
      if (selected.id === id) {
        targets.push(toConversationCommandTarget(selected));
        continue;
      }
      const row = conversations.find((conversation) => conversation.id === id);
      if (row) targets.push(toConversationCommandTarget(row));
    }
    return {
      kind: "multiple",
      active: toConversationCommandTarget(selected),
      selected: targets,
    };
  }
  return { kind: "single", target: toConversationCommandTarget(selected) };
}

export function inboxCommandContext(input: {
  projectId?: string;
  filter?: InboxFilter;
  selection: ConversationSelection;
  view?: InboxView;
  viewport?: "desktop" | "mobile";
  platform?: CommandPlatform;
  menuOpen?: boolean;
  nowMs?: number;
}): DashboardCommandContext {
  return {
    scope: {
      kind: "inbox",
      projectId: input.projectId ?? "local",
      filter: input.filter ?? "inbox",
      selection: input.selection,
      view: input.view ?? { kind: "split", sidechat: "closed" },
      viewport: input.viewport ?? "desktop",
      operations: ALL_INBOX_CAPABILITIES,
    },
    platform: input.platform ?? detectCommandPlatform(),
    menuOpen: input.menuOpen ?? false,
    pending: IDLE_PENDING,
    nowMs: input.nowMs ?? Date.now(),
  };
}

export function resolveInboxCommand(
  id: DashboardCommandId,
  context: DashboardCommandContext,
): CommandAvailability {
  return resolveCommand(id, context);
}

export function commandPresentation(
  availability: CommandAvailability,
): CommandPresentation | null {
  if (availability.status === "hidden") return null;
  return availability.presentation;
}

export function commandLabel(
  availability: CommandAvailability,
  fallback: string,
): string {
  if (availability.status === "hidden") return fallback;
  return availability.presentation.label;
}

export function commandPressed(
  availability: CommandAvailability,
  fallback = false,
): boolean {
  if (availability.status === "hidden") return fallback;
  return availability.presentation.pressed;
}

export function commandKeycap(
  availability: CommandAvailability,
  fallback: CommandKeycap,
): CommandKeycap {
  if (availability.status === "hidden") return fallback;
  return availability.presentation.keycap;
}
