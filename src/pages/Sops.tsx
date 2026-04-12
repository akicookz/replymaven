import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Lightbulb,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  AlertCircle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Guideline {
  id: string;
  condition: string;
  instruction: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface GuidelineFormData {
  condition: string;
  instruction: string;
  enabled: boolean;
}

const emptyForm: GuidelineFormData = {
  condition: "",
  instruction: "",
  enabled: true,
};

// ─── Component ────────────────────────────────────────────────────────────────

function Sops() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GuidelineFormData>(emptyForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  // ─── Queries ──────────────────────────────────────────────────────────────

  const {
    data: guidelines,
    isLoading,
    isError,
  } = useQuery<Guideline[]>({
    queryKey: ["guidelines", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/guidelines`);
      if (!res.ok) throw new Error("Failed to fetch guidelines");
      return res.json();
    },
  });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const createGuideline = useMutation({
    mutationFn: async (data: GuidelineFormData) => {
      const res = await fetch(`/api/projects/${projectId}/guidelines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to create guideline" }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to create guideline",
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guidelines", projectId] });
      resetForm();
      toast.success("Guideline created");
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const updateGuideline = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<GuidelineFormData>;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/guidelines/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to update guideline" }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to update guideline",
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guidelines", projectId] });
      resetForm();
      toast.success("Guideline updated");
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const deleteGuideline = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/guidelines/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete guideline");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guidelines", projectId] });
      if (expandedId) setExpandedId(null);
      toast.success("Guideline deleted");
    },
    onError: () => toast.error("Failed to delete guideline"),
  });

  const toggleGuideline = useMutation({
    mutationFn: async ({
      id,
      enabled,
    }: {
      id: string;
      enabled: boolean;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/guidelines/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      if (!res.ok) throw new Error("Failed to toggle guideline");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guidelines", projectId] });
    },
    onError: () => toast.error("Failed to toggle guideline"),
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
  }

  function startEdit(guideline: Guideline) {
    setEditingId(guideline.id);
    setForm({
      condition: guideline.condition,
      instruction: guideline.instruction,
      enabled: guideline.enabled,
    });
    setShowForm(true);
    setFormError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.condition.trim()) {
      setFormError("Please describe when this guideline should apply.");
      return;
    }
    if (!form.instruction.trim()) {
      setFormError("Please describe what the bot should do.");
      return;
    }

    if (editingId) {
      updateGuideline.mutate({ id: editingId, data: form });
    } else {
      createGuideline.mutate(form);
    }
  }

  const isPending = createGuideline.isPending || updateGuideline.isPending;

  // ─── SOP Suggestions ────────────────────────────────────────────────────────

  interface SopSuggestion {
    id: string;
    type: "new_sop" | "update_sop";
    targetGuidelineId: string | null;
    sourceConversationId: string | null;
    suggestion: string;
    reasoning: string | null;
  }

  const { data: sopSuggestions } = useQuery<SopSuggestion[]>({
    queryKey: ["knowledge-suggestions-sop", projectId],
    queryFn: async () => {
      // Just fetch all pending suggestions - no type filter needed
      const res = await fetch(`/api/projects/${projectId}/knowledge-suggestions`);
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      const allSuggestions = await res.json();
      // Filter to only SOP-related suggestions
      return allSuggestions.filter((s: SopSuggestion) =>
        ["new_sop", "add_sop", "refine_sop"].includes(s.type)
      );
    },
    staleTime: 60_000,
  });

  const approveSop = useMutation({
    mutationFn: async (sugId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/${sugId}/approve`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to approve");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions-sop", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestion-counts", projectId] });
      queryClient.invalidateQueries({ queryKey: ["guidelines", projectId] });
      toast.success("Suggestion approved");
    },
    onError: () => toast.error("Failed to approve suggestion"),
  });

  const rejectSop = useMutation({
    mutationFn: async (sugId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/${sugId}/reject`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to reject");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions-sop", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestion-counts", projectId] });
      toast.success("Suggestion dismissed");
    },
    onError: () => toast.error("Failed to dismiss suggestion"),
  });

  const bulkApproveSops = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/bulk-approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        },
      );
      if (!res.ok) throw new Error("Failed to bulk approve");
      return res.json();
    },
    onSuccess: () => {
      setSelectedSuggestions(new Set());
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions-sop", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestion-counts", projectId] });
      queryClient.invalidateQueries({ queryKey: ["guidelines", projectId] });
      toast.success("Suggestions approved");
    },
    onError: () => toast.error("Failed to approve suggestions"),
  });

  const bulkRejectSops = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/bulk-reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        },
      );
      if (!res.ok) throw new Error("Failed to bulk reject");
      return res.json();
    },
    onSuccess: () => {
      setSelectedSuggestions(new Set());
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions-sop", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestion-counts", projectId] });
      toast.success("Suggestions dismissed");
    },
    onError: () => toast.error("Failed to dismiss suggestions"),
  });

  function toggleSuggestionSelection(id: string) {
    const newSelection = new Set(selectedSuggestions);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedSuggestions(newSelection);
  }

  function toggleAllSuggestions() {
    if (!sopSuggestions) return;
    if (selectedSuggestions.size === sopSuggestions.length) {
      setSelectedSuggestions(new Set());
    } else {
      setSelectedSuggestions(new Set(sopSuggestions.map(s => s.id)));
    }
  }

  const hasSelectedSuggestions = selectedSuggestions.size > 0;
  const allSuggestionsSelected = sopSuggestions && selectedSuggestions.size === sopSuggestions.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link
          to={`/app/projects/${projectId}/knowledgebase`}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">SOPs</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Define step-by-step instructions for how your bot should handle
            specific scenarios.
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add SOP
          </Button>
        )}
      </div>

      {/* SOP Suggestions */}
      {sopSuggestions && sopSuggestions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allSuggestionsSelected ?? false}
                onCheckedChange={() => toggleAllSuggestions()}
              />
              <Lightbulb className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                AI Suggestions
              </h2>
              <span className="inline-flex items-center justify-center px-1.5 h-5 text-[10px] font-bold bg-primary text-primary-foreground rounded-full">
                {sopSuggestions.length}
              </span>
              {hasSelectedSuggestions && (
                <span className="text-xs text-muted-foreground">
                  ({selectedSuggestions.size} selected)
                </span>
              )}
            </div>
            {hasSelectedSuggestions && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => bulkApproveSops.mutate(Array.from(selectedSuggestions))}
                  disabled={bulkApproveSops.isPending || bulkRejectSops.isPending}
                >
                  {bulkApproveSops.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Approve {selectedSuggestions.size}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => bulkRejectSops.mutate(Array.from(selectedSuggestions))}
                  disabled={bulkRejectSops.isPending || bulkApproveSops.isPending}
                >
                  {bulkRejectSops.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <X className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Reject {selectedSuggestions.size}
                </Button>
              </div>
            )}
          </div>
          {sopSuggestions.map((s) => {
            const payload = JSON.parse(s.suggestion);
            const existingGuideline = s.targetGuidelineId
              ? guidelines?.find((g) => g.id === s.targetGuidelineId)
              : null;

            return (
              <div
                key={s.id}
                className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-primary/20 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Checkbox
                      checked={selectedSuggestions.has(s.id)}
                      onCheckedChange={() => toggleSuggestionSelection(s.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-primary">
                      {s.type === "new_sop"
                        ? "New SOP"
                        : `Update SOP: "${existingGuideline?.condition ?? "existing guideline"}"`}
                    </p>
                    {s.reasoning && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {s.reasoning}
                      </p>
                    )}
                    {s.sourceConversationId && (
                      <Link
                        to={`/app/projects/${projectId}/conversations?id=${s.sourceConversationId}`}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mt-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View conversation
                      </Link>
                    )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => approveSop.mutate(s.id)}
                      disabled={approveSop.isPending}
                      className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      title="Approve and apply"
                    >
                      {approveSop.isPending && approveSop.variables === s.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectSop.mutate(s.id)}
                      disabled={rejectSop.isPending}
                      className="p-1.5 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                      title="Dismiss"
                    >
                      {rejectSop.isPending && rejectSop.variables === s.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <X className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="bg-muted/30 rounded-xl p-3 space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    When: {payload.condition}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Then: {payload.instruction}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              {editingId ? "Edit Guideline" : "New Guideline"}
            </h2>
            <button
              type="button"
              onClick={resetForm}
              className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              When this happens
            </label>
            <textarea
              value={form.condition}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, condition: e.target.value }))
              }
              rows={2}
              maxLength={500}
              placeholder="e.g. A customer asks about the status of their order"
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground text-right">
              {form.condition.length}/500
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              The bot should
            </label>
            <textarea
              value={form.instruction}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  instruction: e.target.value,
                }))
              }
              rows={5}
              maxLength={2000}
              placeholder='e.g. Ask for their order number. Then call the check_order tool. If the order status is "shipped", provide the tracking number and estimated delivery date. If "processing", tell them it will ship within 2-3 business days.'
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground text-right">
              {form.instruction.length}/2000
            </p>
          </div>

          {formError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {formError}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending && (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              )}
              {editingId ? "Update" : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to load guidelines. Please try refreshing the page.
        </div>
      )}

      {/* Guideline List */}
      {!isLoading && !isError && (
        <div className="space-y-2">
          {guidelines?.map((guideline) => (
            <div
              key={guideline.id}
              className="bg-white/[0.04] backdrop-blur-xl rounded-xl border border-border overflow-hidden"
            >
              {/* Row */}
              <div
                className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() =>
                  setExpandedId(
                    expandedId === guideline.id ? null : guideline.id,
                  )
                }
              >
                <div className="flex items-center gap-2 shrink-0">
                  {expandedId === guideline.id ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground line-clamp-1">
                    <span className="font-medium text-muted-foreground mr-1.5">
                      When:
                    </span>
                    {guideline.condition}
                  </p>
                </div>
                <div className="flex items-center gap-1 sm:gap-3 shrink-0">
                  <Switch
                    checked={guideline.enabled}
                    onCheckedChange={(checked) => {
                      toggleGuideline.mutate({
                        id: guideline.id,
                        enabled: checked,
                      });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    size="sm"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(guideline);
                    }}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteGuideline.mutate(guideline.id);
                    }}
                    disabled={deleteGuideline.isPending}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Expanded Detail */}
              {expandedId === guideline.id && (
                <div className="border-t border-border px-4 py-4 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      When this happens
                    </p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {guideline.condition}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      The bot should
                    </p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {guideline.instruction}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}

          {(!guidelines || guidelines.length === 0) && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">
                No SOPs configured yet. Add guidelines to tell your bot exactly
                how to handle specific customer scenarios.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Example: &quot;When a customer asks about refunds, ask for their
                order number and explain the 30-day return policy.&quot;
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Sops;
