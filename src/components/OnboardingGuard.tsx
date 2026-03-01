import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSubscription } from "@/hooks/use-subscription";

interface Project {
  id: string;
  onboarded: boolean;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { data: projects, isPending: projectsPending } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  const { data: subData, isPending: subPending } = useSubscription();

  if (projectsPending || subPending) {
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
    return <Navigate to="/app/onboarding?step=plan" replace />;
  }

  return <>{children}</>;
}

export default OnboardingGuard;
