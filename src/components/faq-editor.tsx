import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Save,
  AlertCircle,
  Loader2,
  Split,
  MoreVertical,
  ArrowRightLeft,
  Wand2,
  X,
  GripVertical,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FaqSplitModal from "@/components/faq-split-modal";
import {
  FAQ_DESCRIPTION_MAX_CHARS,
  FAQ_PAIR_MAX_CHARS,
  FAQ_SET_MAX_CHARS,
  getFaqPairLength,
  getFaqSetTotalLength,
} from "../../shared/faq-limits";

interface FaqPair {
  question: string;
  answer: string;
}

interface LocalFaqPair extends FaqPair {
  _id: string;
}

function withId(pair: FaqPair): LocalFaqPair {
  return { ...pair, _id: crypto.randomUUID() };
}

function stripId(pair: LocalFaqPair): FaqPair {
  return { question: pair.question, answer: pair.answer };
}

interface FaqEditorProps {
  projectId: string;
  resourceId?: string;
  onSave?: () => void;
  onCancel?: () => void;
  mode: "create" | "edit";
  initialDraft?: {
    title?: string;
    description?: string;
    pairs?: FaqPair[];
  } | null;
}

interface SortablePairCardProps {
  pair: LocalFaqPair;
  index: number;
  pairsLength: number;
  mode: "create" | "edit";
  resourceId?: string;
  moveTargets: Array<{ id: string; title: string; total: number }>;
  isMovePending: boolean;
  setLimitHit: boolean;
  questionRef: (el: HTMLInputElement | null) => void;
  onUpdatePair: (
    index: number,
    field: "question" | "answer",
    value: string,
  ) => void;
  onRemovePair: (index: number) => void;
  onMovePair: (vars: { destResourceId: string; pairIndex: number }) => void;
  onAddPair: () => void;
  onRequestFocusNext: (nextIndex: number) => void;
}

function SortablePairCard({
  pair,
  index,
  pairsLength,
  mode,
  resourceId,
  moveTargets,
  isMovePending,
  setLimitHit,
  questionRef,
  onUpdatePair,
  onRemovePair,
  onMovePair,
  onAddPair,
  onRequestFocusNext,
}: SortablePairCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pair._id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const pairLen = getFaqPairLength(pair);
  const pairOverLimit = pairLen > FAQ_PAIR_MAX_CHARS;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-xl p-4 space-y-3 ${
        pairOverLimit
          ? "bg-destructive/5 ring-1 ring-destructive/30"
          : "bg-muted/30"
      }`}
      {...attributes}
    >
      <button
        type="button"
        {...listeners}
        className="absolute top-3 left-3 p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-grab active:cursor-grabbing"
        title="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="absolute top-3 right-3 p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Pair actions"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {mode === "edit" && resourceId && moveTargets.length > 0 && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-2" />
                  Move to…
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {moveTargets.map((target) => {
                    const wouldOverflow =
                      target.total + getFaqPairLength(pair) >
                      FAQ_SET_MAX_CHARS;
                    return (
                      <DropdownMenuItem
                        key={target.id}
                        disabled={wouldOverflow || isMovePending}
                        onClick={() =>
                          onMovePair({
                            destResourceId: target.id,
                            pairIndex: index,
                          })
                        }
                      >
                        <span className="truncate max-w-[14rem]">
                          {target.title}
                        </span>
                        {wouldOverflow && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            full
                          </span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            disabled={pairsLength <= 1}
            onClick={() => onRemovePair(index)}
            variant="destructive"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Delete pair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="space-y-1.5 px-8">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          When customer query is about
        </label>
        <input
          ref={questionRef}
          type="text"
          value={pair.question}
          onChange={(e) => onUpdatePair(index, "question", e.target.value)}
          placeholder="e.g., What are your shipping rates?"
          className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1.5 px-8">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Respond with this info
        </label>
        <textarea
          value={pair.answer}
          onChange={(e) => onUpdatePair(index, "answer", e.target.value)}
          onKeyDown={(e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter" &&
              index === pairsLength - 1 &&
              pair.question.trim() &&
              pair.answer.trim() &&
              !setLimitHit
            ) {
              e.preventDefault();
              onAddPair();
              onRequestFocusNext(pairsLength);
            }
          }}
          placeholder="e.g., We offer free shipping on orders over $50. Standard shipping is $5.99 and takes 3-5 business days."
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div
        className={`flex justify-end text-xs px-8 ${
          pairOverLimit ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {pairLen.toLocaleString()} / {FAQ_PAIR_MAX_CHARS.toLocaleString()}
      </div>
    </div>
  );
}

