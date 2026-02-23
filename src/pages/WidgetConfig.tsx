import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Palette,
  Save,
  AlertCircle,
  CheckCircle2,
  Upload,
  Image,
  Type,
  Link as LinkIcon,
  Plus,
  Trash2,
  FileText,
  Mail,
  Calendar,
  Bell,
  Folder,
  ExternalLink,
  Globe,
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
  position: "bottom-right" | "bottom-left";
  borderRadius: number;
  fontFamily: string;
  customCss: string | null;
  bannerUrl: string | null;
  homeTitle: string;
  homeSubtitle: string | null;
}

interface HomeLink {
  id: string;
  label: string;
  url: string;
  icon: string;
  sortOrder: number;
}

const ICON_OPTIONS = [
  { value: "link", label: "Link", Icon: LinkIcon },
  { value: "docs", label: "Docs", Icon: FileText },
  { value: "mail", label: "Mail", Icon: Mail },
  { value: "calendar", label: "Calendar", Icon: Calendar },
  { value: "bell", label: "Bell", Icon: Bell },
  { value: "folder", label: "Folder", Icon: Folder },
  { value: "globe", label: "Globe", Icon: Globe },
  { value: "external", label: "External", Icon: ExternalLink },
];

function getIconComponent(icon: string) {
  const found = ICON_OPTIONS.find((o) => o.value === icon);
  return found?.Icon ?? LinkIcon;
}

function WidgetConfig() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Partial<WidgetConfigData>>({});
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);

  // Home links state
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkIcon, setLinkIcon] = useState("link");

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<WidgetConfigData>({
    queryKey: ["widget-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/widget-config`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const {
    data: homeLinksData,
    isLoading: linksLoading,
  } = useQuery<HomeLink[]>({
    queryKey: ["home-links", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/home-links`);
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

  const addLink = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/home-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: linkLabel, url: linkUrl, icon: linkIcon }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add link");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home-links", projectId] });
      setLinkLabel("");
      setLinkUrl("");
      setLinkIcon("link");
    },
  });

  const deleteLink = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/home-links/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home-links", projectId] });
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
          <div className="h-80 rounded-2xl bg-muted/50 animate-pulse" />
          <div className="h-80 rounded-2xl bg-muted/50 animate-pulse" />
        </div>
      </div>
    );
  }

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
                      position: val as "bottom-right" | "bottom-left",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select position" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottom-right">Bottom Right</SelectItem>
                    <SelectItem value="bottom-left">Bottom Left</SelectItem>
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

          {/* Home Screen */}
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

          {/* Home Links */}
          <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              <LinkIcon className="w-5 h-5" />
              Home Links
            </h2>
            <p className="text-sm text-muted-foreground">
              Navigation buttons shown on the widget home screen. Maximum 5 links.
            </p>

            {/* Add form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addLink.mutate();
              }}
              className="space-y-3"
            >
              <div className="flex gap-2">
                <Select value={linkIcon} onValueChange={setLinkIcon}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ICON_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="flex items-center gap-1.5">
                          <opt.Icon className="w-3.5 h-3.5" />
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  type="text"
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  placeholder="Label"
                  required
                  className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://example.com"
                  required
                  className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={addLink.isPending || (homeLinksData?.length ?? 0) >= 5}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </form>

            {addLink.isError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {addLink.error.message}
              </div>
            )}

            {/* List */}
            {linksLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 rounded-xl bg-muted/50 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {homeLinksData?.map((link) => {
                  const IconComp = getIconComponent(link.icon);
                  return (
                    <div
                      key={link.id}
                      className="flex items-center gap-3 px-4 py-2.5 bg-card/50 rounded-xl border border-border"
                    >
                      <IconComp className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {link.label}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {link.url}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteLink.mutate(link.id)}
                        disabled={deleteLink.isPending}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
                {homeLinksData?.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No home links yet. A default &quot;Visit website&quot; link will
                    be shown.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── Right Column: Live Preview ────────────────────────── */}
        <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6">
          <h2 className="text-lg font-semibold text-card-foreground mb-4">
            Preview
          </h2>
          <div className="relative bg-muted/30 rounded-xl p-4 min-h-[500px] flex items-end justify-end">
            {/* Widget preview */}
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
                className="relative h-24 shrink-0"
                style={
                  form.bannerUrl
                    ? {
                        backgroundImage: `url(${form.bannerUrl})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
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

                {/* Home Links preview */}
                <div className="mt-4 space-y-0">
                  {(homeLinksData && homeLinksData.length > 0
                    ? homeLinksData
                    : [{ id: "default", label: "Visit website", url: "#", icon: "globe" }]
                  ).map((link, i) => {
                    const IconComp = getIconComponent(link.icon);
                    return (
                      <div
                        key={link.id}
                        className="flex items-center gap-3 py-3"
                        style={
                          i > 0
                            ? { borderTop: "1px solid rgba(0,0,0,0.06)" }
                            : {}
                        }
                      >
                        <IconComp
                          className="w-4 h-4 shrink-0 opacity-40"
                        />
                        <span className="flex-1 text-xs font-medium">
                          {link.label}
                        </span>
                        <ExternalLink className="w-3 h-3 opacity-30" />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer */}
              <div className="px-4 py-2 text-center border-t border-border/30">
                <span className="text-[10px] opacity-40">
                  Powered by ReplyMaven
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WidgetConfig;
