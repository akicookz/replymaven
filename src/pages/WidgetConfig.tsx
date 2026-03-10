import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Palette,
  Save,
  AlertCircle,
  CheckCircle2,
  Copy,
  Upload,
  Image,
  Type,
  X,
  Globe,
  Plus,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/color-picker";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface WidgetConfigData {
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

const BACKGROUND_STYLES = [
  { value: "solid" as const, label: "Solid", description: "Clean opaque background" },
  { value: "blurred" as const, label: "Blurred", description: "Frosted glass effect" },
] as const;

function WidgetConfig() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Partial<WidgetConfigData>>({});
  const [introMessage, setIntroMessage] = useState("Hi there! How can I help you today?");
  const [showIntroBubble, setShowIntroBubble] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [pageInput, setPageInput] = useState("");

  const [previewMode, setPreviewMode] = useState<"home" | "chat">("home");
  const [debouncedPreviewState, setDebouncedPreviewState] = useState<{
    form: Partial<WidgetConfigData>;
    introMessage: string;
    showIntroBubble: boolean;
  }>({ form: {}, introMessage: "Hi there! How can I help you today?", showIntroBubble: true });

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: project } = useQuery<{ slug: string }>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      return res.json();
    },
  });

  const { data, isLoading } = useQuery<WidgetConfigData>({
    queryKey: ["widget-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/widget-config`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: settingsData } = useQuery<{ introMessage?: string; showIntroBubble?: boolean }>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  useEffect(() => {
    if (settingsData?.introMessage != null) {
      setIntroMessage(settingsData.introMessage);
    }
    if (settingsData?.showIntroBubble != null) {
      setShowIntroBubble(settingsData.showIntroBubble);
    }
  }, [settingsData]);

  // Debounce preview updates (500ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedPreviewState({ form, introMessage, showIntroBubble });
    }, 500);
    return () => clearTimeout(timer);
  }, [form, introMessage, showIntroBubble]);

  // Reset preview mode when position changes
  useEffect(() => {
    if (form.position === "center-inline") {
      setPreviewMode("chat");
    } else {
      setPreviewMode("home");
    }
  }, [form.position]);

  // Build preview HTML for iframe
  const previewHtml = useMemo(() => {
    const slug = project?.slug ?? "preview";
    const f = debouncedPreviewState.form;
    const configPayload = {
      widget: {
        primaryColor: f.primaryColor ?? "#2563eb",
        backgroundColor: f.backgroundColor ?? "#ffffff",
        textColor: f.textColor ?? "#ffffff",
        headerText: f.headerText ?? "Chat with us",
        headerSubtitle: f.headerSubtitle ?? "We typically reply instantly",
        avatarUrl: f.avatarUrl ?? null,
        position: f.position ?? "bottom-right",
        borderRadius: f.borderRadius ?? 16,
        fontFamily: f.fontFamily ?? "",
        customCss: f.customCss ?? null,
        bannerUrl: f.bannerUrl ?? null,
        homeTitle: f.homeTitle ?? "How can we help?",
        homeSubtitle: f.homeSubtitle ?? null,
        backgroundStyle: f.backgroundStyle ?? "solid",
        allowedPages: null,
      },
      quickActions: [],
      introMessage: debouncedPreviewState.introMessage,
      showIntroBubble: debouncedPreviewState.showIntroBubble,
      botName: null,
      contactForm: null,
      bookingEnabled: false,
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
</script>
<script src="/api/widget-embed.js" data-project="${slug}"></script>
<script>
  var mode = "${previewMode}";
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
  }, [debouncedPreviewState, previewMode, project?.slug]);

  const save = useMutation({
    mutationFn: async () => {
      const [widgetRes, settingsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/widget-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }),
        fetch(`/api/projects/${projectId}/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ introMessage, showIntroBubble }),
        }),
      ]);
      if (!widgetRes.ok) throw new Error("Failed to save widget config");
      if (!settingsRes.ok) throw new Error("Failed to save settings");
      return widgetRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["widget-config", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-settings", projectId] });
    },
  });

  async function handleImageUpload(
    file: File,
    setUploading: (v: boolean) => void,
    field: "avatarUrl" | "bannerUrl",
  ) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
      setForm((prev) => ({ ...prev, [field]: url }));
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Widget Config</h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-80 rounded-2xl bg-muted animate-pulse" />
          <div className="h-80 rounded-2xl bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  const embedSnippet = `<script src="${window.location.origin}/api/widget-embed.js" data-project="${project?.slug ?? "your-project"}"></script>`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">Widget Config</h1>
        <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full sm:w-auto">
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {save.isSuccess && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 text-success text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Widget config saved successfully
        </div>
      )}
      {save.isError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to save widget config. Please try again.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ─── Left Column: Config Forms ─────────────────────────── */}
        <div className="space-y-6">
          {/* Appearance */}
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Appearance
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Brand Color
                </label>
                <ColorPicker
                  value={form.primaryColor ?? "#f97316"}
                  onChange={(color) =>
                    setForm({ ...form, primaryColor: color })
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Brand Text
                </label>
                <ColorPicker
                  value={form.textColor ?? "#ffffff"}
                  onChange={(color) =>
                    setForm({ ...form, textColor: color })
                  }
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Used for buttons, icons, and header accents.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Header Text
              </label>
              <input
                type="text"
                value={form.headerText ?? ""}
                onChange={(e) =>
                  setForm({ ...form, headerText: e.target.value })
                }
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Header Subtitle{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={form.headerSubtitle ?? ""}
                onChange={(e) =>
                  setForm({ ...form, headerSubtitle: e.target.value || null })
                }
                placeholder="We typically reply instantly"
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Position
                </label>
                <Select
                  value={form.position ?? "bottom-right"}
                  onValueChange={(val) =>
                    setForm({
                      ...form,
                      position: val as "bottom-right" | "bottom-left" | "center-inline",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select position" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottom-right">Bottom Right</SelectItem>
                    <SelectItem value="bottom-left">Bottom Left</SelectItem>
                    <SelectItem value="center-inline">Center Inline</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Border Radius
                </label>
                <Select
                  value={
                    form.borderRadius === 0
                      ? "none"
                      : form.borderRadius === 8
                        ? "soft"
                        : "rounded"
                  }
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      borderRadius: v === "none" ? 0 : v === "soft" ? 8 : 16,
                    })
                  }
                >
                  <SelectTrigger className="bg-muted/50 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="soft">Soft</SelectItem>
                    <SelectItem value="rounded">Rounded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Background Style */}
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              Background Style
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {BACKGROUND_STYLES.map((style) => (
                <button
                  key={style.value}
                  type="button"
                  onClick={() =>
                    setForm({ ...form, backgroundStyle: style.value })
                  }
                  className={cn(
                    "relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-all text-center",
                    (form.backgroundStyle ?? "solid") === style.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/30",
                  )}
                >
                  {/* Mini preview */}
                  <div
                    className="w-full h-10 rounded-lg"
                    style={
                      style.value === "solid"
                        ? { background: "#ffffff", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", border: "1px solid #e4e4e7" }
                        : { background: "rgba(0,0,0,0.18)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.1)" }
                    }
                  />
                  <span className="text-xs font-medium text-foreground">
                    {style.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    {style.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Home Screen (hidden for center-inline position) */}
          {form.position !== "center-inline" && (
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              <Type className="w-5 h-5" />
              Home Screen
            </h2>

            {/* Avatar Upload */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Avatar
              </label>
              <div className="flex items-center gap-3">
                <div
                  className="w-14 h-14 rounded-full border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/30 shrink-0"
                  style={form.avatarUrl ? { borderStyle: "solid" } : {}}
                >
                  {form.avatarUrl ? (
                    <img
                      src={form.avatarUrl}
                      alt="Avatar"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file, setAvatarUploading, "avatarUrl");
                    }}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarUploading}
                    >
                      {avatarUploading ? "Uploading..." : "Upload"}
                    </Button>
                    {form.avatarUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setForm({ ...form, avatarUrl: null })}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Recommended: 100x100px. JPG, PNG, or WebP.
                  </p>
                </div>
              </div>
            </div>

            {/* Banner Upload */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Banner Image
              </label>
              <div
                className="relative w-full h-28 rounded-xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                style={
                  form.bannerUrl
                    ? { borderStyle: "solid" }
                    : {}
                }
                onClick={() => bannerInputRef.current?.click()}
              >
                {form.bannerUrl ? (
                  <>
                    <img
                      src={form.bannerUrl}
                      alt="Banner"
                      className="w-full h-full object-cover"
                    />
                    <button
                      className="absolute top-2 right-2 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70"
                      onClick={(e) => {
                        e.stopPropagation();
                        setForm({ ...form, bannerUrl: null });
                      }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                    <Image className="w-6 h-6" />
                    <span className="text-xs">
                      {bannerUploading ? "Uploading..." : "Click to upload banner"}
                    </span>
                  </div>
                )}
              </div>
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file, setBannerUploading, "bannerUrl");
                }}
              />
              <p className="text-xs text-muted-foreground">
                Defaults to primary color if none uploaded. Recommended: 800x200px.
              </p>
            </div>

            {/* Home Title */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Home Title
              </label>
              <input
                type="text"
                value={form.homeTitle ?? "How can we help?"}
                onChange={(e) =>
                  setForm({ ...form, homeTitle: e.target.value })
                }
                placeholder="How can we help?"
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Home Subtitle */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Home Subtitle{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={form.homeSubtitle ?? ""}
                onChange={(e) =>
                  setForm({ ...form, homeSubtitle: e.target.value || null })
                }
                placeholder="We typically reply instantly"
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          )}

          {/* Intro Message */}
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Intro Message
            </h2>
            <p className="text-sm text-muted-foreground">
              The first message visitors see when they open the chat widget.
            </p>
            <textarea
              value={introMessage}
              onChange={(e) => setIntroMessage(e.target.value)}
              placeholder="Hi there! How can I help you today?"
              rows={3}
              maxLength={200}
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">
              {introMessage.length}/200
            </p>
            {form.position === "center-inline" && (
              <div className="flex items-center justify-between rounded-xl border border-input bg-background px-4 py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-card-foreground">
                    Show intro bubble before focus
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Display the intro message as a floating bubble above the input bar before the visitor interacts.
                  </p>
                </div>
                <Switch
                  checked={showIntroBubble}
                  onCheckedChange={setShowIntroBubble}
                />
              </div>
            )}
          </div>

          {/* Page Targeting */}
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Page Targeting
            </h2>
            <p className="text-sm text-muted-foreground">
              Control which pages the widget appears on. Leave empty to show on all pages.
            </p>

            {/* Current pages as tags */}
            {(() => {
              const pages = (form.allowedPages ?? "")
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean);

              function removePage(index: number) {
                const updated = pages.filter((_, i) => i !== index);
                setForm({
                  ...form,
                  allowedPages: updated.length > 0 ? updated.join(",") : null,
                });
              }

              function addPage() {
                const value = pageInput.trim();
                if (!value) return;
                // Normalize: ensure it starts with /
                const normalized = value.startsWith("/") ? value : `/${value}`;
                if (pages.includes(normalized)) {
                  setPageInput("");
                  return;
                }
                const updated = [...pages, normalized];
                setForm({
                  ...form,
                  allowedPages: updated.join(","),
                });
                setPageInput("");
              }

              return (
                <>
                  {pages.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {pages.map((page, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/50 border border-border text-sm font-mono"
                        >
                          {page}
                          <button
                            type="button"
                            onClick={() => removePage(i)}
                            className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {pages.length === 0 && (
                    <div className="px-3 py-2 rounded-lg bg-muted/30 border border-dashed border-border text-sm text-muted-foreground">
                      No page rules set — widget will show on all pages.
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={pageInput}
                      onChange={(e) => setPageInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPage();
                        }
                      }}
                      placeholder="/pricing, /dashboard/*, /"
                      className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addPage}
                      className="px-3 h-[42px]"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="text-xs text-muted-foreground space-y-1">
                    <p className="font-medium">Examples:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground/70">
                      <li><code className="text-xs bg-muted/50 px-1 rounded">/</code> — homepage only</li>
                      <li><code className="text-xs bg-muted/50 px-1 rounded">/pricing</code> — exact page match</li>
                      <li><code className="text-xs bg-muted/50 px-1 rounded">/docs/*</code> — all pages under /docs</li>
                    </ul>
                  </div>
                </>
              );
            })()}
          </div>

        </div>

        {/* ─── Right Column: Live Preview ────────────────────────── */}
        <div className="lg:sticky lg:top-6 lg:self-start space-y-4">
          {/* Embed snippet */}
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-4">
            <h2 className="text-sm font-semibold text-card-foreground mb-2">Embed</h2>
            <p className="text-xs text-muted-foreground mb-2">
              Add this script tag to your website.
            </p>
            <div className="relative">
              <pre className="bg-muted/50 rounded-xl p-3 text-xs font-mono overflow-x-auto">
                {embedSnippet}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(embedSnippet)}
                className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-background border border-border hover:bg-muted"
                title="Copy"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-card-foreground">Preview</h2>
              {form.position !== "center-inline" && (
                <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
                  <button
                    onClick={() => setPreviewMode("home")}
                    className={cn(
                      "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                      previewMode === "home"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Home
                  </button>
                  <button
                    onClick={() => setPreviewMode("chat")}
                    className={cn(
                      "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                      previewMode === "chat"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Chat
                  </button>
                </div>
              )}
            </div>
            <div
              className="rounded-xl overflow-hidden border border-border"
              style={{ height: "min(700px, calc(100vh - 12rem))" }}
            >
              <iframe
                ref={iframeRef}
                srcDoc={previewHtml}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin"
                title="Widget Preview"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WidgetConfig;
