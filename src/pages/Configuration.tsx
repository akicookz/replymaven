import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import WidgetAppearance from "./WidgetAppearance";
import WidgetInstallation from "./WidgetInstallation";
import WidgetGreetings from "./WidgetGreetings";

export default function Configuration() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "appearance";
  return (
    <Tabs value={tab} onValueChange={(v) => setSp({ tab: v }, { replace: true })}>
      <TabsList>
        <TabsTrigger value="appearance">Appearance</TabsTrigger>
        <TabsTrigger value="installation">Installation</TabsTrigger>
        <TabsTrigger value="greetings">Greetings &amp; News</TabsTrigger>
      </TabsList>
      <TabsContent value="appearance"><WidgetAppearance /></TabsContent>
      <TabsContent value="installation"><WidgetInstallation /></TabsContent>
      <TabsContent value="greetings"><WidgetGreetings /></TabsContent>
    </Tabs>
  );
}
