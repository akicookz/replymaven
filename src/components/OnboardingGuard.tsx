import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

interface Project {
  id: string;
  onboarded: boolean;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { data: projects, isPending } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  if (isPending) {
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

  return <>{children}</>;
}

export default OnboardingGuard;
