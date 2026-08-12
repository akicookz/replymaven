import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { getLegacySettingsDestination } from "@/lib/dashboard-routes";
import Team from "./Team";
import Billing from "./Billing";
import Profile from "./Profile";

const TABS = new Set(["team", "billing", "profile"]);

export default function Settings() {
  const { projectId } = useParams<{ projectId: string }>();
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("tab") ?? "team";
  const legacyDestination = projectId
    ? getLegacySettingsDestination(projectId, raw)
    : null;

  if (legacyDestination) {
    return <Navigate to={legacyDestination} replace />;
  }

  const tab = TABS.has(raw) ? raw : "team";
  return (
    <Tabs value={tab} onValueChange={(v) => setSp({ tab: v }, { replace: true })}>
      <TabsList className="h-auto max-w-full flex-wrap justify-start">
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="profile">Profile</TabsTrigger>
      </TabsList>
      <TabsContent value="team"><Team /></TabsContent>
      <TabsContent value="billing"><Billing /></TabsContent>
      <TabsContent value="profile"><Profile /></TabsContent>
    </Tabs>
  );
}
