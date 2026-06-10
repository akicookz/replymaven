import { Image, Type, Upload, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ImagePositioner } from "@/components/ImagePositioner";
import {
  WidgetPageShell,
  WidgetPreviewPanel,
  WidgetSectionCard,
  WidgetSettingsLoading,
} from "@/components/WidgetSettings";
import { useWidgetSettings } from "@/hooks/use-widget-settings";
import { cn } from "@/lib/utils";

const PAGE_TITLE = "Home Screen";
const PAGE_DESCRIPTION =
  "Avatar, banner, and welcome text shown on the widget's home view.";

function WidgetHome() {
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
        title="Home Screen"
        description="Configure the default widget home view."
        icon={Type}
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
    </WidgetPageShell>
  );
}

export default WidgetHome;
