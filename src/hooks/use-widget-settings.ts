import type { Dispatch, RefObject, SetStateAction } from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
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

export interface WidgetSettingsState {
  project?: ProjectData;
  form: Partial<WidgetConfigData>;
  authors?: AuthorOption[];
  avatarUploading: boolean;
  bannerUploading: boolean;
  pageInput: string;
  previewMode: "home" | "chat";
  previewHtml: string;
  embedSnippet: string;
  isLoading: boolean;
  avatarInputRef: RefObject<HTMLInputElement | null>;
  bannerInputRef: RefObject<HTMLInputElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  save: UseMutationResult<WidgetConfigData, Error, void>;
  setPageInput: Dispatch<SetStateAction<string>>;
  setPreviewMode: Dispatch<SetStateAction<"home" | "chat">>;
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

function buildPreviewHtml(options: {
  projectSlug: string;
  form: Partial<WidgetConfigData>;
  greetings: PreviewGreetingPayload[];
  previewMode: "home" | "chat";
}): string {
  const firstGreeting = options.greetings[0] ?? null;

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

  return `<!DOCTYPE html>
<html><head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 100%; height: 100vh;
    background: #1a1a1a;
    background-image: radial-gradient(circle, #333 1px, transparent 1px);
    background-size: 20px 20px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
</style>
</head><body>
<script>
  var cfg = ${JSON.stringify(configPayload)};
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.includes('/api/widget/') && url.includes('/config')) {
      return Promise.resolve(new Response(JSON.stringify(cfg), {
        headers: { 'Content-Type': 'application/json' }
      }));
    }
    return origFetch.call(this, url, opts);
  };
  // Reset dismissed greetings on each preview render so the popup re-shows.
  try {
    Object.keys(localStorage).forEach(function (k) {
      if (k.indexOf('rm:') === 0 && k.indexOf(':greetings_dismissed') !== -1) {
        localStorage.removeItem(k);
      }
    });
  } catch (e) {}
</script>
<script src="https://widget.replymaven.com/widget-embed.js" data-project="${options.projectSlug}"></script>
<script>
  var mode = "${options.previewMode}";
  var waitForWidget = setInterval(function() {
    if (window.ReplyMaven) {
      clearInterval(waitForWidget);
      if (mode === "chat") {
        setTimeout(function() { window.ReplyMaven.open(); }, 300);
      }
    }
  }, 100);
</script>
</body></html>`;
}

export function useWidgetSettings(projectId: string): WidgetSettingsState {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Partial<WidgetConfigData>>({});
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [pageInput, setPageInput] = useState("");
  const [previewMode, setPreviewMode] = useState<"home" | "chat">("home");
  const [previewGreetings, setPreviewGreetings] = useState<GreetingData[]>([]);
  const [debouncedPreviewState, setDebouncedPreviewState] = useState<{
    form: Partial<WidgetConfigData>;
    greetings: GreetingData[];
  }>({
    form: {},
    greetings: [],
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
      setDebouncedPreviewState({ form, greetings: previewGreetings });
    }, 500);

    return () => clearTimeout(timer);
  }, [form, previewGreetings]);

  useEffect(() => {
    if (form.position === "center-inline") {
      setPreviewMode("chat");
    } else {
      setPreviewMode("home");
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

    const previewPayload: PreviewGreetingPayload[] = debouncedPreviewState.greetings
      .filter((g) => g.enabled)
      .map((g) => ({
        id: g.id,
        enabled: g.enabled,
        imageUrl: g.imageUrl,
        title: g.title,
        description: g.description,
        ctaText: g.ctaText,
        ctaLink: g.ctaLink,
        author: g.authorId ? authorMap.get(g.authorId) ?? null : null,
        allowedPages: g.allowedPages,
        delaySeconds: g.delaySeconds,
        durationSeconds: g.durationSeconds,
        sortOrder: g.sortOrder,
      }));

    return buildPreviewHtml({
      projectSlug: project?.slug ?? "preview",
      form: debouncedPreviewState.form,
      greetings: previewPayload,
      previewMode,
    });
  }, [debouncedPreviewState, previewMode, project?.slug, authors]);

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
      updateForm({ [field]: url } as Partial<WidgetConfigData>);
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

  return {
    project,
    form,
    authors,
    avatarUploading,
    bannerUploading,
    pageInput,
    previewMode,
    previewHtml,
    embedSnippet,
    isLoading,
    avatarInputRef,
    bannerInputRef,
    iframeRef,
    save,
    setPageInput,
    setPreviewMode,
    setPreviewGreetings,
    updateForm,
    handleImageUpload,
    uploadAvatar,
    uploadBanner,
  };
}
