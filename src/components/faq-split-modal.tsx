import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Split,
  Loader2,
  AlertCircle,
  ArrowRight,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FAQ_DESCRIPTION_MAX_CHARS,
  FAQ_SET_MAX_CHARS,
  getFaqSetTotalLength,
} from "../../shared/faq-limits";
import { type FaqPair } from "./faq-editor";

interface Bucket {
  title: string;
  description: string;
  pairs: FaqPair[];
}

interface FaqSplitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  resourceId: string;
  resourceTitle: string;
  onApplied?: () => void;
}

function FaqSplitModal({
  open,
  onOpenChange,
  projectId,
  resourceId,
  resourceTitle,
  onApplied,
}: FaqSplitModalProps) {
  const queryClient = useQueryClient();
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview = useMutation({
    mutationFn: async () => {
      setError(null);
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/split-with-ai`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Failed to generate split");
      }
      return (await res.json()) as { buckets: Bucket[] };
    },
    onSuccess: (data) => {
      setBuckets(data.buckets);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!buckets) throw new Error("No split to apply");
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/apply-split`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            buckets: buckets.map((b) => ({
              title: b.title.trim(),
              description: b.description.trim() || undefined,
              pairs: b.pairs,
            })),
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Failed to apply split");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      queryClient.invalidateQueries({
        queryKey: ["resource-content", projectId, resourceId],
      });
      onApplied?.();
      onOpenChange(false);
      setConfirmOpen(false);
      setBuckets(null);
    },
    onError: (err: Error) => {
      setError(err.message);
      setConfirmOpen(false);
    },
  });

  // Trigger preview when modal opens
  useEffect(() => {
    if (open && !buckets && !preview.isPending) {
      preview.mutate();
    }
    if (!open) {
      // Reset on close
      setBuckets(null);
      setError(null);
      setConfirmOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function updateBucketField(
    index: number,
    field: "title" | "description",
    value: string,
  ) {
    if (!buckets) return;
    const next = buckets.map((b, i) => (i === index ? { ...b, [field]: value } : b));
    setBuckets(next);
  }

  function movePair(
    fromBucket: number,
    pairIndex: number,
    toBucket: number,
  ) {
    if (!buckets || fromBucket === toBucket) return;
    const next = buckets.map((b) => ({ ...b, pairs: [...b.pairs] }));
    const [moved] = next[fromBucket].pairs.splice(pairIndex, 1);
    next[toBucket].pairs.push(moved);
    setBuckets(next);
  }

  const isApplyDisabled = (() => {
    if (!buckets || apply.isPending) return true;
    for (const b of buckets) {
      if (!b.title.trim()) return true;
      if (b.pairs.length === 0) return true;
      if (getFaqSetTotalLength(b.pairs) > FAQ_SET_MAX_CHARS) return true;
    }
    return false;
  })();

  function handleClose(nextOpen: boolean) {
    if (!nextOpen && (preview.isPending || apply.isPending)) return;
    onOpenChange(nextOpen);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 text-primary">
                <Split className="w-4 h-4" />
              </div>
              <DialogTitle className="text-base">
                Split &ldquo;{resourceTitle}&rdquo;
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-4">
            {preview.isPending && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Grouping pairs by topic...
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-destructive/10 text-destructive text-sm mb-4">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {!preview.isPending && buckets && (
            <div className="space-y-4">
              {buckets.map((bucket, bIdx) => {
                const total = getFaqSetTotalLength(bucket.pairs);
                const overLimit = total > FAQ_SET_MAX_CHARS;
                return (
                  <div
                    key={bIdx}
                    className="space-y-3 p-4 rounded-2xl bg-muted/40"
                  >
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={bucket.title}
                        onChange={(e) =>
                          updateBucketField(bIdx, "title", e.target.value)
                        }
                        placeholder="Bucket title"
                        className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <textarea
                        value={bucket.description}
                        onChange={(e) =>
                          updateBucketField(
                            bIdx,
                            "description",
                            e.target.value.slice(
                              0,
                              FAQ_DESCRIPTION_MAX_CHARS,
                            ),
                          )
                        }
                        placeholder="When to refer to this FAQ"
                        rows={2}
                        className="w-full px-3 py-2 rounded-xl border border-input bg-background text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <div
                        className={`flex justify-between text-xs ${
                          overLimit
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        <span>
                          {bucket.pairs.length} pair
                          {bucket.pairs.length === 1 ? "" : "s"}
                        </span>
                        <span>
                          {total.toLocaleString()} /{" "}
                          {FAQ_SET_MAX_CHARS.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {bucket.pairs.map((pair, pIdx) => (
                        <div
                          key={pIdx}
                          className="flex items-start gap-2 p-2.5 rounded-xl bg-background"
                        >
                          <div className="flex-1 min-w-0 text-sm">
                            <div className="font-medium line-clamp-2">
                              {pair.question}
                            </div>
                            <div className="text-muted-foreground text-xs line-clamp-2 mt-0.5">
                              {pair.answer}
                            </div>
                          </div>
                          {buckets.length > 1 && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted shrink-0"
                                  title="Move to another bucket"
                                >
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {buckets.map((other, oIdx) =>
                                  oIdx === bIdx ? null : (
                                    <DropdownMenuItem
                                      key={oIdx}
                                      onClick={() => movePair(bIdx, pIdx, oIdx)}
                                    >
                                      Move to {other.title || `bucket ${oIdx + 1}`}
                                    </DropdownMenuItem>
                                  ),
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>

          <DialogFooter className="px-6 py-4 bg-muted/30 shrink-0 rounded-b-lg">
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={preview.isPending || apply.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={isApplyDisabled}
            >
              <Check className="w-4 h-4" />
              Apply split
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Replace this FAQ?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            This will replace <strong>&ldquo;{resourceTitle}&rdquo;</strong> with{" "}
            <strong>{buckets?.length ?? 0}</strong> new FAQ sets. The original
            will be deleted.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={apply.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => apply.mutate()}
              disabled={apply.isPending}
            >
              {apply.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Applying
                </>
              ) : (
                "Replace"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default FaqSplitModal;
