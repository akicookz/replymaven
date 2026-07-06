import { Image, Palette, Type, Upload, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { ImagePositioner } from "@/components/ImagePositioner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WidgetPageShell,
  WidgetPreviewPanel,
  WidgetSectionCard,
  WidgetSettingsLoading,
} from "@/components/WidgetSettings";
import {
  BACKGROUND_STYLES,
  useWidgetSettings,
} from "@/hooks/use-widget-settings";
import { cn } from "@/lib/utils";
import { WIDGET_FONTS } from "../../shared/widget-fonts";

const PAGE_TITLE = "Appearance";
const PAGE_DESCRIPTION =
  "Branding, home view, layout, and background treatment.";

function WidgetAppearance() {
  const { projectId } = useParams<{ projectId: string }>();
  const state = useWidgetSettings(projectId ?? "", {
    defaultPreviewMode: "open",
  });

  if (state.isLoading) {
    return (
      <WidgetSettingsLoading
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
      />
    );
  }

  return (
    <WidgetPageShell
      title={PAGE_TITLE}
      description={PAGE_DESCRIPTION}
      save={state.save}
      sidebar={
        <WidgetPreviewPanel
          iframeRef={state.iframeRef}
          position={state.form.position}
          previewHtml={state.previewHtml}
          previewMode={state.previewMode}
          setPreviewMode={state.setPreviewMode}
        />
      }
    >
      <WidgetSectionCard
        title="Branding"
        description="Colors used across the widget."
        icon={Palette}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Brand Color
            </label>
            <ColorPicker
              value={state.form.primaryColor ?? "#f97316"}
              onChange={(color) => state.updateForm({ primaryColor: color })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Brand Text
            </label>
            <ColorPicker
              value={state.form.textColor ?? "#ffffff"}
              onChange={(color) => state.updateForm({ textColor: color })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Used for buttons, icons, and header accents.
        </p>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Background
          </label>
          <ColorPicker
            value={state.form.backgroundColor ?? "#ffffff"}
            onChange={(color) => state.updateForm({ backgroundColor: color })}
          />
          <p className="text-xs text-muted-foreground">
            Widget surface color (applies when Background Style is Solid).
          </p>
        </div>

      </WidgetSectionCard>

      <WidgetSectionCard
        title="Launcher &amp; Header"
        description="Copy shown in the conversation header."
        icon={Type}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Header Text
          </label>
          <input
            type="text"
            value={state.form.headerText ?? ""}
            onChange={(e) => state.updateForm({ headerText: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Header Subtitle{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </label>
          <input
            type="text"
            value={state.form.headerSubtitle ?? ""}
            onChange={(e) =>
              state.updateForm({ headerSubtitle: e.target.value || null })
            }
            placeholder="We typically reply instantly"
            className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </WidgetSectionCard>

      <WidgetSectionCard
        title="Home View"
        description="Avatar, banner, and welcome text on the widget home."
        icon={Image}
      >
        {state.form.position !== "center-inline" ? (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Avatar
              </label>
              <div className="flex items-center gap-3">
                <div
                  className="w-14 h-14 rounded-full border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/30 shrink-0"
                  style={state.form.avatarUrl ? { borderStyle: "solid" } : {}}
                >
                  {state.form.avatarUrl ? (
                    <img
                      src={state.form.avatarUrl}
                      alt="Avatar"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    ref={state.avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        state.uploadAvatar(file);
                      }
                    }}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => state.avatarInputRef.current?.click()}
                      disabled={state.avatarUploading}
                    >
                      {state.avatarUploading ? "Uploading..." : "Upload"}
                    </Button>
                    {state.form.avatarUrl ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => state.updateForm({ avatarUrl: null })}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Recommended: 100x100px. JPG, PNG, or WebP.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Banner Image
              </label>
              <div
                className={cn(
                  "relative w-full h-28 rounded-xl border-2 border-border flex items-center justify-center overflow-hidden bg-muted/30",
                  !state.form.bannerUrl &&
                    "border-dashed cursor-pointer hover:bg-muted/50 transition-colors",
                )}
                onClick={
                  state.form.bannerUrl
                    ? undefined
                    : () => state.bannerInputRef.current?.click()
                }
              >
                {state.form.bannerUrl ? (
                  <>
                    <ImagePositioner
                      src={state.form.bannerUrl}
                      alt="Banner"
                      position={state.form.bannerPosition ?? null}
                      onChange={(value) =>
                        state.updateForm({ bannerPosition: value })
                      }
                    />
                    <button
                      type="button"
                      title="Replace image"
                      disabled={state.bannerUploading}
                      className="absolute top-2 right-9 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70 disabled:opacity-50"
                      onClick={() => state.bannerInputRef.current?.click()}
                    >
                      <Upload className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      title="Remove image"
                      className="absolute top-2 right-2 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70"
                      onClick={() =>
                        state.updateForm({
                          bannerUrl: null,
                          bannerPosition: null,
                        })
                      }
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                    <Image className="w-6 h-6" />
                    <span className="text-xs">
                      {state.bannerUploading
                        ? "Uploading..."
                        : "Click to upload banner"}
                    </span>
                  </div>
                )}
              </div>
              <input
                ref={state.bannerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    state.uploadBanner(file);
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Defaults to primary color if none uploaded. Recommended:
                800x200px.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Home Title
              </label>
              <input
                type="text"
                value={state.form.homeTitle ?? "How can we help?"}
                onChange={(e) =>
                  state.updateForm({ homeTitle: e.target.value })
                }
                placeholder="How can we help?"
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Home Subtitle{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <input
                type="text"
                value={state.form.homeSubtitle ?? ""}
                onChange={(e) =>
                  state.updateForm({
                    homeSubtitle: e.target.value || null,
                  })
                }
                placeholder="We typically reply instantly"
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </>
        ) : (
          <div className="px-4 py-3 rounded-xl border border-input bg-background text-sm text-muted-foreground">
            Center inline widgets skip the standalone home screen and open
            directly as an inline chat experience.
          </div>
        )}
      </WidgetSectionCard>

      <WidgetSectionCard
        title="Layout &amp; Typography"
        description="Where the widget sits and how it reads."
        icon={Type}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Position
            </label>
            <Select
              value={state.form.position ?? "bottom-right"}
              onValueChange={(value) =>
                state.updateForm({
                  position: value as
                    | "bottom-right"
                    | "bottom-left"
                    | "center-inline",
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
                state.form.borderRadius === 0
                  ? "none"
                  : state.form.borderRadius === 8
                    ? "soft"
                    : "rounded"
              }
              onValueChange={(value) =>
                state.updateForm({
                  borderRadius:
                    value === "none" ? 0 : value === "soft" ? 8 : 16,
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

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Font</label>
          <Select
            value={state.form.fontFamily || "system-ui"}
            onValueChange={(value) => state.updateForm({ fontFamily: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select font" />
            </SelectTrigger>
            <SelectContent>
              {WIDGET_FONTS.map((font) => (
                <SelectItem key={font.value} value={font.value}>
                  {font.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3 pt-2">
          <div className="text-sm font-medium text-foreground">
            Background Style
          </div>
          <div className="grid grid-cols-2 gap-2">
            {BACKGROUND_STYLES.map((style) => (
              <button
                key={style.value}
                type="button"
                onClick={() =>
                  state.updateForm({ backgroundStyle: style.value })
                }
                className={cn(
                  "relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-all text-center",
                  (state.form.backgroundStyle ?? "solid") === style.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30",
                )}
              >
                <div
                  className="w-full h-10 rounded-lg"
                  style={
                    style.value === "solid"
                      ? {
                          background: "#ffffff",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                          border: "1px solid #e4e4e7",
                        }
                      : {
                          background: "rgba(0,0,0,0.18)",
                          backdropFilter: "blur(8px)",
                          border: "1px solid rgba(255,255,255,0.1)",
                        }
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
      </WidgetSectionCard>
    </WidgetPageShell>
  );
}

export default WidgetAppearance;
