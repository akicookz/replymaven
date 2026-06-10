import { useState } from "react";
import { Check, Code, Copy, Globe } from "lucide-react";
import { useParams } from "react-router-dom";
import PageVisibilityInput from "@/components/PageVisibilityInput";
import {
  WidgetPageShell,
  WidgetPreviewPanel,
  WidgetSectionCard,
  WidgetSettingsLoading,
} from "@/components/WidgetSettings";
import { useWidgetSettings } from "@/hooks/use-widget-settings";

const PAGE_TITLE = "Installation";
const PAGE_DESCRIPTION =
  "Embed the widget on your site and control which pages it appears on.";

function WidgetInstallation() {
  const { projectId } = useParams<{ projectId: string }>();
  const state = useWidgetSettings(projectId ?? "");
  const [copied, setCopied] = useState(false);

  if (state.isLoading) {
    return (
      <WidgetSettingsLoading
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
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

  function copyEmbedSnippet() {
    navigator.clipboard.writeText(state.embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          pagePath={state.previewPagePath}
          onPagePathChange={state.setPreviewPagePath}
          onReplay={state.replayPreview}
        />
      }
    >
      <WidgetSectionCard
        title="Embed Code"
        description="Add this script tag to your website's HTML, just before the closing </body> tag."
        icon={Code}
      >
        <div className="relative">
          <pre className="bg-muted/50 rounded-xl p-3 pr-12 text-xs font-mono overflow-x-auto">
            {state.embedSnippet}
          </pre>
          <button
            onClick={copyEmbedSnippet}
            className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-background hover:bg-muted"
            title="Copy embed code"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          The widget loads asynchronously and won't slow down your site.
        </p>
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
    </WidgetPageShell>
  );
}

export default WidgetInstallation;
