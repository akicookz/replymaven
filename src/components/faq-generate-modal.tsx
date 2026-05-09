import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Check,
  FileText,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type FaqPair } from "./faq-editor";

interface ResourceSummary {
  id: string;
  type: "webpage" | "pdf" | "faq";
  title: string;
  pageCount?: number;
}

interface FaqDraft {
  title: string;
  description: string;
  pairs: FaqPair[];
}

interface FaqGenerateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onGenerated: (draft: FaqDraft) => void;
}

function FaqGenerateModal({
  open,
  onOpenChange,
  projectId,
  onGenerated,
}: FaqGenerateModalProps) {
  const [topic, setTopic] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    new Set(),
  );
  const [error, setError] = useState<string | null>(null);

  const { data: resources } = useQuery<ResourceSummary[]>({
    queryKey: ["resources", projectId],
    enabled: open,
  });

  const eligibleSources = (resources ?? []).filter(
    (r) => r.type === "webpage" || r.type === "pdf",
  );

  function toggleSource(id: string) {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const generate = useMutation({
    mutationFn: async () => {
      setError(null);
      if (topic.trim().length < 3) {
        throw new Error("Topic must be at least 3 characters.");
      }

      const payload: {
        topic: string;
        sourceResourceIds?: string[];
      } = { topic: topic.trim() };

      if (selectedSourceIds.size > 0) {
        payload.sourceResourceIds = [...selectedSourceIds];
      }

      const res = await fetch(
        `/api/projects/${projectId}/resources/generate-faq`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Failed to generate FAQ");
      }

      return (await res.json()) as FaqDraft;
    },
    onSuccess: (draft) => {
      onGenerated(draft);
      onOpenChange(false);
      setTopic("");
      setSelectedSourceIds(new Set());
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  function handleClose(nextOpen: boolean) {
    if (!nextOpen && generate.isPending) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setError(null);
    }
  }

  const hasNoSources = (resources ?? []).every((r) => r.type === "faq");

  const sourceSummary =
    selectedSourceIds.size === 0
      ? "Using all eligible resources"
      : `${selectedSourceIds.size} selected`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 text-primary">
              <Sparkles className="w-4 h-4" />
            </div>
            <DialogTitle className="text-base">Generate FAQ</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-5">
          {hasNoSources && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Add a webpage or PDF for best results — falling back to company
                context.
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Topic
            </label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value.slice(0, 500))}
              placeholder="Shipping & returns"
              rows={2}
              className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={generate.isPending}
            />
            <div className="flex justify-end text-xs text-muted-foreground">
              {topic.length} / 500
            </div>
          </div>

          {eligibleSources.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Sources
                </label>
                <span className="text-xs text-muted-foreground">
                  {sourceSummary}
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {eligibleSources.map((r) => {
                  const checked = selectedSourceIds.has(r.id);
                  const Icon = r.type === "webpage" ? Globe : FileText;
                  const subtitle =
                    r.type === "webpage" && r.pageCount && r.pageCount > 0
                      ? `${r.pageCount} page${r.pageCount === 1 ? "" : "s"}`
                      : null;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleSource(r.id)}
                      disabled={generate.isPending}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                        checked
                          ? "bg-primary/10"
                          : "bg-muted/40 hover:bg-muted/70"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{r.title}</div>
                        {subtitle && (
                          <div className="text-xs text-muted-foreground truncate">
                            {subtitle}
                          </div>
                        )}
                      </div>
                      <div
                        className={`flex items-center justify-center w-5 h-5 rounded-md shrink-0 transition-colors ${
                          checked
                            ? "bg-primary text-primary-foreground"
                            : "border-2 border-muted-foreground/30 bg-transparent"
                        }`}
                      >
                        {checked && <Check className="w-3 h-3" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={generate.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || topic.trim().length < 3}
          >
            {generate.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FaqGenerateModal;
export { type FaqDraft };
