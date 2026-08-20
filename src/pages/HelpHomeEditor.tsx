import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileMenuButton } from "@/components/PageHeader";
import { HelpEditorSkeleton } from "@/components/help-editor/editor-skeleton";
import {
  HomeBackgroundControl,
  parseHomeBackgroundFit,
  type HomeBackgroundValue,
} from "@/components/help-editor/home-background-control";
import { useSaveHotkey } from "@/hooks/use-save-hotkey";
import { defaultHelpHomeMarkdown } from "../../shared/help-home-markdown";

const HelpArticleEditor = lazy(
  () => import("@/components/help-article-editor"),
);

interface ProjectData {
  id: string;
  name: string;
  slug: string;
}

interface ProjectSettingsData {
  helpHomeMarkdown: string | null;
  helpHomeBackgroundUrl: string | null;
  helpHomeBackgroundPosition: string | null;
  helpHomeBackgroundFit: string | null;
  helpCustomUrl: string | null;
}

function homeBackgroundStyle(value: HomeBackgroundValue): CSSProperties {
  const fit = value.fit;
  return {
    "--help-home-bg-image": `url(${JSON.stringify(value.url)})`,
    "--help-home-bg-position": value.position ?? "50% 50%",
    "--help-home-bg-size": fit === "repeat" ? "auto" : fit,
    "--help-home-bg-repeat": fit === "repeat" ? "repeat" : "no-repeat",
  } as CSSProperties;
}

function appendHelpLiveCacheBust(href: string, version: number): string {
  const parsed = new URL(href, "https://replymaven.com");
  parsed.searchParams.set("v", String(version));
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return parsed.toString();
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function openHelpLivePreview(href: string): void {
  window.open(
    appendHelpLiveCacheBust(href, Date.now()),
    "_blank",
    "noopener,noreferrer",
  );
}

function HelpHomeEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [background, setBackground] = useState<HomeBackgroundValue>({
    url: null,
    position: null,
    fit: "cover",
  });
  const [savedBackground, setSavedBackground] = useState<HomeBackgroundValue>({
    url: null,
    position: null,
    fit: "cover",
  });
  const [ready, setReady] = useState(false);
  const [bodyImagesUploading, setBodyImagesUploading] = useState(false);

  const projectQuery = useQuery<ProjectData>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to load project");
      return res.json();
    },
    enabled: !!projectId,
  });

  const settingsQuery = useQuery<ProjectSettingsData>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
    enabled: !!projectId,
  });

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
    if (!projectQuery.data || !settingsQuery.data) return;
    const initial =
      settingsQuery.data.helpHomeMarkdown?.trim() ||
      defaultHelpHomeMarkdown(projectQuery.data.name);
    setContent(initial);
    setSaved(initial);
    const nextBackground: HomeBackgroundValue = {
      url: settingsQuery.data.helpHomeBackgroundUrl ?? null,
      position: settingsQuery.data.helpHomeBackgroundPosition ?? null,
      fit: parseHomeBackgroundFit(settingsQuery.data.helpHomeBackgroundFit),
    };
    setBackground(nextBackground);
    setSavedBackground(nextBackground);
    setReady(true);
  }, [projectQuery.data, settingsQuery.data]);

  const save = useMutation({
    mutationFn: async (input: {
      markdown: string;
      background: HomeBackgroundValue;
    }) => {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          helpHomeMarkdown: input.markdown,
          helpHomeBackgroundUrl: input.background.url,
          helpHomeBackgroundPosition: input.background.url
            ? input.background.position
            : null,
          helpHomeBackgroundFit: input.background.url
            ? input.background.fit
            : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to save" }));
        throw new Error((err as { error?: string }).error ?? "Failed to save");
      }
    },
    onSuccess: (_data, input) => {
      setSaved(input.markdown);
      setSavedBackground(input.background);
      queryClient.invalidateQueries({
        queryKey: ["project-settings", projectId],
      });
      toast.success("Home page saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const dirty = useMemo(
    () =>
      content !== saved ||
      background.url !== savedBackground.url ||
      background.position !== savedBackground.position ||
      background.fit !== savedBackground.fit,
    [content, saved, background, savedBackground],
  );
  const liveHref = settingsQuery.data?.helpCustomUrl
    ? settingsQuery.data.helpCustomUrl
    : projectQuery.data
      ? `/help/${projectQuery.data.slug}`
      : null;

  useSaveHotkey(() => {
    if (save.isPending || bodyImagesUploading || !dirty) return;
    save.mutate({ markdown: content, background });
  });

  const isLoading = !ready || projectQuery.isLoading || settingsQuery.isLoading;

  return (
    <div
      className={
        background.url
          ? "help-editor-page-shell help-editor-page-shell-home"
          : "help-editor-page-shell"
      }
      style={background.url ? homeBackgroundStyle(background) : undefined}
    >
      {background.url ? (
        <div
          className="help-editor-home-bg"
          data-fit={background.fit}
          aria-hidden="true"
        >
          {background.fit === "repeat" ? (
            <div className="help-editor-home-bg-fill" />
          ) : (
            <img
              className="help-editor-home-bg-img"
              src={background.url}
              alt=""
            />
          )}
        </div>
      ) : null}
      <header className="help-editor-page-bar">
        <div className="flex min-w-0 items-center gap-2">
          <MobileMenuButton />
          <Button asChild variant="ghost" size="sm" className="-ml-1">
            <Link to={`/app/projects/${projectId}/knowledgebase/help-center`}>
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Articles</span>
            </Link>
          </Button>
          <span className="hidden text-muted-foreground md:inline">/</span>
          <span className="hidden truncate text-sm text-muted-foreground md:inline">
            Home
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <HomeBackgroundControl
            value={background}
            onChange={setBackground}
            disabled={isLoading || save.isPending}
          />
          {liveHref && (
            <Button asChild variant="outline" size="sm">
              <a
                href={liveHref}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  openHelpLivePreview(liveHref);
                }}
              >
                <ExternalLink className="h-4 w-4" />
                <span className="hidden sm:inline">View live</span>
              </a>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() =>
              save.mutate({ markdown: content, background })
            }
            disabled={isLoading || save.isPending || bodyImagesUploading || !dirty}
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Save
          </Button>
        </div>
      </header>
      <main className="help-editor-page-main">
        {isLoading ? (
          <HelpEditorSkeleton />
        ) : (
          <Suspense fallback={<HelpEditorSkeleton />}>
            <HelpArticleEditor
              value={content}
              onChange={setContent}
              onUploadingChange={setBodyImagesUploading}
              variant="page"
              includeHomeBlocks
              placeholder="Write your home page…"
              accentColor={widgetConfigQuery.data?.primaryColor}
            />
          </Suspense>
        )}
      </main>
    </div>
  );
}

export default HelpHomeEditorPage;
