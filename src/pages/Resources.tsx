import { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  FileText,
  HelpCircle,
  Trash2,
  RefreshCw,
  Plus,
  Upload,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import FaqEditor from "@/components/faq-editor";
import WebpageResourceDetail from "@/components/webpage-detail";
import PdfResourceDetail from "@/components/pdf-detail";

interface Resource {
  id: string;
  type: "webpage" | "pdf" | "faq";
  title: string;
  url: string | null;
  content: string | null;
  status: "pending" | "crawling" | "indexed" | "failed";
  createdAt: string;
}

function Resources() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
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

  const { data: resources, isLoading } = useQuery<Resource[]>({
    queryKey: ["resources", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
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
          throw new Error(
            (err as { error?: string }).error ?? "Upload failed",
          );
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

      // FAQ is handled by FaqEditor component directly
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
    },
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
    },
  });

  const typeIcons = {
    webpage: Globe,
    pdf: FileText,
    faq: HelpCircle,
  };

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    crawling: "bg-blue-100 text-blue-700",
    indexed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Resources</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Resource
        </Button>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
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

          {/* FAQ form uses the FaqEditor component */}
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
                          pdfFile
                            ? "text-primary"
                            : "text-muted-foreground",
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      )}

      {/* Resource List */}
      {isLoading ? (
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
                className="bg-card/50 backdrop-blur-xl rounded-xl border border-border overflow-hidden"
              >
                {/* Resource Header Row */}
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
                      "text-xs px-2 py-0.5 rounded-full shrink-0",
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

                {/* Expanded Detail View */}
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
              No resources added yet. Add web pages, FAQs, or PDFs for your bot
              to learn from.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Resources;
