import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileMenuButton } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import type { DerivedMeta } from "@/components/help-article-editor";

const HelpArticleEditor = lazy(
  () => import("@/components/help-article-editor"),
);

interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
}

interface ArticleResponse {
  id: string;
  projectId: string;
  categoryId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  status: "draft" | "published";
  sortOrder: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ArticleFormState {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  categoryId: string;
  status: "draft" | "published";
}

const EXCERPT_MAX = 280;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function HelpArticleEditorPage() {
  const { projectId, articleId } = useParams<{
    projectId: string;
    articleId?: string;
  }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !articleId;

  const initialCategoryId = searchParams.get("categoryId") ?? "";

  const [form, setForm] = useState<ArticleFormState>({
    title: "",
    slug: "",
    excerpt: "",
    content: "",
    categoryId: initialCategoryId,
    status: "draft",
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [excerptTouched, setExcerptTouched] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<ArticleFormState | null>(
    null,
  );

  const categoriesQuery = useQuery<CategoryResponse[]>({
    queryKey: ["help-categories", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/help/categories`);
      if (!res.ok) throw new Error("Failed to load categories");
      return res.json();
    },
    enabled: !!projectId,
  });

  const articleQuery = useQuery<ArticleResponse>({
    queryKey: ["help-article", projectId, articleId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/help/articles/${articleId}`,
      );
      if (!res.ok) throw new Error("Failed to load article");
      return res.json();
    },
    enabled: !!projectId && !!articleId,
  });

  useEffect(() => {
    if (articleQuery.data) {
      const a = articleQuery.data;
      const next: ArticleFormState = {
        title: a.title,
        slug: a.slug,
        excerpt: a.excerpt ?? "",
        content: a.content,
        categoryId: a.categoryId,
        status: a.status,
      };
      setForm(next);
      setSavedSnapshot(next);
      setSlugTouched(true);
      setExcerptTouched(true);
    }
  }, [articleQuery.data]);

  // Auto-select first category for new articles when none picked.
  useEffect(() => {
    if (!isNew) return;
    if (form.categoryId) return;
    const first = categoriesQuery.data?.[0]?.id;
    if (first) setForm((f) => ({ ...f, categoryId: first }));
  }, [isNew, form.categoryId, categoriesQuery.data]);

  const createArticle = useMutation({
    mutationFn: async (input: ArticleFormState) => {
      const body: Record<string, unknown> = {
        categoryId: input.categoryId,
        title: input.title,
        content: input.content,
        status: input.status,
      };
      if (input.slug.trim()) body.slug = input.slug.trim();
      if (input.excerpt.trim()) body.excerpt = input.excerpt.trim();
      const res = await fetch(`/api/projects/${projectId}/help/articles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({
          error: "Failed to create article",
        }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to create article",
        );
      }
      return (await res.json()) as ArticleResponse;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({
        queryKey: ["help-articles", projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["help-categories", projectId],
      });
      toast.success("Article created");
      navigate(`/app/projects/${projectId}/help/articles/${created.id}`, {
        replace: true,
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateArticle = useMutation({
    mutationFn: async (input: Partial<ArticleFormState>) => {
      const body: Record<string, unknown> = {};
      if (input.title !== undefined) body.title = input.title;
      if (input.slug !== undefined) body.slug = input.slug.trim();
      if (input.excerpt !== undefined) {
        body.excerpt = input.excerpt.trim() || null;
      }
      if (input.content !== undefined) body.content = input.content;
      if (input.categoryId !== undefined) body.categoryId = input.categoryId;
      if (input.status !== undefined) body.status = input.status;
      const res = await fetch(
        `/api/projects/${projectId}/help/articles/${articleId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({
          error: "Failed to update article",
        }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to update article",
        );
      }
      return (await res.json()) as ArticleResponse;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({
        queryKey: ["help-articles", projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["help-article", projectId, articleId],
      });
      queryClient.invalidateQueries({
        queryKey: ["help-categories", projectId],
      });
      setSavedSnapshot({
        title: updated.title,
        slug: updated.slug,
        excerpt: updated.excerpt ?? "",
        content: updated.content,
        categoryId: updated.categoryId,
        status: updated.status,
      });
      toast.success("Saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleMetaChange = useCallback(
    (meta: DerivedMeta) => {
      setForm((f) => {
        const next = { ...f };
        if (meta.title !== f.title) next.title = meta.title;
        if (!slugTouched && meta.title) {
          const s = slugify(meta.title);
          if (s !== f.slug) next.slug = s;
        }
        if (!excerptTouched && meta.excerpt !== f.excerpt) {
          next.excerpt = meta.excerpt;
        }
        if (
          next.title === f.title &&
          next.slug === f.slug &&
          next.excerpt === f.excerpt
        ) {
          return f;
        }
        return next;
      });
    },
    [slugTouched, excerptTouched],
  );

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setForm((f) => ({
      ...f,
      slug: value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
    }));
  }

  function handleExcerptChange(value: string) {
    setExcerptTouched(true);
    setForm((f) => ({ ...f, excerpt: value.slice(0, EXCERPT_MAX) }));
  }

  function handleSave() {
    if (!form.title.trim()) {
      toast.error("Article needs a title (type one in the H1 line)");
      return;
    }
    if (!form.categoryId) {
      toast.error("Pick a category in Publish settings");
      return;
    }
    if (isNew) {
      createArticle.mutate(form);
    } else {
      updateArticle.mutate(form);
    }
  }

  function handleTogglePublish() {
    if (isNew || !articleId) {
      toast.error("Save the article before publishing");
      return;
    }
    if (dirty) {
      toast.error("Save your changes before publishing");
      return;
    }
    const nextStatus = form.status === "published" ? "draft" : "published";
    setForm((f) => ({ ...f, status: nextStatus }));
    updateArticle.mutate({ ...form, status: nextStatus });
  }

  const isLoading =
    (!isNew && articleQuery.isLoading) || categoriesQuery.isLoading;
  const saving = createArticle.isPending || updateArticle.isPending;
  const dirty = useMemo(
    () =>
      !savedSnapshot ||
      savedSnapshot.title !== form.title ||
      savedSnapshot.slug !== form.slug ||
      savedSnapshot.excerpt !== form.excerpt ||
      savedSnapshot.content !== form.content ||
      savedSnapshot.categoryId !== form.categoryId ||
      savedSnapshot.status !== form.status,
    [savedSnapshot, form],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const categories = categoriesQuery.data ?? [];

  return (
    <div className="help-editor-page-shell">
      <header className="help-editor-page-bar">
        <div className="flex items-center gap-2 min-w-0">
          <MobileMenuButton />
          <Button asChild variant="ghost" size="sm" className="-ml-1">
            <Link to={`/app/projects/${projectId}/help`}>
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Help Center</span>
            </Link>
          </Button>
          <span className="text-muted-foreground hidden md:inline">/</span>
          <span className="text-sm text-muted-foreground truncate hidden md:inline">
            {form.title || (isNew ? "New article" : "Untitled article")}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "text-xs font-medium px-2 py-1 rounded-full",
              form.status === "published"
                ? "bg-green-500/15 text-green-700 dark:text-green-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {form.status === "published" ? "Published" : "Draft"}
          </span>

          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Settings2 className="w-4 h-4" />
                <span className="hidden sm:inline">Publish settings</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="article-category">Category</Label>
                  <Select
                    value={form.categoryId}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, categoryId: v }))
                    }
                  >
                    <SelectTrigger id="article-category">
                      <SelectValue placeholder="Pick a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="article-slug">URL slug</Label>
                  <Input
                    id="article-slug"
                    value={form.slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    placeholder="getting-started"
                    maxLength={80}
                  />
                  <p className="text-xs text-muted-foreground">
                    Auto-generated from the title — edit to override.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="article-excerpt">Excerpt</Label>
                  <textarea
                    id="article-excerpt"
                    value={form.excerpt}
                    onChange={(e) => handleExcerptChange(e.target.value)}
                    maxLength={EXCERPT_MAX}
                    rows={4}
                    placeholder="One-line summary shown in listings and search."
                    className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {form.excerpt.length} / {EXCERPT_MAX}
                  </p>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTogglePublish}
            disabled={isNew || saving || dirty}
            title={dirty ? "Save your changes before publishing" : undefined}
          >
            {form.status === "published" ? "Unpublish" : "Publish"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving || (!dirty && !isNew)}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </header>

      <main className="help-editor-page-main">
        <Suspense
          fallback={
            <div className="min-h-[60vh] flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <HelpArticleEditor
            value={form.content}
            onChange={(md) => setForm((f) => ({ ...f, content: md }))}
            onMetaChange={handleMetaChange}
            variant="page"
          />
        </Suspense>
      </main>
    </div>
  );
}

export default HelpArticleEditorPage;
