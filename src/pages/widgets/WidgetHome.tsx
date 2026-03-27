import { Image, MessageSquare, Type, Upload, X } from "lucide-react";
import { useParams } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  WidgetPageShell,
  WidgetPreviewPanel,
  WidgetSectionCard,
  WidgetSettingsLoading,
} from "@/components/WidgetSettings";
import { useWidgetSettings } from "@/hooks/use-widget-settings";

function WidgetHome() {
  const { projectId } = useParams<{ projectId: string }>();
  const state = useWidgetSettings(projectId ?? "");

  if (state.isLoading) {
    return (
      <WidgetSettingsLoading
        title="Widget Home"
        description="Configure the home screen and intro message."
      />
    );
  }

  return (
    <WidgetPageShell
      title="Widget Home"
      description="Configure the home screen and intro message."
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
                className="relative w-full h-28 rounded-xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                style={
                  state.form.bannerUrl ? { borderStyle: "solid" } : undefined
                }
                onClick={() => state.bannerInputRef.current?.click()}
              >
                {state.form.bannerUrl ? (
                  <>
                    <img
                      src={state.form.bannerUrl}
                      alt="Banner"
                      className="w-full h-full object-cover"
                    />
                    <button
                      className="absolute top-2 right-2 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70"
                      onClick={(e) => {
                        e.stopPropagation();
                        state.updateForm({ bannerUrl: null });
                      }}
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
                  state.updateForm({ homeSubtitle: e.target.value || null })
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
        title="Intro Message"
        description="The first message visitors see when they open the widget."
        icon={MessageSquare}
      >
        <textarea
          value={state.introMessage}
          onChange={(e) => state.setIntroMessage(e.target.value)}
          placeholder="Hi there! How can I help you today?"
          rows={3}
          maxLength={200}
          className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <p className="text-xs text-muted-foreground text-right">
          {state.introMessage.length}/200
        </p>

        <div className="space-y-2 pt-2">
          <label className="text-sm font-medium text-card-foreground">
            Message Author
          </label>
          <p className="text-xs text-muted-foreground">
            Choose who the intro message appears to be from.
          </p>
          <Select
            value={state.introMessageAuthorId ?? "none"}
            onValueChange={(value) =>
              state.setIntroMessageAuthorId(value === "none" ? null : value)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="No author (bot message)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No author (bot message)</SelectItem>
              {state.authors?.map((author) => (
                <SelectItem key={author.id} value={author.id}>
                  <div className="flex items-center gap-2">
                    {author.avatar ? (
                      <img
                        src={author.avatar}
                        alt={author.name}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary">
                        {author.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span>{author.name}</span>
                    {author.workTitle ? (
                      <span className="text-muted-foreground">
                        - {author.workTitle}
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {state.form.position === "center-inline" ? (
          <div className="flex items-center justify-between rounded-xl border border-input bg-background px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-card-foreground">
                Show intro bubble before focus
              </p>
              <p className="text-xs text-muted-foreground">
                Display the intro message as a floating bubble above the input
                bar before the visitor interacts.
              </p>
            </div>
            <Switch
              checked={state.showIntroBubble}
              onCheckedChange={state.setShowIntroBubble}
            />
          </div>
        ) : null}
      </WidgetSectionCard>
    </WidgetPageShell>
  );
}

export default WidgetHome;
