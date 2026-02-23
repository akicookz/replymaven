import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Trash2,
  Save,
  Loader2,
  Globe,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CrawledPage {
  id: string;
  resourceId: string;
  projectId: string;
  url: string;
  r2Key: string | null;
  status: "pending" | "crawled" | "failed";
  depth: number;
  createdAt: string;
}

interface WebpageDetailProps {
  projectId: string;
  resourceId: string;
  resourceUrl: string;
  onRefreshAll?: () => void;
}

function WebpageResourceDetail({
  projectId,
  resourceId,
  resourceUrl,
  onRefreshAll,
}: WebpageDetailProps) {
  const queryClient = useQueryClient();

  const {
    data: pages,
    isLoading,
  } = useQuery<CrawledPage[]>({
    queryKey: ["crawled-pages", projectId, resourceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/pages`,
      );
      if (!res.ok) throw new Error("Failed to fetch pages");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 px-2">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Loading crawled pages...
        </span>
      </div>
    );
  }

  if (!pages || pages.length === 0) {
    return (
      <div className="py-4 px-2 text-sm text-muted-foreground">
        No pages crawled yet. The crawler may still be processing.
        <Button
          variant="outline"
          size="sm"
          className="ml-3"
          onClick={onRefreshAll}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Refresh All
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Globe className="w-3.5 h-3.5" />
          <span>
            {pages.length} page{pages.length !== 1 ? "s" : ""} crawled from{" "}
            <span className="font-medium text-foreground">{resourceUrl}</span>
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={onRefreshAll}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Refresh All
        </Button>
      </div>

      {pages.map((page) => (
        <CrawledPageItem
          key={page.id}
          page={page}
          projectId={projectId}
          resourceId={resourceId}
          queryClient={queryClient}
        />
      ))}
    </div>
  );
}

interface CrawledPageItemProps {
  page: CrawledPage;
  projectId: string;
  resourceId: string;
  queryClient: ReturnType<typeof useQueryClient>;
}

function CrawledPageItem({
  page,
  projectId,
  resourceId,
  queryClient,
}: CrawledPageItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string>("");
  const [hasEdits, setHasEdits] = useState(false);

  // Lazy-load content when expanded
  const { isLoading: isLoadingContent } = useQuery<{ content: string }>({
    queryKey: ["crawled-page-content", projectId, resourceId, page.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/pages/${page.id}/content`,
      );
      if (!res.ok) throw new Error("Failed to fetch content");
      const data = (await res.json()) as { content: string };
      setContent(data.content);
      setEditedContent(data.content);
      return data;
    },
    enabled: expanded && content === null && page.status === "crawled",
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/pages/${page.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editedContent }),
        },
      );
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      setContent(editedContent);
      setHasEdits(false);
      queryClient.invalidateQueries({
        queryKey: ["crawled-page-content", projectId, resourceId, page.id],
      });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/pages/${page.id}/refresh`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to refresh");
      return res.json();
    },
    onSuccess: () => {
      setContent(null);
      setHasEdits(false);
      queryClient.invalidateQueries({
        queryKey: ["crawled-pages", projectId, resourceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["crawled-page-content", projectId, resourceId, page.id],
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/pages/${page.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["crawled-pages", projectId, resourceId],
      });
    },
  });

  // Display the path relative to the base origin
  let displayPath = page.url;
  try {
    const url = new URL(page.url);
    displayPath = url.pathname + url.search + url.hash;
    if (displayPath === "/") displayPath = "/ (homepage)";
  } catch {
    // Keep full URL if parsing fails
  }

  const statusIcon = {
    pending: <Clock className="w-3.5 h-3.5 text-yellow-500" />,
    crawled: <CheckCircle className="w-3.5 h-3.5 text-green-500" />,
    failed: <XCircle className="w-3.5 h-3.5 text-red-500" />,
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        {statusIcon[page.status]}
        <span className="text-sm font-mono text-foreground truncate flex-1">
          {displayPath}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              refreshMutation.mutate();
            }}
            disabled={refreshMutation.isPending}
            className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-50"
            title="Refresh this page"
          >
            <RefreshCw
              className={cn(
                "w-3.5 h-3.5",
                refreshMutation.isPending && "animate-spin",
              )}
            />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-50"
            title="Delete this page"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 bg-muted/20">
          {page.status === "pending" && (
            <p className="text-sm text-muted-foreground">
              This page is still being crawled...
            </p>
          )}
          {page.status === "failed" && (
            <p className="text-sm text-destructive">
              Failed to crawl this page. Click refresh to retry.
            </p>
          )}
          {page.status === "crawled" && isLoadingContent && (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Loading content...
              </span>
            </div>
          )}
          {page.status === "crawled" && content !== null && (
            <div className="space-y-2">
              <textarea
                value={editedContent}
                onChange={(e) => {
                  setEditedContent(e.target.value);
                  setHasEdits(e.target.value !== content);
                }}
                rows={10}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {hasEdits && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditedContent(content);
                      setHasEdits(false);
                    }}
                  >
                    Discard
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WebpageResourceDetail;
