import { useState, useEffect, useRef } from "react";
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
  botMessageBgColor: string;
  botMessageTextColor: string;
  visitorMessageBgColor: string | null;
  visitorMessageTextColor: string | null;
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

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

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

          {/* Message Colors */}
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Message Colors
            </h2>

            {/* Bot Messages */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Bot Messages
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Background
                  </label>
                  <ColorPicker
                    value={form.botMessageBgColor ?? "#ffffff"}
                    onChange={(color) =>
                      setForm({ ...form, botMessageBgColor: color })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Text
                  </label>
                  <ColorPicker
                    value={form.botMessageTextColor ?? "#18181b"}
                    onChange={(color) =>
                      setForm({ ...form, botMessageTextColor: color })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Visitor Messages */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">
                  Visitor Messages
                </label>
                {(form.visitorMessageBgColor || form.visitorMessageTextColor) && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() =>
                      setForm({
                        ...form,
                        visitorMessageBgColor: null,
                        visitorMessageTextColor: null,
                      })
                    }
                  >
                    Reset to brand colors
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Background
                  </label>
                  <ColorPicker
                    value={
                      form.visitorMessageBgColor ??
                      form.primaryColor ??
                      "#2563eb"
                    }
                    onChange={(color) =>
                      setForm({ ...form, visitorMessageBgColor: color })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Text
                  </label>
                  <ColorPicker
                    value={
                      form.visitorMessageTextColor ??
                      form.textColor ??
                      "#ffffff"
                    }
                    onChange={(color) =>
                      setForm({ ...form, visitorMessageTextColor: color })
                    }
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Defaults to Brand Color and Brand Text when not set.
              </p>
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
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
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
        <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6">
          <h2 className="text-lg font-semibold text-card-foreground mb-4">
            Preview
          </h2>
          <p className="text-sm text-muted-foreground">
            Add this script tag to your website to embed the chat widget.
          </p>
          <div className="relative">
            <pre className="bg-muted/50 rounded-xl p-4 text-xs font-mono overflow-x-auto">
              {embedSnippet}
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(embedSnippet)}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-background border border-border hover:bg-muted"
              title="Copy"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="relative rounded-xl p-4 min-h-full flex items-center justify-center">
            {form.position === "center-inline" ? (
              /* ─── Center Inline Preview ──────────────────────── */
              <div className="w-full flex flex-col items-center gap-3">
                {/* Chat container preview */}
                <div
                  className="w-full max-w-[280px] overflow-hidden shadow-xl"
                  style={{
                    ...(form.backgroundStyle === "blurred"
                      ? {
                          background: "rgba(0,0,0,0.18)",
                          backdropFilter: "blur(24px)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          boxShadow: "0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06)",
                        }
                      : {
                          background: "#ffffff",
                          border: "1px solid #e4e4e7",
                          boxShadow: "0 8px 40px rgba(0,0,0,0.12)",
                        }),
                    borderRadius: `${form.borderRadius ?? 16}px`,
                  }}
                >
                  {/* Header */}
                  <div
                    className="px-3.5 py-2.5 flex items-center gap-2"
                    style={{
                      background: form.primaryColor ?? "#2563eb",
                      borderRadius: `${(form.borderRadius ?? 16) - 1}px ${(form.borderRadius ?? 16) - 1}px 0 0`,
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                      style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke={form.textColor ?? "#ffffff"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                        <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
                      </svg>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] font-medium truncate" style={{ color: form.textColor ?? "#ffffff" }}>
                        {form.headerText || "ReplyMaven"}
                      </span>
                      <span className="text-[9px] truncate" style={{ color: form.textColor ?? "#ffffff", opacity: 0.7 }}>
                        {form.headerSubtitle || "We typically reply instantly"}
                      </span>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="px-3 py-3 flex flex-col gap-2.5">
                    {/* Bot message */}
                    <div className="flex justify-start">
                      <div
                        className="max-w-[85%] px-2.5 py-1.5 rounded-xl text-[10px] leading-relaxed"
                        style={{
                          background: form.botMessageBgColor ?? "#ffffff",
                          color: form.botMessageTextColor ?? "#18181b",
                          border: "1px solid rgba(0,0,0,0.06)",
                        }}
                      >
                        {introMessage || "Hi there! How can I help you today?"}
                      </div>
                    </div>

                    {/* Visitor message */}
                    <div className="flex justify-end">
                      <div
                        className="max-w-[85%] px-2.5 py-1.5 rounded-xl text-[10px] leading-relaxed"
                        style={{
                          backgroundColor: form.visitorMessageBgColor ?? form.primaryColor ?? "#2563eb",
                          color: form.visitorMessageTextColor ?? form.textColor ?? "#ffffff",
                        }}
                      >
                        I have a question
                      </div>
                    </div>

                    {/* Bot reply */}
                    <div className="flex justify-start">
                      <div
                        className="max-w-[85%] px-2.5 py-1.5 rounded-xl text-[10px] leading-relaxed"
                        style={{
                          background: form.botMessageBgColor ?? "#ffffff",
                          color: form.botMessageTextColor ?? "#18181b",
                          border: "1px solid rgba(0,0,0,0.06)",
                        }}
                      >
                        Sure, I&apos;d be happy to help!
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bar */}
                <div
                  className="w-full max-w-[280px] rounded-full p-[2px]"
                  style={{
                    background: `conic-gradient(from 0deg, ${form.primaryColor ?? "#f97316"}, ${form.primaryColor ?? "#f97316"}99, ${form.primaryColor ?? "#f97316"}55, ${form.primaryColor ?? "#f97316"})`,
                  }}
                >
                  <div className="flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2">
                    <span className="flex-1 text-xs text-white/50">
                      Ask a question...
                    </span>
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: form.primaryColor ?? "#f97316" }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke={form.textColor ?? "#ffffff"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground/50">
                  Grows wider on focus. Topics rotate as placeholder.
                </p>
              </div>
            ) : (
              /* ─── Floating Widget Preview ───────────────────── */
              <div
                className="w-full max-w-[340px] shadow-xl overflow-hidden flex flex-col"
                style={{
                  ...(form.backgroundStyle === "blurred"
                    ? {
                        background: "rgba(0,0,0,0.18)",
                        backdropFilter: "blur(24px)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        boxShadow: "0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06)",
                      }
                    : {
                        background: "#ffffff",
                        border: "1px solid #e4e4e7",
                        boxShadow: "0 8px 40px rgba(0,0,0,0.12)",
                      }),
                  borderRadius: `${form.borderRadius ?? 16}px`,
                  color: form.backgroundStyle === "blurred" ? "#ffffff" : "#18181b",
                  maxHeight: "480px",
                }}
              >
                {/* Banner */}
                <div
                  className="relative h-24 w-full shrink-0"
                  style={
                    form.bannerUrl
                      ? {
                        backgroundImage: `url(${form.bannerUrl})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center center",
                        backgroundRepeat: "no-repeat",
                      }
                      : { backgroundColor: form.primaryColor ?? "#2563eb" }
                  }
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "absolute -bottom-5 left-5 w-12 h-12 border-2 overflow-hidden flex items-center justify-center",
                      form.avatarUrl ? "rounded-full" : "rounded-xl",
                    )}
                    style={{
                      backgroundColor: form.avatarUrl
                        ? "transparent"
                        : (form.primaryColor ?? "#2563eb"),
                      borderColor: form.backgroundStyle === "blurred" ? "rgba(255,255,255,0.15)" : "#e4e4e7",
                    }}
                  >
                    {form.avatarUrl ? (
                      <img
                        src={form.avatarUrl}
                        alt="Avatar"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={form.textColor ?? "#ffffff"}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-6 h-6"
                      >
                        <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
                        <path d="M19 2l.5 1.5L21 4l-1.5.5L19 6l-.5-1.5L17 4l1.5-.5L19 2z" />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Home content */}
                <div className="px-5 pt-8 pb-4 flex-1 overflow-y-auto">
                  <h3 className="text-lg font-bold">
                    {form.homeTitle || "How can we help?"}
                  </h3>
                  {form.homeSubtitle && (
                    <p className="text-xs mt-1 opacity-60">{form.homeSubtitle}</p>
                  )}

                  {/* Ask box */}
                  <div className="mt-4 rounded-xl p-3" style={{ border: form.backgroundStyle === "blurred" ? "1px solid rgba(255,255,255,0.1)" : "1px solid #e4e4e7" }}>
                    <div className="flex items-center gap-1.5 text-xs opacity-50 mb-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                      Ask our assistant anything
                    </div>
                    <div className="text-xs opacity-30">Ask a question...</div>
                  </div>

                  {/* Quick actions preview placeholder */}
                  <div className="mt-4 space-y-0">
                    <p className="text-[11px] opacity-30 text-center py-2">
                      Quick actions configured on the Quick Actions page
                    </p>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-2 text-center" style={{ borderTop: form.backgroundStyle === "blurred" ? "1px solid rgba(255,255,255,0.1)" : "1px solid #e4e4e7" }}>
                  <span className="text-[10px] opacity-30">
                    Powered by ReplyMaven
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WidgetConfig;
