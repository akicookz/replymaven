import { Palette, Type } from "lucide-react";
import { useParams } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/color-picker";
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

function WidgetAppearance() {
  const { projectId } = useParams<{ projectId: string }>();
  const state = useWidgetSettings(projectId ?? "");

  if (state.isLoading) {
    return (
      <WidgetSettingsLoading
        title="Appearance"
        description="Customize the look and feel of your widget."
      />
    );
  }

  return (
    <WidgetPageShell
      title="Appearance"
      description="Customize the look and feel of your widget."
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
    </WidgetPageShell>
  );
}

export default WidgetAppearance;
