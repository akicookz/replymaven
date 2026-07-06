import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MobileMenuButton } from "@/components/PageHeader";
import HelpCategoryList, {
  type HelpCategoryItem,
  type SidebarArticle,
} from "@/components/help-category-list";
import HelpArticleList, {
  type HelpArticleItem,
} from "@/components/help-article-list";
import IconPicker from "@/components/icon-picker";

interface CategoryResponse {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  articleCount: number;
  createdAt: string;
  updatedAt: string;
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
  indexing: { status: string; lastIndexedAt: string | null } | null;
}

interface CategoryFormState {
  name: string;
  slug: string;
  description: string;
  icon: string | null;
}

const emptyCategoryForm: CategoryFormState = {
  name: "",
  slug: "",
  description: "",
  icon: null,
};

function firstImageFromMarkdown(markdown: string): string | null {
  if (!markdown) return null;
  const candidates: Array<{ idx: number; url: string }> = [];
  const mdRe = /!\[[^\]]*\]\((\S+?)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdRe.exec(markdown)) !== null) {
    candidates.push({ idx: m.index, url: m[1] });
  }
  const htmlRe = /<img\b[^>]*?\bsrc\s*=\s*"([^"]*)"/gi;
  while ((m = htmlRe.exec(markdown)) !== null) {
    candidates.push({ idx: m.index, url: m[1] });
  }
  candidates.sort((a, b) => a.idx - b.idx);
  for (const c of candidates) {
    const u = c.url.trim();
    if (/^https?:\/\//i.test(u) || u.startsWith("/") || /^data:image\//i.test(u)) {
      return u;
    }
  }
  return null;
}

