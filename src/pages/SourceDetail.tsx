import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, FileText, Globe, HelpCircle, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableBulkBar,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { MobileMenuButton } from "@/components/PageHeader";
import FaqEditor from "@/components/faq-editor";
import PdfResourceDetail from "@/components/pdf-detail";
import { projectRoute } from "@/lib/dashboard-routes";
import { formatTimeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

interface Source {
  id: string;
  type: "webpage" | "pdf" | "faq";
  title: string;
  url: string | null;
  status: "pending" | "crawling" | "indexed" | "failed";
  lastIndexedAt: string | null;
  pageCount?: number;
}

interface CrawledPage {
  id: string;
  url: string;
  pageTitle: string | null;
  status: "pending" | "crawled" | "failed" | "skipped";
  depth: number;
  createdAt: string;
  updatedAt: string | null;
}

type PageFilter = "all" | CrawledPage["status"];

const SOURCE_STATUS_STYLES: Record<Source["status"], string> = {
  pending: "bg-status-waiting/10 text-status-waiting",
  crawling: "bg-status-replied/10 text-status-replied",
  indexed: "bg-status-active/10 text-status-active",
  failed: "bg-destructive/10 text-destructive",
};

const PAGE_STATUS: Record<CrawledPage["status"], { label: string; className: string }> = {
  crawled: { label: "Indexed", className: "bg-status-active/10 text-status-active" },
  pending: { label: "Queued", className: "bg-status-waiting/10 text-status-waiting" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive" },
  skipped: { label: "Skipped", className: "bg-glass-button text-muted-foreground" },
};

const FILTER_ORDER: CrawledPage["status"][] = ["crawled", "failed", "skipped", "pending"];

const TYPE_ICONS = { webpage: Globe, pdf: FileText, faq: HelpCircle };

function Badge({ className, children }: { className: string; children: string }) {
  return (
    <span className={cn("inline-flex rounded-[6px] px-2 py-0.5 text-xs capitalize", className)}>
      {children}
    </span>
  );
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

export default function SourceDetail() {
  const { projectId = "", resourceId = "" } = useParams<{ projectId: string; resourceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const knowledgeHref = projectRoute(projectId, "knowledge");

  const { data: sources, isLoading } = useQuery<Source[]>({
    queryKey: ["resources", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources`);
      if (!res.ok) throw new Error("Failed to fetch resources");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
  const source = sources?.find((item) => item.id === resourceId) ?? null;

  const reindex = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources/${resourceId}/reindex`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to start indexing");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      queryClient.invalidateQueries({ queryKey: ["crawled-pages", projectId, resourceId] });
      toast.success(source?.type === "webpage" ? "Re-crawling" : "Indexing started");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources/${resourceId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete source");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      toast.success(`Deleted ${source?.title ?? "source"}`);
      navigate(knowledgeHref, { replace: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-glass-button" />;
  }
  if (!source) {
    return (
      <div className="space-y-4">
        <Link to={knowledgeHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />
          Knowledge
        </Link>
        <p className="text-sm text-muted-foreground">This source no longer exists.</p>
      </div>
    );
  }

  const Icon = TYPE_ICONS[source.type];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          to={knowledgeHref}
          className="-ml-1 inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Knowledge
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <MobileMenuButton />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-foreground md:text-2xl">{source.title}</h1>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Icon className="size-4 shrink-0" />
                {source.url && (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate hover:text-foreground"
                  >
                    {source.url}
                  </a>
                )}
                <Badge className={SOURCE_STATUS_STYLES[source.status]}>{source.status}</Badge>
                {source.lastIndexedAt && <span>Indexed {formatTimeAgo(source.lastIndexedAt)}</span>}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => reindex.mutate()}
            disabled={reindex.isPending}
            className="shrink-0"
          >
            <RefreshCw className={cn("size-4", reindex.isPending && "animate-spin")} />
            {source.type === "webpage" ? "Re-crawl" : "Re-index"}
          </Button>
        </div>
      </div>

      {source.type === "webpage" && (
        <CrawledPagesTable projectId={projectId} resourceId={resourceId} />
      )}
      {source.type === "faq" && (
        <div className="glass-card rounded-lg p-6">
          <FaqEditor projectId={projectId} resourceId={resourceId} mode="edit" />
        </div>
      )}
      {source.type === "pdf" && (
        <div className="glass-card rounded-lg p-6">
          <PdfResourceDetail projectId={projectId} resourceId={resourceId} resourceTitle={source.title} />
        </div>
      )}

      <div className="glass-card flex flex-col gap-4 rounded-lg p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Delete source</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Maven stops using it right away. This cannot be undone.
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={() => {
            if (window.confirm(`Delete ${source.title}?`)) remove.mutate();
          }}
          disabled={remove.isPending}
          className="shrink-0"
        >
          {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          Delete source
        </Button>
      </div>
    </div>
  );
}

// ─── Crawled pages ────────────────────────────────────────────────────────────

function CrawledPagesTable({ projectId, resourceId }: { projectId: string; resourceId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<PageFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pagesKey = ["crawled-pages", projectId, resourceId];

  const { data: pages, isLoading } = useQuery<CrawledPage[]>({
    queryKey: pagesKey,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources/${resourceId}/pages`);
      if (!res.ok) throw new Error("Failed to fetch pages");
      return res.json();
    },
  });

  const bulk = useMutation({
    mutationFn: async (action: "refresh" | "remove") => {
      const ids = [...selected];
      const results = await Promise.all(
        ids.map((id) =>
          fetch(
            `/api/projects/${projectId}/resources/${resourceId}/pages/${id}${action === "refresh" ? "/refresh" : ""}`,
            { method: action === "refresh" ? "POST" : "DELETE" },
          ),
        ),
      );
      const failed = results.filter((res) => !res.ok).length;
      return { action, done: ids.length - failed, failed };
    },
    onSuccess: ({ action, done, failed }) => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: pagesKey });
      queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
      const verb = action === "refresh" ? "Re-crawling" : "Removed";
      toast.success(`${verb} ${done} ${done === 1 ? "page" : "pages"}`);
      if (failed > 0) toast.error(`${failed} ${failed === 1 ? "page" : "pages"} failed`);
    },
  });

  const all = pages ?? [];
  const counts = new Map<CrawledPage["status"], number>();
  for (const page of all) counts.set(page.status, (counts.get(page.status) ?? 0) + 1);

  const filterOptions = [
    { value: "all" as PageFilter, label: `All ${all.length.toLocaleString()}` },
    ...FILTER_ORDER.filter((status) => (counts.get(status) ?? 0) > 0).map((status) => ({
      value: status as PageFilter,
      label: `${PAGE_STATUS[status].label} ${(counts.get(status) ?? 0).toLocaleString()}`,
    })),
  ];

  const needle = query.trim().toLowerCase();
  const rows = all
    .filter((page) => filter === "all" || page.status === filter)
    .filter(
      (page) =>
        needle === "" ||
        page.url.toLowerCase().includes(needle) ||
        (page.pageTitle ?? "").toLowerCase().includes(needle),
    )
    .sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));

  const columns: DataTableColumn<CrawledPage>[] = [
    {
      id: "page",
      header: "Page",
      cell: (page) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{page.pageTitle || pathOf(page.url)}</p>
          <p className="truncate text-xs text-muted-foreground">{pathOf(page.url)}</p>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      className: "w-28",
      cell: (page) => (
        <Badge className={PAGE_STATUS[page.status].className}>{PAGE_STATUS[page.status].label}</Badge>
      ),
    },
    {
      id: "depth",
      header: "Depth",
      className: "w-20 tabular-nums text-muted-foreground",
      cell: (page) => page.depth,
    },
    {
      id: "updated",
      header: "Updated",
      className: "w-28 text-muted-foreground",
      cell: (page) => formatTimeAgo(page.updatedAt ?? page.createdAt),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label="Filter pages"
          value={filter}
          options={filterOptions}
          onValueChange={(value) => {
            setFilter(value);
            setSelected(new Set());
          }}
        />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages"
            className="pl-9"
            aria-label="Search pages"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-lg bg-glass-button" />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(page) => page.id}
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={(page) =>
            navigate(`${projectRoute(projectId, "knowledge")}/${resourceId}/pages/${page.id}`)
          }
          empty={needle || filter !== "all" ? "No pages match." : "No pages crawled yet. The crawler may still be running."}
        />
      )}

      {selected.size > 0 && (
        <DataTableBulkBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => bulk.mutate("refresh")}>
            <RefreshCw className="size-4" />
            Re-crawl
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={bulk.isPending}
            onClick={() => bulk.mutate("remove")}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
            Remove
          </Button>
        </DataTableBulkBar>
      )}
    </div>
  );
}
