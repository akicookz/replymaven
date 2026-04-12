import { useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronRightIcon,
  ClipboardList,
  ExternalLink,
  FileText,
  Globe,
  HelpCircle,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import FaqEditor from "@/components/faq-editor";
import PdfResourceDetail from "@/components/pdf-detail";
import WebpageResourceDetail from "@/components/webpage-detail";
import { MobileMenuButton } from "@/components/PageHeader";

interface Resource {
  id: string;
  type: "webpage" | "pdf" | "faq";
  title: string;
  url: string | null;
  content: string | null;
  status: "pending" | "crawling" | "indexed" | "failed";
  createdAt: string;
}

interface Guideline {
  id: string;
  condition: string;
  instruction: string;
  enabled: boolean;
}

interface CompanySettings {
  companyName: string | null;
  toneOfVoice: string;
}

interface SuggestionCounts {
  total: number;
  newFaq: number;
  updateFaq: number;
  newSop: number;
  updateSop: number;
  updatePdf: number;
  updateWebpage: number;
  updateContext: number;
}

interface KnowledgeSuggestion {
  id: string;
  projectId: string;
  type:
    | "new_faq"
    | "add_faq_pair"
    | "refine_faq_pair"
    | "new_sop"
    | "add_sop"
    | "refine_sop"
    | "update_pdf"
    | "update_webpage"
    | "update_context";
  status: "pending" | "approved" | "rejected";
  targetResourceId: string | null;
  targetGuidelineId: string | null;
  targetPageId: string | null;
  sourceConversationId: string | null;
  suggestion: string;
  reasoning: string | null;
  createdAt: string;
}

function Resources() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  // ─── Entry Card Queries ─────────────────────────────────────────────────────

  const { data: guidelinesData } = useQuery<Guideline[]>({
    queryKey: ["guidelines", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/guidelines`);
      if (!res.ok) throw new Error("Failed to fetch guidelines");
      return res.json();
    },
  });

  const { data: companySettings } = useQuery<CompanySettings>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const activeGuidelineCount = guidelinesData?.filter((g) => g.enabled).length ?? 0;

  // ─── Knowledge Suggestions ──────────────────────────────────────────────────

  const { data: suggestionCounts } = useQuery<SuggestionCounts>({
    queryKey: ["knowledge-suggestion-counts", projectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/counts`,
      );
      if (!res.ok) throw new Error("Failed to fetch suggestion counts");
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: faqSuggestions } = useQuery<KnowledgeSuggestion[]>({
    queryKey: ["knowledge-suggestions-faq", projectId],
    queryFn: async () => {
      // Just fetch all pending suggestions - no type filter needed
      const res = await fetch(`/api/projects/${projectId}/knowledge-suggestions`);
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      const allSuggestions = await res.json();
      // Filter to only resource-related suggestions (exclude SOPs and context)
      return allSuggestions.filter((s: KnowledgeSuggestion) =>
        ["new_faq", "add_faq_pair", "refine_faq_pair", "update_pdf", "update_webpage"].includes(s.type)
      );
    },
    staleTime: 60_000,
  });

  const approveSuggestion = useMutation({
    mutationFn: async (sugId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/${sugId}/approve`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to approve suggestion");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestion-counts", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions-faq", projectId] });
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      toast.success("Suggestion approved");
    },
    onError: () => toast.error("Failed to approve suggestion"),
  });

  const rejectSuggestion = useMutation({
    mutationFn: async (sugId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/${sugId}/reject`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to reject suggestion");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestion-counts", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions-faq", projectId] });
      toast.success("Suggestion dismissed");
    },
    onError: () => toast.error("Failed to dismiss suggestion"),
  });

  const bulkApproveSuggestions = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/bulk-approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        },
      );
      if (!res.ok) throw new Error("Failed to bulk approve suggestions");
      return res.json();
    },
    onSuccess: () => {
      setSelectedSuggestions(new Set());
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestion-counts", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions-faq", projectId] });
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      toast.success("Suggestions approved");
    },
    onError: () => toast.error("Failed to approve suggestions"),
  });

  const bulkRejectSuggestions = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/bulk-reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        },
      );
      if (!res.ok) throw new Error("Failed to bulk reject suggestions");
      return res.json();
    },
    onSuccess: () => {
      setSelectedSuggestions(new Set());
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestion-counts", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions-faq", projectId] });
      toast.success("Suggestions dismissed");
    },
    onError: () => toast.error("Failed to dismiss suggestions"),
  });

  const resourceSuggestionCount =
    (suggestionCounts?.newFaq ?? 0) +
    (suggestionCounts?.updateFaq ?? 0) +
    (suggestionCounts?.updatePdf ?? 0) +
    (suggestionCounts?.updateWebpage ?? 0);
  const sopSuggestionCount = (suggestionCounts?.newSop ?? 0) + (suggestionCounts?.updateSop ?? 0);
  const contextSuggestionCount = suggestionCounts?.updateContext ?? 0;

  // ─── Resource State ─────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<"webpage" | "pdf" | "faq">(
    "webpage",
  );
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: resources, isLoading: isLoadingResources } = useQuery<Resource[]>(
    {
      queryKey: ["resources", projectId],
      queryFn: async () => {
        const res = await fetch(`/api/projects/${projectId}/resources`);
        if (!res.ok) throw new Error("Failed to fetch resources");
        return res.json();
      },
    },
  );
  const addResource = useMutation({
    mutationFn: async () => {
      setError(null);

      if (formType === "pdf") {
        if (!pdfFile) throw new Error("Please select a PDF file");

        const formData = new FormData();
        formData.append("title", title);
        formData.append("file", pdfFile);

        const res = await fetch(`/api/projects/${projectId}/resources`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error((err as { error?: string }).error ?? "Upload failed");
        }
        return res.json();
      }

      if (formType === "webpage") {
        const res = await fetch(`/api/projects/${projectId}/resources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "webpage", title, url }),
        });
        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: "Failed to add resource" }));
          throw new Error(
            (err as { error?: string }).error ?? "Failed to add resource",
          );
        }
        return res.json();
      }

      // FAQ is handled by FaqEditor directly.
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      resetForm();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const deleteResource = useMutation({
    mutationFn: async (resourceId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      toast.success("Resource deleted");
    },
    onError: () => toast.error("Failed to delete resource"),
  });

  const reindex = useMutation({
    mutationFn: async (resourceId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/reindex`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to reindex");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      toast.success("Reindexing started");
    },
    onError: () => toast.error("Failed to reindex"),
  });

  const typeIcons = {
    webpage: Globe,
    pdf: FileText,
    faq: HelpCircle,
  };

  const statusColors: Record<string, string> = {
    pending: "bg-status-waiting/10 text-status-waiting border-status-waiting/25",
    crawling: "bg-status-replied/10 text-status-replied border-status-replied/25",
    indexed: "bg-status-active/10 text-status-active border-status-active/25",
    failed: "bg-destructive/10 text-destructive border-destructive/25",
  };

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Only PDF files are allowed");
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File too large (max 10MB)");
      e.target.value = "";
      return;
    }

    setError(null);
    setPdfFile(file);
    if (!title) {
      setTitle(file.name.replace(/\.pdf$/i, ""));
    }
  }

  function resetForm() {
    setShowForm(false);
    setError(null);
    setTitle("");
    setUrl("");
    setPdfFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function toggleExpanded(resourceId: string) {
    setExpandedId(expandedId === resourceId ? null : resourceId);
  }

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
    if (!faqSuggestions) return;

    if (selectedSuggestions.size === faqSuggestions.length) {
      setSelectedSuggestions(new Set());
    } else {
      setSelectedSuggestions(new Set(faqSuggestions.map(s => s.id)));
    }
  }

  const hasSelectedSuggestions = selectedSuggestions.size > 0;
  const allSuggestionsSelected = faqSuggestions && selectedSuggestions.size === faqSuggestions.length;

  function getSuggestionTitle(
    suggestion: KnowledgeSuggestion,
    payload: Record<string, unknown>,
    targetResource: Resource | null,
  ) {
    switch (suggestion.type) {
      case "new_faq":
        // Check if this is a legacy suggestion when FAQs already exist
        const hasFAQs = resources?.some(r => r.type === "faq");
        const title = typeof payload.title === "string" ? payload.title : "Untitled FAQ";
        return hasFAQs ? `⚠️ New FAQ (Legacy): ${title}` : `New FAQ: ${title}`;
      case "add_faq_pair":
        return `Add FAQ Q&A: ${targetResource?.title ?? "FAQ resource"}`;
      case "refine_faq_pair":
        return `Refine FAQ Q&A: ${targetResource?.title ?? "FAQ resource"}`;
      case "new_sop":
        return `New Guideline`;
      case "add_sop":
        return `Add Guideline`;
      case "refine_sop":
        return `Refine Guideline`;
      case "update_pdf":
        return `Refine PDF: ${targetResource?.title ?? "PDF resource"}`;
      case "update_webpage":
        return `Refine Web Page: ${
          typeof payload.pageUrl === "string"
            ? payload.pageUrl
            : targetResource?.title ?? "Crawled page"
        }`;
      default:
        return "AI Suggestion";
    }
  }

  function renderSuggestionPreview(
    suggestion: KnowledgeSuggestion,
    payload: Record<string, unknown>,
  ) {
    if (suggestion.type === "new_faq") {
      const pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
      if (pairs.length === 0) return null;

      return (
        <div className="space-y-2">
          {pairs.slice(0, 4).map((pair, index) => {
            if (!pair || typeof pair !== "object") return null;

            return (
              <div key={index} className="bg-muted/30 rounded-xl p-3 space-y-1">
                <p className="text-xs font-medium text-foreground">
                  Q: {typeof pair.question === "string" ? pair.question : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  A: {typeof pair.answer === "string" ? pair.answer : ""}
                </p>
              </div>
            );
          })}
        </div>
      );
    }

    if (suggestion.type === "add_faq_pair") {
      const pair = payload.pair as Record<string, unknown> | undefined;
      if (!pair || typeof pair !== "object") return null;

      return (
        <div className="bg-emerald-500/10 rounded-xl p-3 space-y-1">
          <p className="text-xs font-medium text-emerald-500">New Q&A to add:</p>
          <p className="text-xs font-medium text-foreground">
            Q: {typeof pair.question === "string" ? pair.question : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            A: {typeof pair.answer === "string" ? pair.answer : ""}
          </p>
        </div>
      );
    }

    if (suggestion.type === "refine_faq_pair") {
      const originalPair = payload.originalPair as Record<string, unknown> | undefined;
      const refinedPair = payload.refinedPair as Record<string, unknown> | undefined;

      return (
        <div className="space-y-2">
          {originalPair && typeof originalPair === "object" && (
            <div className="bg-red-500/10 rounded-xl p-3 space-y-1">
              <p className="text-xs font-medium text-red-500">Original:</p>
              <p className="text-xs font-medium text-foreground line-through">
                Q: {typeof originalPair.question === "string" ? originalPair.question : ""}
              </p>
              <p className="text-xs text-muted-foreground line-through">
                A: {typeof originalPair.answer === "string" ? originalPair.answer : ""}
              </p>
            </div>
          )}
          {refinedPair && typeof refinedPair === "object" && (
            <div className="bg-emerald-500/10 rounded-xl p-3 space-y-1">
              <p className="text-xs font-medium text-emerald-500">Refined:</p>
              <p className="text-xs font-medium text-foreground">
                Q: {typeof refinedPair.question === "string" ? refinedPair.question : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                A: {typeof refinedPair.answer === "string" ? refinedPair.answer : ""}
              </p>
            </div>
          )}
        </div>
      );
    }

    if (suggestion.type === "new_sop" || suggestion.type === "add_sop") {
      return (
        <div className="bg-muted/30 rounded-xl p-3 space-y-1">
          <p className="text-xs font-medium text-foreground">
            When: {typeof payload.condition === "string" ? payload.condition : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Then: {typeof payload.instruction === "string" ? payload.instruction : ""}
          </p>
        </div>
      );
    }

    if (suggestion.type === "refine_sop") {
      return (
        <div className="space-y-2">
          <div className="bg-red-500/10 rounded-xl p-3 space-y-1">
            <p className="text-xs font-medium text-red-500">Original:</p>
            <p className="text-xs font-medium text-foreground line-through">
              When: {typeof payload.originalCondition === "string" ? payload.originalCondition : ""}
            </p>
            <p className="text-xs text-muted-foreground line-through">
              Then: {typeof payload.originalInstruction === "string" ? payload.originalInstruction : ""}
            </p>
          </div>
          <div className="bg-emerald-500/10 rounded-xl p-3 space-y-1">
            <p className="text-xs font-medium text-emerald-500">Refined:</p>
            <p className="text-xs font-medium text-foreground">
              When: {typeof payload.refinedCondition === "string" ? payload.refinedCondition : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Then: {typeof payload.refinedInstruction === "string" ? payload.refinedInstruction : ""}
            </p>
          </div>
        </div>
      );
    }

    if (suggestion.type === "update_pdf" || suggestion.type === "update_webpage") {
      if (payload.mode === "append" && typeof payload.appendText === "string") {
        return (
          <div className="bg-muted/30 rounded-xl p-3 space-y-1">
            <p className="text-xs font-medium text-foreground">Append</p>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
              {payload.appendText}
            </p>
          </div>
        );
      }

      if (
        payload.mode === "replace" &&
        typeof payload.currentText === "string" &&
        typeof payload.updatedText === "string"
      ) {
        return (
          <div className="space-y-2">
            <div className="bg-muted/30 rounded-xl p-3 space-y-1">
              <p className="text-xs font-medium text-foreground">Current excerpt</p>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {payload.currentText}
              </p>
            </div>
            <div className="bg-muted/30 rounded-xl p-3 space-y-1">
              <p className="text-xs font-medium text-foreground">Suggested excerpt</p>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {payload.updatedText}
              </p>
            </div>
          </div>
        );
      }
    }

    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Knowledgebase</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Manage your company context and source knowledge for AI replies.
          </p>
        </div>
      </div>

      {/* ─── Entry Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          to={`/app/projects/${projectId}/knowledgebase/sops`}
          className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-5 hover:border-primary/30 hover:bg-muted/20 transition-all group"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <ClipboardList className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">SOPs</p>
                {sopSuggestionCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-primary text-primary-foreground rounded-full">
                    {sopSuggestionCount}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeGuidelineCount > 0
                  ? `${activeGuidelineCount} active guideline${activeGuidelineCount !== 1 ? "s" : ""}`
                  : "Define how your bot handles specific scenarios"}
              </p>
            </div>
            <ChevronRightIcon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </div>
        </Link>

        <Link
          to={`/app/projects/${projectId}/knowledgebase/company-info`}
          className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-5 hover:border-primary/30 hover:bg-muted/20 transition-all group"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Company Information</p>
                {contextSuggestionCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-primary text-primary-foreground rounded-full">
                    {contextSuggestionCount}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {companySettings?.companyName
                  ? `${companySettings.companyName} \u2014 ${companySettings.toneOfVoice} tone`
                  : "Set up your company context and tone of voice"}
              </p>
            </div>
            <ChevronRightIcon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </div>
        </Link>
      </div>

      {/* ─── Resource Suggestions ─────────────────────────────────────────── */}
      {faqSuggestions && faqSuggestions.length > 0 && (
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
                {faqSuggestions.length}
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
                  onClick={() => bulkApproveSuggestions.mutate(Array.from(selectedSuggestions))}
                  disabled={bulkApproveSuggestions.isPending || bulkRejectSuggestions.isPending}
                >
                  {bulkApproveSuggestions.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Approve {selectedSuggestions.size}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => bulkRejectSuggestions.mutate(Array.from(selectedSuggestions))}
                  disabled={bulkRejectSuggestions.isPending || bulkApproveSuggestions.isPending}
                >
                  {bulkRejectSuggestions.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <X className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Reject {selectedSuggestions.size}
                </Button>
              </div>
            )}
          </div>
          {faqSuggestions.map((s) => {
            const payload = JSON.parse(s.suggestion) as Record<string, unknown>;
            const targetResource = s.targetResourceId
              ? (resources?.find((r) => r.id === s.targetResourceId) ?? null)
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
                        {getSuggestionTitle(s, payload, targetResource)}
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
                      onClick={() => approveSuggestion.mutate(s.id)}
                      disabled={approveSuggestion.isPending}
                      className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      title="Approve and apply"
                    >
                      {approveSuggestion.isPending && approveSuggestion.variables === s.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectSuggestion.mutate(s.id)}
                      disabled={rejectSuggestion.isPending}
                      className="p-1.5 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                      title="Dismiss"
                    >
                      {rejectSuggestion.isPending && rejectSuggestion.variables === s.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <X className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                {renderSuggestionPreview(s, payload)}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Resources ──────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Resources</h2>
            {resourceSuggestionCount > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-primary text-primary-foreground rounded-full">
                {resourceSuggestionCount}
              </span>
            )}
          </div>
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Resource
          </Button>
        </div>

        {showForm && (
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
            <div className="flex gap-2">
              <Button
                variant={formType === "webpage" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setFormType("webpage");
                  setError(null);
                }}
              >
                <Globe className="w-3.5 h-3.5 mr-1.5" />
                Web Page
              </Button>
              <Button
                variant={formType === "pdf" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setFormType("pdf");
                  setError(null);
                }}
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                PDF
              </Button>
              <Button
                variant={formType === "faq" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setFormType("faq");
                  setError(null);
                }}
              >
                <HelpCircle className="w-3.5 h-3.5 mr-1.5" />
                FAQ
              </Button>
            </div>

            {formType === "faq" ? (
              <FaqEditor
                projectId={projectId!}
                mode="create"
                onSave={resetForm}
                onCancel={resetForm}
              />
            ) : (
              <>
                {error && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addResource.mutate();
                  }}
                  className="space-y-3"
                >
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Resource title"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {formType === "webpage" && (
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com/page"
                      required
                      className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  )}
                  {formType === "pdf" && (
                    <div className="space-y-2">
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          "relative flex flex-col items-center justify-center px-6 py-8 rounded-xl border-2 border-dashed cursor-pointer transition-colors",
                          pdfFile
                            ? "border-primary/50 bg-primary/5"
                            : "border-input bg-background hover:border-muted-foreground/50",
                        )}
                      >
                        <Upload
                          className={cn(
                            "w-8 h-8 mb-2",
                            pdfFile ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        {pdfFile ? (
                          <div className="text-center">
                            <p className="text-sm font-medium text-foreground">
                              {pdfFile.name}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                        ) : (
                          <div className="text-center">
                            <p className="text-sm text-foreground">
                              Click to upload a PDF
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Max 10MB
                            </p>
                          </div>
                        )}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="application/pdf"
                          onChange={handleFileChange}
                          className="hidden"
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" disabled={addResource.isPending}>
                      {addResource.isPending ? "Adding..." : "Add Resource"}
                    </Button>
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}

        {isLoadingResources ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-xl bg-muted animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {resources?.map((resource) => {
              const Icon = typeIcons[resource.type];
              const isExpanded = expandedId === resource.id;

              return (
                <div
                  key={resource.id}
                  className="bg-white/[0.04] backdrop-blur-xl rounded-xl border border-border overflow-hidden"
                >
                  <div
                    className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => toggleExpanded(resource.id)}
                  >
                    <div className="flex items-center gap-2 shrink-0">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                        <Icon className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {resource.title}
                      </p>
                      {resource.url && (
                        <p className="text-xs text-muted-foreground truncate">
                          {resource.url}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {resource.type.toUpperCase()}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full border shrink-0",
                        statusColors[resource.status] ?? statusColors.pending,
                      )}
                    >
                      {resource.status}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          reindex.mutate(resource.id);
                        }}
                        disabled={reindex.isPending}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-50"
                        title="Reindex"
                      >
                        <RefreshCw
                          className={cn(
                            "w-4 h-4",
                            reindex.isPending && "animate-spin",
                          )}
                        />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (expandedId === resource.id) setExpandedId(null);
                          deleteResource.mutate(resource.id);
                        }}
                        disabled={deleteResource.isPending}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border px-4 py-4">
                      {resource.type === "faq" && (
                        <FaqEditor
                          projectId={projectId!}
                          resourceId={resource.id}
                          mode="edit"
                          onSave={() => setExpandedId(null)}
                          onCancel={() => setExpandedId(null)}
                        />
                      )}
                      {resource.type === "webpage" && (
                        <WebpageResourceDetail
                          projectId={projectId!}
                          resourceId={resource.id}
                          resourceUrl={resource.url ?? ""}
                          onRefreshAll={() => reindex.mutate(resource.id)}
                        />
                      )}
                      {resource.type === "pdf" && (
                        <PdfResourceDetail
                          projectId={projectId!}
                          resourceId={resource.id}
                          resourceTitle={resource.title}
                          onReindex={() => reindex.mutate(resource.id)}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {(!resources || resources.length === 0) && (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No resources added yet. Add web pages, FAQs, or PDFs for your
                bot to learn from.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Resources;