function HelpCenter() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<CategoryResponse | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(
    emptyCategoryForm,
  );
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const categoriesQuery = useQuery<CategoryResponse[]>({
    queryKey: ["help-categories", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/help/categories`);
      if (!res.ok) throw new Error("Failed to load categories");
      return res.json();
    },
    enabled: !!projectId,
  });

  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );

  useEffect(() => {
    if (!selectedCategoryId && categories.length > 0) {
      setSelectedCategoryId(categories[0].id);
    } else if (
      selectedCategoryId &&
      !categories.find((c) => c.id === selectedCategoryId)
    ) {
      setSelectedCategoryId(categories[0]?.id ?? null);
    }
  }, [categories, selectedCategoryId]);

  const articlesQuery = useQuery<ArticleResponse[]>({
    queryKey: ["help-articles", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/help/articles`);
      if (!res.ok) throw new Error("Failed to load articles");
      return res.json();
    },
    enabled: !!projectId,
  });

  const allArticles = useMemo(
    () => articlesQuery.data ?? [],
    [articlesQuery.data],
  );

  const articlesByCategory = useMemo(() => {
    const map = new Map<string, SidebarArticle[]>();
    for (const a of allArticles) {
      const list = map.get(a.categoryId) ?? [];
      list.push({ id: a.id, title: a.title, status: a.status });
      map.set(a.categoryId, list);
    }
    return map;
  }, [allArticles]);

  const articles = useMemo(
    () => allArticles.filter((a) => a.categoryId === selectedCategoryId),
    [allArticles, selectedCategoryId],
  );

  const createCategory = useMutation({
    mutationFn: async (input: CategoryFormState) => {
      const body: Record<string, unknown> = { name: input.name };
      if (input.slug.trim()) body.slug = input.slug.trim();
      if (input.description.trim()) body.description = input.description.trim();
      if (input.icon !== null) body.icon = input.icon;
      const res = await fetch(`/api/projects/${projectId}/help/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({
          error: "Failed to create category",
        }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to create category",
        );
      }
      return (await res.json()) as CategoryResponse;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({
        queryKey: ["help-categories", projectId],
      });
      setSelectedCategoryId(created.id);
      setCategoryDialogOpen(false);
      setCategoryForm(emptyCategoryForm);
      setCategoryError(null);
      toast.success("Category created");
    },
    onError: (err: Error) => setCategoryError(err.message),
  });

  const updateCategory = useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<CategoryFormState>;
    }) => {
      const body: Record<string, unknown> = {};
      if (input.patch.name !== undefined) body.name = input.patch.name;
      if (input.patch.slug !== undefined) body.slug = input.patch.slug.trim();
      if (input.patch.description !== undefined) {
        body.description = input.patch.description.trim() || null;
      }
      if (input.patch.icon !== undefined) {
        body.icon = input.patch.icon;
      }
      const res = await fetch(
        `/api/projects/${projectId}/help/categories/${input.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({
          error: "Failed to update category",
        }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to update category",
        );
      }
      return (await res.json()) as CategoryResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["help-categories", projectId],
      });
      setCategoryDialogOpen(false);
      setEditingCategory(null);
      setCategoryForm(emptyCategoryForm);
      setCategoryError(null);
      toast.success("Category updated");
    },
    onError: (err: Error) => setCategoryError(err.message),
  });

  const archiveCategory = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/help/categories/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to archive category");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["help-categories", projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["help-articles", projectId],
      });
      toast.success("Category archived");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reorderCategories = useMutation({
    mutationFn: async (items: { id: string; sortOrder: number }[]) => {
      const res = await fetch(
        `/api/projects/${projectId}/help/categories/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        },
      );
      if (!res.ok) throw new Error("Failed to reorder categories");
    },
    onMutate: async (items) => {
      await queryClient.cancelQueries({
        queryKey: ["help-categories", projectId],
      });
      const prev = queryClient.getQueryData<CategoryResponse[]>([
        "help-categories",
        projectId,
      ]);
      if (prev) {
        const map = new Map(items.map((i) => [i.id, i.sortOrder]));
        const next = [...prev]
          .map((c) => ({ ...c, sortOrder: map.get(c.id) ?? c.sortOrder }))
          .sort((a, b) => a.sortOrder - b.sortOrder);
        queryClient.setQueryData(["help-categories", projectId], next);
      }
      return { prev };
    },
    onError: (_err, _items, context) => {
      if (context?.prev) {
        queryClient.setQueryData(
          ["help-categories", projectId],
          context.prev,
        );
      }
      toast.error("Failed to reorder categories");
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["help-categories", projectId],
      });
    },
  });

  const deleteArticle = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/help/articles/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete article");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["help-articles", projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["help-categories", projectId],
      });
      toast.success("Article deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reorderArticles = useMutation({
    mutationFn: async (items: { id: string; sortOrder: number }[]) => {
      if (!selectedCategoryId) return;
      const res = await fetch(
        `/api/projects/${projectId}/help/articles/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId: selectedCategoryId, items }),
        },
      );
      if (!res.ok) throw new Error("Failed to reorder articles");
    },
    onMutate: async (items) => {
      await queryClient.cancelQueries({
        queryKey: ["help-articles", projectId],
      });
      const prev = queryClient.getQueryData<ArticleResponse[]>([
        "help-articles",
        projectId,
      ]);
      if (prev) {
        const map = new Map(items.map((i) => [i.id, i.sortOrder]));
        const next = [...prev]
          .map((a) =>
            map.has(a.id) ? { ...a, sortOrder: map.get(a.id)! } : a,
          )
          .sort((a, b) => a.sortOrder - b.sortOrder);
        queryClient.setQueryData(["help-articles", projectId], next);
      }
      return { prev };
    },
    onError: (_err, _items, context) => {
      if (context?.prev) {
        queryClient.setQueryData(
          ["help-articles", projectId],
          context.prev,
        );
      }
      toast.error("Failed to reorder articles");
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["help-articles", projectId],
      });
    },
  });

  function openCreateCategory() {
    setEditingCategory(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryError(null);
    setCategoryDialogOpen(true);
  }

  function openEditCategory(cat: HelpCategoryItem) {
    const full = categories.find((c) => c.id === cat.id);
    if (!full) return;
    setEditingCategory(full);
    setCategoryForm({
      name: full.name,
      slug: full.slug,
      description: full.description ?? "",
      icon: full.icon,
    });
    setCategoryError(null);
    setCategoryDialogOpen(true);
  }

  function handleCategorySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryForm.name.trim()) {
      setCategoryError("Name is required");
      return;
    }
    if (editingCategory) {
      updateCategory.mutate({
        id: editingCategory.id,
        patch: categoryForm,
      });
    } else {
      createCategory.mutate(categoryForm);
    }
  }

  function handleArchiveCategory(cat: HelpCategoryItem) {
    if (
      !confirm(
        `Archive "${cat.name}"? Its ${cat.articleCount} article(s) will be hidden from your help center. Nothing is permanently deleted.`,
      )
    ) {
      return;
    }
    archiveCategory.mutate(cat.id);
  }

  function handleNewArticleInCategory(categoryId: string) {
    navigate(
      `/app/projects/${projectId}/help/articles/new?categoryId=${categoryId}`,
    );
  }

  function handleDeleteArticle(article: HelpArticleItem) {
    if (!confirm(`Delete article "${article.title}"?`)) return;
    deleteArticle.mutate(article.id);
  }

  function handleNewArticle() {
    if (!selectedCategoryId) {
      toast.error("Create a category first");
      return;
    }
    navigate(
      `/app/projects/${projectId}/help/articles/new?categoryId=${selectedCategoryId}`,
    );
  }

  const categoryItems: HelpCategoryItem[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    icon: c.icon,
    articleCount: c.articleCount,
    sortOrder: c.sortOrder,
  }));

  const articleItems: HelpArticleItem[] = articles.map((a) => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    excerpt: a.excerpt,
    status: a.status,
    sortOrder: a.sortOrder,
    thumbnail: firstImageFromMarkdown(a.content),
    indexing: a.indexing,
  }));

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <MobileMenuButton />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
              Articles
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Write help center articles. Published articles are indexed for
              the AI automatically.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/app/projects/${projectId}/help/settings`}>
              <Settings className="w-4 h-4" />
              Site settings
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openCreateCategory}
          >
            <Plus className="w-4 h-4" />
            New Category
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleNewArticle}
            disabled={!selectedCategoryId}
          >
            <Plus className="w-4 h-4" />
            New Article
          </Button>
        </div>
      </div>

      {categoriesQuery.isLoading ? (
        <div className="space-y-2">
          <div className="h-20 rounded-xl bg-muted/40 animate-pulse" />
          <div className="h-20 rounded-xl bg-muted/40 animate-pulse" />
        </div>
      ) : categories.length === 0 ? (
        <div className="rounded-2xl bg-card/50 backdrop-blur-xl border border-border px-8 py-16 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-muted/50 flex items-center justify-center">
            <BookOpen className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">No categories yet</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Categories group related articles. Create your first one to start
              writing.
            </p>
          </div>
          <Button type="button" onClick={openCreateCategory}>
            <Plus className="w-4 h-4" />
            Create your first category
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6 items-start">
          <aside className="space-y-3 md:sticky md:top-6">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
              Categories
            </h2>
            <HelpCategoryList
              projectId={projectId ?? ""}
              categories={categoryItems}
              articlesByCategory={articlesByCategory}
              selectedId={selectedCategoryId}
              onSelect={setSelectedCategoryId}
              onNewArticle={handleNewArticleInCategory}
              onEditCategory={openEditCategory}
              onArchiveCategory={handleArchiveCategory}
              onReorder={(items) => reorderCategories.mutate(items)}
            />
          </aside>

          <section className="space-y-4 min-w-0">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-foreground tracking-tight">
                {selectedCategory?.name ?? "Articles"}
              </h2>
              {selectedCategory?.description && (
                <p className="text-sm text-muted-foreground">
                  {selectedCategory.description}
                </p>
              )}
            </div>
            {articlesQuery.isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                <div className="h-48 rounded-xl bg-muted/40 animate-pulse" />
                <div className="h-48 rounded-xl bg-muted/40 animate-pulse" />
              </div>
            ) : (
              <HelpArticleList
                projectId={projectId ?? ""}
                articles={articleItems}
                onDelete={handleDeleteArticle}
                onReorder={(items) => reorderArticles.mutate(items)}
              />
            )}
          </section>
        </div>
      )}

      <Dialog
        open={categoryDialogOpen}
        onOpenChange={(open) => {
          setCategoryDialogOpen(open);
          if (!open) setCategoryError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? "Edit category" : "New category"}
            </DialogTitle>
            <DialogDescription>
              Categories group related articles in your help center.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCategorySubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="category-name">Name</Label>
              <Input
                id="category-name"
                value={categoryForm.name}
                onChange={(e) =>
                  setCategoryForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Billing"
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category-slug">
                URL slug{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="category-slug"
                value={categoryForm.slug}
                onChange={(e) =>
                  setCategoryForm((f) => ({
                    ...f,
                    slug: e.target.value.toLowerCase(),
                  }))
                }
                placeholder="billing"
                pattern="[a-z0-9-]*"
                maxLength={60}
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens. Auto-generated if left
                blank.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category-description">
                Description{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="category-description"
                value={categoryForm.description}
                onChange={(e) =>
                  setCategoryForm((f) => ({
                    ...f,
                    description: e.target.value,
                  }))
                }
                placeholder="Refunds, plans, and invoices"
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Icon{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <IconPicker
                value={categoryForm.icon}
                onChange={(v) =>
                  setCategoryForm((f) => ({ ...f, icon: v }))
                }
              />
            </div>
            {categoryError && (
              <p className="text-sm text-destructive">{categoryError}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCategoryDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createCategory.isPending || updateCategory.isPending}
              >
                {editingCategory ? "Save changes" : "Create category"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default HelpCenter;
