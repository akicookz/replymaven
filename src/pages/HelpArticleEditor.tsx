import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Eye, ImagePlus, Loader2, RefreshCw, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileMenuButton } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { useSaveHotkey } from "@/hooks/use-save-hotkey";
import type { DerivedMeta } from "@/components/help-article-editor";
import { extractFirstImage } from "../../shared/extract-first-image";
import {
  dimensionOgImageWarnings,
  sizeOgImageWarnings,
  staticOgImageWarnings,
  typeOgImageWarnings,
} from "@/lib/help-og-image-warnings";

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
  ogImageUrl: string | null;
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
  ogImageUrl: string;
  content: string;
  categoryId: string;
  status: "draft" | "published";
}

const TITLE_MAX = 200;
const TITLE_WARN = 60;
const EXCERPT_MAX = 280;
const EXCERPT_WARN = 160;
const OG_IMAGE_MAX = 2048;

function formFromArticle(a: ArticleResponse): ArticleFormState {
  return {
    title: a.title,
    slug: a.slug,
    excerpt: a.excerpt ?? "",
    ogImageUrl: a.ogImageUrl ?? "",
    content: a.content,
    categoryId: a.categoryId,
    status: a.status,
  };
}

function SeoWarnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((warning) => (
        <li
          key={warning}
          className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  );
}

