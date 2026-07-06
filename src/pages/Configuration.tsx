import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import WidgetAppearance from "./WidgetAppearance";
import WidgetInstallation from "./WidgetInstallation";
import WidgetGreetings from "./WidgetGreetings";

const SECTIONS = new Set(["appearance", "greetings", "installation"]);

export default function Configuration() {
  const { projectId } = useParams<{ projectId: string }>();
  const [sp, setSp] = useSearchParams();

  // Auto-close moved to Settings; Actions & Tools is a first-level page now
  if (sp.get("section") === "conversation") {
    return (
      <Navigate
        to={`/app/projects/${projectId}/settings?tab=general`}
        replace
      />
    );
  }
  if (sp.get("section") === "actions") {
    const toolsSuffix = sp.get("tab") === "tools" ? "?tab=tools" : "";
    return (
      <Navigate
        to={`/app/projects/${projectId}/quick-actions${toolsSuffix}`}
        replace
      />
    );
  }

  // Legacy links used ?tab= for appearance/installation/greetings; ?tab= now
  // belongs to the Quick Actions sub-tabs.
  const legacyTab = sp.get("tab");
  const section =
    sp.get("section") ??
    (legacyTab && SECTIONS.has(legacyTab) ? legacyTab : "appearance");

  function setSection(v: string) {
    setSp({ section: v }, { replace: true });
  }

  return (
    <Tabs value={section} onValueChange={setSection}>
      <TabsList>
        <TabsTrigger value="appearance">Appearance</TabsTrigger>
        <TabsTrigger value="greetings">Greetings &amp; News</TabsTrigger>
        <TabsTrigger value="installation">Installation</TabsTrigger>
      </TabsList>
      <TabsContent value="appearance"><WidgetAppearance /></TabsContent>
      <TabsContent value="greetings"><WidgetGreetings /></TabsContent>
      <TabsContent value="installation"><WidgetInstallation /></TabsContent>
    </Tabs>
  );
}
