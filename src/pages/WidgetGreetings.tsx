import { useParams } from "react-router-dom";
import GreetingsList from "@/components/GreetingsList";
import {
  WidgetPageShell,
  WidgetPreviewPanel,
  WidgetSectionCard,
  WidgetSettingsLoading,
} from "@/components/WidgetSettings";
import { useWidgetSettings } from "@/hooks/use-widget-settings";

const PAGE_TITLE = "Greetings & News";
const PAGE_DESCRIPTION =
  "Welcome bubbles, announcements, and changelog popups shown above the chat trigger.";

function WidgetGreetings() {
  const { projectId } = useParams<{ projectId: string }>();
  const state = useWidgetSettings(projectId ?? "");

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
      <WidgetSectionCard description="Each greeting saves as you create or edit it.">
        <GreetingsList
          projectId={projectId ?? ""}
          authors={state.authors ?? []}
          onPreviewChange={state.setPreviewGreetings}
        />
      </WidgetSectionCard>
    </WidgetPageShell>
  );
}

export default WidgetGreetings;
