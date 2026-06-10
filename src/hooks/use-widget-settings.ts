import type { Dispatch, RefObject, SetStateAction } from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useTheme } from "@/lib/theme";
import type { GreetingData } from "./use-greetings";

export interface WidgetConfigData {
  id: string;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  headerText: string;
  headerSubtitle: string | null;
  avatarUrl: string | null;
  position: "bottom-right" | "bottom-left" | "center-inline";
  borderRadius: number;
  fontFamily: string;
  customCss: string | null;
  bannerUrl: string | null;
  bannerPosition: string | null;
  homeTitle: string;
  homeSubtitle: string | null;
  allowedPages: string | null;
  backgroundStyle: "solid" | "blurred";
}

export interface AuthorOption {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  workTitle: string | null;
}

interface ProjectData {
  slug: string;
}

export const BACKGROUND_STYLES = [
  {
    value: "solid" as const,
    label: "Solid",
    description: "Clean opaque background",
  },
  {
    value: "blurred" as const,
    label: "Blurred",
    description: "Frosted glass effect",
  },
] as const;

export type WidgetPreviewMode = "launcher" | "open";

export interface WidgetSettingsOptions {
  /**
   * Preview state the page starts on: "launcher" shows the closed trigger
   * with greeting/intro popups, "open" shows the widget opened on its home
   * screen. Center-inline widgets always preview as "open".
   */
  defaultPreviewMode?: WidgetPreviewMode;
}

export interface WidgetSettingsState {
  project?: ProjectData;
  form: Partial<WidgetConfigData>;
  authors?: AuthorOption[];
  avatarUploading: boolean;
  bannerUploading: boolean;
  previewMode: WidgetPreviewMode;
  previewPagePath: string;
  previewHtml: string;
  embedSnippet: string;
  isLoading: boolean;
  avatarInputRef: RefObject<HTMLInputElement | null>;
  bannerInputRef: RefObject<HTMLInputElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  save: UseMutationResult<WidgetConfigData, Error, void>;
  setPreviewMode: Dispatch<SetStateAction<WidgetPreviewMode>>;
  setPreviewPagePath: Dispatch<SetStateAction<string>>;
  replayPreview: () => void;
  setPreviewGreetings: (greetings: GreetingData[]) => void;
  updateForm: (updates: Partial<WidgetConfigData>) => void;
  handleImageUpload: (
    file: File,
    setUploading: (value: boolean) => void,
    field: "avatarUrl" | "bannerUrl",
  ) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  uploadBanner: (file: File) => Promise<void>;
}

interface PreviewGreetingPayload {
  id: string;
  enabled: boolean;
  imageUrl: string | null;
  imagePosition: string | null;
  imageAspect: "landscape" | "square" | null;
  title: string;
  description: string | null;
  ctaText: string | null;
  ctaLink: string | null;
  author: {
    id: string;
    name: string;
    avatar: string | null;
    workTitle: string | null;
  } | null;
  allowedPages: string[] | null;
  delaySeconds: number;
  durationSeconds: number;
  sortOrder: number;
}

// In dev the preview loads the locally built bundle (public/widget-embed.js,
// same file test-widget.html uses — keep it fresh with `bun run widget:watch`)
// so widget changes show up without deploying. The widget derives its API base
// from the script origin, so API calls go to the local worker too.
const WIDGET_SCRIPT_URL = import.meta.env.DEV
  ? "/widget-embed.js"
  : "https://widget.replymaven.com/widget-embed.js";

// Mirrors --background in src/theme.css so the preview backdrop matches the app
const PREVIEW_BACKDROP = {
  light: { background: "oklch(98.5% 0.002 80)", dot: "oklch(87% 0.004 80)" },
  dark: { background: "#08080a", dot: "#2c2c30" },
} as const;

// Mirrors matchesCurrentPage in widget/index.ts. The preview iframe runs at
// about:srcdoc, so page-visibility rules are evaluated here against the
// simulated path instead of letting the widget check window.location.
function matchesPagePatterns(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return path === prefix || path.startsWith(prefix + "/");
    }
    return path === pattern;
  });
}

function normalizePagePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPreviewHtml(options: {
  projectSlug: string;
  form: Partial<WidgetConfigData>;
  greetings: PreviewGreetingPayload[];
  previewMode: WidgetPreviewMode;
  theme: "light" | "dark";
  pagePath: string;
  hiddenByPageRules: boolean;
  replayNonce: number;
}): string {
  const backdrop = PREVIEW_BACKDROP[options.theme];
  // The widget derives the in-thread intro from the first compact greeting
  // (no image, no CTA) — see widget/index.ts. Mirror that so the legacy
  // introMessage fallback fields don't diverge from real behavior.
  const firstGreeting =
    options.greetings.find((g) => !g.imageUrl && !g.ctaText && !g.ctaLink) ??
    null;

  const configPayload = {
    widget: {
      primaryColor: options.form.primaryColor ?? "#2563eb",
      backgroundColor: options.form.backgroundColor ?? "#ffffff",
      textColor: options.form.textColor ?? "#ffffff",
      headerText: options.form.headerText ?? "Chat with us",
      headerSubtitle:
        options.form.headerSubtitle ?? "We typically reply instantly",
      avatarUrl: options.form.avatarUrl ?? null,
      position: options.form.position ?? "bottom-right",
      borderRadius: options.form.borderRadius ?? 16,
      fontFamily: options.form.fontFamily ?? "",
      customCss: options.form.customCss ?? null,
      bannerUrl: options.form.bannerUrl ?? null,
      bannerPosition: options.form.bannerPosition ?? null,
      homeTitle: options.form.homeTitle ?? "How can we help?",
      homeSubtitle: options.form.homeSubtitle ?? null,
      backgroundStyle: options.form.backgroundStyle ?? "solid",
      allowedPages: null,
    },
    quickActions: [],
    greetings: options.greetings,
    introMessage: firstGreeting?.title ?? "",
    introMessageAuthor: firstGreeting?.author
      ? {
          name: firstGreeting.author.name,
          avatar: firstGreeting.author.avatar,
          workTitle: firstGreeting.author.workTitle,
        }
      : null,
    introMessageDelay: firstGreeting?.delaySeconds ?? 1,
    introMessageDuration: firstGreeting?.durationSeconds ?? 15,
    botName: null,
    contactForm: null,
  };

  const head = `<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 100%; height: 100vh;
    background: ${backdrop.background};
    background-image: radial-gradient(circle, ${backdrop.dot} 1px, transparent 1px);
    background-size: 20px 20px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
</style>
</head>`;

  if (options.hiddenByPageRules) {
    return `<!DOCTYPE html>
<html>${head}<body>
<div style="height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;">
  <div style="max-width: 280px; text-align: center; font-size: 13px; line-height: 1.5; color: ${options.theme === "dark" ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)"};">
    The widget is hidden on <code>${escapeHtml(options.pagePath)}</code> by your page visibility rules.
  </div>
</div>
</body></html>`;
  }

  // <-escape so greeting titles containing "</script>" can't break out
  // of the inline script tag.
  const cfgJson = JSON.stringify(configPayload).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html>${head}<body>
<!-- replay:${options.replayNonce} -->
<script>
  // The iframe is same-origin with the dashboard, so the widget would read
  // the dashboard's localStorage: dismissed greetings and conversations from
  // earlier preview sessions would suppress greeting cards (the widget only
  // renders them when no conversation exists). An in-memory shim gives every
  // preview load a clean slate without touching real storage.
  (function () {
    var mem = {};
    var shim = {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
      clear: function () { mem = {}; },
      key: function (i) { return Object.keys(mem)[i] || null; },
      get length() { return Object.keys(mem).length; }
    };
    try {
      Object.defineProperty(window, 'localStorage', {
        value: shim,
        configurable: true
      });
    } catch (e) {}
  })();

  var cfg = ${cfgJson};
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.includes('/api/widget/')) {
      if (url.includes('/config')) {
        return Promise.resolve(new Response(JSON.stringify(cfg), {
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      // Never restore a previously tested conversation into the preview.
      if (url.includes('/conversations/active')) {
        return Promise.resolve(new Response(JSON.stringify({ conversation: null }), {
          headers: { 'Content-Type': 'application/json' }
        }));
      }
    }
    return origFetch.call(this, url, opts);
  };
</script>
<script src="${WIDGET_SCRIPT_URL}" data-project="${options.projectSlug}"></script>
<script>
  var mode = "${options.previewMode}";
  var waitForWidget = setInterval(function() {
    if (window.ReplyMaven) {
      clearInterval(waitForWidget);
      if (mode === "open") {
        setTimeout(function() { window.ReplyMaven.open(); }, 300);
      }
    }
  }, 100);
</script>
</body></html>`;
}

export function useWidgetSettings(
  projectId: string,
  options?: WidgetSettingsOptions,
): WidgetSettingsState {
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const defaultPreviewMode = options?.defaultPreviewMode ?? "launcher";
  const [form, setForm] = useState<Partial<WidgetConfigData>>({});
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [previewMode, setPreviewMode] =
    useState<WidgetPreviewMode>(defaultPreviewMode);
  const [previewPagePath, setPreviewPagePath] = useState("/");
  const [previewGreetings, setPreviewGreetings] = useState<GreetingData[]>([]);
  const [replayNonce, setReplayNonce] = useState(0);
  const [debouncedPreviewState, setDebouncedPreviewState] = useState<{
    form: Partial<WidgetConfigData>;
    greetings: GreetingData[];
    pagePath: string;
  }>({
    form: {},
    greetings: [],
    pagePath: "/",
  });

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: project } = useQuery<ProjectData>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data, isLoading } = useQuery<WidgetConfigData>({
    queryKey: ["widget-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/widget-config`);
      if (!res.ok) throw new Error("Failed to fetch widget config");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: authors } = useQuery<AuthorOption[]>({
    queryKey: ["team-authors"],
    queryFn: async () => {
      const res = await fetch("/api/team/authors");
      if (!res.ok) throw new Error("Failed to fetch authors");
      return res.json();
    },
  });

  useEffect(() => {
    if (data) {
      setForm(data);
    }
  }, [data]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedPreviewState({
        form,
        greetings: previewGreetings,
        pagePath: previewPagePath,
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [form, previewGreetings, previewPagePath]);

  useEffect(() => {
    // Center-inline has no launcher state to preview. Only force the mode on
    // that transition so the user's manual toggle survives data loads and
    // unrelated form edits.
    if (form.position === "center-inline") {
      setPreviewMode("open");
    }
  }, [form.position]);

  const previewHtml = useMemo(() => {
    const authorMap = new Map(
      (authors ?? []).map((a) => [
        a.id,
        {
          id: a.id,
          name: a.name,
          avatar: a.avatar,
          workTitle: a.workTitle,
        },
      ]),
    );

    const pagePath = normalizePagePath(debouncedPreviewState.pagePath);

    // Widget-level page visibility — the whole widget hides on non-matching
    // pages, exactly like matchesCurrentPage in the embed script.
    const widgetPagePatterns = (debouncedPreviewState.form.allowedPages ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const hiddenByPageRules =
      widgetPagePatterns.length > 0 &&
      !matchesPagePatterns(pagePath, widgetPagePatterns);

    // Per-greeting page rules are resolved here against the simulated path,
    // then stripped so the widget doesn't re-check them against about:srcdoc.
    const previewPayload: PreviewGreetingPayload[] = debouncedPreviewState.greetings
      .filter((g) => g.enabled)
      .filter(
        (g) =>
          !g.allowedPages ||
          g.allowedPages.length === 0 ||
          matchesPagePatterns(pagePath, g.allowedPages),
      )
      .map((g) => ({
        id: g.id,
        enabled: g.enabled,
        imageUrl: g.imageUrl,
        imagePosition: g.imagePosition,
        imageAspect: g.imageAspect,
        title: g.title,
        description: g.description,
        ctaText: g.ctaText,
        ctaLink: g.ctaLink,
        author: g.authorId ? authorMap.get(g.authorId) ?? null : null,
        allowedPages: null,
        delaySeconds: g.delaySeconds,
        durationSeconds: g.durationSeconds,
        sortOrder: g.sortOrder,
      }));

    return buildPreviewHtml({
      projectSlug: project?.slug ?? "preview",
      form: debouncedPreviewState.form,
      greetings: previewPayload,
      previewMode,
      theme,
      pagePath,
      hiddenByPageRules,
      replayNonce,
    });
  }, [
    debouncedPreviewState,
    previewMode,
    project?.slug,
    authors,
    theme,
    replayNonce,
  ]);

  const save = useMutation<WidgetConfigData, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/widget-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) throw new Error("Failed to save widget config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["widget-config", projectId] });
    },
  });

  function updateForm(updates: Partial<WidgetConfigData>) {
    setForm((prev) => ({ ...prev, ...updates }));
  }

  async function handleImageUpload(
    file: File,
    setUploading: (value: boolean) => void,
    field: "avatarUrl" | "bannerUrl",
  ): Promise<void> {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const { url } = (await res.json()) as { url: string };
      const updates: Partial<WidgetConfigData> = { [field]: url };
      // A new banner starts centered — the old focal point is meaningless.
      if (field === "bannerUrl") updates.bannerPosition = null;
      updateForm(updates);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }

  const embedSnippet = `<script src="https://widget.replymaven.com/widget-embed.js" data-project="${project?.slug ?? "your-project"}"></script>`;

  async function uploadAvatar(file: File): Promise<void> {
    await handleImageUpload(file, setAvatarUploading, "avatarUrl");
  }

  async function uploadBanner(file: File): Promise<void> {
    await handleImageUpload(file, setBannerUploading, "bannerUrl");
  }

  // Bumping the nonce changes the iframe srcDoc, reloading the preview so
  // greeting delay/duration timers run again.
  function replayPreview(): void {
    setReplayNonce((n) => n + 1);
  }

  return {
    project,
    form,
    authors,
    avatarUploading,
    bannerUploading,
    previewMode,
    previewPagePath,
    previewHtml,
    embedSnippet,
    isLoading,
    avatarInputRef,
    bannerInputRef,
    iframeRef,
    save,
    setPreviewMode,
    setPreviewPagePath,
    replayPreview,
    setPreviewGreetings,
    updateForm,
    handleImageUpload,
    uploadAvatar,
    uploadBanner,
  };
}
