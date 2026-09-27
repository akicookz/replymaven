import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  FileText,
  Globe,
  HelpCircle,
  Plus,
  ListPlus,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import FaqEditor from "@/components/faq-editor";
import FaqGenerateModal, { type FaqDraft } from "@/components/faq-generate-modal";
import { MobileMenuButton } from "@/components/PageHeader";
import { CompanyCard } from "@/components/company-card";
import { RowCard } from "@/components/ui/row-card";
import { ArticlesIcon } from "@/components/icons/nav-icons";
import { projectRoute } from "@/lib/dashboard-routes";

interface Resource {
  id: string;
  type: "webpage" | "pdf" | "faq";
  title: string;
  url: string | null;
  content: string | null;
  status: "pending" | "crawling" | "indexed" | "failed";
  pageCount?: number;
  createdAt: string;
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function faqPairCount(content: string | null): number | null {
  if (!content) return 0;
  try {
    const pairs: unknown = JSON.parse(content);
    return Array.isArray(pairs) ? pairs.length : null;
  } catch {
    return null;
  }
}

// What the source holds, next to where it came from.
function resourceSummary(resource: Resource): string {
  if (resource.type === "webpage") {
    const pages = plural(resource.pageCount ?? 0, "crawled page", "crawled pages");
    return resource.url ? `${resource.url} · ${pages}` : pages;
  }
  if (resource.type === "faq") {
    const pairs = faqPairCount(resource.content);
    return pairs === null ? "FAQ" : plural(pairs, "Q&A pair", "Q&A pairs");
  }
  return plural(resource.content?.length ?? 0, "character", "characters") + " extracted";
}

function Resources() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  // ─── Resource State ─────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<"webpage" | "pdf" | "faq">(
    "webpage",
  );
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState<FaqDraft | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const { data: projectData } = useQuery<{ slug: string }>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      return res.json();
    },
  });

  const { data: settingsData } = useQuery<{ helpCustomUrl: string | null }>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const { data: helpArticles } = useQuery<{ status: string }[]>({
    queryKey: ["help-articles", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/help/articles`);
      if (!res.ok) throw new Error("Failed to load articles");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
  const publishedArticles = (helpArticles ?? []).filter(
    (article) => article.status === "published",
  ).length;

  const helpCenterDuplicates = useMemo(() => {
    const prefixes: string[] = [];
    if (projectData?.slug) {
      prefixes.push(`https://replymaven.com/help/${projectData.slug}`);
    }
    const customUrl = settingsData?.helpCustomUrl?.trim();
    if (customUrl) prefixes.push(customUrl.replace(/\/+$/, ""));
    if (prefixes.length === 0) return [];
    return (resources ?? []).filter(
      (r) =>
        r.type === "webpage" &&
        r.url &&
        prefixes.some((p) => r.url === p || r.url!.startsWith(`${p}/`)),
    );
  }, [resources, projectData, settingsData]);

  const removeDuplicates = useMutation({
    mutationFn: async () => {
      for (const dupe of helpCenterDuplicates) {
        await fetch(`/api/projects/${projectId}/resources/${dupe.id}`, {
          method: "DELETE",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      toast.success("Duplicate sources removed");
    },
    onError: () => toast.error("Failed to remove duplicates"),
  });

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

  const typeIcons = {
    webpage: Globe,
    pdf: FileText,
    faq: HelpCircle,
  };

  const statusColors: Record<string, string> = {
    pending: "bg-status-waiting/10 text-status-waiting",
    crawling: "bg-status-replied/10 text-status-replied",
    indexed: "bg-status-active/10 text-status-active",
    failed: "bg-destructive/10 text-destructive",
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
    setGeneratedDraft(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleGenerated(draft: FaqDraft) {
    setGeneratedDraft(draft);
    setFormType("faq");
    setShowForm(true);
  }


  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <h1 className="text-balance text-xl font-bold text-foreground md:text-2xl">Knowledge</h1>
      </div>

      <CompanyCard
        projectId={projectId ?? ""}
        hasResources={(resources?.length ?? 0) > 0}
      />

      {helpCenterDuplicates.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-500/10 p-4">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              {helpCenterDuplicates.length} source
              {helpCenterDuplicates.length === 1 ? "" : "s"} duplicate
              {helpCenterDuplicates.length === 1 ? "s" : ""} your help center
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Published articles are already indexed for the AI. These crawled
              copies are redundant and can drift out of date.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => removeDuplicates.mutate()}
            disabled={removeDuplicates.isPending}
          >
            {removeDuplicates.isPending
              ? "Removing..."
              : `Remove ${helpCenterDuplicates.length}`}
          </Button>
        </div>
      )}

      {/* ─── Resources ──────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Sources</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowGenerateModal(true)}
            >
              <ListPlus className="w-4 h-4 mr-2" />
              Generate FAQ
            </Button>
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Resource
            </Button>
          </div>
        </div>

        <RowCard
          icon={<ArticlesIcon />}
          title="Help Center"
          summary={`${publishedArticles} published ${publishedArticles === 1 ? "article" : "articles"} · synced automatically`}
          to={projectRoute(projectId ?? "", "help-center")}
        />

        <FaqGenerateModal
          open={showGenerateModal}
          onOpenChange={setShowGenerateModal}
          projectId={projectId!}
          onGenerated={handleGenerated}
        />

        {showForm && (
          <div className="glass-card rounded-lg p-6 space-y-4">
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
                initialDraft={generatedDraft}
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
                  <Input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Resource title"
                    required
                  />
                  {formType === "webpage" && (
                    <Input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com/page"
                      required
                    />
                  )}
                  {formType === "pdf" && (
                    <div className="space-y-2">
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          // Outline, not a ring: box-shadow cannot be dashed,
                          // and the dashed edge is the drop-target affordance.
                          "relative flex flex-col items-center justify-center px-6 py-8 rounded-xl outline-2 outline-dashed -outline-offset-2 cursor-pointer transition-colors",
                          pdfFile
                            ? "outline-primary/50 bg-primary/5"
                            : "outline-input bg-background hover:outline-muted-foreground/50",
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
                className="h-16 rounded-xl bg-glass-button animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {resources?.map((resource) => {
              const Icon = typeIcons[resource.type];
              return (
                <RowCard
                  key={resource.id}
                  icon={<Icon className="size-4" />}
                  title={resource.title}
                  summary={resourceSummary(resource)}
                  trailing={
                    <span
                      className={cn(
                        "shrink-0 rounded-[6px] px-2 py-0.5 text-xs",
                        statusColors[resource.status] ?? statusColors.pending,
                      )}
                    >
                      {resource.status}
                    </span>
                  }
                  to={`${projectRoute(projectId ?? "", "knowledge")}/${resource.id}`}
                />
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
