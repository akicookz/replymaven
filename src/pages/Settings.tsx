import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import GeneralSettings from "./GeneralSettings";
import Team from "./Team";
import Billing from "./Billing";
import Profile from "./Profile";
import McpConnections from "./McpConnections";

const TABS = new Set(["general", "team", "billing", "profile", "mcp"]);

export default function Settings() {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("tab") ?? "general";
  // company/conversations were separate tabs before they merged into General
  const tab = TABS.has(raw) ? raw : "general";
  return (
    <Tabs value={tab} onValueChange={(v) => setSp({ tab: v }, { replace: true })}>
      <TabsList className="h-auto max-w-full flex-wrap justify-start">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="mcp">MCP</TabsTrigger>
      </TabsList>
      <TabsContent value="general"><GeneralSettings /></TabsContent>
      <TabsContent value="team"><Team /></TabsContent>
      <TabsContent value="billing"><Billing /></TabsContent>
      <TabsContent value="profile"><Profile /></TabsContent>
      <TabsContent value="mcp"><McpConnections /></TabsContent>
    </Tabs>
  );
}
