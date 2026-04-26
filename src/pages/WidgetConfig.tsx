import {
  Globe,
  Image,
  MessageSquare,
  Palette,
  Type,
  Upload,
  X,
} from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import GreetingsList from "@/components/GreetingsList";
import PageVisibilityInput from "@/components/PageVisibilityInput";
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

const VALID_TABS = ["appearance", "greetings"] as const;
type TabValue = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is TabValue {
  return value !== null && (VALID_TABS as readonly string[]).includes(value);
}

function WidgetConfig() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: TabValue = isValidTab(tabParam) ? tabParam : "appearance";

  const state = useWidgetSettings(projectId ?? "");

  if (state.isLoading) {
    return (
      <WidgetSettingsLoading
        title="Widget Configuration"
        description="Customize the widget appearance, greetings, and installation settings."
      />
    );
  }

  const widgetPages = (state.form.allowedPages ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  function setWidgetPages(next: string[]) {
    state.updateForm({
      allowedPages: next.length > 0 ? next.join(",") : null,
    });
  }

  function setTab(next: TabValue) {
    const params = new URLSearchParams(searchParams);
    if (next === "appearance") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    setSearchParams(params, { replace: true });
  }

  return (
    <WidgetPageShell
      title="Widget Configuration"
      description="Customize the widget appearance, greetings, and installation settings."
      save={state.save}
      sidebar={
        <WidgetPreviewPanel
          iframeRef={state.iframeRef}
          position={state.form.position}
          previewHtml={state.previewHtml}
          previewMode={state.previewMode}
          setPreviewMode={state.setPreviewMode}
          embedSnippet={state.embedSnippet}
          showEmbedSnippet={true}
        />
      }
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="greetings">Greetings &amp; News</TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="space-y-6">
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
                  onChange={(color) =>
                    state.updateForm({ primaryColor: color })
                  }
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
                onChange={(e) =>
                  state.updateForm({ headerText: e.target.value })
                }
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
              <label className="text-sm font-medium text-foreground">
                Font
              </label>
              <Select
                value={state.form.fontFamily || "system-ui"}
                onValueChange={(value) =>
                  state.updateForm({ fontFamily: value })
                }
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
                      style={
                        state.form.avatarUrl ? { borderStyle: "solid" } : {}
                      }
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
                            onClick={() =>
                              state.updateForm({ avatarUrl: null })
                            }
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
                      state.form.bannerUrl
                        ? { borderStyle: "solid" }
                        : undefined
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
        </TabsContent>

        <TabsContent value="greetings" className="space-y-6">
          <WidgetSectionCard
            title="Greetings &amp; News"
            description="Welcome bubbles, announcements, and changelog popups shown above the chat trigger."
            icon={MessageSquare}
          >
            <GreetingsList
              projectId={projectId ?? ""}
              authors={state.authors ?? []}
              onPreviewChange={state.setPreviewGreetings}
            />
          </WidgetSectionCard>

          <WidgetSectionCard
            title="Page Visibility"
            description="Control which pages the widget appears on."
            icon={Globe}
          >
            <PageVisibilityInput
              value={widgetPages}
              onChange={setWidgetPages}
              emptyHint="No page rules set. The widget will show on all pages."
            />
          </WidgetSectionCard>
        </TabsContent>
      </Tabs>
    </WidgetPageShell>
  );
}

export default WidgetConfig;
