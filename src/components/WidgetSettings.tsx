import type { ComponentType, ReactNode, RefObject } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
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
  error?: Error | null;
}

interface WidgetPageShellProps {
  title: string;
  description: string;
  save?: SaveState;
  children: ReactNode;
  sidebar?: ReactNode;
  showHeader?: boolean;
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
  showHeader = true,
}: WidgetPageShellProps) {
  return (
    <div className="space-y-6">
      {showHeader ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <MobileMenuButton />
            <div>
              <h1 className="text-balance text-xl font-bold text-foreground md:text-2xl">
                {title}
              </h1>
              <p className="mt-1 text-pretty text-xs text-muted-foreground md:text-sm">
                {description}
              </p>
            </div>
          </div>
          {save && (
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="w-full transition-transform active:scale-[0.96] sm:w-auto"
            >
              <Save className="w-4 h-4 mr-2" />
              {save.isPending ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </div>
      ) : null}

      {save?.isSuccess && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 text-success text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Widget settings saved successfully
        </div>
      )}
      {save?.isError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {save.error?.message ??
            "Failed to save widget settings. Please try again."}
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
      <Card className={cn(WIDGET_CARD_CLASS_NAME, "relative overflow-hidden")}>
        <CardContent className="p-0">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3">
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-hairline bg-background/70 p-1.5 shadow-lg backdrop-blur-md">
              {onPagePathChange ? (
                <input
                  type="text"
                  value={pagePath ?? "/"}
                  onChange={(e) => onPagePathChange(e.target.value)}
                  placeholder="/pricing"
                  aria-label="Preview page path"
                  className="min-w-0 flex-1 rounded-lg bg-muted/40 px-3 py-1.5 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : null}
              {position !== "center-inline" ? (
                <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted/50 p-0.5">
                  <button
                    onClick={() => setPreviewMode("launcher")}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-medium transition-colors",
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
                      "rounded-md px-3 py-1 text-xs font-medium transition-colors",
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
              {onReplay ? (
                <button
                  onClick={onReplay}
                  aria-label="Replay greetings and intro timers"
                  title="Replay greetings and intro timers"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
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
