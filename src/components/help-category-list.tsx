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
import { GripVertical, MoreVertical, Plus, Settings2, Archive } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CategoryIcon } from "@/components/icon-picker";
import { cn } from "@/lib/utils";

export interface HelpCategoryItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  articleCount: number;
  sortOrder: number;
}

export interface SidebarArticle {
  id: string;
  title: string;
  status: "draft" | "published";
}

interface HelpCategoryListProps {
  projectId: string;
  categories: HelpCategoryItem[];
  articlesByCategory: Map<string, SidebarArticle[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewArticle: (categoryId: string) => void;
  onEditCategory: (category: HelpCategoryItem) => void;
  onArchiveCategory: (category: HelpCategoryItem) => void;
  onReorder: (items: { id: string; sortOrder: number }[]) => void;
}

interface SortableCategoryRowProps {
  projectId: string;
  category: HelpCategoryItem;
  articles: SidebarArticle[];
  selected: boolean;
  onSelect: () => void;
  onNewArticle: () => void;
  onEdit: () => void;
  onArchive: () => void;
}

function SortableCategoryRow({
  projectId,
  category,
  articles,
  selected,
  onSelect,
  onNewArticle,
  onEdit,
  onArchive,
}: SortableCategoryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <div className="group relative flex items-center gap-2 rounded-lg pr-1 py-1.5 transition-colors hover:bg-muted/40">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="absolute -left-5 top-1/2 -translate-y-1/2 h-7 w-5 inline-flex items-center justify-center text-muted-foreground/50 hover:text-foreground cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onSelect}
          className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
        >
          <span className="shrink-0 h-8 w-8 rounded-md bg-muted overflow-hidden inline-flex items-center justify-center text-muted-foreground">
            <CategoryIcon icon={category.icon} className="h-4 w-4" />
          </span>
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              selected
                ? "font-semibold text-foreground"
                : "font-medium text-foreground/70",
            )}
          >
            {category.name}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${category.name}`}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border bg-background shadow-sm text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => onNewArticle()}>
              <Plus className="w-4 h-4" />
              New article
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEdit()}>
              <Settings2 className="w-4 h-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onArchive()}
              className="text-destructive focus:text-destructive"
            >
              <Archive className="w-4 h-4" />
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {selected && articles.length > 0 && (
        <ul className="mt-0.5 mb-1 ml-4 border-l border-border pl-3 space-y-0.5">
          {articles.map((article) => (
            <li key={article.id}>
              <Link
                to={`/app/projects/${projectId}/help/articles/${article.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60"
              >
                <span
                  className={cn(
                    "shrink-0 h-1.5 w-1.5 rounded-full",
                    article.status === "published"
                      ? "bg-green-500"
                      : "bg-muted-foreground/40",
                  )}
                />
                <span className="truncate">
                  {article.title || "(untitled)"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function HelpCategoryList({
  projectId,
  categories,
  articlesByCategory,
  selectedId,
  onSelect,
  onNewArticle,
  onEditCategory,
  onArchiveCategory,
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
        <ul className="space-y-0.5 pl-1">
          {categories.map((cat) => (
            <SortableCategoryRow
              key={cat.id}
              projectId={projectId}
              category={cat}
              articles={articlesByCategory.get(cat.id) ?? []}
              selected={selectedId === cat.id}
              onSelect={() => onSelect(cat.id)}
              onNewArticle={() => onNewArticle(cat.id)}
              onEdit={() => onEditCategory(cat)}
              onArchive={() => onArchiveCategory(cat)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export default HelpCategoryList;