function FaqEditor({
  projectId,
  resourceId,
  onSave,
  onCancel,
  mode,
  initialDraft,
}: FaqEditorProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(() =>
    mode === "create" ? (initialDraft?.title ?? "") : "",
  );
  const [description, setDescription] = useState(() =>
    mode === "create" ? (initialDraft?.description ?? "") : "",
  );
  const [pairs, setPairs] = useState<LocalFaqPair[]>(() => {
    const seed =
      mode === "create" && initialDraft?.pairs && initialDraft.pairs.length > 0
        ? initialDraft.pairs
        : [{ question: "", answer: "" }];
    return seed.map((p) => ({ ...p, _id: crypto.randomUUID() }));
  });
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPairs((current) => {
      const oldIndex = current.findIndex((p) => p._id === active.id);
      const newIndex = current.findIndex((p) => p._id === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  }
  const [descriptionSuggestion, setDescriptionSuggestion] = useState<
    string | null
  >(null);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(
    null,
  );
  const questionRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (pendingFocusIndex === null) return;
    const el = questionRefs.current[pendingFocusIndex];
    if (el) {
      el.focus();
      setPendingFocusIndex(null);
    }
  }, [pendingFocusIndex, pairs.length]);

  const { data: resources } = useQuery<
    Array<{
      id: string;
      title: string;
      description: string | null;
      type: string;
      content: string | null;
    }>
  >({
    queryKey: ["resources", projectId],
    enabled: mode === "edit" && !!resourceId,
  });

  const existingResource = resources?.find((r) => r.id === resourceId);

  const { data: contentData, isLoading: isLoadingContent } = useQuery<{
    content: string | null;
    pairs?: FaqPair[];
  }>({
    queryKey: ["resource-content", projectId, resourceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/content`,
      );
      if (!res.ok) throw new Error("Failed to fetch content");
      return res.json();
    },
    enabled: mode === "edit" && !!resourceId,
  });

  useEffect(() => {
    if (initialized || !contentData || !existingResource) return;

    setTitle(existingResource.title);
    setDescription(existingResource.description ?? "");

    if (contentData.pairs && contentData.pairs.length > 0) {
      setPairs(contentData.pairs.map(withId));
    } else if (contentData.content) {
      const legacyPairs = parseLegacyFaqContent(contentData.content);
      if (legacyPairs.length > 0) {
        setPairs(legacyPairs.map(withId));
      }
    }

    setInitialized(true);
  }, [contentData, existingResource, initialized]);

  const totalChars = getFaqSetTotalLength(pairs);
  const setLimitHit = totalChars >= FAQ_SET_MAX_CHARS;
  const anyPairOverLimit = pairs.some(
    (pair) => getFaqPairLength(pair) > FAQ_PAIR_MAX_CHARS,
  );

  const meterPercent = Math.min(
    100,
    (totalChars / FAQ_SET_MAX_CHARS) * 100,
  );
  const meterTier =
    meterPercent >= 90 ? "danger" : meterPercent >= 70 ? "warn" : "ok";
  const meterFillClass =
    meterTier === "danger"
      ? "bg-destructive"
      : meterTier === "warn"
        ? "bg-amber-500"
        : "bg-primary/70";
  const meterTextClass =
    meterTier === "danger"
      ? "text-destructive"
      : meterTier === "warn"
        ? "text-amber-600 dark:text-amber-500"
        : "text-muted-foreground";

  const saveMutation = useMutation({
    mutationFn: async () => {
      setError(null);

      const validPairs = pairs.filter(
        (p) => p.question.trim() && p.answer.trim(),
      );
      if (validPairs.length === 0) {
        throw new Error("At least one complete Q&A pair is required");
      }

      if (!title.trim()) {
        throw new Error("Title is required");
      }

      if (anyPairOverLimit) {
        throw new Error(
          `One or more Q&A pairs exceed ${FAQ_PAIR_MAX_CHARS} characters`,
        );
      }

      if (getFaqSetTotalLength(validPairs) > FAQ_SET_MAX_CHARS) {
        throw new Error(
          `FAQ set exceeds ${FAQ_SET_MAX_CHARS.toLocaleString()} characters total`,
        );
      }

      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        pairs: validPairs.map(stripId),
      };

      if (mode === "create") {
        const res = await fetch(`/api/projects/${projectId}/resources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "faq", ...payload }),
        });
        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: "Failed to create FAQ" }));
          throw new Error(
            (err as { error?: string }).error ?? "Failed to create FAQ",
          );
        }
        return res.json();
      }

      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to update FAQ" }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to update FAQ",
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      queryClient.invalidateQueries({
        queryKey: ["resource-content", projectId, resourceId],
      });
      onSave?.();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  function addPair() {
    if (setLimitHit) return;
    setPairs([...pairs, withId({ question: "", answer: "" })]);
  }

  function removePair(index: number) {
    if (pairs.length <= 1) return;
    setPairs(pairs.filter((_, i) => i !== index));
  }

  const movePair = useMutation({
    mutationFn: async (vars: { destResourceId: string; pairIndex: number }) => {
      if (!resourceId) throw new Error("Save the FAQ first");
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/move-pair`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(vars),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Failed to move pair");
      }
      return vars;
    },
    onSuccess: (vars) => {
      // Drop locally; refetch destination + resources list
      setPairs((prev) => prev.filter((_, i) => i !== vars.pairIndex));
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      queryClient.invalidateQueries({
        queryKey: ["resource-content", projectId, vars.destResourceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["resource-content", projectId, resourceId],
      });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const suggestDescription = useMutation({
    mutationFn: async () => {
      setError(null);
      const validPairs = pairs.filter(
        (p) => p.question.trim() && p.answer.trim(),
      );
      const res = await fetch(
        `/api/projects/${projectId}/faq-description-suggestion`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairs: validPairs }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Failed to suggest description");
      }
      return (await res.json()) as { suggestion: string };
    },
    onSuccess: (data) => {
      setDescriptionSuggestion(data.suggestion);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const validPairCount = pairs.filter(
    (p) => p.question.trim() && p.answer.trim(),
  ).length;
  const showSuggestButton =
    validPairCount >= 3 && description.trim().length < 20;

  // Other FAQ resources eligible as move destinations (current FAQ excluded)
  const moveTargets = (resources ?? [])
    .filter((r) => r.type === "faq" && r.id !== resourceId)
    .map((r) => {
      let total = 0;
      try {
        const parsedPairs = JSON.parse(r.content ?? "[]");
        if (Array.isArray(parsedPairs)) {
          for (const p of parsedPairs as FaqPair[]) {
            total += (p.question?.length ?? 0) + (p.answer?.length ?? 0);
          }
        }
      } catch {
        // unknown content shape — assume room
      }
      return { id: r.id, title: r.title, total };
    });

  function updatePair(
    index: number,
    field: "question" | "answer",
    value: string,
  ) {
    const updated = [...pairs];
    updated[index] = { ...updated[index], [field]: value };
    setPairs(updated);
  }

  if (mode === "edit" && (isLoadingContent || !initialized)) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading FAQ...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="FAQ collection title (e.g., Shipping & Returns)"
        className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Explain when to refer to this FAQ
          </label>
          {showSuggestButton && (
            <button
              type="button"
              onClick={() => suggestDescription.mutate()}
              disabled={suggestDescription.isPending}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
            >
              {suggestDescription.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Wand2 className="w-3 h-3" />
              )}
              Suggest
            </button>
          )}
        </div>
        <textarea
          value={description}
          onChange={(e) =>
            setDescription(e.target.value.slice(0, FAQ_DESCRIPTION_MAX_CHARS))
          }
          placeholder="Use when the visitor asks about shipping rates, delivery times, or returns."
          rows={2}
          className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {descriptionSuggestion && (
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-primary/5">
            <Wand2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
            <div className="flex-1 text-xs">
              <div className="text-muted-foreground mb-1.5">Suggested:</div>
              <div className="text-foreground">{descriptionSuggestion}</div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setDescription(descriptionSuggestion);
                    setDescriptionSuggestion(null);
                  }}
                  className="text-primary hover:text-primary/80 font-medium"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => setDescriptionSuggestion(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Dismiss
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDescriptionSuggestion(null)}
              className="p-1 rounded-md hover:bg-muted text-muted-foreground"
              title="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="flex justify-end text-xs text-muted-foreground">
          {description.length} / {FAQ_DESCRIPTION_MAX_CHARS}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground uppercase tracking-wide">
            Set total
          </span>
          <span className={meterTextClass}>
            {totalChars.toLocaleString()} /{" "}
            {FAQ_SET_MAX_CHARS.toLocaleString()}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all ${meterFillClass}`}
            style={{ width: `${meterPercent}%` }}
          />
        </div>
      </div>

      {setLimitHit && mode === "edit" && resourceId && (
        <div className="flex items-start gap-3 px-3 py-3 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium">
              FAQ set is at its character limit
            </div>
            <div className="text-xs opacity-90 mt-0.5">
              Split this set into smaller, focused ones for better routing.
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setSplitModalOpen(true)}
            className="shrink-0"
          >
            <Split className="w-3.5 h-3.5" />
            Split by Topic
          </Button>
        </div>
      )}

      {setLimitHit && mode === "create" && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">
              FAQ set is at its character limit
            </div>
            <div className="text-xs opacity-90 mt-0.5">
              Save this set first, then use &ldquo;Split with AI&rdquo; to break it up.
            </div>
          </div>
        </div>
      )}

      {mode === "edit" && resourceId && (
        <FaqSplitModal
          open={splitModalOpen}
          onOpenChange={setSplitModalOpen}
          projectId={projectId}
          resourceId={resourceId}
          resourceTitle={title || "FAQ"}
          onApplied={onSave}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={pairs.map((p) => p._id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4">
            {pairs.map((pair, index) => (
              <SortablePairCard
                key={pair._id}
                pair={pair}
                index={index}
                pairsLength={pairs.length}
                mode={mode}
                resourceId={resourceId}
                moveTargets={moveTargets}
                isMovePending={movePair.isPending}
                setLimitHit={setLimitHit}
                questionRef={(el) => {
                  questionRefs.current[index] = el;
                }}
                onUpdatePair={updatePair}
                onRemovePair={removePair}
                onMovePair={(vars) => movePair.mutate(vars)}
                onAddPair={addPair}
                onRequestFocusNext={(nextIndex) =>
                  setPendingFocusIndex(nextIndex)
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!setLimitHit && (
        <button
          type="button"
          onClick={addPair}
          className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add another Q&A pair
        </button>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={
            saveMutation.isPending ||
            anyPairOverLimit ||
            totalChars > FAQ_SET_MAX_CHARS
          }
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              {mode === "create" ? "Add FAQ" : "Save Changes"}
            </>
          )}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function parseLegacyFaqContent(content: string): FaqPair[] {
  const pairs: FaqPair[] = [];
  const lines = content.split("\n");
  let currentQuestion = "";
  let currentAnswer = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Q:") || trimmed.startsWith("q:")) {
      if (currentQuestion && currentAnswer) {
        pairs.push({
          question: currentQuestion.trim(),
          answer: currentAnswer.trim(),
        });
      }
      currentQuestion = trimmed.substring(2).trim();
      currentAnswer = "";
    } else if (trimmed.startsWith("A:") || trimmed.startsWith("a:")) {
      currentAnswer = trimmed.substring(2).trim();
    } else if (currentAnswer) {
      currentAnswer += "\n" + trimmed;
    }
  }

  if (currentQuestion && currentAnswer) {
    pairs.push({
      question: currentQuestion.trim(),
      answer: currentAnswer.trim(),
    });
  }

  return pairs;
}

void parseLegacyFaqContent;

export default FaqEditor;
export { type FaqPair };
