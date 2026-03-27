import {
  Copy,
  Globe,
  Image,
  MessageSquare,
  Palette,
  Type,
  Upload,
  X,
} from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

function WidgetConfig() {
  const { projectId } = useParams<{ projectId: string }>();
  const state = useWidgetSettings(projectId ?? "");

  if (state.isLoading) {
    return (
      <WidgetSettingsLoading
        title="Widget Configuration"
        description="Customize the widget appearance, home experience, and installation settings."
      />
    );
  }

  const pages = (state.form.allowedPages ?? "")
    .split(",")
    .map((page) => page.trim())
    .filter(Boolean);

  function removePage(index: number) {
    const updated = pages.filter((_, pageIndex) => pageIndex !== index);
    state.updateForm({
      allowedPages: updated.length > 0 ? updated.join(",") : null,
    });
  }

  function addPage() {
    const value = state.pageInput.trim();
    if (!value) return;

    const normalized = value.startsWith("/") ? value : `/${value}`;
    if (pages.includes(normalized)) {
      state.setPageInput("");
      return;
    }

    state.updateForm({
      allowedPages: [...pages, normalized].join(","),
    });
    state.setPageInput("");
  }

  return (
    <WidgetPageShell
      title="Widget Configuration"
      description="Customize the widget appearance, home experience, and installation settings."
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
        title="Appearance"
        description="Colors, layout, typography, and background treatment."
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
              <SelectItem value="system-ui">System Default</SelectItem>
              <SelectItem value="Inter">Inter</SelectItem>
              <SelectItem value="Satoshi">Satoshi</SelectItem>
              <SelectItem value="DM Sans">DM Sans</SelectItem>
              <SelectItem value="Nunito">Nunito</SelectItem>
              <SelectItem value="Raleway">Raleway</SelectItem>
              <SelectItem value="Plus Jakarta Sans">
                Plus Jakarta Sans
              </SelectItem>
              <SelectItem value="IBM Plex Sans">IBM Plex Sans</SelectItem>
              <SelectItem value="Lato">Lato</SelectItem>
              <SelectItem value="Space Grotesk">Space Grotesk</SelectItem>
              <SelectItem value="Outfit">Outfit</SelectItem>
              <SelectItem value="Merriweather Sans">
                Merriweather Sans
              </SelectItem>
              <SelectItem value="JetBrains Mono">JetBrains Mono</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Type className="w-4 h-4" />
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

      <WidgetSectionCard
        title="Widget Home"
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
                      type="button"
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

      <WidgetSectionCard
        title="Embed"
        description="Add this script tag to your website."
        icon={Copy}
      >
        <div className="relative">
          <pre className="bg-muted/50 rounded-xl p-3 text-xs font-mono overflow-x-auto">
            {state.embedSnippet}
          </pre>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(state.embedSnippet)}
            className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-background border border-border hover:bg-muted"
            title="Copy"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </WidgetSectionCard>

      <WidgetSectionCard
        title="Visibility"
        description="Control which pages the widget appears on."
        icon={Globe}
      >
        {pages.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {pages.map((page, index) => (
              <span
                key={page}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/50 border border-border text-sm font-mono"
              >
                {page}
                <button
                  type="button"
                  onClick={() => removePage(index)}
                  className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="px-3 py-2 rounded-lg bg-muted/30 border border-dashed border-border text-sm text-muted-foreground">
            No page rules set. The widget will show on all pages.
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={state.pageInput}
            onChange={(e) => state.setPageInput(e.target.value)}
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
            Add
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium">Examples:</p>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground/70">
            <li>
              <code className="text-xs bg-muted/50 px-1 rounded">/</code> -
              homepage only
            </li>
            <li>
              <code className="text-xs bg-muted/50 px-1 rounded">
                /pricing
              </code>{" "}
              - exact page match
            </li>
            <li>
              <code className="text-xs bg-muted/50 px-1 rounded">
                /docs/*
              </code>{" "}
              - all pages under `/docs`
            </li>
          </ul>
        </div>
      </WidgetSectionCard>
    </WidgetPageShell>
  );
}

export default WidgetConfig;
