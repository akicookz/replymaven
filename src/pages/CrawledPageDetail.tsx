import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MobileMenuButton } from "@/components/PageHeader";
import { projectRoute } from "@/lib/dashboard-routes";

interface CrawledPage {
  id: string;
  url: string;
  pageTitle: string | null;
  status: "pending" | "crawled" | "failed" | "skipped";
}

interface SourceSummary {
  id: string;
  title: string;
}

export default function CrawledPageDetail() {
  const { projectId = "", resourceId = "", pageId = "" } = useParams<{
    projectId: string;
    resourceId: string;
    pageId: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sourceHref = `${projectRoute(projectId, "knowledge")}/${resourceId}`;
  const pagesKey = ["crawled-pages", projectId, resourceId];
  const contentKey = ["crawled-page-content", projectId, resourceId, pageId];
  const [draft, setDraft] = useState("");

  const { data: sources } = useQuery<SourceSummary[]>({
    queryKey: ["resources", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources`);
      if (!res.ok) throw new Error("Failed to fetch resources");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
  const sourceTitle = sources?.find((item) => item.id === resourceId)?.title ?? "Source";

  const { data: pages } = useQuery<CrawledPage[]>({
    queryKey: pagesKey,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources/${resourceId}/pages`);
      if (!res.ok) throw new Error("Failed to fetch pages");
      return res.json();
    },
  });
  const page = pages?.find((item) => item.id === pageId);

  const { data: content, isLoading } = useQuery<string>({
    queryKey: contentKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/pages/${pageId}/content`,
      );
      if (!res.ok) throw new Error("Failed to load page content");
      const body = (await res.json()) as { content: string };
      return body.content;
    },
  });

  useEffect(() => {
    if (content !== undefined) setDraft(content);
  }, [content]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources/${resourceId}/pages/${pageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error("Failed to save page");
    },
    onSuccess: () => {
      queryClient.setQueryData(contentKey, draft);
      toast.success("Page saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/pages/${pageId}/refresh`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to re-crawl page");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pagesKey });
      toast.success("Re-crawling this page");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources/${resourceId}/pages/${pageId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove page");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pagesKey });
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      toast.success("Page removed");
      navigate(sourceHref, { replace: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const dirty = content !== undefined && draft !== content;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          to={sourceHref}
          className="-ml-1 inline-flex max-w-full items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4 shrink-0" />
          <span className="truncate">{sourceTitle}</span>
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <MobileMenuButton />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-foreground md:text-2xl">
                {page?.pageTitle || page?.url || "Page"}
              </h1>
              {page && (
                <a
                  href={page.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  <span className="truncate">{page.url}</span>
                  <ExternalLink className="size-3.5 shrink-0" />
                </a>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              <RefreshCw className={refresh.isPending ? "size-4 animate-spin" : "size-4"} />
              Re-crawl
            </Button>
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="h-96 animate-pulse rounded-lg bg-glass-button" />
      ) : (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Page content"
          className="min-h-[60vh] font-mono text-xs leading-5"
        />
      )}

      <div className="flex justify-start">
        <Button
          variant="ghost"
          onClick={() => {
            if (window.confirm("Remove this page from the source?")) remove.mutate();
          }}
          disabled={remove.isPending}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          Remove page
        </Button>
      </div>
    </div>
  );
}
