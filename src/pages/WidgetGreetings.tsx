import { useRef } from "react";
import { Plus } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import GreetingsList, {
  type GreetingsListHandle,
} from "@/components/GreetingsList";
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
  const listRef = useRef<GreetingsListHandle>(null);

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
      <WidgetSectionCard
        title="Your greetings"
        description="Each greeting saves as you create or edit it."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => listRef.current?.openCreate()}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add greeting
          </Button>
        }
      >
        <GreetingsList
          projectId={projectId ?? ""}
          authors={state.authors ?? []}
          onPreviewChange={state.setPreviewGreetings}
          handleRef={listRef}
        />
      </WidgetSectionCard>
    </WidgetPageShell>
  );
}

export default WidgetGreetings;
