import { Copy, Globe, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  WidgetPageShell,
  WidgetPreviewPanel,
  WidgetSectionCard,
  WidgetSettingsLoading,
} from "@/components/WidgetSettings";
import { useWidgetSettings } from "@/hooks/use-widget-settings";

function WidgetEmbedVisibility() {
  const { projectId } = useParams<{ projectId: string }>();
  const state = useWidgetSettings(projectId ?? "");

  if (state.isLoading) {
    return (
      <WidgetSettingsLoading
        title="Embed and Visibility"
        description="Install the widget and control where it appears."
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
      title="Embed and Visibility"
      description="Install the widget and control where it appears."
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
        title="Embed"
        description="Add this script tag to your website."
        icon={Copy}
      >
        <div className="relative">
          <pre className="bg-muted/50 rounded-xl p-3 text-xs font-mono overflow-x-auto">
            {state.embedSnippet}
          </pre>
          <button
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
              - all pages under /docs
            </li>
          </ul>
        </div>
      </WidgetSectionCard>
    </WidgetPageShell>
  );
}

export default WidgetEmbedVisibility;
