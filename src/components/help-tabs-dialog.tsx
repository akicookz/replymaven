import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface HelpTabItem {
  id: string;
  name: string;
  sortOrder: number;
  categoryCount: number;
}

// Mirrors MAX_HELP_TABS and the tab name limit in the worker.
export const MAX_HELP_TABS = 6;
const MAX_TAB_NAME = 24;

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? fallback);
}

async function createTabRequest(
  projectId: string,
  name: string,
): Promise<HelpTabItem> {
  const res = await fetch(`/api/projects/${projectId}/help/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw await readError(res, "Failed to create tab");
  return res.json();
}

function useInvalidateHelpTabs(projectId: string) {
  const queryClient = useQueryClient();
  return function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["help-tabs", projectId] });
    queryClient.invalidateQueries({ queryKey: ["help-categories", projectId] });
  };
}

// ─── First tabs ───────────────────────────────────────────────────────────────

interface HelpFirstTabsDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (newTabId: string) => void;
}

/** Creates the first two tabs. The first one takes every existing category. */
export function HelpFirstTabsDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: HelpFirstTabsDialogProps) {
  const invalidate = useInvalidateHelpTabs(projectId);
  const [currentName, setCurrentName] = useState("Docs");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCurrentName("Docs");
    setNewName("");
    setError(null);
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      await createTabRequest(projectId, currentName.trim());
      return createTabRequest(projectId, newName.trim());
    },
    onSuccess: (created) => {
      invalidate();
      onOpenChange(false);
      onCreated(created.id);
    },
    onError: (err: Error) => {
      invalidate();
      setError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentName.trim() || !newName.trim()) {
      setError("Name both tabs");
      return;
    }
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add tabs</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="help-tab-current">Your current categories</Label>
            <Input
              id="help-tab-current"
              value={currentName}
              onChange={(e) => setCurrentName(e.target.value)}
              maxLength={MAX_TAB_NAME}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="help-tab-new">New tab</Label>
            <Input
              id="help-tab-new"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Changelog"
              maxLength={MAX_TAB_NAME}
              required
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Create tabs
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Manage tabs ──────────────────────────────────────────────────────────────

interface HelpTabsDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: HelpTabItem[];
  onCreated: (tabId: string) => void;
}

export function HelpTabsDialog({
  projectId,
  open,
  onOpenChange,
  tabs,
  onCreated,
}: HelpTabsDialogProps) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateHelpTabs(projectId);
  const [newName, setNewName] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = useMemo(() => tabs.map((t) => t.id), [tabs]);

  useEffect(() => {
    if (open) setNewName("");
  }, [open]);

  const create = useMutation({
    mutationFn: (name: string) => createTabRequest(projectId, name),
    onSuccess: (created) => {
      setNewName("");
      invalidate();
      onCreated(created.id);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rename = useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      const res = await fetch(
        `/api/projects/${projectId}/help/tabs/${input.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: input.name }),
        },
      );
      if (!res.ok) throw await readError(res, "Failed to rename tab");
    },
    onSettled: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/projects/${projectId}/help/tabs/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw await readError(res, "Failed to delete tab");
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });

  const reorder = useMutation({
    mutationFn: async (items: { id: string; sortOrder: number }[]) => {
      const res = await fetch(`/api/projects/${projectId}/help/tabs/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw await readError(res, "Failed to reorder tabs");
    },
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: ["help-tabs", projectId] });
      const prev = queryClient.getQueryData<HelpTabItem[]>([
        "help-tabs",
        projectId,
      ]);
      if (prev) {
        const order = new Map(items.map((i) => [i.id, i.sortOrder]));
        queryClient.setQueryData(
          ["help-tabs", projectId],
          [...prev]
            .map((t) => ({ ...t, sortOrder: order.get(t.id) ?? t.sortOrder }))
            .sort((a, b) => a.sortOrder - b.sortOrder),
        );
      }
      return { prev };
    },
    onError: (_err, _items, context) => {
      if (context?.prev) {
        queryClient.setQueryData(["help-tabs", projectId], context.prev);
      }
      toast.error("Failed to reorder tabs");
    },
    onSettled: () => invalidate(),
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    reorder.mutate(
      arrayMove(tabs, from, to).map((t, i) => ({ id: t.id, sortOrder: i })),
    );
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (name) create.mutate(name);
  }

  const atLimit = tabs.length >= MAX_HELP_TABS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Tabs</DialogTitle>
        </DialogHeader>
        <TooltipProvider delayDuration={200}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {tabs.map((tab) => (
                  <SortableTabRow
                    key={tab.id}
                    tab={tab}
                    onRename={(name) => rename.mutate({ id: tab.id, name })}
                    onDelete={() => remove.mutate(tab.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </TooltipProvider>
        <form onSubmit={handleAdd} className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={atLimit ? `${MAX_HELP_TABS} tabs maximum` : "New tab"}
            aria-label="New tab name"
            maxLength={MAX_TAB_NAME}
            disabled={atLimit}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={atLimit || !newName.trim() || create.isPending}
          >
            <Plus />
            Add
          </Button>
        </form>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SortableTabRowProps {
  tab: HelpTabItem;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function SortableTabRow({ tab, onRename, onDelete }: SortableTabRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id });
  const [name, setName] = useState(tab.name);

  useEffect(() => setName(tab.name), [tab.name]);

  function commit() {
    const next = name.trim();
    if (!next) {
      setName(tab.name);
      return;
    }
    if (next !== tab.name) onRename(next);
  }

  const deleteButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Delete ${tab.name}`}
      onClick={onDelete}
      disabled={tab.categoryCount > 0}
    >
      <Trash2 />
    </Button>
  );

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="flex items-center gap-2"
    >
      <button
        type="button"
        aria-label={`Drag to reorder ${tab.name}`}
        className="inline-flex h-9 w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        aria-label="Tab name"
        maxLength={MAX_TAB_NAME}
      />
      <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
        {tab.categoryCount === 1
          ? "1 category"
          : `${tab.categoryCount} categories`}
      </span>
      {tab.categoryCount > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{deleteButton}</span>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>
            Move or archive its categories first
          </TooltipContent>
        </Tooltip>
      ) : (
        deleteButton
      )}
    </li>
  );
}
