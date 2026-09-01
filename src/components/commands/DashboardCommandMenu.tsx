import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CommandKeycap } from "@/components/commands/CommandKeycap";
import {
  DASHBOARD_COMMAND_IDS,
  DASHBOARD_COMMANDS,
  normalizeKeyStroke,
  resolveCommand,
  type CommandGroup as CommandGroupId,
  type CommandKeycap as CommandKeycapModel,
  type CommandPlatform,
  type DashboardCommandContext,
  type DashboardCommandId,
  type DashboardCommandIntent,
  type KeyEventInput,
} from "@/lib/commands/dashboard-command-domain";
import type { DashboardNavItem } from "@/lib/dashboard/nav";

interface MenuRow {
  id: DashboardCommandId;
  group: Exclude<CommandGroupId, "global">;
  label: string;
  keywords: string[];
  keycap: CommandKeycapModel;
  disabled: boolean;
  intent: DashboardCommandIntent | null;
}

const GROUP_ORDER = ["navigation", "inbox", "selection"] as const;
const GROUP_HEADING: Record<(typeof GROUP_ORDER)[number], string> = {
  navigation: "Navigation",
  inbox: "Inbox",
  selection: "Selection",
};

interface DashboardCommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: DashboardCommandContext;
  navItems: DashboardNavItem[];
  platform: CommandPlatform;
  onExecute: (intent: DashboardCommandIntent) => void;
}

function toKeyEventInput(
  event: KeyboardEvent,
  platform: CommandPlatform,
): KeyEventInput {
  return {
    key: event.key,
    keyCode: event.keyCode,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    defaultPrevented: event.defaultPrevented,
    isComposing: event.isComposing,
    platform,
  };
}

function isToggleMenuStroke(
  event: KeyboardEvent,
  platform: CommandPlatform,
): boolean {
  const stroke = normalizeKeyStroke(toKeyEventInput(event, platform));
  return (
    stroke.key === "k" &&
    stroke.primary &&
    !stroke.shift &&
    !stroke.alt &&
    !stroke.extra
  );
}

function buildMenuRows(
  context: DashboardCommandContext,
  navItems: DashboardNavItem[],
): MenuRow[] {
  const rows: MenuRow[] = [];
  const seen = new Set<DashboardCommandId>();

  for (const item of navItems) {
    const availability = resolveCommand(item.navigationCommandId, context);
    if (availability.status === "hidden") continue;
    seen.add(item.navigationCommandId);
    rows.push({
      id: item.navigationCommandId,
      group: "navigation",
      label: item.label,
      keywords: item.searchTerms,
      keycap: availability.presentation.keycap,
      disabled: availability.status === "disabled",
      intent: availability.status === "enabled" ? availability.intent : null,
    });
  }

  for (const id of DASHBOARD_COMMAND_IDS) {
    if (seen.has(id)) continue;
    const definition = DASHBOARD_COMMANDS[id];
    if (definition.group === "global") continue;
    const availability = resolveCommand(id, context);
    if (availability.status === "hidden") continue;
    const group = definition.group;
    rows.push({
      id,
      group,
      label: availability.presentation.label,
      keywords: [
        availability.presentation.label,
        availability.presentation.description,
      ],
      keycap: availability.presentation.keycap,
      disabled: availability.status === "disabled",
      intent: availability.status === "enabled" ? availability.intent : null,
    });
  }

  return rows;
}

export function DashboardCommandMenu({
  open,
  onOpenChange,
  context,
  navItems,
  platform,
  onExecute,
}: DashboardCommandMenuProps) {
  const rows = buildMenuRows(context, navItems);

  function handleSelect(row: MenuRow) {
    if (row.disabled || row.intent == null) return;
    onExecute(row.intent);
    onOpenChange(false);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command menu"
      description="Search dashboard pages and commands"
      showCloseButton={false}
    >
      <div
        data-command-layer="command-menu"
        onKeyDown={(event) => {
          if (!isToggleMenuStroke(event.nativeEvent, platform)) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        }}
      >
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          {GROUP_ORDER.map((group) => {
            const items = rows.filter((row) => row.group === group);
            if (items.length === 0) return null;
            return (
              <CommandGroup key={group} heading={GROUP_HEADING[group]}>
                {items.map((row) => (
                  <CommandItem
                    key={row.id}
                    value={row.id}
                    keywords={row.keywords}
                    disabled={row.disabled}
                    onSelect={() => handleSelect(row)}
                  >
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    <CommandKeycap keycap={row.keycap} className="ml-auto" />
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </div>
    </CommandDialog>
  );
}
