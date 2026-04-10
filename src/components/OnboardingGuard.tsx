import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSubscription } from "@/hooks/use-subscription";

interface Project {
  id: string;
  onboarded: boolean;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { data: subData, isPending: subPending } = useSubscription();

  const isTeamMember =
    subData?.role === "admin" || subData?.role === "member";

  const { data: projects, isPending: projectsPending } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
    enabled: !subPending && subData !== undefined && !isTeamMember,
  });

  if (subPending || subData === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Team members bypass onboarding entirely -- they access the owner's projects
  // and see a profile setup modal on the dashboard instead.
  if (isTeamMember) {
    return <>{children}</>;
  }

  // If the newly-authenticated user has a pending invite for their email,
  // route them straight to the accept page instead of the owner onboarding
  // flow. Once accepted, they come back here as a team member.
  if (subData.pendingInvite) {
    return (
      <Navigate
        to={`/app/team/accept/${subData.pendingInvite.id}`}
        replace
      />
    );
  }

  // For owners, wait for projects query before deciding
  if (projectsPending) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // No projects at all -- go to onboarding
  if (!projects || projects.length === 0) {
    return <Navigate to="/app/onboarding" replace />;
  }

  // Check if there's at least one onboarded project
  const hasOnboarded = projects.some((p) => p.onboarded);
  if (!hasOnboarded) {
    return <Navigate to="/app/onboarding" replace />;
  }

  // Has onboarded projects but no subscription -- go to plan selection
  if (!subData?.subscription) {
    return <Navigate to="/app/onboarding?step=4" replace />;
  }

  return <>{children}</>;
}

export default OnboardingGuard;
