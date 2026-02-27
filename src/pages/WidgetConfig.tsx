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

interface WidgetConfigData {
  id: string;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  headerText: string;
  avatarUrl: string | null;
  position: "bottom-right" | "bottom-left" | "center-inline";
  borderRadius: number;
  fontFamily: string;
  customCss: string | null;
  bannerUrl: string | null;
  homeTitle: string;
  homeSubtitle: string | null;
}

function WidgetConfig() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Partial<WidgetConfigData>>({});
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);

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

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/widget-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["widget-config", projectId] });
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Widget Config</h1>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {save.isSuccess && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 text-green-700 text-sm">
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
          <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Appearance
            </h2>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Primary
                </label>
                <ColorPicker
                  value={form.primaryColor ?? "#2563eb"}
                  onChange={(color) =>
                    setForm({ ...form, primaryColor: color })
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Background
                </label>
                <ColorPicker
                  value={form.backgroundColor ?? "#ffffff"}
                  onChange={(color) =>
                    setForm({ ...form, backgroundColor: color })
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Text
                </label>
                <ColorPicker
                  value={form.textColor ?? "#1f2937"}
                  onChange={(color) =>
                    setForm({ ...form, textColor: color })
                  }
                />
              </div>
            </div>

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
                  Border Radius: {form.borderRadius ?? 16}px
                </label>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={form.borderRadius ?? 16}
                  onChange={(e) =>
                    setForm({ ...form, borderRadius: Number(e.target.value) })
                  }
                  className="w-full"
                />
              </div>
            </div>
          </div>

          {/* Home Screen (hidden for center-inline position) */}
          {form.position !== "center-inline" && (
          <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
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


        </div>

        {/* ─── Right Column: Live Preview ────────────────────────── */}
        <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6">
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
                {/* Bar */}
                <div
                  className="w-full max-w-[280px] rounded-full p-[2px]"
                  style={{
                    background: `conic-gradient(from 0deg, #ec4899, #f97316, #a855f7, #ec4899)`,
                  }}
                >
                  <div className="flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2">
                    <span className="flex-1 text-xs text-white/50">
                      Ask a question...
                    </span>
                    <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#1f2937" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
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
                className="w-[340px] shadow-xl overflow-hidden flex flex-col"
                style={{
                  backgroundColor: form.backgroundColor ?? "#ffffff",
                  borderRadius: `${form.borderRadius ?? 16}px`,
                  color: form.textColor ?? "#1f2937",
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
                    className="absolute -bottom-5 left-5 w-12 h-12 rounded-full border-2 border-white overflow-hidden flex items-center justify-center"
                    style={{
                      backgroundColor: form.avatarUrl
                        ? "transparent"
                        : (form.primaryColor ?? "#2563eb"),
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
                        stroke="white"
                        strokeWidth="1.5"
                        className="w-6 h-6"
                      >
                        <rect x="3" y="11" width="18" height="10" rx="2" />
                        <circle cx="12" cy="5" r="2" />
                        <path d="M12 7v4" />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Home content */}
                <div className="px-5 pt-8 pb-4 flex-1 overflow-y-auto">
                  <h3 className="text-lg font-bold" style={{ color: form.textColor ?? "#1f2937" }}>
                    {form.homeTitle || "How can we help?"}
                  </h3>
                  {form.homeSubtitle && (
                    <p className="text-xs mt-1 opacity-60">{form.homeSubtitle}</p>
                  )}

                  {/* Ask box */}
                  <div className="mt-4 border border-border/50 rounded-xl p-3">
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
                    <p className="text-[11px] text-muted-foreground/50 text-center py-2">
                      Quick actions configured on the Quick Actions page
                    </p>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-2 text-center border-t border-border/30">
                  <span className="text-[10px] opacity-40">
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
