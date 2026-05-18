import { useMemo } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
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
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface HelpCategoryItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  articleCount: number;
  sortOrder: number;
}

interface HelpCategoryListProps {
  categories: HelpCategoryItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (category: HelpCategoryItem) => void;
  onDelete: (category: HelpCategoryItem) => void;
  onReorder: (items: { id: string; sortOrder: number }[]) => void;
}

interface SortableCategoryRowProps {
  category: HelpCategoryItem;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function SortableCategoryRow({
  category,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: SortableCategoryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1.5 rounded-xl px-2 py-2 transition-colors",
        selected ? "bg-accent" : "bg-muted/40 hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="h-8 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 min-w-0 text-left"
      >
        <div className="text-sm font-medium truncate">{category.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {category.articleCount} {category.articleCount === 1 ? "article" : "articles"}
        </div>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        aria-label={`Edit ${category.name}`}
      >
        <Pencil className="w-4 h-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete ${category.name}`}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </li>
  );
}

function HelpCategoryList({
  categories,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onReorder,
}: HelpCategoryListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = useMemo(() => categories.map((c) => c.id), [categories]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(categories, oldIndex, newIndex);
    onReorder(next.map((c, i) => ({ id: c.id, sortOrder: i })));
  }

  if (categories.length === 0) {
    return (
      <div className="px-4 py-6 rounded-xl bg-muted/30 border-2 border-dashed border-muted text-sm text-muted-foreground text-center">
        No categories yet.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {categories.map((cat) => (
            <SortableCategoryRow
              key={cat.id}
              category={cat}
              selected={selectedId === cat.id}
              onSelect={() => onSelect(cat.id)}
              onEdit={() => onEdit(cat)}
              onDelete={() => onDelete(cat)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export default HelpCategoryList;
