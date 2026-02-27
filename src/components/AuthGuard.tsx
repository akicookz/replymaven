import { Navigate } from "react-router-dom";
import { useSession } from "@/lib/auth-client";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/?show_auth=true" replace />;
  }

  return <>{children}</>;
}

export default AuthGuard;
