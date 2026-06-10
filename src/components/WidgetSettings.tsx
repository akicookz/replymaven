import type { ComponentType, ReactNode, RefObject } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Globe,
  RotateCcw,
  Save,
} from "lucide-react";
import { MobileMenuButton } from "@/components/PageHeader";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  WidgetConfigData,
  WidgetPreviewMode,
} from "@/hooks/use-widget-settings";

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
  save?: SaveState;
  children: ReactNode;
  sidebar?: ReactNode;
}

interface WidgetSettingsLoadingProps {
  title: string;
  description: string;
}

interface WidgetSectionCardProps {
  title?: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Rendered top-right in the header, aligned with the title. */
  action?: ReactNode;
  children: ReactNode;
}

interface WidgetPreviewPanelProps {
  embedSnippet?: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  position?: WidgetConfigData["position"];
  previewHtml: string;
  previewMode: WidgetPreviewMode;
  setPreviewMode: (mode: WidgetPreviewMode) => void;
  showEmbedSnippet?: boolean;
  /** Simulated visitor page path; enables the page simulator input when set. */
  pagePath?: string;
  onPagePathChange?: (path: string) => void;
  /** Reloads the preview so greeting delay/duration timers run again. */
  onReplay?: () => void;
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
        {save && (
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="w-full sm:w-auto"
          >
            <Save className="w-4 h-4 mr-2" />
            {save.isPending ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </div>

      {save?.isSuccess && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 text-success text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Widget settings saved successfully
        </div>
      )}
      {save?.isError && (
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
  action,
  children,
}: WidgetSectionCardProps) {
  return (
    <Card className={WIDGET_CARD_CLASS_NAME}>
      {title || description || action ? (
        <CardHeader className="gap-0">
          {title ? (
            <CardTitle className="flex items-center gap-2 text-lg">
              {Icon ? <Icon className="w-5 h-5" /> : null}
              {title}
            </CardTitle>
          ) : null}
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
      ) : null}
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
  pagePath,
  onPagePathChange,
  onReplay,
}: WidgetPreviewPanelProps) {
  return (
    <>
      <Card className={WIDGET_CARD_CLASS_NAME}>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-lg">Preview</CardTitle>
            <CardDescription>
              Review how the widget looks before publishing changes.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            {onReplay ? (
              <button
                onClick={onReplay}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Replay greetings and intro timers"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            ) : null}
            {position !== "center-inline" ? (
              <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
                <button
                  onClick={() => setPreviewMode("launcher")}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                    previewMode === "launcher"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  title="Closed widget with greeting and intro popups"
                >
                  Launcher
                </button>
                <button
                  onClick={() => setPreviewMode("open")}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                    previewMode === "open"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  title="Widget opened on its home screen"
                >
                  Open
                </button>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {onPagePathChange ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={pagePath ?? "/"}
                  onChange={(e) => onPagePathChange(e.target.value)}
                  placeholder="/pricing"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-input bg-background text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <p className="text-[11px] text-muted-foreground pl-6">
                Simulate the page visitors are on to test page visibility
                rules.
              </p>
            </div>
          ) : null}
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
