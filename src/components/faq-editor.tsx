import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FaqPair {
  question: string;
  answer: string;
}

interface FaqEditorProps {
  projectId: string;
  resourceId?: string;
  onSave?: () => void;
  onCancel?: () => void;
  mode: "create" | "edit";
}

function FaqEditor({
  projectId,
  resourceId,
  onSave,
  onCancel,
  mode,
}: FaqEditorProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [pairs, setPairs] = useState<FaqPair[]>([
    { question: "", answer: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load existing FAQ data when editing
  const { isLoading: isLoadingContent } = useQuery<{
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
    enabled: mode === "edit" && !!resourceId && !loaded,
  });

  // Load existing resource for title
  const { data: resources } = useQuery<
    Array<{ id: string; title: string; type: string }>
  >({
    queryKey: ["resources", projectId],
    enabled: mode === "edit" && !!resourceId,
  });

  // Populate form when content loads
  const existingResource = resources?.find((r) => r.id === resourceId);

  useQuery<{ content: string | null; pairs?: FaqPair[] }>({
    queryKey: ["resource-content-populate", projectId, resourceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/content`,
      );
      if (!res.ok) throw new Error("Failed to fetch content");
      const data = (await res.json()) as {
        content: string | null;
        pairs?: FaqPair[];
      };

      if (!loaded) {
        if (existingResource) {
          setTitle(existingResource.title);
        }
        if (data.pairs && data.pairs.length > 0) {
          setPairs(data.pairs);
        } else if (data.content) {
          // Try to parse legacy content into pairs
          const legacyPairs = parseLegacyFaqContent(data.content);
          if (legacyPairs.length > 0) {
            setPairs(legacyPairs);
          }
        }
        setLoaded(true);
      }

      return data;
    },
    enabled: mode === "edit" && !!resourceId && !!existingResource && !loaded,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      setError(null);

      // Validate pairs
      const validPairs = pairs.filter(
        (p) => p.question.trim() && p.answer.trim(),
      );
      if (validPairs.length === 0) {
        throw new Error("At least one complete Q&A pair is required");
      }

      if (!title.trim()) {
        throw new Error("Title is required");
      }

      if (mode === "create") {
        const res = await fetch(`/api/projects/${projectId}/resources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "faq",
            title: title.trim(),
            pairs: validPairs,
          }),
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

      // Edit mode
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            pairs: validPairs,
          }),
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
    setPairs([...pairs, { question: "", answer: "" }]);
  }

  function removePair(index: number) {
    if (pairs.length <= 1) return;
    setPairs(pairs.filter((_, i) => i !== index));
  }

  function updatePair(
    index: number,
    field: "question" | "answer",
    value: string,
  ) {
    const updated = [...pairs];
    updated[index] = { ...updated[index], [field]: value };
    setPairs(updated);
  }

  if (mode === "edit" && isLoadingContent && !loaded) {
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

      <div className="space-y-4">
        {pairs.map((pair, index) => (
          <div
            key={index}
            className="relative bg-muted/30 rounded-xl border border-border p-4 space-y-3"
          >
            {pairs.length > 1 && (
              <button
                type="button"
                onClick={() => removePair(index)}
                className="absolute top-3 right-3 p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                title="Remove this Q&A pair"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            <div className="space-y-1.5 pr-8">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                When customer query is about
              </label>
              <input
                type="text"
                value={pair.question}
                onChange={(e) =>
                  updatePair(index, "question", e.target.value)
                }
                placeholder="e.g., What are your shipping rates?"
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Respond with this info
              </label>
              <textarea
                value={pair.answer}
                onChange={(e) =>
                  updatePair(index, "answer", e.target.value)
                }
                placeholder="e.g., We offer free shipping on orders over $50. Standard shipping is $5.99 and takes 3-5 business days."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addPair}
        className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add another Q&A pair
      </button>

      <div className="flex gap-2 pt-2">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
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
  // Try to parse "Q: ... A: ..." format
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

// Suppress unused warning — parseLegacyFaqContent is used above
void parseLegacyFaqContent;

export default FaqEditor;
export { type FaqPair };
