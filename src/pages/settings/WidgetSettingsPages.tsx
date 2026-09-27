import { useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { WidgetSettingsLoading } from "@/components/WidgetSettings";
import { useWidgetSettings } from "@/hooks/use-widget-settings";
import { WidgetActionsPanel } from "../QuickActions";
import { WidgetAppearancePanel } from "../WidgetAppearance";

export function AppearanceSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const state = useWidgetSettings(projectId ?? "", {
    defaultPreviewMode: "open",
  });

  if (!projectId || state.isLoading) {
    return (
      <WidgetSettingsLoading
        title="Appearance"
        description="How the chat widget looks on your site."
      />
    );
  }

  return (
    <SettingsPage
      title="Appearance"
      wide
      actions={
        <Button
          type="button"
          onClick={() => state.save.mutate()}
          disabled={state.save.isPending}
          className="transition-transform active:scale-[0.96]"
        >
          <Save className="size-4" />
          {state.save.isPending ? "Saving..." : "Save Changes"}
        </Button>
      }
    >
      <WidgetAppearancePanel state={state} />
    </SettingsPage>
  );
}

export function QuickActionsSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const [showAddForm, setShowAddForm] = useState(false);

  if (!projectId) return null;

  return (
    <SettingsPage
      title="Quick actions"
      description="Buttons on the widget home and above the chat input."
      actions={
        <Button
          type="button"
          onClick={() => setShowAddForm((current) => !current)}
          className="transition-transform active:scale-[0.96]"
        >
          <Plus className="size-4" />
          Add Action
        </Button>
      }
    >
      <WidgetActionsPanel
        projectId={projectId}
        showAddForm={showAddForm}
        onCloseAddForm={() => setShowAddForm(false)}
      />
    </SettingsPage>
  );
}
