import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Code2, Plus, Save } from "lucide-react";
import { MobileMenuButton } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { WidgetSettingsLoading } from "@/components/WidgetSettings";
import { WidgetInstallationDrawer } from "@/components/widget-installation-drawer";
import { useWidgetSettings } from "@/hooks/use-widget-settings";
import {
  type ChatWidgetTab,
  normalizeChatWidgetTab,
} from "@/lib/dashboard-routes";
import { WidgetActionsPanel } from "./QuickActions";
import { WidgetAppearancePanel } from "./WidgetAppearance";

const PAGE_DESCRIPTION =
  "Control how your support chat looks and what visitors can do.";

function ChatWidget() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAddForm, setShowAddForm] = useState(false);
  const state = useWidgetSettings(projectId ?? "", {
    defaultPreviewMode: "open",
  });
  const activeTab = normalizeChatWidgetTab(searchParams.get("tab"));
  const installationOpen = searchParams.get("install") === "open";

  function setActiveTab(tab: ChatWidgetTab): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (tab === "appearance") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }

  function setInstallationOpen(open: boolean): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (open) next.set("install", "open");
        else next.delete("install");
        return next;
      },
      { replace: true },
    );
  }

  if (!projectId || state.isLoading) {
    return (
      <WidgetSettingsLoading
        title="Chat Widget"
        description={PAGE_DESCRIPTION}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <MobileMenuButton />
          <div>
            <h1 className="text-balance text-xl font-bold text-foreground md:text-2xl">
              Chat Widget
            </h1>
            <p className="mt-1 text-pretty text-xs text-muted-foreground md:text-sm">
              {PAGE_DESCRIPTION}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setInstallationOpen(true)}
            className="min-h-10 transition-transform active:scale-[0.96]"
          >
            <Code2 className="size-4" />
            Installation
          </Button>
          {activeTab === "appearance" ? (
            <Button
              type="button"
              onClick={() => state.save.mutate()}
              disabled={state.save.isPending}
              className="min-h-10 transition-transform active:scale-[0.96]"
            >
              <Save className="size-4" />
              {state.save.isPending ? "Saving..." : "Save Changes"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => setShowAddForm((current) => !current)}
              className="min-h-10 transition-transform active:scale-[0.96]"
            >
              <Plus className="size-4" />
              Add Action
            </Button>
          )}
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ChatWidgetTab)}
      >
        <TabsList aria-label="Chat Widget settings">
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
        </TabsList>
        <TabsContent
          value="appearance"
          forceMount
          className="data-[state=inactive]:hidden"
        >
          <WidgetAppearancePanel state={state} />
        </TabsContent>
        <TabsContent
          value="actions"
          forceMount
          className="data-[state=inactive]:hidden"
        >
          <WidgetActionsPanel
            projectId={projectId}
            showAddForm={showAddForm}
            onCloseAddForm={() => setShowAddForm(false)}
          />
        </TabsContent>
      </Tabs>

      <WidgetInstallationDrawer
        open={installationOpen}
        onOpenChange={setInstallationOpen}
        projectId={projectId}
        embedSnippet={state.embedSnippet}
      />
    </div>
  );
}

export default ChatWidget;
