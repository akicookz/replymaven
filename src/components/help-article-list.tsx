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
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface HelpArticleItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  status: "draft" | "published";
  sortOrder: number;
}

interface HelpArticleListProps {
  projectId: string;
  articles: HelpArticleItem[];
  onDelete: (article: HelpArticleItem) => void;
  onReorder: (items: { id: string; sortOrder: number }[]) => void;
}

interface SortableArticleRowProps {
  projectId: string;
  article: HelpArticleItem;
  onDelete: () => void;
}

function SortableArticleRow({
  projectId,
  article,
  onDelete,
}: SortableArticleRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: article.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const editHref = `/app/projects/${projectId}/help/articles/${article.id}`;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 rounded-xl px-2 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors"
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
      <Link to={editHref} className="flex-1 min-w-0 group">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate group-hover:underline">
            {article.title || "(untitled)"}
          </span>
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
              article.status === "published"
                ? "bg-green-500/15 text-green-700 dark:text-green-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {article.status === "published" ? "Published" : "Draft"}
          </span>
        </div>
        {article.excerpt && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {article.excerpt}
          </div>
        )}
      </Link>
      <Button type="button" variant="ghost" size="icon" asChild aria-label={`Edit ${article.title}`}>
        <Link to={editHref}>
          <Pencil className="w-4 h-4" />
        </Link>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onDelete}
        aria-label={`Delete ${article.title}`}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </li>
  );
}

function HelpArticleList({
  projectId,
  articles,
  onDelete,
  onReorder,
}: HelpArticleListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = useMemo(() => articles.map((a) => a.id), [articles]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(articles, oldIndex, newIndex);
    onReorder(next.map((a, i) => ({ id: a.id, sortOrder: i })));
  }

  if (articles.length === 0) {
    return (
      <div className="px-4 py-10 rounded-xl bg-muted/30 border-2 border-dashed border-muted text-sm text-muted-foreground text-center">
        No articles in this category yet. Click "New Article" to create one.
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
          {articles.map((article) => (
            <SortableArticleRow
              key={article.id}
              projectId={projectId}
              article={article}
              onDelete={() => onDelete(article)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export default HelpArticleList;