function useOgImageWarnings(url: string): string[] {
  const [probed, setProbed] = useState<string[]>([]);

  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setProbed([]);
      return;
    }
    let cancelled = false;

    async function run() {
      const extra: string[] = [];
      try {
        const size = await new Promise<{ width: number; height: number }>(
          (resolve, reject) => {
            const img = new Image();
            img.onload = () =>
              resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => reject(new Error("load failed"));
            img.src = trimmed;
          },
        );
        extra.push(...dimensionOgImageWarnings(size.width, size.height));
      } catch {
        extra.push("Could not load this image. Check the URL.");
      }
      try {
        const res = await fetch(trimmed, { method: "HEAD" });
        if (res.ok) {
          const type = res.headers.get("content-type");
          if (type) extra.push(...typeOgImageWarnings(type));
          const len = res.headers.get("content-length");
          if (len) extra.push(...sizeOgImageWarnings(Number(len)));
        }
      } catch {
        // Missing HEAD or CORS. Dimensions already cover the common case.
      }
      if (!cancelled) setProbed(extra);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return [...staticOgImageWarnings(url), ...probed];
}

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
    ogImageUrl: "",
    content: "",
    categoryId: initialCategoryId,
    status: "draft",
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [excerptTouched, setExcerptTouched] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<ArticleFormState | null>(
    null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Body images upload asynchronously; until they land the content holds
  // `blob:` URLs that would be persisted as dead links.
  const [bodyImagesUploading, setBodyImagesUploading] = useState(false);
  const [ogImageUploading, setOgImageUploading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ogImageInputRef = useRef<HTMLInputElement | null>(null);

  const defaultOgImageUrl = extractFirstImage(form.content)?.url ?? "";
  const effectiveOgImageUrl = form.ogImageUrl.trim() || defaultOgImageUrl;
  const ogImageWarnings = useOgImageWarnings(
    settingsOpen ? effectiveOgImageUrl : "",
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

  // Published help pages tint links/badges with the widget primaryColor —
  // feed it to the editor so authoring matches the live look.
  const widgetConfigQuery = useQuery<{ primaryColor?: string | null }>({
    queryKey: ["widget-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/widget-config`);
      if (!res.ok) throw new Error("Failed to fetch widget config");
      return res.json();
    },
    enabled: !!projectId,
  });

  useEffect(() => {
    if (articleQuery.data) {
      const next = formFromArticle(articleQuery.data);
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
      if (input.ogImageUrl.trim()) body.ogImageUrl = input.ogImageUrl.trim();
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
      navigate(`/app/projects/${projectId}/knowledgebase/help-center/articles/${created.id}`, {
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
      if (input.ogImageUrl !== undefined) {
        body.ogImageUrl = input.ogImageUrl.trim() || null;
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
      setSavedSnapshot(formFromArticle(updated));
      setForm(formFromArticle(updated));
      setExcerptTouched(true);
      toast.success("Saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleMetaChange = useCallback(
    (meta: DerivedMeta) => {
      setForm((f) => {
        const next = { ...f };
        // Only an actual H1 renames the article. Articles imported with their
        // title in frontmatter have no H1 in the body, so deriveMeta returns
        // "" for them — without this guard that empty string overwrote the
        // stored title and the breadcrumb read "Untitled article".
        if (meta.title && meta.title !== f.title && !titleTouched) {
          next.title = meta.title;
        }
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
    [slugTouched, titleTouched, excerptTouched],
  );

  function handleTitleChange(value: string) {
    setTitleTouched(true);
    setForm((f) => ({ ...f, title: value.slice(0, TITLE_MAX) }));
  }

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

  async function handleOgImageUpload(file: File) {
    setOgImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? "Upload failed");
      }
      const body = (await res.json()) as { url: string };
      setForm((f) => ({ ...f, ogImageUrl: body.url.slice(0, OG_IMAGE_MAX) }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setOgImageUploading(false);
    }
  }

  function handleSave() {
    if (bodyImagesUploading || ogImageUploading) {
      toast.error("Wait for the image uploads to finish");
      return;
    }
    if (!form.title.trim()) {
      toast.error("Article needs a title");
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

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/help/articles/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: form.categoryId || null,
            title: form.title,
            slug: form.slug || undefined,
            excerpt: form.excerpt || null,
            ogImageUrl: form.ogImageUrl || null,
            content: form.content,
          }),
        },
      );
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to render preview" }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to render preview",
        );
      }
      setPreviewHtml(await res.text());
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : "Failed to render preview",
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [projectId, form]);

  function handleOpenPreview() {
    setPreviewOpen(true);
    void loadPreview();
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
      savedSnapshot.ogImageUrl !== form.ogImageUrl ||
      savedSnapshot.content !== form.content ||
      savedSnapshot.categoryId !== form.categoryId ||
      savedSnapshot.status !== form.status,
    [savedSnapshot, form],
  );

  useSaveHotkey(() => {
    if (
      isLoading ||
      saving ||
      bodyImagesUploading ||
      ogImageUploading ||
      (!dirty && !isNew)
    ) {
      return;
    }
    handleSave();
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const categories = categoriesQuery.data ?? [];
  const titleWarnings =
    form.title.length > TITLE_WARN
      ? [
          `Title is ${form.title.length} characters. Keep it under ${TITLE_WARN} so search and social results do not cut it off.`,
        ]
      : [];
  const descriptionWarnings =
    form.excerpt.length > EXCERPT_WARN
      ? [
          `Description is ${form.excerpt.length} characters. Keep it under ${EXCERPT_WARN} for search snippets.`,
        ]
      : [];

  return (
    <div className="help-editor-page-shell">
      <header className="help-editor-page-bar">
        <div className="flex items-center gap-2 min-w-0">
          <MobileMenuButton />
          <Button asChild variant="ghost" size="sm" className="-ml-1">
            <Link to={`/app/projects/${projectId}/knowledgebase/help-center`}>
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Articles</span>
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

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenPreview}
          >
            <Eye className="w-4 h-4" />
            <span className="hidden sm:inline">Preview</span>
          </Button>

          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Settings2 className="w-4 h-4" />
                <span className="hidden sm:inline">Publish settings</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-96 max-h-[min(36rem,calc(100vh-4rem))] overflow-y-auto"
            >
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
                    Auto-generated from the title. Edit to override.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="article-title">Title</Label>
                  <Input
                    id="article-title"
                    value={form.title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="Follows the H1 until you edit it"
                    maxLength={TITLE_MAX}
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {form.title.length} / {TITLE_MAX}
                  </p>
                  <SeoWarnings items={titleWarnings} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="article-description">Description</Label>
                  <textarea
                    id="article-description"
                    value={form.excerpt}
                    onChange={(e) => handleExcerptChange(e.target.value)}
                    maxLength={EXCERPT_MAX}
                    rows={3}
                    placeholder="First text line of the article, filled on save if empty."
                    className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {form.excerpt.length} / {EXCERPT_MAX}
                  </p>
                  <SeoWarnings items={descriptionWarnings} />
                </div>

                <div className="space-y-3 pt-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Open Graph
                  </p>

                  <div className="space-y-1.5">
                    <Label htmlFor="article-og-image">OG image</Label>
                    <div className="flex gap-2">
                      <Input
                        id="article-og-image"
                        value={form.ogImageUrl}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            ogImageUrl: e.target.value.slice(0, OG_IMAGE_MAX),
                          }))
                        }
                        placeholder={
                          defaultOgImageUrl ||
                          "First image in the article, filled on save"
                        }
                        maxLength={OG_IMAGE_MAX}
                      />
                      <input
                        ref={ogImageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/svg+xml"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void handleOgImageUpload(file);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        disabled={ogImageUploading}
                        onClick={() => ogImageInputRef.current?.click()}
                        aria-label="Upload OG image"
                      >
                        {ogImageUploading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ImagePlus className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                    {effectiveOgImageUrl ? (
                      <div className="mt-1 w-full overflow-hidden rounded-lg bg-muted aspect-[1200/630]">
                        <img
                          src={effectiveOgImageUrl}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      </div>
                    ) : null}
                    <SeoWarnings items={ogImageWarnings} />
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTogglePublish}
            disabled={
              isNew || saving || dirty || bodyImagesUploading || ogImageUploading
            }
            title={dirty ? "Save your changes before publishing" : undefined}
          >
            {form.status === "published" ? "Unpublish" : "Publish"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={
              saving ||
              bodyImagesUploading ||
              ogImageUploading ||
              (!dirty && !isNew)
            }
            title={
              bodyImagesUploading || ogImageUploading
                ? "Uploading images"
                : undefined
            }
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
            onUploadingChange={setBodyImagesUploading}
            variant="page"
            accentColor={widgetConfigQuery.data?.primaryColor}
          />
        </Suspense>
      </main>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full sm:max-w-3xl lg:max-w-5xl p-0 gap-0"
        >
          <SheetHeader className="flex-row items-center justify-between gap-3 px-4 py-2.5">
            <SheetTitle className="text-sm">Preview</SheetTitle>
            <SheetDescription className="sr-only">
              Live preview of how this article looks to your readers.
            </SheetDescription>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadPreview()}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Refresh
              </Button>
              <SheetClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Close preview"
                >
                  <X className="w-4 h-4" />
                </Button>
              </SheetClose>
            </div>
          </SheetHeader>
          <div className="relative flex-1 min-h-0 bg-muted/30">
            {previewError ? (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <p className="text-sm text-destructive">{previewError}</p>
              </div>
            ) : previewHtml ? (
              <iframe
                title="Article preview"
                srcDoc={previewHtml}
                className="w-full h-full border-0 bg-white"
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default HelpArticleEditorPage;
