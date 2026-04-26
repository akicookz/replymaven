import type { ComponentType, ReactNode, RefObject } from "react";
import { AlertCircle, CheckCircle2, Copy, Save } from "lucide-react";
import { MobileMenuButton } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WidgetConfigData } from "@/hooks/use-widget-settings";

const WIDGET_CARD_CLASS_NAME =
  "bg-white/[0.04] backdrop-blur-xl rounded-2xl shadow-none";

interface SaveState {
  mutate: () => void;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
}

interface WidgetPageShellProps {
  title: string;
  description: string;
  save: SaveState;
  children: ReactNode;
  sidebar?: ReactNode;
}

interface WidgetSettingsLoadingProps {
  title: string;
  description: string;
}

interface WidgetSectionCardProps {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}

interface WidgetPreviewPanelProps {
  embedSnippet?: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  position?: WidgetConfigData["position"];
  previewHtml: string;
  previewMode: "home" | "chat";
  setPreviewMode: (mode: "home" | "chat") => void;
  showEmbedSnippet?: boolean;
}

export function WidgetPageShell({
  title,
  description,
  save,
  children,
  sidebar,
}: WidgetPageShellProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <MobileMenuButton />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">
              {title}
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              {description}
            </p>
          </div>
        </div>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="w-full sm:w-auto"
        >
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {save.isSuccess && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 text-success text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Widget settings saved successfully
        </div>
      )}
      {save.isError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to save widget settings. Please try again.
        </div>
      )}

      <div className={cn("grid gap-6", sidebar && "lg:grid-cols-2")}>
        <div className="space-y-6">{children}</div>
        {sidebar ? (
          <div className="lg:sticky lg:top-6 lg:self-start space-y-4">
            {sidebar}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function WidgetSettingsLoading({
  title,
  description,
}: WidgetSettingsLoadingProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            {title}
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            {description}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-80 rounded-2xl bg-muted animate-pulse" />
        <div className="h-80 rounded-2xl bg-muted animate-pulse" />
      </div>
    </div>
  );
}

export function WidgetSectionCard({
  title,
  description,
  icon: Icon,
  children,
}: WidgetSectionCardProps) {
  return (
    <Card className={WIDGET_CARD_CLASS_NAME}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {Icon ? <Icon className="w-5 h-5" /> : null}
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function WidgetPreviewPanel({
  embedSnippet,
  iframeRef,
  position,
  previewHtml,
  previewMode,
  setPreviewMode,
  showEmbedSnippet = false,
}: WidgetPreviewPanelProps) {
  return (
    <>
      <Card className={WIDGET_CARD_CLASS_NAME}>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-sm">Preview</CardTitle>
            <CardDescription>
              Review how the widget looks before publishing changes.
            </CardDescription>
          </div>
          {position !== "center-inline" ? (
            <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
              <button
                onClick={() => setPreviewMode("home")}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  previewMode === "home"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
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
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Chat
              </button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          <div
            className="rounded-xl overflow-hidden"
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
        </CardContent>
      </Card>

      {showEmbedSnippet && embedSnippet ? (
        <Card className={WIDGET_CARD_CLASS_NAME}>
          <CardHeader>
            <CardTitle className="text-sm">Embed</CardTitle>
            <CardDescription>
              Add this script tag to your website.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <pre className="bg-muted/50 rounded-xl p-3 text-xs font-mono overflow-x-auto">
                {embedSnippet}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(embedSnippet)}
                className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-background hover:bg-muted"
                title="Copy"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
