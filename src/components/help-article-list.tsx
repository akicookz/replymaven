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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ImageIcon, Pencil, Trash2 } from "lucide-react";
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
  thumbnail: string | null;
}

interface HelpArticleListProps {
  projectId: string;
  articles: HelpArticleItem[];
  onDelete: (article: HelpArticleItem) => void;
  onReorder: (items: { id: string; sortOrder: number }[]) => void;
}

interface SortableArticleCardProps {
  projectId: string;
  article: HelpArticleItem;
  onDelete: () => void;
}

function SortableArticleCard({
  projectId,
  article,
  onDelete,
}: SortableArticleCardProps) {
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
      className="group relative flex flex-col overflow-hidden rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors"
    >
      <Link to={editHref} className="flex flex-col">
        <div className="aspect-[16/9] w-full bg-muted/60 overflow-hidden">
          {article.thumbnail ? (
            <img
              src={article.thumbnail}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
              <ImageIcon className="h-8 w-8" />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium line-clamp-1">
              {article.title || "(untitled)"}
            </span>
            <span
              className={cn(
                "shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                article.status === "published"
                  ? "bg-green-500/15 text-green-700 dark:text-green-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {article.status === "published" ? "Published" : "Draft"}
            </span>
          </div>
          {article.excerpt && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {article.excerpt}
            </p>
          )}
        </div>
      </Link>

      <button
        type="button"
        aria-label="Drag to reorder"
        className="absolute top-2 left-2 h-7 w-7 inline-flex items-center justify-center rounded-md bg-background/80 backdrop-blur text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-7 w-7 bg-background/80 backdrop-blur"
          asChild
          aria-label={`Edit ${article.title}`}
        >
          <Link to={editHref}>
            <Pencil className="w-3.5 h-3.5" />
          </Link>
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-7 w-7 bg-background/80 backdrop-blur"
          onClick={onDelete}
          aria-label={`Delete ${article.title}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
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
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {articles.map((article) => (
            <SortableArticleCard
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
