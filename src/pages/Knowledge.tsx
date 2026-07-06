import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import HelpCenter from "./HelpCenter";
import Resources from "./Resources";
import Sops from "./Sops";

export default function Knowledge() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "articles";
  return (
    <Tabs value={tab} onValueChange={(v) => setSp({ tab: v }, { replace: true })}>
      <TabsList>
        <TabsTrigger value="articles">Articles</TabsTrigger>
        <TabsTrigger value="sources">External Sources</TabsTrigger>
        <TabsTrigger value="sops">SOPs</TabsTrigger>
      </TabsList>
      <TabsContent value="articles"><HelpCenter /></TabsContent>
      <TabsContent value="sources"><Resources /></TabsContent>
      <TabsContent value="sops"><Sops /></TabsContent>
    </Tabs>
  );
}
